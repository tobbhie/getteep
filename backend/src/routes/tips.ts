import { Router, Request, Response } from "express";
import { getDb } from "../db/database";
import { keccak256, toBytes } from "viem";
import { isAddress, isBytes32, isUnsignedIntegerString, normalizeHandle, normalizeTweetId } from "../utils/security";
import { getUnifiedTipperStats } from "../services/tipperStats";
import { createReceiptReadyNotification } from "../services/notifications";
import { getUserSettings, publicIdentity } from "../services/userSettings";
import { getAccountActivity } from "../services/accountActivity";
import { verifyWalletProof } from "../services/walletAuth";

const router = Router();

function contentIdFromPost(handle: string, tweetId: string): string {
  const canonical = `x.com/${handle.toLowerCase()}/status/${tweetId}`;
  return keccak256(toBytes(canonical));
}

function contentIdFromDirectCreator(authorId: string): string {
  return keccak256(toBytes(`teep:direct:x:${authorId}`));
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
              m.author_handle, m.tweet_id, COALESCE(m.kind, 'post_tip') as kind
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
    kind: string | null;
  } | undefined;

  if (!row) {
    const funding = db
      .prepare(
        `SELECT user_address, metadata_json, created_at
         FROM funding_provider_sessions
         WHERE LOWER(COALESCE(json_extract(metadata_json, '$.txHash'), json_extract(metadata_json, '$.hash'), provider_session_id)) = ?
         LIMIT 1`
      )
      .get(txHash) as { user_address: string; metadata_json: string | null; created_at: number } | undefined;
    if (funding) {
      let metadata: any = {};
      try {
        metadata = funding.metadata_json ? JSON.parse(funding.metadata_json) : {};
      } catch {
        metadata = {};
      }
      const amountRaw = metadata.amountRaw && String(metadata.amountRaw).length <= 18
        ? String(metadata.amountRaw)
        : String(Math.round(Number(metadata.amount || 0) * 1e6));
      const identity = publicIdentity(funding.user_address);
      res.json({
        fromAddress: null,
        fromIdentity: "Funding source",
        toAddress: funding.user_address,
        amount: amountRaw,
        displayAmount: true,
        txHash,
        timestamp: Math.floor(funding.created_at / 1000),
        authorId: "",
        contentId: "",
        authorHandle: null,
        tweetId: null,
        kind: "deposit",
        receiptPreferences: getUserSettings(funding.user_address).receipts,
        accountIdentity: identity.label,
      });
      return;
    }

    const withdrawal = db
      .prepare(
        `SELECT owner_address, destination_address, amount_raw, created_at
         FROM withdrawal_records
         WHERE LOWER(tx_hash) = ?
         LIMIT 1`
      )
      .get(txHash) as { owner_address: string; destination_address: string; amount_raw: string; created_at: number } | undefined;
    if (withdrawal) {
      const senderSettings = getUserSettings(withdrawal.owner_address);
      const senderIdentity = publicIdentity(withdrawal.owner_address);
      res.json({
        fromAddress: senderSettings.privacy.hideAddress ? null : withdrawal.owner_address,
        fromIdentity: senderIdentity.label,
        toAddress: withdrawal.destination_address,
        amount: withdrawal.amount_raw,
        displayAmount: senderSettings.receipts.shareAmountEnabled,
        txHash,
        timestamp: Math.floor(withdrawal.created_at / 1000),
        authorId: "",
        contentId: "",
        authorHandle: null,
        tweetId: null,
        kind: "withdrawal",
        receiptPreferences: senderSettings.receipts,
      });
      return;
    }

    const referral = db
      .prepare(
        `SELECT from_address, to_address, amount, timestamp
         FROM user_activity
         WHERE LOWER(tx_hash) = ? AND type = 'referral_fee_received'
         LIMIT 1`
      )
      .get(txHash) as { from_address: string; to_address: string; amount: string; timestamp: number } | undefined;
    if (referral) {
      const settings = getUserSettings(referral.to_address);
      const identity = publicIdentity(referral.to_address);
      res.json({
        fromAddress: null,
        fromIdentity: "Referral network",
        toAddress: referral.to_address,
        amount: referral.amount,
        displayAmount: settings.receipts.shareAmountEnabled,
        txHash,
        timestamp: referral.timestamp,
        authorId: "",
        contentId: "",
        authorHandle: null,
        tweetId: null,
        kind: "referral_fee_received",
        receiptPreferences: settings.receipts,
        accountIdentity: identity.label,
      });
      return;
    }

    res.status(404).json({ error: "Teep receipt not found for this transaction" });
    return;
  }

  const creatorUsername =
    (db.prepare("SELECT username FROM verified_claims WHERE author_id = ? LIMIT 1").get(row.author_id) as { username: string } | undefined)?.username ||
    row.author_handle ||
    null;
  const senderSettings = getUserSettings(row.from_address);
  const senderIdentity = publicIdentity(row.from_address);

  res.json({
    fromAddress: senderSettings.privacy.hideAddress ? null : row.from_address,
    fromIdentity: senderIdentity.label,
    toAddress: row.to_address,
    amount: row.amount,
    displayAmount: senderSettings.receipts.shareAmountEnabled,
    txHash: row.tx_hash,
    timestamp: row.timestamp,
    authorId: row.author_id,
    contentId: row.content_id,
    authorHandle: creatorUsername || row.author_handle,
    tweetId: row.tweet_id,
    kind: row.kind || "post_tip",
    receiptPreferences: senderSettings.receipts,
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
      `SELECT t.amount, t.tx_hash, t.author_id, t.from_address, m.author_handle
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE LOWER(t.tx_hash) = ?`
    )
    .get(txHash) as { amount: string; tx_hash: string; author_id: string; from_address: string; author_handle: string | null } | undefined;

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
  const senderSettings = getUserSettings(row.from_address);
  const title = senderSettings.receipts.shareAmountEnabled
    ? `${creatorLabel} received a $${amountUsd} tip on Teep`
    : `${creatorLabel} received a tip on Teep`;
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
 * Store metadata for a tip's content ID.
 */
router.post("/metadata", (req: Request, res: Response) => {
  const { contentId, authorHandle, tweetId, authorId, kind } = req.body;
  const metadataKind = kind === "direct_creator_tip" ? "direct_creator_tip" : "post_tip";
  const handle = normalizeHandle(authorHandle);
  const normalizedTweetId = normalizeTweetId(tweetId);

  if (!isBytes32(contentId) || !handle) {
    res.status(400).json({ error: "Valid contentId and authorHandle are required" });
    return;
  }

  if (metadataKind === "post_tip") {
    if (!normalizedTweetId) {
      res.status(400).json({ error: "tweetId is required for post tips" });
      return;
    }
    if (contentIdFromPost(handle, normalizedTweetId).toLowerCase() !== contentId.toLowerCase()) {
      res.status(400).json({ error: "contentId does not match authorHandle and tweetId" });
      return;
    }
  } else {
    if (!isUnsignedIntegerString(authorId)) {
      res.status(400).json({ error: "authorId is required for direct creator tips" });
      return;
    }
    if (contentIdFromDirectCreator(authorId).toLowerCase() !== contentId.toLowerCase()) {
      res.status(400).json({ error: "contentId does not match direct creator tip authorId" });
      return;
    }
  }

  const db = getDb();
  try {
    db.prepare(
      "INSERT OR IGNORE INTO tip_metadata (content_id, author_handle, tweet_id, kind) VALUES (?, ?, ?, ?)"
    ).run(contentId.toLowerCase(), handle, normalizedTweetId || "", metadataKind);
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
router.post("/activity", async (req: Request, res: Response) => {
  if (process.env.ALLOW_CLIENT_ACTIVITY_WRITES !== "true") {
    res.status(403).json({ error: "Client activity writes are disabled" });
    return;
  }

  const { type, fromAddress, toAddress, amount, txHash, detail, authorHandle, tweetId, walletProof } = req.body;

  const allowedTypes = new Set(["tip_sent", "direct_creator_tip", "send", "withdraw", "withdraw_balance", "referral_fee_received"]);
  if (
    typeof type !== "string" ||
    !allowedTypes.has(type) ||
    !isAddress(fromAddress) ||
    !isUnsignedIntegerString(amount) ||
    (toAddress != null && !isAddress(toAddress)) ||
    !isBytes32(txHash)
  ) {
    res.status(400).json({ error: "Invalid activity payload" });
    return;
  }

  const verified = await verifyWalletProof(fromAddress, "activity-write", walletProof);
  if (!verified) {
    res.status(401).json({ error: "Valid wallet proof required for activity writes" });
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
      txHash.toLowerCase(),
      typeof detail === "string" ? detail.slice(0, 200) : null,
      handle,
      normalizedTweetId,
      timestamp
    );
    createReceiptReadyNotification({
      userAddress: fromAddress.toLowerCase(),
      txHash: txHash.toLowerCase(),
      amountRaw: amount,
      authorHandle: handle,
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error("[Tips] Error storing activity:", err);
    res.status(500).json({ error: "Failed to store activity" });
  }
});

/**
 * GET /tips/history/:address
 * Combined history: tips sent, tips received, deposits, sends, withdrawals.
 * Only includes tips from the current TIP_CONTRACT_ADDRESS so "earned this week" resets after a new deploy.
 */
router.get("/history/:address", (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  if (!isAddress(address)) {
    res.status(400).json({ error: "Valid address required" });
    return;
  }

  res.json({
    history: getAccountActivity({
      address,
      limit,
      tipContractAddress: process.env.TIP_CONTRACT_ADDRESS,
    }),
  });
});

export default router;
