import { Router, Request, Response } from "express";
import { getDb } from "../db/database";
import { keccak256, toBytes } from "viem";
import { isAddress, isBytes32, isUnsignedIntegerString, normalizeHandle, normalizeTweetId } from "../utils/security";
import { getUnifiedTipperStats } from "../services/tipperStats";

const router = Router();

function contentIdFromPost(handle: string, tweetId: string): string {
  const canonical = `x.com/${handle.toLowerCase()}/status/${tweetId}`;
  return keccak256(toBytes(canonical));
}

/**
 * GET /tips/post/:handle/:tweetId
 * Returns tip data for a post by handle and tweet ID (for CTA links).
 */
router.get("/post/:handle/:tweetId", (req: Request, res: Response) => {
  const handle = String(req.params.handle || "").replace(/^@/, "");
  const tweetId = String(req.params.tweetId || "");
  if (!handle || !tweetId) {
    res.status(400).json({ error: "handle and tweetId required" });
    return;
  }
  const contentId = contentIdFromPost(handle, tweetId);
  const db = getDb();

  const total = db
    .prepare(
      "SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total, COUNT(*) as count FROM tips WHERE content_id = ?"
    )
    .get(contentId) as { total: number; count: number } | undefined;

  const recentTips = db
    .prepare(
      "SELECT from_address, amount, tx_hash, timestamp FROM tips WHERE content_id = ? ORDER BY block_number DESC LIMIT 20"
    )
    .all(contentId);

  res.json({
    contentId,
    totalAmount: total?.total?.toString() || "0",
    tipCount: total?.count || 0,
    recentTips,
    handle,
    tweetId,
  });
});

/**
 * GET /tips/:contentId
 * Returns aggregated tip total and recent tips for a specific post
 */
router.get("/:contentId", (req: Request, res: Response) => {
  const { contentId } = req.params;
  const db = getDb();

  const total = db
    .prepare(
      "SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total, COUNT(*) as count FROM tips WHERE content_id = ?"
    )
    .get(contentId) as { total: number; count: number } | undefined;

  const recentTips = db
    .prepare(
      "SELECT from_address, amount, tx_hash, timestamp FROM tips WHERE content_id = ? ORDER BY block_number DESC LIMIT 20"
    )
    .all(contentId);

  res.json({
    contentId,
    totalAmount: total?.total?.toString() || "0",
    tipCount: total?.count || 0,
    recentTips,
  });
});

/**
 * GET /tips/author/:authorId
 * Returns total tips received by an author across all posts
 */
router.get("/author/:authorId", (req: Request, res: Response) => {
  const { authorId } = req.params;
  const db = getDb();

  const total = db
    .prepare(
      "SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total, COUNT(*) as count FROM tips WHERE author_id = ?"
    )
    .get(authorId) as { total: number; count: number } | undefined;

  const topPosts = db
    .prepare(
      `SELECT content_id, SUM(CAST(amount AS REAL)) as total, COUNT(*) as count 
       FROM tips WHERE author_id = ? 
       GROUP BY content_id 
       ORDER BY total DESC 
       LIMIT 10`
    )
    .all(authorId);

  res.json({
    authorId,
    totalReceived: total?.total?.toString() || "0",
    tipCount: total?.count || 0,
    topPosts,
  });
});

/**
 * GET /tips/receipt/:txHash
 * Returns a single tip by transaction hash for the receipt page.
 */
router.get("/receipt/:txHash", (req: Request, res: Response) => {
  const txHash = String(req.params.txHash || "").trim().toLowerCase();
  if (!txHash || !txHash.startsWith("0x")) {
    res.status(400).json({ error: "Valid tx hash required" });
    return;
  }
  const db = getDb();

  const row = db
    .prepare(
      `SELECT t.from_address, t.to_address, t.amount, t.tx_hash, t.timestamp, t.author_id, t.content_id,
              m.author_handle, m.tweet_id
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE LOWER(t.tx_hash) = ?`
    )
    .get(txHash) as {
    from_address: string;
    to_address: string;
    amount: string;
    tx_hash: string;
    timestamp: number;
    author_id: string;
    content_id: string;
    author_handle: string | null;
    tweet_id: string | null;
  } | undefined;

  if (!row) {
    res.status(404).json({ error: "Tip not found for this transaction" });
    return;
  }

  const creatorUsername =
    (db.prepare("SELECT username FROM verified_claims WHERE author_id = ? LIMIT 1").get(row.author_id) as { username: string } | undefined)?.username ||
    row.author_handle ||
    null;

  res.json({
    fromAddress: row.from_address,
    toAddress: row.to_address,
    amount: row.amount,
    txHash: row.tx_hash,
    timestamp: row.timestamp,
    authorId: row.author_id,
    contentId: row.content_id,
    authorHandle: creatorUsername || row.author_handle,
    tweetId: row.tweet_id,
  });
});

const RECEIPT_BASE_URL = process.env.RECEIPT_BASE_URL || "https://tipcoin.xyz";

/**
 * GET /tips/receipt/:txHash/og
 * Returns HTML with Open Graph (and Twitter card) meta tags for link previews.
 * Use when serving receipt URL to crawlers (e.g. reverse proxy or serverless).
 */
router.get("/receipt/:txHash/og", (req: Request, res: Response) => {
  const txHash = String(req.params.txHash || "").trim().toLowerCase();
  if (!txHash || !txHash.startsWith("0x")) {
    res.status(400).send("Invalid tx hash");
    return;
  }
  const db = getDb();

  const row = db
    .prepare(
      `SELECT t.amount, t.tx_hash, t.author_id, m.author_handle
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE LOWER(t.tx_hash) = ?`
    )
    .get(txHash) as { amount: string; tx_hash: string; author_id: string; author_handle: string | null } | undefined;

  if (!row) {
    res.status(404).send("Tip not found");
    return;
  }

  const creatorUsername =
    (db.prepare("SELECT username FROM verified_claims WHERE author_id = ? LIMIT 1").get(row.author_id) as { username: string } | undefined)?.username ||
    row.author_handle ||
    null;
  const creatorLabel = creatorUsername ? `@${creatorUsername}` : "Creator";
  const amountUsd = (Number(row.amount) / 1e6).toFixed(2);
  const receiptUrl = `${RECEIPT_BASE_URL}/tx/${row.tx_hash}`;
  const title = `${creatorLabel} received a $${amountUsd} tip — Teep`;
  const description = "Claim your tip in seconds.";

  res.set("Cache-Control", "public, max-age=300");
  res.type("html");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(receiptUrl)}" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
</head>
<body><p>${escapeHtml(description)}</p><a href="${escapeHtml(receiptUrl)}">View receipt</a></body>
</html>`);
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * GET /tips/wallet/:address
 * Returns tip history for a wallet address (sent tips), joined with metadata
 */
router.get("/wallet/:address", (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  const db = getDb();

  const tips = db
    .prepare(
      `SELECT t.content_id, t.author_id, t.amount, t.tx_hash, t.timestamp,
              m.author_handle, m.tweet_id
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE t.from_address = ?
       ORDER BY t.block_number DESC
       LIMIT ? OFFSET ?`
    )
    .all(address, limit, offset);

  const stats = getUnifiedTipperStats(address);

  res.json({
    address,
    totalSent: stats.totalSent,
    tipCount: stats.tipCount,
    creatorsSupported: stats.creatorsSupported,
    tips,
  });
});

/**
 * POST /tips/metadata
 * Store metadata (author handle, tweet ID) for a tip's content ID.
 */
router.post("/metadata", (req: Request, res: Response) => {
  const { contentId, authorHandle, tweetId } = req.body;
  const handle = normalizeHandle(authorHandle);
  const normalizedTweetId = normalizeTweetId(tweetId);

  if (!isBytes32(contentId) || !handle || !normalizedTweetId) {
    res.status(400).json({ error: "Valid contentId, authorHandle, and tweetId are required" });
    return;
  }

  if (contentIdFromPost(handle, normalizedTweetId).toLowerCase() !== contentId.toLowerCase()) {
    res.status(400).json({ error: "contentId does not match authorHandle and tweetId" });
    return;
  }

  const db = getDb();
  try {
    db.prepare(
      "INSERT OR IGNORE INTO tip_metadata (content_id, author_handle, tweet_id) VALUES (?, ?, ?)"
    ).run(contentId.toLowerCase(), handle, normalizedTweetId);
    res.json({ success: true });
  } catch (err: any) {
    console.error("[Tips] Error storing metadata:", err);
    res.status(500).json({ error: "Failed to store metadata" });
  }
});

/**
 * POST /tips/activity
 * Log a user transaction (send, withdraw, tip_sent, etc.) for history.
 * For type "tip_sent", pass authorHandle and tweetId so history shows "View Post".
 */
router.post("/activity", (req: Request, res: Response) => {
  if (process.env.ALLOW_CLIENT_ACTIVITY_WRITES !== "true") {
    res.status(403).json({ error: "Client activity writes are disabled" });
    return;
  }

  const { type, fromAddress, toAddress, amount, txHash, detail, authorHandle, tweetId } = req.body;

  const allowedTypes = new Set(["tip_sent", "send", "withdraw", "withdraw_balance", "referral_fee_received"]);
  if (
    typeof type !== "string" ||
    !allowedTypes.has(type) ||
    !isAddress(fromAddress) ||
    !isUnsignedIntegerString(amount) ||
    (toAddress != null && !isAddress(toAddress)) ||
    (txHash != null && !isBytes32(txHash))
  ) {
    res.status(400).json({ error: "Invalid activity payload" });
    return;
  }
  const handle = authorHandle == null ? null : normalizeHandle(authorHandle);
  const normalizedTweetId = tweetId == null ? null : normalizeTweetId(tweetId);

  const db = getDb();
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    db.prepare(
      "INSERT INTO user_activity (type, from_address, to_address, amount, tx_hash, detail, author_handle, tweet_id, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      type,
      fromAddress.toLowerCase(),
      toAddress?.toLowerCase() || null,
      amount,
      txHash?.toLowerCase() || null,
      typeof detail === "string" ? detail.slice(0, 200) : null,
      handle,
      normalizedTweetId,
      timestamp
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error("[Tips] Error storing activity:", err);
    res.status(500).json({ error: "Failed to store activity" });
  }
});

/**
 * GET /tips/history/:address
 * Combined history: tips sent, tips received, sends, withdrawals.
 * Only includes tips from the current TIP_CONTRACT_ADDRESS so "earned this week" resets after a new deploy.
 */
router.get("/history/:address", (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const db = getDb();
  const currentContract = (process.env.TIP_CONTRACT_ADDRESS || "").toLowerCase();

  // Tips sent by this user (only from current contract when tip_contract_address is set)
  const tipsSent = currentContract
    ? db.prepare(
        `SELECT 'tip_sent' as type, t.amount, t.tx_hash, t.timestamp,
                m.author_handle, m.tweet_id
         FROM tips t
         LEFT JOIN tip_metadata m ON t.content_id = m.content_id
         WHERE t.from_address = ? AND t.tip_contract_address = ?
         ORDER BY t.timestamp DESC
         LIMIT ?`
      ).all(address, currentContract, limit) as any[]
    : db.prepare(
        `SELECT 'tip_sent' as type, t.amount, t.tx_hash, t.timestamp,
                m.author_handle, m.tweet_id
         FROM tips t
         LEFT JOIN tip_metadata m ON t.content_id = m.content_id
         WHERE t.from_address = ?
         ORDER BY t.timestamp DESC
         LIMIT ?`
      ).all(address, limit) as any[];

  // Tips received (if this user has a verified claim); same contract filter
  const claim = db.prepare(
    "SELECT username, author_id FROM verified_claims WHERE owner_address = ?"
  ).get(address) as { username: string; author_id: string } | undefined;

  let tipsReceived: any[] = [];
  if (claim) {
    tipsReceived = currentContract
      ? db.prepare(
          `SELECT 'tip_received' as type, t.amount, t.tx_hash, t.timestamp,
                  t.from_address as from_addr, m.author_handle, m.tweet_id
           FROM tips t
           LEFT JOIN tip_metadata m ON t.content_id = m.content_id
           WHERE t.author_id = ? AND t.tip_contract_address = ?
           ORDER BY t.timestamp DESC
           LIMIT ?`
        ).all(claim.author_id, currentContract, limit) as any[]
      : db.prepare(
          `SELECT 'tip_received' as type, t.amount, t.tx_hash, t.timestamp,
                  t.from_address as from_addr, m.author_handle, m.tweet_id
           FROM tips t
           LEFT JOIN tip_metadata m ON t.content_id = m.content_id
           WHERE t.author_id = ?
           ORDER BY t.timestamp DESC
           LIMIT ?`
        ).all(claim.author_id, limit) as any[];
  }

  // Other activity (sends, withdrawals, tip_sent before indexer catches up).
  // Exclude referral_fee_received from outbound list — only the referrer (recipient) should see it (activityIn).
  const activityOutRaw = db.prepare(
    `SELECT type, amount, tx_hash, timestamp, to_address, detail, author_handle, tweet_id
     FROM user_activity
     WHERE from_address = ?
     ORDER BY timestamp DESC
     LIMIT ?`
  ).all(address, limit) as any[];
  const activityOut = activityOutRaw.filter((row: any) => row.type !== "referral_fee_received");

  // Incoming activity (e.g. referral_fee_received when this user is the referrer)
  const activityIn = db.prepare(
    `SELECT type, amount, tx_hash, timestamp, to_address, from_address, detail
     FROM user_activity
     WHERE to_address = ?
     ORDER BY timestamp DESC
     LIMIT ?`
  ).all(address, limit) as any[];

  const activity = [...activityOut, ...activityIn];

  // Dedupe by tx_hash: indexer tips take precedence over activity tip_sent
  const seenTxHash = new Set<string>();
  const deduped: any[] = [];
  for (const row of [...tipsSent, ...tipsReceived, ...activity]) {
    const h = row.tx_hash ? String(row.tx_hash).toLowerCase() : null;
    if (h && row.type === "tip_sent" && seenTxHash.has(h)) continue; // drop duplicate tip_sent (activity row)
    if (h) seenTxHash.add(h);
    deduped.push(row);
  }

  const combined = deduped
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);

  res.json({ history: combined });
});

export default router;
