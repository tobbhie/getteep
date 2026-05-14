import { Router, Request, Response } from "express";
import { getDb } from "../db/database";

const router = Router();

function requireOpsToken(req: Request, res: Response): boolean {
  const token = process.env.OPS_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV === "production") {
      res.status(503).json({ error: "OPS_TOKEN is not configured" });
      return false;
    }
    return true;
  }
  const header = req.headers.authorization || "";
  if (header !== `Bearer ${token}`) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

router.get("/events", (req: Request, res: Response) => {
  if (!requireOpsToken(req, res)) return;
  const limit = Math.min(Number(req.query.limit || 50), 100);
  const db = getDb();
  const opsEvents = db.prepare(
    "SELECT level, source, event_type, message, metadata_json, created_at FROM ops_events ORDER BY created_at DESC LIMIT ?"
  ).all(limit);
  const abuseEvents = db.prepare(
    "SELECT severity, event_type, actor_address, counterparty_address, author_id, content_id, tx_hash, reason, metadata_json, status, created_at FROM abuse_events ORDER BY created_at DESC LIMIT ?"
  ).all(limit);
  const securityEvents = db.prepare(
    "SELECT event_type, actor_address, route, reason, created_at FROM security_events ORDER BY created_at DESC LIMIT ?"
  ).all(limit);
  res.json({ opsEvents, abuseEvents, securityEvents });
});

router.get("/abuse/summary", (req: Request, res: Response) => {
  if (!requireOpsToken(req, res)) return;
  const db = getDb();
  const totals = db.prepare(
    "SELECT event_type, severity, status, COUNT(*) as count FROM abuse_events GROUP BY event_type, severity, status ORDER BY count DESC"
  ).all();
  const recent = db.prepare(
    "SELECT severity, event_type, actor_address, counterparty_address, reason, status, created_at FROM abuse_events ORDER BY created_at DESC LIMIT 50"
  ).all();
  res.json({ totals, recent });
});

router.get("/indexer/state", (req: Request, res: Response) => {
  if (!requireOpsToken(req, res)) return;
  const state = getDb()
    .prepare("SELECT last_block, current_block, updated_at, last_success_at, last_error, last_error_at FROM indexer_state WHERE id = 1")
    .get();
  res.json({ state });
});

router.post("/indexer/rewind", (req: Request, res: Response) => {
  if (!requireOpsToken(req, res)) return;
  let fromBlock: bigint;
  try {
    fromBlock = BigInt(String(req.body?.fromBlock ?? ""));
  } catch {
    res.status(400).json({ error: "fromBlock must be a non-negative integer" });
    return;
  }
  if (fromBlock < 0n) {
    res.status(400).json({ error: "fromBlock must be a non-negative integer" });
    return;
  }
  const nextLastBlock = fromBlock > 0n ? fromBlock - 1n : 0n;
  getDb()
    .prepare("UPDATE indexer_state SET last_block = ?, last_error = NULL, updated_at = datetime('now') WHERE id = 1")
    .run(nextLastBlock.toString());
  res.json({
    success: true,
    lastBlock: nextLastBlock.toString(),
    message: `Indexer will resume from block ${fromBlock.toString()} on the next poll.`,
  });
});

router.post("/abuse/:id/status", (req: Request, res: Response) => {
  if (!requireOpsToken(req, res)) return;
  const id = Number(req.params.id);
  const status = String(req.body?.status || "");
  if (!Number.isSafeInteger(id) || !["open", "reviewing", "resolved", "ignored"].includes(status)) {
    res.status(400).json({ error: "Valid id and status required" });
    return;
  }
  getDb().prepare("UPDATE abuse_events SET status = ? WHERE id = ?").run(status, id);
  res.json({ success: true });
});

export default router;
