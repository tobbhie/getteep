import { Router, Request, Response } from "express";
import { createPublicClient, http } from "viem";
import { getDb } from "../db/database";
import { getConfiguredChain, getRpcUrl } from "../config/chain";
import { summarizeOpenAbuseEvents } from "../services/abuse";

const router = Router();
const INDEXER_MAX_LAG_BLOCKS = Number(process.env.INDEXER_MAX_LAG_BLOCKS || 50);
const INDEXER_MAX_STALE_MS = Number(process.env.INDEXER_MAX_STALE_MS || 5 * 60 * 1000);

router.get("/live", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * GET /health
 * Returns service health and indexer state
 */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const state = db
      .prepare("SELECT last_block, current_block, updated_at, last_success_at, last_error, last_error_at FROM indexer_state WHERE id = 1")
      .get() as {
        last_block: number;
        current_block: number | null;
        updated_at: string;
        last_success_at: number | null;
        last_error: string | null;
        last_error_at: number | null;
      } | undefined;

    const tipCount = db
      .prepare("SELECT COUNT(*) as count FROM tips")
      .get() as { count: number };

    let rpcBlock: string | null = null;
    try {
      const rpcUrl = getRpcUrl();
      if (rpcUrl) {
        const client = createPublicClient({ chain: getConfiguredChain(), transport: http(rpcUrl, { timeout: 8_000 }) });
        rpcBlock = (await client.getBlockNumber()).toString();
      }
    } catch {}

    const indexedBlock = Number(state?.last_block || 0);
    const currentBlock = Number(rpcBlock || state?.current_block || 0);
    const lagBlocks = currentBlock > indexedBlock ? currentBlock - indexedBlock : 0;
    const lastSuccessAt = state?.last_success_at || null;
    const staleMs = lastSuccessAt ? Date.now() - lastSuccessAt : null;
    const indexerHealthy = lagBlocks <= INDEXER_MAX_LAG_BLOCKS && (staleMs == null || staleMs <= INDEXER_MAX_STALE_MS) && !state?.last_error;
    const abuse = summarizeOpenAbuseEvents(5);

    res.json({
      status: indexerHealthy ? "ok" : "degraded",
      indexer: {
        lastBlock: state?.last_block || 0,
        currentBlock,
        lagBlocks,
        lastUpdated: state?.updated_at || null,
        lastSuccessAt: lastSuccessAt ? new Date(lastSuccessAt).toISOString() : null,
        staleMs,
        lastError: state?.last_error || null,
        lastErrorAt: state?.last_error_at ? new Date(state.last_error_at).toISOString() : null,
      },
      thresholds: {
        indexerMaxLagBlocks: INDEXER_MAX_LAG_BLOCKS,
        indexerMaxStaleMs: INDEXER_MAX_STALE_MS,
      },
      totalTipsIndexed: tipCount.count,
      abuse,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: "Database unavailable" });
  }
});

router.get("/ready", async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const state = db
      .prepare("SELECT last_block, current_block, last_success_at, last_error FROM indexer_state WHERE id = 1")
      .get() as { last_block: number; current_block: number | null; last_success_at: number | null; last_error: string | null } | undefined;
    const indexedBlock = Number(state?.last_block || 0);
    const currentBlock = Number(state?.current_block || 0);
    const lagBlocks = currentBlock > indexedBlock ? currentBlock - indexedBlock : 0;
    const staleMs = state?.last_success_at ? Date.now() - state.last_success_at : null;
    const ok = !state?.last_error && lagBlocks <= INDEXER_MAX_LAG_BLOCKS && (staleMs == null || staleMs <= INDEXER_MAX_STALE_MS);
    res.status(ok ? 200 : 503).json({ status: ok ? "ready" : "degraded", lagBlocks, staleMs, lastError: state?.last_error || null });
  } catch {
    res.status(503).json({ status: "error", message: "Database unavailable" });
  }
});

export default router;
