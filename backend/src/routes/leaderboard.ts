import { Router, Request, Response } from "express";
import { getDb } from "../db/database";

const router = Router();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePeriod(period: string | undefined): { since?: number } | null {
  if (!period || period === "all") return {};
  if (period === "7d") {
    const since = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
    return { since };
  }
  if (period === "30d") {
    const since = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    return { since };
  }
  return null;
}

/**
 * GET /leaderboard/creators
 * Top creators by total received. Query: limit (default 20), period (all | 7d | 30d).
 */
router.get("/creators", async (req: Request, res: Response) => {
  const limit = Math.min(
    parseInt(req.query.limit as string) || DEFAULT_LIMIT,
    MAX_LIMIT
  );
  const period = parsePeriod(req.query.period as string);
  if (period === null) {
    res.status(400).json({ error: "Invalid period. Use 'all', '7d', or '30d'" });
    return;
  }

  const db = getDb();

  const whereClause = period.since != null
    ? "WHERE t.author_id IN (SELECT author_id FROM verified_claims) AND t.timestamp >= ?"
    : "WHERE t.author_id IN (SELECT author_id FROM verified_claims)";
  const args = period.since != null ? [period.since, limit] : [limit];

  const rows = await db.prepare(
    `SELECT t.author_id, SUM(CAST(t.amount AS NUMERIC)) as total, COUNT(*) as tip_count
     FROM tips t
     ${whereClause}
     GROUP BY t.author_id
     ORDER BY total DESC
     LIMIT ?`
  ).all(...args) as Array<{
    author_id: string;
    total: number;
    tip_count: number;
  }>;
  const xBotWhere = period.since != null
    ? `WHERE xbt.status = 'completed'
         AND CAST(xbt.created_at / 1000 AS INTEGER) >= ?
         AND xbt.recipient_x_user_id IN (SELECT author_id FROM verified_claims)
         AND NOT EXISTS (
           SELECT 1 FROM tips t
           WHERE xbt.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(xbt.tx_hash)
         )`
    : `WHERE xbt.status = 'completed'
         AND xbt.recipient_x_user_id IN (SELECT author_id FROM verified_claims)
         AND NOT EXISTS (
           SELECT 1 FROM tips t
           WHERE xbt.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(xbt.tx_hash)
         )`;
  const xBotRows = await db.prepare(
    `SELECT xbt.recipient_x_user_id as author_id,
            SUM(CAST(xbt.amount_raw AS NUMERIC)) as total,
            COUNT(*) as tip_count
     FROM x_bot_tips xbt
     ${xBotWhere}
     GROUP BY xbt.recipient_x_user_id`
  ).all(...(period.since != null ? [period.since] : [])) as Array<{
    author_id: string;
    total: number;
    tip_count: number;
  }>;

  const mergedByAuthor = new Map<string, { author_id: string; total: number; tip_count: number }>();
  for (const row of [...rows, ...xBotRows]) {
    const existing = mergedByAuthor.get(row.author_id) ?? { author_id: row.author_id, total: 0, tip_count: 0 };
    existing.total += Number(row.total || 0);
    existing.tip_count += Number(row.tip_count || 0);
    mergedByAuthor.set(row.author_id, existing);
  }
  const mergedRows = Array.from(mergedByAuthor.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);

  if (mergedRows.length === 0) {
    res.set("Cache-Control", "public, max-age=60");
    res.json({ creators: [] });
    return;
  }

  const authorIds = mergedRows.map((r) => r.author_id);
  const claims = await db.prepare(
    "SELECT author_id, username, display_name, profile_image_url FROM verified_claims WHERE author_id IN (" +
    authorIds.map(() => "?").join(",") +
    ")"
  ).all(...authorIds) as Array<{ author_id: string; username: string; display_name: string | null; profile_image_url: string | null }>;

  const byAuthor = Object.fromEntries(
    claims.map((c) => [c.author_id, { username: c.username, displayName: c.display_name, profileImageUrl: c.profile_image_url }])
  );

  const creators = mergedRows.map((r, i) => ({
    rank: i + 1,
    authorId: r.author_id,
    username: byAuthor[r.author_id]?.username ?? null,
    displayName: byAuthor[r.author_id]?.displayName ?? null,
    profileImageUrl: byAuthor[r.author_id]?.profileImageUrl ?? null,
    totalReceivedUsd: (r.total / 1e6).toFixed(2),
    tipCount: r.tip_count,
  }));

  res.set("Cache-Control", "public, max-age=60");
  res.json({ creators });
});

/**
 * GET /leaderboard/tippers
 * Top tippers by total sent. Query: limit (default 20), period (all | 30d).
 */
router.get("/tippers", async (req: Request, res: Response) => {
  const limit = Math.min(
    parseInt(req.query.limit as string) || DEFAULT_LIMIT,
    MAX_LIMIT
  );
  const period = parsePeriod(req.query.period as string);
  if (period === null) {
    res.status(400).json({ error: "Invalid period. Use 'all', '7d', or '30d'" });
    return;
  }

  const db = getDb();

  const whereClause = period.since != null ? "WHERE timestamp >= ?" : "";
  const args = period.since != null ? [period.since, limit] : [limit];

  const rows = await db.prepare(
    `SELECT from_address, SUM(CAST(amount AS NUMERIC)) as total
     FROM tips
     ${whereClause}
     GROUP BY from_address
     ORDER BY total DESC
     LIMIT ?`
  ).all(...args) as Array<{ from_address: string; total: number }>;
  const xBotWhere = period.since != null
    ? `WHERE status = 'completed'
         AND CAST(created_at / 1000 AS INTEGER) >= ?
         AND NOT EXISTS (
           SELECT 1 FROM tips t
           WHERE x_bot_tips.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(x_bot_tips.tx_hash)
         )`
    : `WHERE status = 'completed'
         AND NOT EXISTS (
           SELECT 1 FROM tips t
           WHERE x_bot_tips.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(x_bot_tips.tx_hash)
         )`;
  const xBotRows = await db.prepare(
    `SELECT sender_address as from_address, SUM(CAST(amount_raw AS NUMERIC)) as total
     FROM x_bot_tips
     ${xBotWhere}
     GROUP BY sender_address`
  ).all(...(period.since != null ? [period.since] : [])) as Array<{ from_address: string; total: number }>;

  const mergedByTipper = new Map<string, { from_address: string; total: number }>();
  for (const row of [...rows, ...xBotRows]) {
    const key = row.from_address.toLowerCase();
    const existing = mergedByTipper.get(key) ?? { from_address: row.from_address, total: 0 };
    existing.total += Number(row.total || 0);
    mergedByTipper.set(key, existing);
  }

  const tippers = Array.from(mergedByTipper.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, limit)
    .map((r, i) => ({
    rank: i + 1,
    address: r.from_address,
    totalSentUsd: (r.total / 1e6).toFixed(2),
  }));

  res.set("Cache-Control", "public, max-age=60");
  res.json({ tippers });
});

export default router;
