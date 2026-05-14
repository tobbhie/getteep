import { getDb } from "../db/database";
import { recordOpsEvent } from "./ops";

const DAY_SECONDS = 24 * 60 * 60;
const HIGH_FREQUENCY_TIP_COUNT = parseInt(process.env.ABUSE_HIGH_FREQUENCY_TIP_COUNT || "25", 10);
const CIRCULAR_TIP_WINDOW_SECONDS = parseInt(process.env.ABUSE_CIRCULAR_TIP_WINDOW_SECONDS || String(7 * DAY_SECONDS), 10);
const WASH_REFERRAL_WINDOW_SECONDS = parseInt(process.env.ABUSE_WASH_REFERRAL_WINDOW_SECONDS || String(14 * DAY_SECONDS), 10);

function insertAbuseEvent(params: {
  severity: "low" | "medium" | "high";
  eventType: string;
  actorAddress?: string | null;
  counterpartyAddress?: string | null;
  authorId?: string | null;
  contentId?: string | null;
  txHash?: string | null;
  reason: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const metadataJson = params.metadata ? JSON.stringify(params.metadata) : null;
    getDb().prepare(`
      INSERT INTO abuse_events (
        severity, event_type, actor_address, counterparty_address, author_id, content_id, tx_hash, reason, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.severity,
      params.eventType,
      params.actorAddress?.toLowerCase() || null,
      params.counterpartyAddress?.toLowerCase() || null,
      params.authorId || null,
      params.contentId || null,
      params.txHash?.toLowerCase() || null,
      params.reason,
      metadataJson,
      Date.now()
    );
  } catch {}
}

function countOpenRecent(eventType: string, actorAddress: string, reason: string, sinceMs: number): number {
  const row = getDb().prepare(
    "SELECT COUNT(*) as c FROM abuse_events WHERE event_type = ? AND actor_address = ? AND reason = ? AND created_at >= ?"
  ).get(eventType, actorAddress.toLowerCase(), reason, sinceMs) as { c: number } | undefined;
  return row?.c ?? 0;
}

export function inspectTipForAbuse(params: {
  fromAddress: string;
  toAddress: string;
  authorId: string;
  contentId: string;
  amountRaw: string;
  txHash: string;
}) {
  const db = getDb();
  const from = params.fromAddress.toLowerCase();
  const to = params.toAddress.toLowerCase();
  const nowSeconds = Math.floor(Date.now() / 1000);

  const claim = db.prepare(
    "SELECT owner_address FROM verified_claims WHERE author_id = ? LIMIT 1"
  ).get(params.authorId) as { owner_address: string } | undefined;

  if (claim?.owner_address?.toLowerCase() === from && countOpenRecent("self_tipping", from, params.authorId, Date.now() - DAY_SECONDS * 1000) === 0) {
    insertAbuseEvent({
      severity: "high",
      eventType: "self_tipping",
      actorAddress: from,
      counterpartyAddress: to,
      authorId: params.authorId,
      contentId: params.contentId,
      txHash: params.txHash,
      reason: params.authorId,
      metadata: { amountRaw: params.amountRaw },
    });
  }

  const reciprocal = db.prepare(
    `SELECT COUNT(*) as c FROM tips
     WHERE from_address = ? AND to_address = ? AND timestamp >= ?`
  ).get(to, from, nowSeconds - CIRCULAR_TIP_WINDOW_SECONDS) as { c: number } | undefined;
  if ((reciprocal?.c ?? 0) > 0 && countOpenRecent("circular_tipping", from, to, Date.now() - DAY_SECONDS * 1000) === 0) {
    insertAbuseEvent({
      severity: "medium",
      eventType: "circular_tipping",
      actorAddress: from,
      counterpartyAddress: to,
      authorId: params.authorId,
      contentId: params.contentId,
      txHash: params.txHash,
      reason: to,
      metadata: { reciprocalCount: reciprocal?.c ?? 0, windowSeconds: CIRCULAR_TIP_WINDOW_SECONDS },
    });
  }

  const frequency = db.prepare(
    "SELECT COUNT(*) as c FROM tips WHERE from_address = ? AND timestamp >= ?"
  ).get(from, nowSeconds - DAY_SECONDS) as { c: number } | undefined;
  if ((frequency?.c ?? 0) >= HIGH_FREQUENCY_TIP_COUNT && countOpenRecent("high_frequency_tipping", from, "daily", Date.now() - DAY_SECONDS * 1000) === 0) {
    insertAbuseEvent({
      severity: "low",
      eventType: "high_frequency_tipping",
      actorAddress: from,
      reason: "daily",
      txHash: params.txHash,
      metadata: { count: frequency?.c ?? 0, threshold: HIGH_FREQUENCY_TIP_COUNT },
    });
  }

  const referral = db.prepare(
    "SELECT referrer_address FROM user_referrals WHERE user_address = ?"
  ).get(from) as { referrer_address: string } | undefined;
  if (referral?.referrer_address) {
    const referrer = referral.referrer_address.toLowerCase();
    const referrerClaim = db.prepare(
      "SELECT author_id FROM verified_claims WHERE owner_address = ? LIMIT 1"
    ).get(referrer) as { author_id: string } | undefined;
    if (referrerClaim?.author_id === params.authorId) {
      const recentToReferrer = db.prepare(
        "SELECT COUNT(*) as c FROM tips WHERE from_address = ? AND author_id = ? AND timestamp >= ?"
      ).get(from, params.authorId, nowSeconds - WASH_REFERRAL_WINDOW_SECONDS) as { c: number } | undefined;
      if ((recentToReferrer?.c ?? 0) > 0 && countOpenRecent("wash_referral", from, referrer, Date.now() - DAY_SECONDS * 1000) === 0) {
        insertAbuseEvent({
          severity: "medium",
          eventType: "wash_referral",
          actorAddress: from,
          counterpartyAddress: referrer,
          authorId: params.authorId,
          txHash: params.txHash,
          reason: referrer,
          metadata: { tipsToReferrer: recentToReferrer?.c ?? 0, windowSeconds: WASH_REFERRAL_WINDOW_SECONDS },
        });
      }
    }
  }
}

export function inspectReferralForAbuse(userAddress: string, referrerAddress: string, referralCode: string) {
  const db = getDb();
  const user = userAddress.toLowerCase();
  const referrer = referrerAddress.toLowerCase();

  const reciprocal = db.prepare(
    "SELECT 1 FROM user_referrals WHERE user_address = ? AND referrer_address = ? LIMIT 1"
  ).get(referrer, user);
  if (reciprocal) {
    insertAbuseEvent({
      severity: "high",
      eventType: "reciprocal_referral",
      actorAddress: user,
      counterpartyAddress: referrer,
      reason: referralCode,
    });
  }

  const sameCreator = db.prepare(
    `SELECT COUNT(DISTINCT author_id) as c FROM verified_claims
     WHERE owner_address IN (?, ?)`
  ).get(user, referrer) as { c: number } | undefined;
  if ((sameCreator?.c ?? 0) === 1) {
    insertAbuseEvent({
      severity: "high",
      eventType: "creator_referral_self_link",
      actorAddress: user,
      counterpartyAddress: referrer,
      reason: referralCode,
    });
  }
}

export function summarizeOpenAbuseEvents(limit = 20) {
  const db = getDb();
  const totals = db.prepare(
    "SELECT event_type, severity, COUNT(*) as count FROM abuse_events WHERE status = 'open' GROUP BY event_type, severity ORDER BY count DESC"
  ).all() as Array<{ event_type: string; severity: string; count: number }>;
  const recent = db.prepare(
    "SELECT severity, event_type, actor_address, reason, created_at FROM abuse_events WHERE status = 'open' ORDER BY created_at DESC LIMIT ?"
  ).all(limit) as Array<Record<string, unknown>>;
  return { totals, recent };
}

export function logAbuseSummary() {
  const summary = summarizeOpenAbuseEvents(5);
  if (summary.recent.length) {
    recordOpsEvent({
      level: "warn",
      source: "abuse",
      eventType: "open_abuse_events",
      message: `${summary.recent.length} recent open abuse events`,
      metadata: { totals: summary.totals },
    });
  }
}
