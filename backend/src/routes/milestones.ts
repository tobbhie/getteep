import { Router, Request, Response } from "express";
import { getDb } from "../db/database";

const router = Router();

const DEFAULT_MILESTONES = [100, 500, 1000]; // USD

/**
 * GET /milestones/pending/:authorId
 * Returns list of { contentId, totalUsd, milestone } for posts that crossed a milestone
 * and have not yet been notified. Used by extension to show "Your post crossed $X!" and tweet prompt.
 */
router.get("/pending/:authorId", (req: Request, res: Response) => {
  const authorId = req.params.authorId;
  const db = getDb();

  const milestones = DEFAULT_MILESTONES;
  const pending: Array<{ contentId: string; totalUsd: number; milestone: number }> = [];

  const posts = db.prepare(
    `SELECT content_id, SUM(CAST(amount AS REAL)) / 1e6 as total_usd
     FROM tips WHERE author_id = ?
     GROUP BY content_id`
  ).all(authorId) as Array<{ content_id: string; total_usd: number }>;

  for (const row of posts) {
    const totalUsd = row.total_usd;
    for (const m of milestones) {
      if (totalUsd < m) continue;
      const notified = db.prepare(
        "SELECT 1 FROM milestone_notified WHERE content_id = ? AND author_id = ? AND milestone_usd = ?"
      ).get(row.content_id, authorId, m);
      if (!notified) {
        pending.push({ contentId: row.content_id, totalUsd, milestone: m });
      }
    }
  }

  res.json({ authorId, pending });
});

/**
 * POST /milestones/notified
 * Body: { contentId, authorId, milestoneUsd }
 * Record that we showed the milestone prompt so we don't repeat.
 */
router.post("/notified", (req: Request, res: Response) => {
  const { contentId, authorId, milestoneUsd } = req.body;

  if (!contentId || !authorId || milestoneUsd == null) {
    res.status(400).json({ error: "contentId, authorId, milestoneUsd required" });
    return;
  }

  const db = getDb();
  db.prepare(
    "INSERT OR IGNORE INTO milestone_notified (content_id, author_id, milestone_usd) VALUES (?, ?, ?)"
  ).run(contentId, authorId, Number(milestoneUsd));

  res.json({ success: true });
});

/**
 * GET /milestones/check/:contentId
 * Returns current total (USD) and which milestones have been reached (for display).
 */
router.get("/check/:contentId", (req: Request, res: Response) => {
  const contentId = req.params.contentId;
  const db = getDb();

  const row = db.prepare(
    "SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) / 1e6 as total_usd FROM tips WHERE content_id = ?"
  ).get(contentId) as { total_usd: number } | undefined;

  const totalUsd = row?.total_usd ?? 0;
  const reached = DEFAULT_MILESTONES.filter((m) => totalUsd >= m);

  res.json({ contentId, totalUsd, reached });
});

export default router;
