import { parseAbiItem, type Log } from "viem";
import { getDb } from "../db/database";
import { getConfiguredChain, getRpcUrl } from "../config/chain";
import { inspectTipForAbuse } from "./abuse";
import { recordOpsEvent } from "./ops";
import { createClaimWalletActivityNotification, createNewTipReceivedNotification, createReceiptReadyNotification, createRepeatSupporterNotification } from "./notifications";
import { createBackendPublicClient, isInsecureRpcTlsEnabled, warnIfInsecureRpcTlsEnabled } from "./rpcClient";

// ABI for the Tipped event
const TIPPED_EVENT = parseAbiItem(
  "event Tipped(bytes32 indexed contentId, uint256 indexed authorId, address indexed from, address to, uint256 amount)"
);

const CLAIM_WALLET_DEPLOYED_EVENT = parseAbiItem(
  "event ClaimWalletDeployed(uint256 indexed authorId, address indexed wallet, address indexed owner)"
);

const CHAIN = getConfiguredChain();
const RPC_URL = getRpcUrl();
const TIP_CONTRACT_ADDRESS = process.env.TIP_CONTRACT_ADDRESS as `0x${string}`;
const X_TIPPING_ROUTER_ADDRESS = process.env.X_TIPPING_ROUTER_ADDRESS as `0x${string}` | undefined;
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS as `0x${string}`;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "5000");
const BATCH_SIZE = BigInt(process.env.INDEXER_BATCH_SIZE || "5000");
const START_BLOCK = BigInt(process.env.INDEXER_START_BLOCK || process.env.DEPLOYMENT_BLOCK || "0");
const CONFIRMATIONS = BigInt(process.env.INDEXER_CONFIRMATIONS || "2");
const RESCAN_BLOCKS = BigInt(process.env.INDEXER_RESCAN_BLOCKS || "100");
// viem default is 10s. Timeout can be caused by: slow Alchemy response, network latency,
// firewall/VPN, or free-tier throttling. Set RPC_TIMEOUT_MS in .env to increase (e.g. 30000).
const RPC_TIMEOUT_MS = parseInt(process.env.RPC_TIMEOUT_MS || "30000", 10) || 30000;
const RESET_TO_START_ON_BOOT = process.env.INDEXER_RESET_TO_START_ON_BOOT === "true";
const ALLOW_INSECURE_RPC_TLS = isInsecureRpcTlsEnabled();

function isAddress(value?: string): value is `0x${string}` {
  return Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value));
}

function tipEventAddresses(): `0x${string}`[] {
  return [TIP_CONTRACT_ADDRESS, X_TIPPING_ROUTER_ADDRESS].filter(isAddress);
}

export class Indexer {
  private client;
  private running = false;

  constructor() {
    this.client = createBackendPublicClient({ url: RPC_URL, timeoutMs: RPC_TIMEOUT_MS });
  }

  async start(): Promise<void> {
    if (!TIP_CONTRACT_ADDRESS || !FACTORY_ADDRESS) {
      console.warn("[Indexer] Contract addresses not configured. Skipping indexer.");
      return;
    }

    this.running = true;
    console.log(`[Indexer] Starting on ${CHAIN.name}, polling every ${POLL_INTERVAL}ms, RPC timeout ${RPC_TIMEOUT_MS}ms`);
    if (ALLOW_INSECURE_RPC_TLS) warnIfInsecureRpcTlsEnabled("Indexer");
    console.log(`[Indexer] TipContract: ${TIP_CONTRACT_ADDRESS}`);
    if (isAddress(X_TIPPING_ROUTER_ADDRESS)) console.log(`[Indexer] XTippingRouter: ${X_TIPPING_ROUTER_ADDRESS}`);
    console.log(`[Indexer] Factory:     ${FACTORY_ADDRESS}`);
    console.log(`[Indexer] Start block: ${START_BLOCK}, confirmations: ${CONFIRMATIONS}, rescan blocks: ${RESCAN_BLOCKS}`);

    await this.prepareStartState();

    this.poll();
  }

  stop(): void {
    this.running = false;
    console.log("[Indexer] Stopped");
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        await this.processNewBlocks();
      } catch (err) {
        console.error("[Indexer] Error processing blocks:", err);
        const message = err instanceof Error ? err.message : String(err);
        try {
          await getDb().prepare("UPDATE indexer_state SET last_error = ?, last_error_at = ? WHERE id = 1")
            .run(message.slice(0, 500), Date.now());
        } catch {}
        await recordOpsEvent({
          level: "error",
          source: "indexer",
          eventType: "poll_error",
          message,
        });
      }
      await sleep(POLL_INTERVAL);
    }
  }

  private async processNewBlocks(): Promise<void> {
    const db = getDb();
    const currentBlock = await this.client.getBlockNumber();
    const confirmedBlock = currentBlock > CONFIRMATIONS ? currentBlock - CONFIRMATIONS : 0n;
    await db.prepare("UPDATE indexer_state SET current_block = ? WHERE id = 1").run(currentBlock.toString());
    const stateRow = await db.prepare("SELECT last_block FROM indexer_state WHERE id = 1").get() as any;
    let lastIndexedBlock = BigInt(stateRow.last_block || "0");

    if (confirmedBlock === 0n) return;

    const lagBlocks = confirmedBlock > lastIndexedBlock ? confirmedBlock - lastIndexedBlock : 0n;

    // Re-scan only when caught up. During recovery, replaying the recent window before every
    // catch-up pass wastes RPC calls and delays newly confirmed tips.
    if (RESCAN_BLOCKS > 0n && lagBlocks <= RESCAN_BLOCKS && lastIndexedBlock > START_BLOCK) {
      const rescanFrom = lastIndexedBlock > RESCAN_BLOCKS ? lastIndexedBlock - RESCAN_BLOCKS + 1n : START_BLOCK;
      const rescanTo = lastIndexedBlock < confirmedBlock ? lastIndexedBlock : confirmedBlock;
      if (rescanFrom <= rescanTo) {
        await this.processRange(rescanFrom, rescanTo, currentBlock, false);
      }
    }

    let fromBlock = lastIndexedBlock === 0n ? START_BLOCK : lastIndexedBlock + 1n;
    if (fromBlock < START_BLOCK) fromBlock = START_BLOCK;
    if (fromBlock > confirmedBlock) return;

    await this.processRange(fromBlock, confirmedBlock, currentBlock, true);
  }

  private async processRange(fromBlock: bigint, toBlock: bigint, currentBlock: bigint, advanceState: boolean): Promise<void> {
    const db = getDb();
    // Process in batches
    let batchFrom = fromBlock;
    while (batchFrom <= toBlock) {
      const batchTo = batchFrom + BATCH_SIZE > toBlock ? toBlock : batchFrom + BATCH_SIZE;

      // Fetch tip events
      const tipLogs = await this.client.getLogs({
        address: tipEventAddresses(),
        event: TIPPED_EVENT,
        fromBlock: batchFrom,
        toBlock: batchTo,
      });

      // Fetch claim wallet deployment events
      const claimLogs = await this.client.getLogs({
        address: FACTORY_ADDRESS,
        event: CLAIM_WALLET_DEPLOYED_EVENT,
        fromBlock: batchFrom,
        toBlock: batchTo,
      });

      if (tipLogs.length > 0) {
        await this.processTipLogs(tipLogs);
      }
      if (claimLogs.length > 0) {
        await this.processClaimLogs(claimLogs);
      }

      if (advanceState) {
        await db.prepare("UPDATE indexer_state SET last_block = ?, current_block = ?, last_success_at = ?, last_error = NULL, updated_at = now() WHERE id = 1")
          .run(batchTo.toString(), currentBlock.toString(), Date.now());
      } else {
        await db.prepare("UPDATE indexer_state SET current_block = ?, last_success_at = ?, last_error = NULL, updated_at = now() WHERE id = 1")
          .run(currentBlock.toString(), Date.now());
      }

      if (tipLogs.length > 0 || claimLogs.length > 0) {
        const mode = advanceState ? "Processed" : "Re-scanned";
        console.log(`[Indexer] ${mode} blocks ${batchFrom}-${batchTo}: ${tipLogs.length} tips, ${claimLogs.length} claims`);
      }

      batchFrom = batchTo + 1n;
    }
  }

  private async processTipLogs(logs: Log[]): Promise<void> {
    const db = getDb();

    const tx = db.transaction(async (txDb) => {
      for (const log of logs) {
        const args = (log as any).args;
        const from = args.from.toLowerCase();
        const to = args.to.toLowerCase();
        const authorId = args.authorId.toString();
        const contentId = args.contentId;
        const amount = args.amount.toString();
        const txHash = String(log.transactionHash).toLowerCase();
        const contractAddr = String(log.address || "").toLowerCase();
        const result = await txDb.prepare(`
          INSERT INTO tips (content_id, author_id, from_address, to_address, amount, tx_hash, block_number, log_index, timestamp, tip_contract_address)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (tx_hash) DO NOTHING
        `).run(
          contentId,
          authorId,
          from,
          to,
          amount,
          txHash,
          Number(log.blockNumber),
          Number(log.logIndex),
          Math.floor(Date.now() / 1000),
          contractAddr || null
        );
        if (result.changes > 0) {
          await inspectTipForAbuse({
            fromAddress: from,
            toAddress: to,
            authorId,
            contentId,
            amountRaw: amount,
            txHash,
          });
          const metadata = await txDb.prepare("SELECT author_handle FROM tip_metadata WHERE content_id = ? LIMIT 1").get(contentId) as { author_handle: string | null } | undefined;
          await createReceiptReadyNotification({
            userAddress: from,
            authorHandle: metadata?.author_handle || null,
            amountRaw: amount,
            txHash,
          });
          const creatorClaim = await txDb
            .prepare("SELECT owner_address, username FROM verified_claims WHERE author_id = ? ORDER BY verified_at DESC LIMIT 1")
            .get(authorId) as { owner_address: string; username: string | null } | undefined;
          if (creatorClaim?.owner_address && creatorClaim.owner_address.toLowerCase() !== from) {
            await createNewTipReceivedNotification({
              creatorOwnerAddress: creatorClaim.owner_address,
              fromAddress: from,
              amountRaw: amount,
              txHash,
              authorHandle: metadata?.author_handle || creatorClaim.username || null,
            });
            const supporterStats = await txDb
              .prepare(
                `SELECT COUNT(*) as "tipCount", COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as "totalRaw"
                 FROM tips
                 WHERE author_id = ? AND LOWER(from_address) = ?`
              )
              .get(authorId, from) as { tipCount: string; totalRaw: string } | undefined;
            if (Number(supporterStats?.tipCount || 0) > 1) {
              await createRepeatSupporterNotification({
                creatorOwnerAddress: creatorClaim.owner_address,
                supporterAddress: from,
                tipCount: Number(supporterStats?.tipCount || 0),
                totalRaw: String(Math.trunc(Number(supporterStats?.totalRaw || 0))),
              });
            }
          }
        }
      }
    });

    await tx();
  }

  private async processClaimLogs(logs: Log[]): Promise<void> {
    const db = getDb();

    const tx = db.transaction(async (txDb) => {
      for (const log of logs) {
        const args = (log as any).args;
        const authorId = args.authorId.toString();
        const walletAddress = args.wallet.toLowerCase();
        const ownerAddress = args.owner.toLowerCase();
        const result = await txDb.prepare(`
          INSERT INTO claim_wallets (author_id, wallet_address, owner_address, deployed_at_block, tx_hash)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (author_id) DO NOTHING
        `).run(
          authorId,
          walletAddress,
          ownerAddress,
          Number(log.blockNumber),
          log.transactionHash
        );
        if (result.changes > 0) {
          await createClaimWalletActivityNotification({
            creatorOwnerAddress: ownerAddress,
            authorId,
            walletAddress,
            txHash: String(log.transactionHash),
          });
        }
      }
    });

    await tx();
  }

  private async prepareStartState(): Promise<void> {
    const db = getDb();
    const stateRow = await db.prepare("SELECT last_block FROM indexer_state WHERE id = 1").get() as any;
    const lastBlock = BigInt(stateRow?.last_block || "0");
    if (RESET_TO_START_ON_BOOT || (lastBlock === 0n && START_BLOCK > 0n)) {
      const newLastBlock = START_BLOCK > 0n ? START_BLOCK - 1n : 0n;
      await db.prepare("UPDATE indexer_state SET last_block = ?, last_error = NULL, updated_at = now() WHERE id = 1")
        .run(newLastBlock.toString());
      await recordOpsEvent({
        level: "info",
        source: "indexer",
        eventType: "start_block_set",
        message: `Indexer positioned at block ${newLastBlock}; next poll starts from ${START_BLOCK}`,
        metadata: { startBlock: START_BLOCK.toString(), resetToStartOnBoot: RESET_TO_START_ON_BOOT },
      });
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
