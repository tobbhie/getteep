import { Router, Request, Response } from "express";
import { getDb } from "../db/database";
import { getUnifiedTipperStats } from "../services/tipperStats";

const router = Router();

/**
 * GET /profile/username/:username
 * Public creator profile by X username (verified claims only).
 * Returns creator stats: totalReceived, tipCount, topPosts.
 */
router.get("/username/:username", (req: Request, res: Response) => {
  const username = (req.params.username as string).replace(/^@/, "").toLowerCase();
  const db = getDb();

  const claim = db.prepare(
    "SELECT author_id, username, display_name, profile_image_url FROM verified_claims WHERE LOWER(username) = ?"
  ).get(username) as { author_id: string; username: string; display_name: string | null; profile_image_url: string | null } | undefined;

  if (!claim) {
    res.status(404).json({ error: "Creator not found or not verified" });
    return;
  }

  const total = db.prepare(
    "SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total, COUNT(*) as count FROM tips WHERE author_id = ?"
  ).get(claim.author_id) as { total: number; count: number } | undefined;

  const topPosts = db.prepare(
    `SELECT t.content_id, SUM(CAST(t.amount AS REAL)) as total, COUNT(*) as count,
              m.tweet_id, m.author_handle
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE t.author_id = ?
       GROUP BY t.content_id
       ORDER BY total DESC
       LIMIT 10`
  ).all(claim.author_id) as Array<{
    content_id: string;
    total: number;
    count: number;
    tweet_id: string | null;
    author_handle: string | null;
  }>;

  const topSupporters = db.prepare(
    `SELECT from_address, SUM(CAST(amount AS REAL)) as total
       FROM tips WHERE author_id = ?
       GROUP BY from_address
       ORDER BY total DESC
       LIMIT 10`
  ).all(claim.author_id) as Array<{ from_address: string; total: number }>;

  res.json({
    username: claim.username,
    displayName: claim.display_name,
    profileImageUrl: claim.profile_image_url,
    authorId: claim.author_id,
    totalReceived: total?.total?.toString() || "0",
    tipCount: total?.count || 0,
    topPosts: topPosts.map((p) => ({
      contentId: p.content_id,
      total: (p.total / 1e6).toString(),
      count: p.count,
      tweetId: p.tweet_id,
      authorHandle: p.author_handle,
    })),
    topSupporters: topSupporters.map((s) => ({
      address: s.from_address,
      total: (s.total / 1e6).toString(),
    })),
  });
});

/**
 * GET /profile/tipper/:address
 * Public tipper profile: total sent, creators supported, etc.
 */
router.get("/tipper/:address", (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const stats = getUnifiedTipperStats(address);

  res.json({
    address,
    totalSent: stats.totalSent,
    tipCount: stats.tipCount,
    creatorsSupported: stats.creatorsSupported,
  });
});

export default router;
