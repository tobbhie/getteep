import crypto from "crypto";
import type { Hex } from "viem";
import { getDb } from "../../db/database";
import { XOAuthService } from "../oauth";
import {
  createReceiptId,
  getDailyXBotTipTotal,
  getDefaultChainId,
  getDefaultTokenAddress,
} from "../teepBalance";
import {
  buildXDirectCreatorContentId,
  buildXPostContentId,
  getOnchainTeepBalance,
  getOnchainXTippingReadiness,
  relayXTip,
} from "../xTippingRouter";
import { amountToRaw, classifyIgnoredMention, formatUsdcRaw, parseTipCommand } from "./parseTipCommand";
import {
  buildBalanceReply,
  buildBatchSuccessReply,
  buildClaimableReply,
  buildConnectReply,
  buildFailureReply,
  buildHelpReply,
  buildInvalidCommandReply,
  buildInsufficientBalanceReply,
  buildSuccessReply,
} from "./replies";
import type { ProcessPostResult, TipIntent, XIncomingPost, XTipKind } from "./types";

const MIN_TIP_RAW = BigInt(process.env.X_BOT_MIN_TIP_RAW || "10000");
const PROCESSING_STALE_MS = Number(process.env.X_BOT_PROCESSING_STALE_MS || "300000");
const BOT_USER_ID = process.env.X_BOT_USER_ID || "";
const oauthService = new XOAuthService();

type SenderAccount = {
  userAddress: string;
  xUsername: string;
};

type RecipientAccount = {
  userAddress: string | null;
  xUserId: string;
  xUsername: string;
};

type PreparedTip = {
  intent: TipIntent;
  amountRaw: bigint;
  recipient: RecipientAccount;
  receiptId: string;
  tipId: string;
  sourceTweetId: string;
  tipKind: XTipKind;
  contentId: Hex;
  contextTweetId: string;
  contextAuthorId: string;
  contextAuthorUsername: string;
  contextAuthorName?: string | null;
  contextAuthorProfileImageUrl?: string | null;
};

function dbBool(value: unknown) {
  return value === true || value === 1;
}

function nowMs() {
  return Date.now();
}

function normalizeHandle(handle?: string) {
  return handle?.replace(/^@/, "").toLowerCase();
}

async function ensureVerifiedClaimFromLinkedXAccount(params: {
  xUserId: string;
  xUsername: string;
  displayName?: string | null;
  profileImageUrl?: string | null;
  userAddress: string;
}) {
  const db = getDb();
  const ownerAddress = params.userAddress.toLowerCase();
  const existingClaim = await db
    .prepare(`SELECT owner_address FROM verified_claims WHERE author_id = ? ORDER BY verified_at DESC LIMIT 1`)
    .get(params.xUserId) as { owner_address: string } | undefined;

  if (existingClaim && existingClaim.owner_address.toLowerCase() !== ownerAddress) {
    return;
  }

  await db
    .prepare(
      `INSERT INTO verified_claims (author_id, username, display_name, owner_address, profile_image_url)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(author_id, owner_address) DO UPDATE SET
         username = excluded.username,
         display_name = COALESCE(excluded.display_name, verified_claims.display_name),
         profile_image_url = COALESCE(excluded.profile_image_url, verified_claims.profile_image_url),
         verified_at = now()`
    )
    .run(
      params.xUserId,
      params.xUsername,
      params.displayName ?? null,
      ownerAddress,
      params.profileImageUrl ?? null
    );
}

async function markProcessed(
  tweetId: string,
  authorXUserId: string,
  status: string,
  reason?: string,
  receiptId?: string
) {
  const db = getDb();
  const now = nowMs();
  await db.prepare(
    `INSERT INTO processed_x_posts (tweet_id, author_x_user_id, status, reason, receipt_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tweet_id) DO UPDATE SET
       status = excluded.status,
       reason = excluded.reason,
       receipt_id = excluded.receipt_id,
       updated_at = excluded.updated_at`
  ).run(tweetId, authorXUserId, status, reason ?? null, receiptId ?? null, now, now);
}

async function resolveSender(authorId: string): Promise<SenderAccount | null> {
  const db = getDb();
  const claim = await db
    .prepare(
      `SELECT owner_address, username FROM verified_claims
       WHERE author_id = ? ORDER BY verified_at DESC LIMIT 1`
    )
    .get(authorId) as { owner_address: string; username: string } | undefined;
  if (claim) return { userAddress: claim.owner_address.toLowerCase(), xUsername: claim.username };

  const row = await db
    .prepare(`SELECT user_address, x_username FROM x_accounts WHERE x_user_id = ?`)
    .get(authorId) as { user_address: string; x_username: string } | undefined;
  if (!row) return null;
  return { userAddress: row.user_address.toLowerCase(), xUsername: row.x_username };
}

async function resolveRecipient(intent: TipIntent, post: XIncomingPost): Promise<RecipientAccount | null> {
  const db = getDb();

  if (intent.recipientXHandle) {
    const handle = normalizeHandle(intent.recipientXHandle);
    const claim = await db
      .prepare(
        `SELECT author_id, username, owner_address FROM verified_claims
         WHERE LOWER(username) = ? ORDER BY verified_at DESC LIMIT 1`
      )
      .get(handle) as { author_id: string; username: string; owner_address: string } | undefined;
    if (claim) {
      return {
        userAddress: claim.owner_address.toLowerCase(),
        xUserId: claim.author_id,
        xUsername: claim.username,
      };
    }

    try {
      const profile = await oauthService.getUserByUsername(handle || "");
      const linked = await db
        .prepare(`SELECT user_address FROM x_accounts WHERE x_user_id = ?`)
        .get(profile.id) as { user_address: string } | undefined;
      if (linked?.user_address) {
        await ensureVerifiedClaimFromLinkedXAccount({
          xUserId: profile.id,
          xUsername: profile.username,
          displayName: profile.name,
          profileImageUrl: profile.profile_image_url ?? null,
          userAddress: linked.user_address,
        });
      }
      return {
        userAddress: linked?.user_address?.toLowerCase() ?? null,
        xUserId: profile.id,
        xUsername: profile.username,
      };
    } catch {
      return null;
    }
  }

  if (post.parentAuthorId && post.parentAuthorUsername) {
    const claim = await db
      .prepare(`SELECT author_id, username, owner_address FROM verified_claims WHERE author_id = ? LIMIT 1`)
      .get(post.parentAuthorId) as { author_id: string; username: string; owner_address: string } | undefined;
    const linked = claim
      ? undefined
      : (await db
          .prepare(`SELECT user_address, x_username FROM x_accounts WHERE x_user_id = ?`)
          .get(post.parentAuthorId) as { user_address: string; x_username: string } | undefined);
    if (!claim && linked?.user_address) {
      await ensureVerifiedClaimFromLinkedXAccount({
        xUserId: post.parentAuthorId,
        xUsername: linked.x_username ?? post.parentAuthorUsername,
        userAddress: linked.user_address,
      });
    }
    return {
      userAddress: claim?.owner_address?.toLowerCase() ?? linked?.user_address?.toLowerCase() ?? null,
      xUserId: post.parentAuthorId,
      xUsername: claim?.username ?? linked?.x_username ?? post.parentAuthorUsername,
    };
  }

  return null;
}

async function getTippingPermissions(userAddress: string) {
  const db = getDb();
  const tokenAddress = getDefaultTokenAddress();
  const row = await db
    .prepare(
      `SELECT enabled, max_per_tip_raw, max_daily_raw, token_address FROM x_tipping_permissions WHERE user_address = ?`
    )
    .get(userAddress.toLowerCase()) as
    | { enabled: boolean | number; max_per_tip_raw: string; max_daily_raw: string; token_address: string }
    | undefined;

  return {
    enabled: dbBool(row?.enabled),
    maxPerTipRaw: BigInt(row?.max_per_tip_raw || process.env.X_BOT_MAX_PER_TIP_RAW || "10000000"),
    maxDailyRaw: BigInt(row?.max_daily_raw || process.env.X_BOT_MAX_DAILY_RAW || "50000000"),
    tokenAddress: (row?.token_address || tokenAddress).toLowerCase(),
  };
}

async function validateBatch(params: {
  senderAddress: string;
  amountsRaw: bigint[];
  tokenAddress: string;
}) {
  const permissions = await getTippingPermissions(params.senderAddress);
  if (!permissions.enabled) {
    return {
      ok: false as const,
      code: "X_TIPPING_DISABLED",
      reason: "X tip commands are paused for this account. Open Teep settings to enable them.",
    };
  }

  for (const amountRaw of params.amountsRaw) {
    if (amountRaw < MIN_TIP_RAW) {
      return {
        ok: false as const,
        code: "BELOW_MINIMUM",
        reason: `Minimum tip is ${formatUsdcRaw(MIN_TIP_RAW)} USD.`,
      };
    }
    if (amountRaw > permissions.maxPerTipRaw) {
      return {
        ok: false as const,
        code: "MAX_PER_TIP",
        reason: `This is above your Max per tip on X (${formatUsdcRaw(permissions.maxPerTipRaw)} USD). Open Teep settings to raise the limit.`,
      };
    }
  }

  const totalRaw = params.amountsRaw.reduce((sum, amountRaw) => sum + amountRaw, 0n);
  const chainId = getDefaultChainId();
  const dailyTotal = await getDailyXBotTipTotal(params.senderAddress, params.tokenAddress, chainId);
  if (dailyTotal + totalRaw > permissions.maxDailyRaw) {
    return {
      ok: false as const,
      code: "DAILY_LIMIT",
      reason: `This would pass your Daily tip limit on X (${formatUsdcRaw(permissions.maxDailyRaw)} USD). Open Teep settings to raise the limit.`,
    };
  }

  const onchain = await getOnchainXTippingReadiness({ senderAddress: params.senderAddress, totalRaw });
  if (!onchain.ok) return onchain;

  return { ok: true as const };
}

function sourceTweetIdFor(postId: string, index: number, count: number) {
  return count === 1 ? postId : `${postId}:${index + 1}`;
}

function getTipContext(params: {
  intent: TipIntent;
  post: XIncomingPost;
  recipient: RecipientAccount;
  sender: SenderAccount;
}): Omit<PreparedTip, "intent" | "amountRaw" | "recipient" | "receiptId" | "tipId" | "sourceTweetId"> | null {
  if (params.intent.targetType === "post") {
    if (!params.post.parentTweetId || !params.post.parentAuthorId || !params.post.parentAuthorUsername) {
      return null;
    }
    return {
      tipKind: "post_tip",
      contentId: buildXPostContentId(params.post.parentAuthorUsername, params.post.parentTweetId),
      contextTweetId: params.post.parentTweetId,
      contextAuthorId: params.post.parentAuthorId,
      contextAuthorUsername: params.post.parentAuthorUsername,
      contextAuthorName: params.post.parentAuthorName ?? null,
      contextAuthorProfileImageUrl: params.post.parentAuthorProfileImageUrl ?? null,
    };
  }

  return {
    tipKind: "direct_creator_tip",
    contentId: buildXDirectCreatorContentId(params.recipient.xUserId),
    contextTweetId: params.post.id,
    contextAuthorId: params.post.authorId,
    contextAuthorUsername: params.post.authorUsername || params.sender.xUsername,
    contextAuthorName: params.post.authorName ?? null,
    contextAuthorProfileImageUrl: params.post.authorProfileImageUrl ?? null,
  };
}

function firstIntentContext(post: XIncomingPost, intent?: TipIntent) {
  return {
    tweetId: post.id,
    recipientHandle: intent?.recipientXHandle || post.parentAuthorUsername,
    amount: intent?.amount,
    intent: "x-tip" as const,
  };
}

export async function processIncomingPost(post: XIncomingPost): Promise<ProcessPostResult> {
  const db = getDb();
  if (BOT_USER_ID && post.authorId === BOT_USER_ID) {
    await markProcessed(post.id, post.authorId, "ignored", "BOT_SELF_POST");
    return { tweetId: post.id, status: "ignored", code: "BOT_SELF_POST" };
  }

  const existing = await db
    .prepare(`SELECT status, updated_at FROM processed_x_posts WHERE tweet_id = ?`)
    .get(post.id) as { status: string; updated_at: number } | undefined;
  if (existing) {
    const isStaleProcessing =
      existing.status === "processing" && nowMs() - Number(existing.updated_at) > PROCESSING_STALE_MS;
    if (!isStaleProcessing) {
      return { tweetId: post.id, status: "ignored", code: "ALREADY_PROCESSED" };
    }
  }

  await markProcessed(post.id, post.authorId, "processing");

  const command = parseTipCommand(post.text);
  if (!command) {
    const ignoredReason = classifyIgnoredMention(post.text) || "NO_COMMAND";
    await markProcessed(post.id, post.authorId, "ignored", ignoredReason);
    return { tweetId: post.id, status: "ignored", code: ignoredReason };
  }

  if (command.type === "HELP") {
    const replyText = buildHelpReply();
    await markProcessed(post.id, post.authorId, "completed", "HELP");
    return { tweetId: post.id, status: "completed", replyText };
  }

  if (command.type === "INVALID_COMMAND") {
    const replyText = buildInvalidCommandReply(command.reason);
    await markProcessed(post.id, post.authorId, "failed", command.reason);
    return { tweetId: post.id, status: "failed", code: command.reason, replyText };
  }

  if (command.type === "BALANCE") {
    const sender = await resolveSender(post.authorId);
    if (!sender) {
      const replyText = buildConnectReply(post.authorUsername, { tweetId: post.id, intent: "x-balance" });
      await markProcessed(post.id, post.authorId, "failed", "SENDER_NOT_REGISTERED");
      return { tweetId: post.id, status: "failed", code: "SENDER_NOT_REGISTERED", replyText };
    }
    const balance = await getOnchainTeepBalance(sender.userAddress);
    const replyText = buildBalanceReply(sender.xUsername, balance);
    await markProcessed(post.id, post.authorId, "completed", "BALANCE");
    return { tweetId: post.id, status: "completed", replyText };
  }

  const sender = await resolveSender(post.authorId);
  if (!sender) {
    const replyText = buildConnectReply(post.authorUsername, firstIntentContext(post, command.tips[0]));
    await markProcessed(post.id, post.authorId, "failed", "SENDER_NOT_REGISTERED");
    return { tweetId: post.id, status: "failed", code: "SENDER_NOT_REGISTERED", replyText };
  }
  if (command.tips.length > 1) {
    const replyText = buildFailureReply("Send one X tip command at a time.");
    await markProcessed(post.id, post.authorId, "failed", "BATCH_NOT_SUPPORTED");
    return { tweetId: post.id, status: "failed", code: "BATCH_NOT_SUPPORTED", replyText };
  }

  const tokenAddress = getDefaultTokenAddress();
  const chainId = getDefaultChainId();
  const amountsRaw: bigint[] = [];
  for (const intent of command.tips) {
    try {
      amountsRaw.push(amountToRaw(intent.amount));
    } catch {
      const replyText = buildFailureReply("Invalid tip amount.");
      await markProcessed(post.id, post.authorId, "failed", "INVALID_AMOUNT");
      return { tweetId: post.id, status: "failed", code: "INVALID_AMOUNT", replyText };
    }
  }

  const validation = await validateBatch({ senderAddress: sender.userAddress, amountsRaw, tokenAddress });
  if (!validation.ok) {
    const replyText =
      validation.code === "INSUFFICIENT_BALANCE"
        ? buildInsufficientBalanceReply(sender.xUsername, firstIntentContext(post, command.tips[0]))
        : buildFailureReply(validation.reason);
    await markProcessed(post.id, post.authorId, "failed", validation.code);
    return { tweetId: post.id, status: "failed", code: validation.code, replyText };
  }

  const prepared: PreparedTip[] = [];
  for (let index = 0; index < command.tips.length; index += 1) {
    const intent = command.tips[index];
    if (intent.targetType === "post" && (!post.parentTweetId || !post.parentAuthorId || !post.parentAuthorUsername)) {
      const replyText = buildFailureReply("Reply to the post you want to tip, then use @teepagent tip this post $2.");
      await markProcessed(post.id, post.authorId, "failed", "MISSING_POST_CONTEXT");
      return { tweetId: post.id, status: "failed", code: "MISSING_POST_CONTEXT", replyText };
    }

    const recipient = await resolveRecipient(intent, post);
    if (!recipient) {
      const replyText = buildFailureReply("I couldn't find that creator on X.");
      await markProcessed(post.id, post.authorId, "failed", "RECIPIENT_NOT_FOUND");
      return { tweetId: post.id, status: "failed", code: "RECIPIENT_NOT_FOUND", replyText };
    }
    if (recipient.userAddress && recipient.userAddress === sender.userAddress) {
      const replyText = buildFailureReply("You can't tip yourself.");
      await markProcessed(post.id, post.authorId, "failed", "SELF_TIP");
      return { tweetId: post.id, status: "failed", code: "SELF_TIP", replyText };
    }

    const context = getTipContext({ intent, post, recipient, sender });
    if (!context) {
      const replyText = buildFailureReply("I couldn't identify the post to tip.");
      await markProcessed(post.id, post.authorId, "failed", "MISSING_POST_CONTEXT");
      return { tweetId: post.id, status: "failed", code: "MISSING_POST_CONTEXT", replyText };
    }

    prepared.push({
      intent,
      amountRaw: amountsRaw[index],
      recipient,
      receiptId: createReceiptId(),
      tipId: crypto.randomUUID(),
      sourceTweetId: sourceTweetIdFor(post.id, index, command.tips.length),
      ...context,
    });
  }

  try {
    const relayed: Array<PreparedTip & { txHash: string; claimWallet: string; contentId: Hex }> = [];
    for (const tip of prepared) {
      const result = await relayXTip({
        senderAddress: sender.userAddress,
        recipientXUserId: tip.recipient.xUserId,
        commandTweetId: tip.sourceTweetId,
        contentId: tip.contentId,
        amountRaw: tip.amountRaw,
      });
      relayed.push({ ...tip, txHash: result.txHash, claimWallet: result.claimWallet, contentId: result.contentId });
    }

    await db.transaction(async (txDb) => {
      for (const tip of relayed) {
        await txDb.prepare(
          `INSERT INTO tip_metadata (content_id, author_handle, tweet_id, kind)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(content_id) DO UPDATE SET
             author_handle = excluded.author_handle,
             tweet_id = excluded.tweet_id,
             kind = excluded.kind`
        ).run(tip.contentId, tip.contextAuthorUsername, tip.contextTweetId, tip.tipKind);
        await txDb.prepare(
          `INSERT INTO x_bot_tips (
            id, sender_address, recipient_address, recipient_x_user_id, recipient_x_username,
            token_address, amount_raw, source_tweet_id, receipt_id, tx_hash, status, created_at,
            tip_kind, content_id, context_tweet_id, context_author_id, context_author_username,
            context_author_name, context_author_profile_image_url
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(source_tweet_id) DO UPDATE SET
            tx_hash = excluded.tx_hash,
            status = excluded.status,
            tip_kind = excluded.tip_kind,
            content_id = excluded.content_id,
            context_tweet_id = excluded.context_tweet_id,
            context_author_id = excluded.context_author_id,
            context_author_username = excluded.context_author_username,
            context_author_name = excluded.context_author_name,
            context_author_profile_image_url = excluded.context_author_profile_image_url`
        ).run(
          tip.tipId,
          sender.userAddress,
          tip.claimWallet,
          tip.recipient.xUserId,
          tip.recipient.xUsername,
          tokenAddress,
          tip.amountRaw.toString(),
          tip.sourceTweetId,
          tip.receiptId,
          tip.txHash,
          nowMs(),
          tip.tipKind,
          tip.contentId,
          tip.contextTweetId,
          tip.contextAuthorId,
          tip.contextAuthorUsername,
          tip.contextAuthorName ?? null,
          tip.contextAuthorProfileImageUrl ?? null
        );
      }
    })();

    const completed = relayed.filter((tip) => tip.recipient.userAddress);
    const reserved = relayed.filter((tip) => !tip.recipient.userAddress);
    const firstReceiptId = relayed[0]?.receiptId;

    if (relayed.length === 1) {
      const only = relayed[0];
      const replyText = only.recipient.userAddress
        ? buildSuccessReply({
            senderHandle: sender.xUsername,
            recipientHandle: only.recipient.xUsername,
            amountRaw: only.amountRaw,
            receiptId: only.receiptId,
          })
        : buildClaimableReply({
            senderHandle: sender.xUsername,
            recipientHandle: only.recipient.xUsername,
            amountRaw: only.amountRaw,
            receiptId: only.receiptId,
          });
      await markProcessed(post.id, post.authorId, "completed", reserved.length ? "CLAIMABLE" : undefined, firstReceiptId);
      return { tweetId: post.id, status: "completed", replyText, receiptId: firstReceiptId };
    }

    const replyText = buildBatchSuccessReply({
      senderHandle: sender.xUsername,
      completed: completed.map((tip) => ({
        recipientHandle: tip.recipient.xUsername,
        amountRaw: tip.amountRaw,
        receiptId: tip.receiptId,
      })),
      reserved: reserved.map((tip) => ({
        recipientHandle: tip.recipient.xUsername,
        amountRaw: tip.amountRaw,
        receiptId: tip.receiptId,
      })),
    });
    await markProcessed(post.id, post.authorId, "completed", reserved.length ? "BATCH_WITH_CLAIMABLE" : "BATCH", firstReceiptId);
    return { tweetId: post.id, status: "completed", replyText, receiptId: firstReceiptId };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "UNKNOWN";
    const replyText =
      message === "INSUFFICIENT_BALANCE"
        ? buildInsufficientBalanceReply(sender.xUsername, firstIntentContext(post, command.tips[0]))
        : buildFailureReply("Something went wrong sending this tip.");
    await markProcessed(post.id, post.authorId, "failed", message);
    return { tweetId: post.id, status: "failed", code: message, replyText };
  }
}
