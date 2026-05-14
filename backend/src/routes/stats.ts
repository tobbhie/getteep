import { Router, Request, Response } from "express";
import { getDb } from "../db/database";

const router = Router();

/**
 * GET /stats
 * Public stats: total tips, volume, distinct tippers, verified creators.
 * Read-only, cacheable (e.g. Cache-Control: public, max-age=60).
 */
router.get("/", (req: Request, res: Response) => {
  const db = getDb();

  const tipsAgg = db.prepare(
    `SELECT
       COUNT(*) as total_tips,
       COALESCE(SUM(CAST(amount AS REAL)), 0) as total_volume,
       COUNT(DISTINCT from_address) as distinct_tippers
     FROM tips`
  ).get() as { total_tips: number; total_volume: number; distinct_tippers: number };

  const creatorsCount = db.prepare(
    "SELECT COUNT(DISTINCT author_id) as count FROM verified_claims"
  ).get() as { count: number };

  res.set("Cache-Control", "public, max-age=60");
  res.json({
    totalTips: tipsAgg.total_tips,
    totalVolumeUsd: (tipsAgg.total_volume / 1e6).toFixed(2),
    distinctTippers: tipsAgg.distinct_tippers,
    verifiedCreators: creatorsCount.count,
  });
});

/**
 * GET /stats/recent-tips
 * Returns latest tips for landing page: amountUsd, username (creator handle).
 */
router.get("/recent-tips", (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 15, 50);
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT t.amount, t.author_id, t.from_address, t.timestamp, t.content_id,
              m.author_handle AS meta_handle, m.tweet_id AS meta_tweet_id
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       ORDER BY t.timestamp DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
      amount: string;
      author_id: string;
      from_address: string;
      timestamp: number;
      content_id: string;
      meta_handle: string | null;
      meta_tweet_id: string | null;
    }>;

  const authorIds = [...new Set(rows.map((r) => r.author_id))];
  const claims =
    authorIds.length > 0
      ? (db
          .prepare(
            "SELECT author_id, username FROM verified_claims WHERE author_id IN (" +
              authorIds.map(() => "?").join(",") +
              ")"
          )
          .all(...authorIds) as Array<{ author_id: string; username: string }>)
      : [];
  const byAuthor = Object.fromEntries(claims.map((c) => [c.author_id, c.username]));

  const recentTips = rows.map((r) => {
    const postUrl =
      r.meta_handle && r.meta_tweet_id
        ? `https://x.com/${r.meta_handle}/status/${r.meta_tweet_id}`
        : null;
    return {
      amountUsd: (Number(r.amount) / 1e6).toFixed(2),
      creatorUsername: byAuthor[r.author_id] ?? null,
      postAuthorHandle: r.meta_handle ?? null,
      fromAddress: r.from_address,
      timestamp: r.timestamp,
      postUrl,
    };
  });

  res.set("Cache-Control", "public, max-age=60");
  res.json({ recentTips });
});

export default router;
