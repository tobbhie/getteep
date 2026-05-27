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
router.get("/creators", (req: Request, res: Response) => {
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

  const rows = db.prepare(
    `SELECT t.author_id, SUM(CAST(t.amount AS REAL)) as total, COUNT(*) as tip_count
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

  if (rows.length === 0) {
    res.set("Cache-Control", "public, max-age=60");
    res.json({ creators: [] });
    return;
  }

  const authorIds = rows.map((r) => r.author_id);
  const claims = db.prepare(
    "SELECT author_id, username, display_name, profile_image_url FROM verified_claims WHERE author_id IN (" +
    authorIds.map(() => "?").join(",") +
    ")"
  ).all(...authorIds) as Array<{ author_id: string; username: string; display_name: string | null; profile_image_url: string | null }>;

  const byAuthor = Object.fromEntries(
    claims.map((c) => [c.author_id, { username: c.username, displayName: c.display_name, profileImageUrl: c.profile_image_url }])
  );

  const creators = rows.map((r, i) => ({
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
router.get("/tippers", (req: Request, res: Response) => {
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

  const rows = db.prepare(
    `SELECT from_address, SUM(CAST(amount AS REAL)) as total
     FROM tips
     ${whereClause}
     GROUP BY from_address
     ORDER BY total DESC
     LIMIT ?`
  ).all(...args) as Array<{ from_address: string; total: number }>;

  const tippers = rows.map((r, i) => ({
    rank: i + 1,
    address: r.from_address,
    totalSentUsd: (r.total / 1e6).toFixed(2),
  }));

  res.set("Cache-Control", "public, max-age=60");
  res.json({ tippers });
});

export default router;
