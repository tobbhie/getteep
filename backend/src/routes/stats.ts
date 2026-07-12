import { Router, Request, Response } from "express";
import { getDb } from "../db/database";
import { resolveAddressIdentities } from "../services/identity";

const router = Router();

/**
 * GET /stats
 * Public stats: total tips, volume, distinct tippers, verified creators.
 * Read-only, cacheable (e.g. Cache-Control: public, max-age=60).
 */
router.get("/", async (req: Request, res: Response) => {
  const db = getDb();

  const tipsAgg = await db.prepare(
    `SELECT
       COUNT(*) as total_tips,
       COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total_volume,
       COUNT(DISTINCT from_address) as distinct_tippers
     FROM tips`
  ).get() as { total_tips: string; total_volume: string; distinct_tippers: string };
  const xBotAgg = await db.prepare(
    `SELECT
       COUNT(*) as total_tips,
       COALESCE(SUM(CAST(xbt.amount_raw AS NUMERIC)), 0) as total_volume
     FROM x_bot_tips xbt
     WHERE xbt.status = 'completed'
       AND NOT EXISTS (
         SELECT 1 FROM tips t
         WHERE xbt.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(xbt.tx_hash)
       )`
  ).get() as { total_tips: string; total_volume: string };
  const xBotTippers = await db.prepare(
    `SELECT DISTINCT LOWER(sender_address) as address
     FROM x_bot_tips xbt
     WHERE xbt.status = 'completed'
       AND NOT EXISTS (
         SELECT 1 FROM tips t
         WHERE xbt.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(xbt.tx_hash)
       )`
  ).all() as Array<{ address: string }>;
  const indexedTippers = await db.prepare("SELECT DISTINCT LOWER(from_address) as address FROM tips").all() as Array<{ address: string }>;

  const creatorsCount = await db.prepare(
    "SELECT COUNT(DISTINCT author_id) as count FROM verified_claims"
  ).get() as { count: string };

  res.set("Cache-Control", "public, max-age=60");
  res.json({
    totalTips: Number(tipsAgg.total_tips) + Number(xBotAgg.total_tips),
    totalVolumeUsd: ((Number(tipsAgg.total_volume) + Number(xBotAgg.total_volume)) / 1e6).toFixed(2),
    distinctTippers: new Set([...indexedTippers, ...xBotTippers].map((row) => row.address)).size,
    verifiedCreators: Number(creatorsCount.count),
  });
});

/**
 * GET /stats/recent-tips
 * Returns latest tips for landing page: amountUsd, username (creator handle).
 */
router.get("/recent-tips", async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 15, 50);
  const db = getDb();

  const rows = await db
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
  const xBotRows = await db
    .prepare(
      `SELECT xbt.amount_raw as amount,
              xbt.recipient_x_user_id as author_id,
              xbt.sender_address as from_address,
              CAST(xbt.created_at / 1000 AS INTEGER) as timestamp,
              xbt.recipient_x_username as meta_handle,
              xbt.source_tweet_id as meta_tweet_id
       FROM x_bot_tips xbt
       WHERE xbt.status = 'completed'
         AND NOT EXISTS (
           SELECT 1 FROM tips t
           WHERE xbt.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(xbt.tx_hash)
         )
       ORDER BY xbt.created_at DESC
       LIMIT ?`
    )
    .all(limit) as Array<{
      amount: string;
      author_id: string;
      from_address: string;
      timestamp: number;
      meta_handle: string | null;
      meta_tweet_id: string | null;
    }>;
  const mergedRows = [...rows, ...xBotRows]
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
    .slice(0, limit);

  const authorIds = [...new Set(mergedRows.map((r) => r.author_id))];
  const claims =
    authorIds.length > 0
      ? (await db
          .prepare(
            "SELECT author_id, username FROM verified_claims WHERE author_id IN (" +
              authorIds.map(() => "?").join(",") +
              ")"
          )
          .all(...authorIds) as Array<{ author_id: string; username: string }>)
      : [];
  const byAuthor = Object.fromEntries(claims.map((c) => [c.author_id, c.username]));
  const identities = await resolveAddressIdentities(mergedRows.map((r) => r.from_address));

  const recentTips = mergedRows.map((r) => {
    const postUrl =
      r.meta_handle && r.meta_tweet_id
        ? `https://x.com/${r.meta_handle}/status/${r.meta_tweet_id}`
        : null;
    const senderIdentity = identities.get(r.from_address.toLowerCase());
    return {
      amountUsd: (Number(r.amount) / 1e6).toFixed(2),
      creatorUsername: byAuthor[r.author_id] ?? r.meta_handle ?? null,
      postAuthorHandle: r.meta_handle ?? null,
      fromAddress: r.from_address,
      fromIdentity: senderIdentity
        ? {
            displayName: senderIdentity.displayName,
            teepUsername: senderIdentity.teepUsername,
            socialXHandle: senderIdentity.socialXHandle,
            creatorUsername: senderIdentity.creatorUsername,
            creatorDisplayName: senderIdentity.creatorDisplayName,
            profileImageUrl: senderIdentity.profileImageUrl,
          }
        : { displayName: "Teep supporter" },
      timestamp: r.timestamp,
      postUrl,
    };
  });

  res.set("Cache-Control", "public, max-age=60");
  res.json({ recentTips });
});

export default router;
