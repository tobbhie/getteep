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

type CreatorClaimStatus = "verified" | "unclaimed" | "claim_wallet_active";

type XBotTipReceiptRow = {
  sender_address: string;
  recipient_address: string | null;
  recipient_x_user_id: string;
  recipient_x_username: string | null;
  amount_raw: string;
  source_tweet_id: string;
  receipt_id: string;
  tx_hash: string | null;
  created_at: number;
  tip_kind?: string | null;
  content_id?: string | null;
  context_tweet_id?: string | null;
  context_author_id?: string | null;
  context_author_username?: string | null;
  context_author_name?: string | null;
  context_author_profile_image_url?: string | null;
};

type ClaimableTipReceiptRow = {
  sender_address: string;
  recipient_x_user_id?: string | null;
  recipient_x_username: string;
  amount_raw: string;
  source_tweet_id: string;
  receipt_id: string | null;
  status: string;
  created_at: number;
  expires_at: number | null;
};

function contentIdFromPost(handle: string, tweetId: string): string {
  const canonical = `x.com/${handle.toLowerCase()}/status/${tweetId}`;
  return keccak256(toBytes(canonical));
}

function contentIdFromDirectCreator(authorId: string): string {
  return keccak256(toBytes(`teep:direct:x:${authorId}`));
}

function normalizeReceiptHandle(value?: string | null): string | null {
  const normalized = (value || "").trim().replace(/^@/, "");
  return normalized || null;
}

async function senderXHandle(db: ReturnType<typeof getDb>, senderAddress: string): Promise<string | null> {
  const senderX = await db
    .prepare(`SELECT x_username FROM x_accounts WHERE LOWER(user_address) = LOWER(?) ORDER BY verified_at DESC LIMIT 1`)
    .get(senderAddress) as { x_username: string } | undefined;
  return normalizeReceiptHandle(senderX?.x_username);
}

async function resolveCreatorClaimState(
  db: ReturnType<typeof getDb>,
  authorId: string,
  handle?: string | null
): Promise<{
  recipientHandle: string | null;
  creatorClaimStatus: CreatorClaimStatus;
  creatorVerified: boolean;
  creatorOwnerAddress: string | null;
}> {
  const normalizedHandle = normalizeReceiptHandle(handle);
  const verifiedCreator = normalizedHandle
    ? await db
        .prepare(
          `SELECT username, owner_address
           FROM verified_claims
           WHERE author_id = ? OR LOWER(username) = LOWER(?)
           ORDER BY CASE WHEN author_id = ? THEN 0 ELSE 1 END, verified_at DESC
           LIMIT 1`
        )
        .get(authorId, normalizedHandle, authorId) as { username: string; owner_address: string } | undefined
    : await db
        .prepare(
          `SELECT username, owner_address
           FROM verified_claims
           WHERE author_id = ?
           ORDER BY verified_at DESC
           LIMIT 1`
        )
        .get(authorId) as { username: string; owner_address: string } | undefined;

  if (verifiedCreator) {
    return {
      recipientHandle: normalizeReceiptHandle(verifiedCreator.username) || normalizedHandle,
      creatorClaimStatus: "verified",
      creatorVerified: true,
      creatorOwnerAddress: verifiedCreator.owner_address,
    };
  }

  const claimWallet = await db
    .prepare(
      `SELECT owner_address
       FROM claim_wallets
       WHERE author_id = ?
         AND deployed_at_block > 0
         AND COALESCE(tx_hash, '') <> ''
       LIMIT 1`
    )
    .get(authorId) as { owner_address: string } | undefined;

  if (claimWallet) {
    return {
      recipientHandle: normalizedHandle,
      creatorClaimStatus: "claim_wallet_active",
      creatorVerified: true,
      creatorOwnerAddress: claimWallet.owner_address,
    };
  }

  return {
    recipientHandle: normalizedHandle,
    creatorClaimStatus: "unclaimed",
    creatorVerified: false,
    creatorOwnerAddress: null,
  };
}

async function buildXBotReceiptPayload(db: ReturnType<typeof getDb>, row: XBotTipReceiptRow) {
  const [senderSettings, senderIdentity, senderHandle, creatorState] = await Promise.all([
    getUserSettings(row.sender_address),
    publicIdentity(row.sender_address),
    senderXHandle(db, row.sender_address),
    resolveCreatorClaimState(db, row.recipient_x_user_id, row.recipient_x_username),
  ]);
  const kind = row.tip_kind === "post_tip" ? "post_tip" : "direct_creator_tip";
  const recipientHandle = creatorState.recipientHandle || normalizeReceiptHandle(row.recipient_x_username);
  const fallbackTweetAuthor =
    kind === "post_tip"
      ? recipientHandle
      : senderHandle || normalizeReceiptHandle(senderIdentity.label);
  const tweetAuthorHandle = normalizeReceiptHandle(row.context_author_username) || fallbackTweetAuthor || null;
  const tweetId = row.context_tweet_id || row.source_tweet_id;
  const contentId =
    row.content_id ||
    (kind === "post_tip" && tweetAuthorHandle
      ? contentIdFromPost(tweetAuthorHandle, tweetId)
      : contentIdFromDirectCreator(row.recipient_x_user_id));

  return {
    kind,
    receiptId: row.receipt_id,
    fromAddress: senderSettings.privacy.hideAddress ? null : row.sender_address,
    fromIdentity: senderIdentity.label,
    toAddress: row.recipient_address,
    amount: row.amount_raw,
    displayAmount: senderSettings.receipts.shareAmountEnabled,
    txHash: row.tx_hash,
    timestamp: Math.floor(Number(row.created_at || 0) / 1000),
    authorId: row.recipient_x_user_id,
    contentId,
    authorHandle: recipientHandle,
    recipientHandle,
    tweetAuthorHandle,
    tweetAuthorName: row.context_author_name || null,
    tweetAuthorProfileImageUrl: row.context_author_profile_image_url || null,
    tweetId,
    source: "x_bot",
    status: "completed",
    creatorClaimStatus: creatorState.creatorClaimStatus,
    creatorVerified: creatorState.creatorVerified,
    creatorOwnerAddress: creatorState.creatorOwnerAddress,
    receiptPreferences: senderSettings.receipts,
  };
}

async function buildClaimableReceiptPayload(db: ReturnType<typeof getDb>, row: ClaimableTipReceiptRow) {
  const [senderSettings, senderIdentity, senderHandle] = await Promise.all([
    getUserSettings(row.sender_address),
    publicIdentity(row.sender_address),
    senderXHandle(db, row.sender_address),
  ]);
  const recipientHandle = normalizeReceiptHandle(row.recipient_x_username);
  const tweetAuthorHandle = senderHandle || normalizeReceiptHandle(senderIdentity.label) || null;

  return {
    kind: "direct_creator_tip",
    receiptId: row.receipt_id,
    fromAddress: senderSettings.privacy.hideAddress ? null : row.sender_address,
    fromIdentity: senderIdentity.label,
    toAddress: null,
    amount: row.amount_raw,
    displayAmount: senderSettings.receipts.shareAmountEnabled,
    txHash: null,
    timestamp: Math.floor(Number(row.created_at || 0) / 1000),
    authorId: row.recipient_x_user_id || "",
    contentId: row.recipient_x_user_id ? contentIdFromDirectCreator(row.recipient_x_user_id) : "",
    authorHandle: recipientHandle,
    recipientHandle,
    tweetAuthorHandle,
    tweetId: row.source_tweet_id,
    source: "x_bot",
    status: row.status === "unclaimed" ? "reserved" : row.status,
    creatorClaimStatus: "unclaimed" as CreatorClaimStatus,
    creatorVerified: false,
    creatorOwnerAddress: null,
    receiptPreferences: senderSettings.receipts,
    expiresAt: row.expires_at ? Math.floor(Number(row.expires_at) / 1000) : null,
  };
}

/**
 * GET /tips/post/:handle/:tweetId
 * Returns tip data for a post by handle and tweet ID (for CTA links).
 */
router.get("/post/:handle/:tweetId", async (req: Request, res: Response) => {
  const handle = String(req.params.handle || "").replace(/^@/, "");
  const tweetId = String(req.params.tweetId || "");
  if (!handle || !tweetId) {
    res.status(400).json({ error: "handle and tweetId required" });
    return;
  }
  const contentId = contentIdFromPost(handle, tweetId);
  const db = getDb();

  const total = await db
    .prepare(
      "SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total, COUNT(*) as count FROM tips WHERE content_id = ?"
    )
    .get(contentId) as { total: number; count: number } | undefined;

  const recentTips = await db
    .prepare(
      "SELECT from_address, amount, tx_hash, timestamp FROM tips WHERE content_id = ? ORDER BY block_number DESC LIMIT 20"
    )
    .all(contentId);

  res.json({
    contentId,
    totalAmount: total?.total?.toString() || "0",
    tipCount: Number(total?.count || 0),
    recentTips,
    handle,
    tweetId,
  });
});

/**
 * GET /tips/:contentId
 * Returns aggregated tip total and recent tips for a specific post
 */
router.get("/:contentId", async (req: Request, res: Response) => {
  const { contentId } = req.params;
  const db = getDb();

  const total = await db
    .prepare(
      "SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total, COUNT(*) as count FROM tips WHERE content_id = ?"
    )
    .get(contentId) as { total: number; count: number } | undefined;

  const recentTips = await db
    .prepare(
      "SELECT from_address, amount, tx_hash, timestamp FROM tips WHERE content_id = ? ORDER BY block_number DESC LIMIT 20"
    )
    .all(contentId);

  res.json({
    contentId,
    totalAmount: total?.total?.toString() || "0",
    tipCount: Number(total?.count || 0),
    recentTips,
  });
});

/**
 * GET /tips/author/:authorId
 * Returns total tips received by an author across all posts
 */
router.get("/author/:authorId", async (req: Request, res: Response) => {
  const { authorId } = req.params;
  const db = getDb();

  const total = await db
    .prepare(
      "SELECT COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total, COUNT(*) as count FROM tips WHERE author_id = ?"
    )
    .get(authorId) as { total: number; count: number } | undefined;

  const xBotTotal = await db
    .prepare(
      `SELECT COALESCE(SUM(CAST(xbt.amount_raw AS NUMERIC)), 0) as total, COUNT(*) as count
       FROM x_bot_tips xbt
       WHERE xbt.status = 'completed'
         AND xbt.recipient_x_user_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM tips t
           WHERE xbt.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(xbt.tx_hash)
         )`
    )
    .get(authorId) as { total: number; count: number } | undefined;

  const topPosts = await db
    .prepare(
      `SELECT content_id, SUM(CAST(amount AS NUMERIC)) as total, COUNT(*) as count
       FROM tips WHERE author_id = ?
       GROUP BY content_id
       ORDER BY total DESC
       LIMIT 10`
    )
    .all(authorId);

  res.json({
    authorId,
    totalReceived: (Number(total?.total || 0) + Number(xBotTotal?.total || 0)).toString(),
    tipCount: Number(total?.count || 0) + Number(xBotTotal?.count || 0),
    topPosts,
  });
});

/**
 * GET /tips/receipt/x/:receiptId
 * Returns an internal X-bot tip receipt (Mode A ledger tip).
 */
router.get("/receipt/x/:receiptId", async (req: Request, res: Response) => {
  const receiptId = String(req.params.receiptId || "").trim();
  if (!receiptId || !/^[a-f0-9]{16}$/i.test(receiptId)) {
    res.status(400).json({ error: "Valid receipt id required" });
    return;
  }
  const db = getDb();
  const row = await db
    .prepare(
      `SELECT sender_address, recipient_address, recipient_x_user_id, recipient_x_username,
              amount_raw, source_tweet_id, receipt_id, tx_hash, created_at,
              COALESCE(tip_kind, 'direct_creator_tip') as tip_kind,
              content_id, context_tweet_id, context_author_id, context_author_username,
              context_author_name, context_author_profile_image_url
       FROM x_bot_tips WHERE receipt_id = ?`
    )
    .get(receiptId) as XBotTipReceiptRow | undefined;

  if (row) {
    res.json(await buildXBotReceiptPayload(db, row));
    return;
  }

  const claimable = await db
    .prepare(
      `SELECT sender_address, recipient_x_user_id, recipient_x_username, amount_raw, source_tweet_id, receipt_id, status, created_at, expires_at
       FROM claimable_tips WHERE receipt_id = ?`
    )
    .get(receiptId) as ClaimableTipReceiptRow | undefined;

  if (!claimable) {
    res.status(404).json({ error: "Receipt not found" });
    return;
  }

  res.json(await buildClaimableReceiptPayload(db, claimable));
});

/**
 * GET /tips/receipt/:txHash
 * Returns a single tip by transaction hash for the receipt page.
 */
router.get("/receipt/:txHash", async (req: Request, res: Response) => {
  const txHash = String(req.params.txHash || "").trim().toLowerCase();
  if (!txHash || !txHash.startsWith("0x")) {
    res.status(400).json({ error: "Valid tx hash required" });
    return;
  }
  const db = getDb();

  const xBotTip = await db
    .prepare(
      `SELECT sender_address, recipient_address, recipient_x_user_id, recipient_x_username,
              amount_raw, source_tweet_id, receipt_id, tx_hash, created_at,
              COALESCE(tip_kind, 'direct_creator_tip') as tip_kind,
              content_id, context_tweet_id, context_author_id, context_author_username,
              context_author_name, context_author_profile_image_url
       FROM x_bot_tips
       WHERE LOWER(tx_hash) = ?
       LIMIT 1`
    )
    .get(txHash) as XBotTipReceiptRow | undefined;
  if (xBotTip) {
    res.json(await buildXBotReceiptPayload(db, xBotTip));
    return;
  }

  const row = await db
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
    const funding = await db
      .prepare(
        `SELECT user_address, metadata_json, created_at
         FROM funding_provider_sessions
         WHERE LOWER(COALESCE(metadata_json::jsonb ->> 'txHash', metadata_json::jsonb ->> 'hash', provider_session_id)) = ?
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
      const identity = await publicIdentity(funding.user_address);
      const settings = await getUserSettings(funding.user_address);
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
        receiptPreferences: settings.receipts,
        accountIdentity: identity.label,
      });
      return;
    }

    const withdrawal = await db
      .prepare(
        `SELECT owner_address, destination_address, amount_raw, created_at
         FROM withdrawal_records
         WHERE LOWER(tx_hash) = ?
         LIMIT 1`
      )
      .get(txHash) as { owner_address: string; destination_address: string; amount_raw: string; created_at: number } | undefined;
    if (withdrawal) {
      const senderSettings = await getUserSettings(withdrawal.owner_address);
      const senderIdentity = await publicIdentity(withdrawal.owner_address);
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

    const referral = await db
      .prepare(
        `SELECT from_address, to_address, amount, timestamp
         FROM user_activity
         WHERE LOWER(tx_hash) = ? AND type = 'referral_fee_received'
         LIMIT 1`
      )
      .get(txHash) as { from_address: string; to_address: string; amount: string; timestamp: number } | undefined;
    if (referral) {
      const settings = await getUserSettings(referral.to_address);
      const identity = await publicIdentity(referral.to_address);
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

  const verifiedCreator = row.author_handle
    ? await db
        .prepare(
          `SELECT username, owner_address
           FROM verified_claims
           WHERE author_id = ? OR LOWER(username) = LOWER(?)
           ORDER BY CASE WHEN author_id = ? THEN 0 ELSE 1 END
           LIMIT 1`
        )
        .get(row.author_id, row.author_handle, row.author_id) as { username: string; owner_address: string } | undefined
    : await db
        .prepare(
          `SELECT username, owner_address
           FROM verified_claims
           WHERE author_id = ?
           LIMIT 1`
        )
        .get(row.author_id) as { username: string; owner_address: string } | undefined;
  const creatorUsername = verifiedCreator?.username || row.author_handle || null;
  const senderSettings = await getUserSettings(row.from_address);
  const senderIdentity = await publicIdentity(row.from_address);

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
    recipientHandle: creatorUsername || row.author_handle,
    tweetAuthorHandle: row.author_handle || creatorUsername || null,
    tweetId: row.tweet_id,
    kind: row.kind || "post_tip",
    creatorClaimStatus: verifiedCreator ? "verified" : "unclaimed",
    creatorVerified: Boolean(verifiedCreator),
    creatorOwnerAddress: verifiedCreator?.owner_address || null,
    receiptPreferences: senderSettings.receipts,
  });
});

const RECEIPT_BASE_URL = process.env.RECEIPT_BASE_URL || "https://tipcoin.xyz";

/**
 * GET /tips/receipt/:txHash/og
 * Returns HTML with Open Graph (and Twitter card) meta tags for link previews.
 * Use when serving receipt URL to crawlers (e.g. reverse proxy or serverless).
 */
router.get("/receipt/:txHash/og", async (req: Request, res: Response) => {
  const txHash = String(req.params.txHash || "").trim().toLowerCase();
  if (!txHash || !txHash.startsWith("0x")) {
    res.status(400).send("Invalid tx hash");
    return;
  }
  const db = getDb();

  const row = await db
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
    (await db.prepare("SELECT username FROM verified_claims WHERE author_id = ? LIMIT 1").get(row.author_id) as { username: string } | undefined)?.username ||
    row.author_handle ||
    null;
  const creatorLabel = creatorUsername ? `@${creatorUsername}` : "Creator";
  const amountUsd = (Number(row.amount) / 1e6).toFixed(2);
  const receiptUrl = `${RECEIPT_BASE_URL}/tx/${row.tx_hash}`;
  const senderSettings = await getUserSettings(row.from_address);
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
router.get("/wallet/:address", async (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  const offset = parseInt(req.query.offset as string) || 0;
  const db = getDb();

  const indexedTips = await db
    .prepare(
      `SELECT t.content_id, t.author_id, t.amount, t.tx_hash, t.timestamp,
              m.author_handle, m.tweet_id, COALESCE(m.kind, 'post_tip') as kind,
              'indexed' as source
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE t.from_address = ?
       ORDER BY t.block_number DESC
       LIMIT ?`
    )
    .all(address, limit + offset) as Array<{
      content_id: string;
      author_id: string;
      amount: string;
      tx_hash: string;
      timestamp: number;
      author_handle: string | null;
      tweet_id: string | null;
      kind: string;
      source: string;
    }>;

  const xBotTips = await db
    .prepare(
      `SELECT xbt.content_id as content_id,
              xbt.recipient_x_user_id as author_id,
              xbt.amount_raw as amount,
              xbt.tx_hash,
              CAST(xbt.created_at / 1000 AS INTEGER) as timestamp,
              xbt.recipient_x_username as author_handle,
              xbt.context_author_username as tweet_author_handle,
              COALESCE(xbt.context_tweet_id, xbt.source_tweet_id) as tweet_id,
              COALESCE(xbt.tip_kind, 'direct_creator_tip') as kind,
              'x_bot' as source
       FROM x_bot_tips xbt
       WHERE LOWER(xbt.sender_address) = ?
         AND xbt.status = 'completed'
         AND NOT EXISTS (
           SELECT 1 FROM tips t
           WHERE xbt.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(xbt.tx_hash)
         )
       ORDER BY xbt.created_at DESC
       LIMIT ?`
    )
    .all(address, limit + offset) as Array<{
      content_id: string | null;
      author_id: string;
      amount: string;
      tx_hash: string;
      timestamp: number;
      author_handle: string | null;
      tweet_author_handle: string | null;
      tweet_id: string;
      kind: string;
      source: string;
    }>;

  const tips = [...indexedTips, ...xBotTips]
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
    .slice(offset, offset + limit);

  const stats = await getUnifiedTipperStats(address);

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
router.post("/metadata", async (req: Request, res: Response) => {
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
    await db.prepare(
      `INSERT INTO tip_metadata (content_id, author_handle, tweet_id, kind)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (content_id) DO NOTHING`
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

  const { type, fromAddress, toAddress, amount, txHash, detail, authorHandle, tweetId, sourceMethod, walletProof } = req.body;

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
  const normalizedSourceMethod =
    typeof sourceMethod === "string" && /^[a-z0-9_-]{2,40}$/i.test(sourceMethod)
      ? sourceMethod.toLowerCase()
      : null;

  const db = getDb();
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    await db.prepare(
      "INSERT INTO user_activity (type, from_address, to_address, amount, tx_hash, detail, author_handle, tweet_id, source_method, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      type,
      fromAddress.toLowerCase(),
      toAddress?.toLowerCase() || null,
      amount,
      txHash.toLowerCase(),
      typeof detail === "string" ? detail.slice(0, 200) : null,
      handle,
      normalizedTweetId,
      normalizedSourceMethod,
      timestamp
    );
    await createReceiptReadyNotification({
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
router.get("/history/:address", async (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
  if (!isAddress(address)) {
    res.status(400).json({ error: "Valid address required" });
    return;
  }

  res.json({
    history: await getAccountActivity({
      address,
      limit,
      tipContractAddress: process.env.TIP_CONTRACT_ADDRESS,
    }),
  });
});

export default router;
