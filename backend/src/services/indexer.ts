import { createPublicClient, http, parseAbiItem, type Log } from "viem";
import { getDb } from "../db/database";
import { getConfiguredChain, getRpcUrl } from "../config/chain";
import { inspectTipForAbuse } from "./abuse";
import { recordOpsEvent } from "./ops";

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
const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS as `0x${string}`;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "5000");
const BATCH_SIZE = BigInt(process.env.INDEXER_BATCH_SIZE || "9");
const START_BLOCK = BigInt(process.env.INDEXER_START_BLOCK || process.env.DEPLOYMENT_BLOCK || "0");
const CONFIRMATIONS = BigInt(process.env.INDEXER_CONFIRMATIONS || "2");
const RESCAN_BLOCKS = BigInt(process.env.INDEXER_RESCAN_BLOCKS || "100");
// viem default is 10s. Timeout can be caused by: slow Alchemy response, network latency,
// firewall/VPN, or free-tier throttling. Set RPC_TIMEOUT_MS in .env to increase (e.g. 30000).
const RPC_TIMEOUT_MS = parseInt(process.env.RPC_TIMEOUT_MS || "30000", 10) || 30000;
const RESET_TO_START_ON_BOOT = process.env.INDEXER_RESET_TO_START_ON_BOOT === "true";

export class Indexer {
  private client;
  private running = false;

  constructor() {
    this.client = createPublicClient({
      chain: CHAIN,
      transport: http(RPC_URL, { timeout: RPC_TIMEOUT_MS }),
    });
  }

  async start(): Promise<void> {
    if (!TIP_CONTRACT_ADDRESS || !FACTORY_ADDRESS) {
      console.warn("[Indexer] Contract addresses not configured. Skipping indexer.");
      return;
    }

    this.running = true;
    console.log(`[Indexer] Starting on ${CHAIN.name}, polling every ${POLL_INTERVAL}ms, RPC timeout ${RPC_TIMEOUT_MS}ms`);
    console.log(`[Indexer] TipContract: ${TIP_CONTRACT_ADDRESS}`);
    console.log(`[Indexer] Factory:     ${FACTORY_ADDRESS}`);
    console.log(`[Indexer] Start block: ${START_BLOCK}, confirmations: ${CONFIRMATIONS}, rescan blocks: ${RESCAN_BLOCKS}`);

    this.prepareStartState();

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
          getDb().prepare("UPDATE indexer_state SET last_error = ?, last_error_at = ? WHERE id = 1")
            .run(message.slice(0, 500), Date.now());
        } catch {}
        recordOpsEvent({
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
    db.prepare("UPDATE indexer_state SET current_block = ? WHERE id = 1").run(currentBlock.toString());
    const stateRow = db.prepare("SELECT last_block FROM indexer_state WHERE id = 1").get() as any;
    let lastIndexedBlock = BigInt(stateRow.last_block || "0");

    if (confirmedBlock === 0n) return;

    // Re-scan a recent confirmed window each poll. INSERT OR IGNORE makes this cheap and
    // recovers from transient RPC/indexer misses without relying on client-side activity.
    if (RESCAN_BLOCKS > 0n && lastIndexedBlock > START_BLOCK) {
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
        address: TIP_CONTRACT_ADDRESS,
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
        this.processTipLogs(tipLogs);
      }
      if (claimLogs.length > 0) {
        this.processClaimLogs(claimLogs);
      }

      if (advanceState) {
        db.prepare("UPDATE indexer_state SET last_block = ?, current_block = ?, last_success_at = ?, last_error = NULL, updated_at = datetime('now') WHERE id = 1")
          .run(batchTo.toString(), currentBlock.toString(), Date.now());
      } else {
        db.prepare("UPDATE indexer_state SET current_block = ?, last_success_at = ?, last_error = NULL, updated_at = datetime('now') WHERE id = 1")
          .run(currentBlock.toString(), Date.now());
      }

      if (tipLogs.length > 0 || claimLogs.length > 0) {
        const mode = advanceState ? "Processed" : "Re-scanned";
        console.log(`[Indexer] ${mode} blocks ${batchFrom}-${batchTo}: ${tipLogs.length} tips, ${claimLogs.length} claims`);
      }

      batchFrom = batchTo + 1n;
    }
  }

  private processTipLogs(logs: Log[]): void {
    const db = getDb();
    const contractAddr = (TIP_CONTRACT_ADDRESS || "").toLowerCase();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO tips (content_id, author_id, from_address, to_address, amount, tx_hash, block_number, log_index, timestamp, tip_contract_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (const log of logs) {
        const args = (log as any).args;
        const from = args.from.toLowerCase();
        const to = args.to.toLowerCase();
        const authorId = args.authorId.toString();
        const contentId = args.contentId;
        const amount = args.amount.toString();
        const txHash = String(log.transactionHash).toLowerCase();
        const result = insert.run(
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
          inspectTipForAbuse({
            fromAddress: from,
            toAddress: to,
            authorId,
            contentId,
            amountRaw: amount,
            txHash,
          });
        }
      }
    });

    tx();
  }

  private processClaimLogs(logs: Log[]): void {
    const db = getDb();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO claim_wallets (author_id, wallet_address, owner_address, deployed_at_block, tx_hash)
      VALUES (?, ?, ?, ?, ?)
    `);

    const tx = db.transaction(() => {
      for (const log of logs) {
        const args = (log as any).args;
        insert.run(
          args.authorId.toString(),
          args.wallet.toLowerCase(),
          args.owner.toLowerCase(),
          Number(log.blockNumber),
          log.transactionHash
        );
      }
    });

    tx();
  }

  private prepareStartState(): void {
    const db = getDb();
    const stateRow = db.prepare("SELECT last_block FROM indexer_state WHERE id = 1").get() as any;
    const lastBlock = BigInt(stateRow?.last_block || "0");
    if (RESET_TO_START_ON_BOOT || (lastBlock === 0n && START_BLOCK > 0n)) {
      const newLastBlock = START_BLOCK > 0n ? START_BLOCK - 1n : 0n;
      db.prepare("UPDATE indexer_state SET last_block = ?, last_error = NULL, updated_at = datetime('now') WHERE id = 1")
        .run(newLastBlock.toString());
      recordOpsEvent({
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
