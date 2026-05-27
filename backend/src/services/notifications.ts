import { getDb } from "../db/database";
import { getUserSettings } from "./userSettings";

export type NotificationType =
  | "creator_claimed_funds"
  | "low_balance"
  | "receipt_ready"
  | "deposit_confirmed"
  | "withdrawal_confirmed"
  | "referral_earned"
  | "message";

function isEnabled(userAddress: string, type: NotificationType) {
  const settings = getUserSettings(userAddress);
  if (type === "creator_claimed_funds") return settings.notifications.creatorClaimed;
  if (type === "low_balance") return settings.notifications.lowBalance;
  if (type === "receipt_ready") return settings.notifications.receiptReady;
  if (type === "deposit_confirmed" || type === "withdrawal_confirmed" || type === "referral_earned" || type === "message") return true;
  return false;
}

export function createNotification(params: {
  userAddress: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}) {
  const userAddress = params.userAddress.toLowerCase();
  if (!isEnabled(userAddress, params.type)) return null;

  const db = getDb();
  const now = Date.now();
  const txHash = typeof params.metadata?.txHash === "string" ? params.metadata.txHash.toLowerCase() : "";
  const messageKey = typeof params.metadata?.messageKey === "string" ? params.metadata.messageKey : "";
  const recent = txHash
    ? db
        .prepare(
          `SELECT id FROM user_notifications
           WHERE user_address = ? AND type = ? AND LOWER(json_extract(metadata_json, '$.txHash')) = ?
           LIMIT 1`
        )
        .get(userAddress, params.type, txHash)
    : messageKey
    ? db
        .prepare(
          `SELECT id FROM user_notifications
           WHERE user_address = ? AND type = ? AND json_extract(metadata_json, '$.messageKey') = ?
           LIMIT 1`
        )
        .get(userAddress, params.type, messageKey)
    : db
        .prepare(
          `SELECT id FROM user_notifications
           WHERE user_address = ? AND type = ? AND status = 'unread' AND created_at >= ?
           LIMIT 1`
        )
        .get(userAddress, params.type, now - 24 * 60 * 60 * 1000);
  if (recent) return null;
  const result = db
    .prepare(
      `INSERT INTO user_notifications (user_address, type, title, body, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      userAddress,
      params.type,
      params.title,
      params.body,
      params.metadata ? JSON.stringify(params.metadata) : null,
      now
    );
  return result.lastInsertRowid;
}

export function createDepositConfirmedNotification(params: { userAddress: string; amountRaw: string; txHash: string }) {
  const amount = (Number(params.amountRaw) / 1e6).toFixed(2);
  return createNotification({
    userAddress: params.userAddress,
    type: "deposit_confirmed",
    title: "Deposit confirmed",
    body: `$${amount} is now available in your Teep account.`,
    metadata: { txHash: params.txHash.toLowerCase(), amountRaw: params.amountRaw },
  });
}

export function createWithdrawalConfirmedNotification(params: { userAddress: string; amountRaw: string; txHash: string }) {
  const amount = (Number(params.amountRaw) / 1e6).toFixed(2);
  return createNotification({
    userAddress: params.userAddress,
    type: "withdrawal_confirmed",
    title: "Withdrawal confirmed",
    body: `$${amount} has been recorded as withdrawn from Teep.`,
    metadata: { txHash: params.txHash.toLowerCase(), amountRaw: params.amountRaw },
  });
}

export function createReferralEarnedNotification(params: { userAddress: string; amountRaw: string; txHash: string; referredAddress: string }) {
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

export function createThankYouMessageNotification(params: {
  userAddress: string;
  creatorUsername: string;
  creatorDisplayName?: string | null;
  creatorOwnerAddress: string;
  totalRaw: string;
  tipCount: number;
}) {
  const amount = (Number(params.totalRaw) / 1e6).toFixed(2);
  const creator = params.creatorDisplayName || `@${params.creatorUsername.replace(/^@/, "")}`;
  return createNotification({
    userAddress: params.userAddress,
    type: "message",
    title: "A creator says thanks",
    body: `${creator} sent you a thank you for ${params.tipCount} support${params.tipCount === 1 ? "" : "s"} totaling $${amount}.`,
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

export function createLowBalanceNotification(params: { userAddress: string; balanceRaw: string; thresholdUsd: string }) {
  const balance = (Number(params.balanceRaw) / 1e6).toFixed(2);
  return createNotification({
    userAddress: params.userAddress,
    type: "low_balance",
    title: "Low balance",
    body: `Your Teep balance is $${balance}, below your default tip of $${params.thresholdUsd}.`,
    metadata: { balanceRaw: params.balanceRaw, thresholdUsd: params.thresholdUsd },
  });
}

export function createReceiptReadyNotification(params: {
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

export function createCreatorClaimedNotifications(params: {
  authorId: string;
  username: string;
  ownerAddress: string;
}) {
  const db = getDb();
  const tippers = db
    .prepare(
      `SELECT from_address, COUNT(*) as tipCount, COALESCE(SUM(CAST(amount AS REAL)), 0) as total
       FROM tips
       WHERE author_id = ? AND LOWER(from_address) <> ?
       GROUP BY from_address`
    )
    .all(params.authorId, params.ownerAddress.toLowerCase()) as Array<{ from_address: string; tipCount: number; total: number }>;

  for (const tipper of tippers) {
    const amount = (Number(tipper.total) / 1e6).toFixed(2);
    createNotification({
      userAddress: tipper.from_address,
      type: "creator_claimed_funds",
      title: "Creator claimed",
      body: `@${params.username} connected their account and can now access $${amount} you sent.`,
      metadata: {
        authorId: params.authorId,
        username: params.username,
        ownerAddress: params.ownerAddress.toLowerCase(),
        tipCount: tipper.tipCount,
        amountRaw: String(tipper.total),
      },
    });
  }
}
