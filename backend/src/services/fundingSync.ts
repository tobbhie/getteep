import { decodeEventLog, formatUnits, parseAbiItem, toHex, type Address, type Log } from "viem";
import { getDb } from "../db/database";
import { ARC_TESTNET_USDC, getRpcUrl } from "../config/chain";
import { createBackendPublicClient } from "./rpcClient";
import { createDepositConfirmedNotification } from "./notifications";

const ERC20_TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const RPC_URL = getRpcUrl();
const USDC_ADDRESS = (process.env.MOCK_USDC_ADDRESS || process.env.USDC_ADDRESS || ARC_TESTNET_USDC) as Address;
const USDC_DECIMALS = Number(process.env.USDC_DECIMALS || "6");

// Arc emits native USDC balance movements through this system log on testnet.
const ARC_NATIVE_USDC_EVENT_ADDRESS = (process.env.ARC_NATIVE_USDC_EVENT_ADDRESS || "0x1800000000000000000000000000000000000000") as Address;
const ARC_NATIVE_USDC_TRANSFER_TOPIC = (process.env.ARC_NATIVE_USDC_TRANSFER_TOPIC ||
  "0x62f084c00a442dcf51cdbb51beed2839bf42a268da8474b0e98f38edb7db5a22") as `0x${string}`;
const ARC_NATIVE_USDC_DECIMALS = Number(process.env.ARC_NATIVE_USDC_DECIMALS || "18");

const CONFIRMATIONS = BigInt(process.env.FUNDING_SYNC_CONFIRMATIONS || process.env.INDEXER_CONFIRMATIONS || "2");
const BATCH_BLOCKS = BigInt(process.env.FUNDING_SYNC_BATCH_BLOCKS || "5000");
const MAX_BLOCKS_PER_SYNC = BigInt(process.env.FUNDING_SYNC_MAX_BLOCKS_PER_RUN || "250000");
const LOOKBACK_BLOCKS = BigInt(process.env.FUNDING_SYNC_LOOKBACK_BLOCKS || "250000");

type InboundFundingLog = {
  provider: "Arc USDC";
  source: "erc20_transfer" | "arc_native_transfer";
  from: string;
  to: string;
  amountRaw: bigint;
  decimals: number;
  txHash: string;
  blockNumber: bigint;
  logIndex: number;
};

const blockTimestampCache = new Map<string, number>();

export async function syncInboundUsdcFunding(userAddress: string): Promise<void> {
  const address = userAddress.toLowerCase() as Address;
  const client = createBackendPublicClient({ url: RPC_URL });
  const currentBlock = await client.getBlockNumber();
  const confirmedBlock = currentBlock > CONFIRMATIONS ? currentBlock - CONFIRMATIONS : 0n;
  if (confirmedBlock <= 0n) return;

  const db = getDb();
  const state = db.prepare("SELECT last_block as lastBlock FROM funding_sync_state WHERE user_address = ?").get(address) as { lastBlock: number } | undefined;
  const configuredStart = BigInt(process.env.FUNDING_SYNC_START_BLOCK || "0");
  const defaultStart = confirmedBlock > LOOKBACK_BLOCKS ? confirmedBlock - LOOKBACK_BLOCKS : 0n;
  const latestWindowStart = confirmedBlock > MAX_BLOCKS_PER_SYNC ? confirmedBlock - MAX_BLOCKS_PER_SYNC + 1n : 0n;
  const initialStart = configuredStart > 0n ? configuredStart : defaultStart > latestWindowStart ? defaultStart : latestWindowStart;
  const stateStart = state?.lastBlock ? BigInt(state.lastBlock) + 1n : 0n;
  const fromBlock = stateStart > initialStart ? stateStart : initialStart;
  const maxToBlock = fromBlock + MAX_BLOCKS_PER_SYNC - 1n;
  const toBlock = maxToBlock < confirmedBlock ? maxToBlock : confirmedBlock;
  if (fromBlock > toBlock) return;

  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const batchTo = cursor + BATCH_BLOCKS - 1n < toBlock ? cursor + BATCH_BLOCKS - 1n : toBlock;
    const logs = [
      ...(await fetchErc20InboundLogs(client, address, cursor, batchTo)),
      ...(await fetchNativeInboundLogs(client, address, cursor, batchTo)),
    ];
    for (const log of logs) {
      const createdAt = await getBlockCreatedAt(client, log.blockNumber);
      recordInboundFunding(log, createdAt);
    }
    cursor = batchTo + 1n;
  }

  db.prepare(`
    INSERT INTO funding_sync_state (user_address, last_block, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_address) DO UPDATE SET last_block = excluded.last_block, updated_at = excluded.updated_at
  `).run(address, Number(toBlock), Date.now());
}

async function fetchErc20InboundLogs(client: ReturnType<typeof createBackendPublicClient>, address: Address, fromBlock: bigint, toBlock: bigint): Promise<InboundFundingLog[]> {
  const logs = await client.getLogs({
    address: USDC_ADDRESS,
    event: ERC20_TRANSFER_EVENT,
    args: { to: address },
    fromBlock,
    toBlock,
  });

  return logs.map((log: Log) => {
    const decoded = decodeEventLog({ abi: [ERC20_TRANSFER_EVENT], data: log.data, topics: log.topics });
    const args = decoded.args as { from: Address; to: Address; value: bigint };
    return {
      provider: "Arc USDC",
      source: "erc20_transfer",
      from: args.from.toLowerCase(),
      to: args.to.toLowerCase(),
      amountRaw: args.value,
      decimals: USDC_DECIMALS,
      txHash: String(log.transactionHash).toLowerCase(),
      blockNumber: BigInt(log.blockNumber || 0n),
      logIndex: Number(log.logIndex || 0),
    };
  });
}

async function fetchNativeInboundLogs(client: ReturnType<typeof createBackendPublicClient>, address: Address, fromBlock: bigint, toBlock: bigint): Promise<InboundFundingLog[]> {
  const logs = await (client as any).request({
    method: "eth_getLogs",
    params: [{
      address: ARC_NATIVE_USDC_EVENT_ADDRESS,
      topics: [ARC_NATIVE_USDC_TRANSFER_TOPIC, null, padAddressTopic(address)],
      fromBlock: toHex(fromBlock),
      toBlock: toHex(toBlock),
    }],
  }) as Log[];

  return logs.map((log: Log) => ({
    provider: "Arc USDC",
    source: "arc_native_transfer",
    from: topicToAddress(log.topics[1]),
    to: topicToAddress(log.topics[2]),
    amountRaw: BigInt(log.data || "0x0"),
    decimals: ARC_NATIVE_USDC_DECIMALS,
    txHash: String(log.transactionHash).toLowerCase(),
    blockNumber: BigInt(log.blockNumber || 0n),
    logIndex: Number(log.logIndex || 0),
  }));
}

async function getBlockCreatedAt(client: ReturnType<typeof createBackendPublicClient>, blockNumber: bigint): Promise<number> {
  const key = blockNumber.toString();
  const cached = blockTimestampCache.get(key);
  if (cached) return cached;
  const block = await client.getBlock({ blockNumber });
  const createdAt = Number(block.timestamp) * 1000;
  blockTimestampCache.set(key, createdAt);
  return createdAt;
}

function recordInboundFunding(log: InboundFundingLog, createdAt: number): void {
  if (log.from === log.to) return;
  const id = `${log.source}:${log.txHash}:${log.logIndex}`;
  const amount = formatUnits(log.amountRaw, log.decimals);
  const amountRawUsdc = log.decimals === 6 ? log.amountRaw.toString() : (log.amountRaw / 10n ** BigInt(log.decimals - 6)).toString();
  const result = getDb().prepare(`
    INSERT OR IGNORE INTO funding_provider_sessions (
      id, provider, provider_session_id, kind, user_address, status, redirect_url, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    log.provider,
    `${log.txHash}:${log.logIndex}`,
    "crypto_receive",
    log.to,
    "completed",
    null,
    JSON.stringify({
      amount,
      amountRaw: amountRawUsdc,
      chainAmountRaw: log.amountRaw.toString(),
      asset: "USDC",
      txHash: log.txHash,
      from: log.from,
      blockNumber: Number(log.blockNumber),
      logIndex: log.logIndex,
      source: log.source,
    }),
    createdAt,
    Date.now()
  );
  if (result.changes > 0) {
    createDepositConfirmedNotification({
      userAddress: log.to,
      amountRaw: amountRawUsdc,
      txHash: log.txHash,
    });
  }
}

function padAddressTopic(address: string): `0x${string}` {
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

function topicToAddress(topic?: `0x${string}`): string {
  if (!topic) return "";
  return `0x${topic.slice(-40)}`.toLowerCase();
}
