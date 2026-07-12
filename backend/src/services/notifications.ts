import { one, query, run } from "../db/database";
import { getUserSettings } from "./userSettings";

export type NotificationType =
  | "creator_claimed_funds"
  | "low_balance"
  | "receipt_ready"
  | "new_tip_received"
  | "repeat_supporter"
  | "claim_wallet_activity"
  | "deposit_confirmed"
  | "withdrawal_confirmed"
  | "grow_tips_status"
  | "referral_earned"
  | "message";

async function isEnabled(userAddress: string, type: NotificationType) {
  const settings = await getUserSettings(userAddress);
  if (type === "creator_claimed_funds") return settings.notifications.creatorClaimed;
  if (type === "low_balance") return settings.notifications.lowBalance;
  if (type === "receipt_ready") return settings.notifications.receiptReady;
  if (type === "new_tip_received") return settings.notifications.newTip;
  if (type === "repeat_supporter") return settings.notifications.repeatSupporter;
  if (type === "claim_wallet_activity") return settings.notifications.claimWalletActivity;
  if (type === "withdrawal_confirmed") return settings.notifications.withdrawalCompleted && settings.payout.notifications;
  if (type === "grow_tips_status") return settings.notifications.growTipsStatus;
  if (type === "deposit_confirmed" || type === "referral_earned" || type === "message") return true;
  return false;
}

export async function createNotification(params: {
  userAddress: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}) {
  const userAddress = params.userAddress.toLowerCase();
  if (!(await isEnabled(userAddress, params.type))) return null;

  const now = Date.now();
  const txHash = typeof params.metadata?.txHash === "string" ? params.metadata.txHash.toLowerCase() : "";
  const messageKey = typeof params.metadata?.messageKey === "string" ? params.metadata.messageKey : "";
  const recent = txHash
    ? await one<{ id: string }>(
          `SELECT id FROM user_notifications
           WHERE user_address = ? AND type = ? AND LOWER(metadata_json::jsonb ->> 'txHash') = ?
           LIMIT 1`
        , [userAddress, params.type, txHash])
    : messageKey
    ? await one<{ id: string }>(
          `SELECT id FROM user_notifications
           WHERE user_address = ? AND type = ? AND metadata_json::jsonb ->> 'messageKey' = ?
           LIMIT 1`
        , [userAddress, params.type, messageKey])
    : await one<{ id: string }>(
          `SELECT id FROM user_notifications
           WHERE user_address = ? AND type = ? AND status = 'unread' AND created_at >= ?
           LIMIT 1`
        , [userAddress, params.type, now - 24 * 60 * 60 * 1000]);
  if (recent) return null;
  const inserted = await one<{ id: string }>(
    `INSERT INTO user_notifications (user_address, type, title, body, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [
      userAddress,
      params.type,
      params.title,
      params.body,
      params.metadata ? JSON.stringify(params.metadata) : null,
      now
    ]
  );
  return inserted?.id ?? null;
}

export async function createDepositConfirmedNotification(params: { userAddress: string; amountRaw: string; txHash: string }) {
  const amount = (Number(params.amountRaw) / 1e6).toFixed(2);
  return createNotification({
    userAddress: params.userAddress,
    type: "deposit_confirmed",
    title: "Deposit confirmed",
    body: `$${amount} is now available in your Teep account.`,
    metadata: { txHash: params.txHash.toLowerCase(), amountRaw: params.amountRaw },
  });
}

export async function createWithdrawalConfirmedNotification(params: { userAddress: string; amountRaw: string; txHash: string }) {
  const amount = (Number(params.amountRaw) / 1e6).toFixed(2);
  return createNotification({
    userAddress: params.userAddress,
    type: "withdrawal_confirmed",
    title: "Withdrawal confirmed",
    body: `$${amount} has been recorded as withdrawn from Teep.`,
    metadata: { txHash: params.txHash.toLowerCase(), amountRaw: params.amountRaw },
  });
}

export async function createReferralEarnedNotification(params: { userAddress: string; amountRaw: string; txHash: string; referredAddress: string }) {
  const amount = (Number(params.amountRaw) / 1e6).toFixed(2);
  return createNotification({
    userAddress: params.userAddress,
    type: "referral_earned",
    title: "Referral earned",
    body: `You earned $${amount} from an eligible referred withdrawal.`,
    metadata: {
      txHash: params.txHash.toLowerCase(),
      amountRaw: params.amountRaw,
      referredAddress: params.referredAddress.toLowerCase(),
    },
  });
}

export async function createThankYouMessageNotification(params: {
  userAddress: string;
  creatorUsername: string;
  creatorDisplayName?: string | null;
  creatorOwnerAddress: string;
  totalRaw: string;
  tipCount: number;
  message?: string | null;
}) {
  const amount = (Number(params.totalRaw) / 1e6).toFixed(2);
  const creator = params.creatorDisplayName || `@${params.creatorUsername.replace(/^@/, "")}`;
  const intro = params.message?.trim() || `${creator} sent you a thank you`;
  return createNotification({
    userAddress: params.userAddress,
    type: "message",
    title: "A creator says thanks",
    body: `${intro} for ${params.tipCount} support${params.tipCount === 1 ? "" : "s"} totaling $${amount}.`,
    metadata: {
      messageKind: "creator_thank_you",
      messageKey: `thanks:${params.creatorOwnerAddress.toLowerCase()}:${params.userAddress.toLowerCase()}`,
      creatorUsername: params.creatorUsername.replace(/^@/, "").toLowerCase(),
      creatorDisplayName: params.creatorDisplayName ?? null,
      creatorOwnerAddress: params.creatorOwnerAddress.toLowerCase(),
      totalRaw: params.totalRaw,
      tipCount: params.tipCount,
    },
  });
}

export async function createLowBalanceNotification(params: { userAddress: string; balanceRaw: string; thresholdUsd: string }) {
  const balance = (Number(params.balanceRaw) / 1e6).toFixed(2);
  return createNotification({
    userAddress: params.userAddress,
    type: "low_balance",
    title: "Low balance",
    body: `Your Teep balance is $${balance}, below your default tip of $${params.thresholdUsd}.`,
    metadata: { balanceRaw: params.balanceRaw, thresholdUsd: params.thresholdUsd },
  });
}

export async function createReceiptReadyNotification(params: {
  userAddress: string;
  txHash: string;
  amountRaw: string;
  authorHandle?: string | null;
}) {
  const amount = (Number(params.amountRaw) / 1e6).toFixed(2);
  const creator = params.authorHandle ? `@${params.authorHandle.replace(/^@/, "")}` : "a creator";
  return createNotification({
    userAddress: params.userAddress,
    type: "receipt_ready",
    title: "Receipt ready",
    body: `Your $${amount} tip to ${creator} has a Teep receipt.`,
    metadata: { txHash: params.txHash, amountRaw: params.amountRaw, authorHandle: params.authorHandle ?? null },
  });
}

export async function createNewTipReceivedNotification(params: {
  creatorOwnerAddress: string;
  fromAddress: string;
  amountRaw: string;
  txHash: string;
  authorHandle?: string | null;
}) {
  const amount = (Number(params.amountRaw) / 1e6).toFixed(2);
  const creator = params.authorHandle ? `@${params.authorHandle.replace(/^@/, "")}` : "your creator account";
  return createNotification({
    userAddress: params.creatorOwnerAddress,
    type: "new_tip_received",
    title: "New tip received",
    body: `$${amount} was sent to ${creator}.`,
    metadata: {
      txHash: params.txHash.toLowerCase(),
      amountRaw: params.amountRaw,
      fromAddress: params.fromAddress.toLowerCase(),
      authorHandle: params.authorHandle ?? null,
    },
  });
}

export async function createRepeatSupporterNotification(params: {
  creatorOwnerAddress: string;
  supporterAddress: string;
  tipCount: number;
  totalRaw: string;
}) {
  const amount = (Number(params.totalRaw) / 1e6).toFixed(2);
  return createNotification({
    userAddress: params.creatorOwnerAddress,
    type: "repeat_supporter",
    title: "Repeat supporter",
    body: `A supporter has tipped ${params.tipCount} times, totaling $${amount}.`,
    metadata: {
      messageKey: `repeat:${params.creatorOwnerAddress.toLowerCase()}:${params.supporterAddress.toLowerCase()}`,
      supporterAddress: params.supporterAddress.toLowerCase(),
      tipCount: params.tipCount,
      totalRaw: params.totalRaw,
    },
  });
}

export async function createClaimWalletActivityNotification(params: {
  creatorOwnerAddress: string;
  authorId: string;
  walletAddress: string;
  txHash: string;
}) {
  return createNotification({
    userAddress: params.creatorOwnerAddress,
    type: "claim_wallet_activity",
    title: "Claim wallet active",
    body: "Your creator claim wallet has been recorded and can be used for creator earnings.",
    metadata: {
      authorId: params.authorId,
      walletAddress: params.walletAddress.toLowerCase(),
      txHash: params.txHash.toLowerCase(),
    },
  });
}

export async function createCreatorClaimedNotifications(params: {
  authorId: string;
  username: string;
  ownerAddress: string;
}) {
  const tippers = await query<{ from_address: string; tipCount: string; total: string }>(
    `SELECT from_address, SUM(tip_count) as "tipCount", COALESCE(SUM(total), 0) as total
     FROM (
       SELECT LOWER(from_address) as from_address,
              COUNT(*) as tip_count,
              COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total
       FROM tips
       WHERE author_id = ? AND LOWER(from_address) <> ?
       GROUP BY LOWER(from_address)

       UNION ALL

       SELECT LOWER(sender_address) as from_address,
              COUNT(*) as tip_count,
              COALESCE(SUM(CAST(amount_raw AS NUMERIC)), 0) as total
       FROM claimable_tips
       WHERE recipient_x_user_id = ?
         AND status IN ('unclaimed', 'claimed')
         AND LOWER(sender_address) <> ?
       GROUP BY LOWER(sender_address)

       UNION ALL

       SELECT LOWER(xbt.sender_address) as from_address,
              COUNT(*) as tip_count,
              COALESCE(SUM(CAST(xbt.amount_raw AS NUMERIC)), 0) as total
       FROM x_bot_tips xbt
       WHERE xbt.recipient_x_user_id = ?
         AND xbt.status = 'completed'
         AND LOWER(xbt.sender_address) <> ?
         AND NOT EXISTS (
           SELECT 1 FROM tips t
           WHERE xbt.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(xbt.tx_hash)
         )
       GROUP BY LOWER(xbt.sender_address)
     ) support
     GROUP BY from_address`,
    [
      params.authorId,
      params.ownerAddress.toLowerCase(),
      params.authorId,
      params.ownerAddress.toLowerCase(),
      params.authorId,
      params.ownerAddress.toLowerCase(),
    ]
  );

  for (const tipper of tippers) {
    const amount = (Number(tipper.total) / 1e6).toFixed(2);
    await createNotification({
      userAddress: tipper.from_address,
      type: "creator_claimed_funds",
      title: "Creator claimed",
      body: `@${params.username} connected their account and can now access $${amount} you sent.`,
      metadata: {
        authorId: params.authorId,
        username: params.username,
        ownerAddress: params.ownerAddress.toLowerCase(),
        tipCount: Number(tipper.tipCount),
        amountRaw: String(tipper.total),
      },
    });
  }
}
