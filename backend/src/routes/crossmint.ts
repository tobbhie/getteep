import { Router, Request, Response } from "express";
import crypto from "crypto";
import { getDb } from "../db/database";
import { isAddress } from "../utils/security";
import { verifyWalletProof } from "../services/walletAuth";
import { recordSecurityEvent } from "../services/ops";
import {
  buildCrossmintOfframpPayload,
  buildCrossmintOnrampPayload,
  createCrossmintOrder,
  crossmintSessionId,
  CrossmintConfigError,
  CrossmintProviderError,
  fetchCrossmintOrderStatus,
  getCrossmintPublicStatus,
  normalizeOnrampAmountRaw,
  rawUsdcToUsdString,
  sanitizeProviderPayload,
} from "../services/crossmint";
import {
  createFundingProviderSession,
  updateFundingProviderSession,
  updateFundingProviderSessionStatus,
} from "../services/fundingProviderRecords";
import {
  FEE_BPS,
  REFERRER_SHARE_BPS,
  PROTOCOL_TREASURY,
  REFERRAL_ACTIVATION_MIN_TIPS,
  REFERRAL_CAP_PER_REFERRER,
} from "./referral";

const router = Router();

const USDC_DECIMALS = 6n;
const DEFAULT_DAILY_LIMIT_RAW = 1_000n * 10n ** USDC_DECIMALS;
const DAILY_LIMIT_RAW = BigInt(process.env.WITHDRAWAL_DAILY_LIMIT_RAW || DEFAULT_DAILY_LIMIT_RAW.toString());
const CONFIRMATION_TTL_MS = Number(process.env.WITHDRAWAL_CONFIRMATION_TTL_MS || 10 * 60 * 1000);
const REQUIRE_EMAIL_CONFIRMATION = process.env.WITHDRAWAL_REQUIRE_EMAIL_CONFIRMATION !== "false";
const NODE_ENV = process.env.NODE_ENV || "development";

function parsePositiveAmount(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  const amount = BigInt(value);
  return amount > 0n ? amount : null;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function normalizePaymentMethodId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id) return null;
  return /^[a-zA-Z0-9_.:-]{3,120}$/.test(id) ? id : null;
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function verifyRecordToken(token: unknown, expectedHash: string | null | undefined): boolean {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token) || !expectedHash) return false;
  const actual = Buffer.from(hashCode(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function sumRows(rows: Array<{ amount_raw?: string; amount?: string }>): bigint {
  return rows.reduce((sum, row) => {
    const value = row.amount_raw ?? row.amount;
    return /^[0-9]+$/.test(value || "") ? sum + BigInt(value as string) : sum;
  }, 0n);
}

function getUtcDayStartMs(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

async function getDailyUsage(ownerAddress: string, db = getDb()) {
  const dayStart = getUtcDayStartMs();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const recorded = await db.prepare(
    "SELECT amount_raw FROM withdrawal_records WHERE owner_address = ? AND created_at >= ? AND created_at < ?"
  ).all(ownerAddress, dayStart, dayEnd) as Array<{ amount_raw: string }>;
  const legacy = await db.prepare(
    "SELECT amount FROM user_activity WHERE from_address = ? AND type IN ('withdraw', 'withdraw_balance') AND timestamp >= ? AND timestamp < ?"
  ).all(ownerAddress, Math.floor(dayStart / 1000), Math.floor(dayEnd / 1000)) as Array<{ amount: string }>;
  const pending = await db.prepare(
    "SELECT amount_raw FROM withdrawal_confirmations WHERE owner_address = ? AND status IN ('pending', 'confirmed') AND expires_at >= ? AND created_at >= ? AND created_at < ?"
  ).all(ownerAddress, Date.now(), dayStart, dayEnd) as Array<{ amount_raw: string }>;
  const used = sumRows(recorded) + sumRows(legacy) + sumRows(pending);
  const remaining = DAILY_LIMIT_RAW > used ? DAILY_LIMIT_RAW - used : 0n;
  return { used, remaining, limit: DAILY_LIMIT_RAW, windowStart: dayStart, windowEnd: dayEnd };
}

async function getTipActivityCount(ownerAddress: string, db = getDb()): Promise<number> {
  const indexed = await db.prepare(
    "SELECT COUNT(*) as c FROM tips WHERE LOWER(from_address) = ?"
  ).get(ownerAddress.toLowerCase()) as { c: number | string } | undefined;
  const xBot = await db.prepare(
    `SELECT COUNT(*) as c
     FROM x_bot_tips xbt
     WHERE LOWER(xbt.sender_address) = ?
       AND xbt.status = 'completed'
       AND NOT EXISTS (
         SELECT 1 FROM tips t
         WHERE xbt.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(xbt.tx_hash)
       )`
  ).get(ownerAddress.toLowerCase()) as { c: number | string } | undefined;
  return Number(indexed?.c ?? 0) + Number(xBot?.c ?? 0);
}

async function getTipsEarnedBreakdown(ownerAddress: string, amount: bigint, db = getDb()) {
  const feeAmount = (amount * BigInt(FEE_BPS)) / 10000n;
  const netAmount = amount - feeAmount;
  let referrerAddress: string | null = null;
  let referrerAmount = 0n;
  let protocolAmount = feeAmount;
  const hasActiveReferral = (await getTipActivityCount(ownerAddress, db)) >= REFERRAL_ACTIVATION_MIN_TIPS;

  if (hasActiveReferral && feeAmount > 0n) {
    const refRow = await db.prepare(
      "SELECT referrer_address FROM user_referrals WHERE user_address = ?"
    ).get(ownerAddress) as { referrer_address: string } | undefined;
    const refAddr = refRow?.referrer_address?.toLowerCase();
    if (refAddr && refAddr !== ownerAddress) {
      const refCount = await db.prepare(
        "SELECT COUNT(*) as c FROM user_referrals WHERE referrer_address = ?"
      ).get(refAddr) as { c: number | string } | undefined;
      if (Number(refCount?.c ?? 0) <= REFERRAL_CAP_PER_REFERRER) {
        referrerAddress = refAddr;
        referrerAmount = (feeAmount * BigInt(REFERRER_SHARE_BPS)) / 10000n;
        protocolAmount = feeAmount - referrerAmount;
      }
    }
  }

  return {
    amountRaw: amount,
    netAmount,
    feeAmount,
    protocolAmount,
    protocolTreasury: PROTOCOL_TREASURY || "0x0000000000000000000000000000000000000000",
    referrerAmount,
    referrerAddress: referrerAddress || "0x0000000000000000000000000000000000000000",
    feeBps: FEE_BPS,
  };
}

async function validateTipsEarnedWithdrawal(ownerAddress: string, claimWalletAddress: string, amount: bigint, db = getDb()) {
  const claim = await db.prepare(
    "SELECT author_id FROM verified_claims WHERE owner_address = ? LIMIT 1"
  ).get(ownerAddress) as { author_id: string } | undefined;
  if (!claim) return { ok: false, status: 403, error: "Verify your X account before withdrawing tips earned." };

  const source = await db.prepare(
    `SELECT wallet_address
     FROM claim_wallets
     WHERE LOWER(owner_address) = ? AND LOWER(wallet_address) = ?
     LIMIT 1`
  ).get(ownerAddress, claimWalletAddress) as { wallet_address: string } | undefined;
  if (!source) return { ok: false, status: 403, error: "The selected Tips Earned source does not belong to this account." };

  const usage = await getDailyUsage(ownerAddress, db);
  if (amount > usage.remaining) {
    return {
      ok: false,
      status: 429,
      error: "This withdrawal exceeds your daily limit.",
      code: "WITHDRAWAL_DAILY_LIMIT",
      dailyLimitRaw: usage.limit.toString(),
      dailyUsedRaw: usage.used.toString(),
      dailyRemainingRaw: usage.remaining.toString(),
      windowResetAt: new Date(usage.windowEnd).toISOString(),
    };
  }

  return { ok: true as const };
}

async function maybeSendConfirmationEmail(email: string, code: string): Promise<{ delivered: boolean; devCode?: string }> {
  const webhookUrl = process.env.WITHDRAWAL_EMAIL_WEBHOOK_URL;
  if (webhookUrl) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: email,
        subject: "Confirm your Teep bank cash-out",
        text: `Your Teep bank cash-out confirmation code is ${code}. It expires in ${Math.round(CONFIRMATION_TTL_MS / 60000)} minutes.`,
      }),
    });
    if (!res.ok) throw new Error("Withdrawal confirmation email failed");
    return { delivered: true };
  }

  if (NODE_ENV === "production") {
    throw new Error("Withdrawal email delivery is not configured");
  }

  return { delivered: false, devCode: code };
}

function providerError(res: Response, error: unknown) {
  if (error instanceof CrossmintConfigError || error instanceof CrossmintProviderError) {
    res.status(error.statusCode).json({
      error: error.message,
      code: error.code,
      ...(error instanceof CrossmintProviderError && error.details ? { details: error.details } : {}),
    });
    return;
  }
  res.status(500).json({ error: "Crossmint request failed." });
}

router.get("/status", (_req: Request, res: Response) => {
  res.json(getCrossmintPublicStatus());
});

router.post("/onramp/orders", async (req: Request, res: Response) => {
  const ownerAddress = String(req.body?.ownerAddress || req.body?.walletAddress || "").toLowerCase();
  const walletAddress = String(req.body?.walletAddress || ownerAddress || "").toLowerCase();
  const email = normalizeEmail(req.body?.email);
  const amountRaw = normalizeOnrampAmountRaw(String(req.body?.amountRaw || req.body?.amountUsd || ""));

  if (!isAddress(ownerAddress) || !isAddress(walletAddress) || !amountRaw) {
    res.status(400).json({ error: "Valid ownerAddress, walletAddress, and amount are required." });
    return;
  }

  const verified = await verifyWalletProof(ownerAddress, "funding", req.body?.walletProof);
  if (!verified) {
    await recordSecurityEvent({
      eventType: "crossmint_onramp_signature_failed",
      actorAddress: ownerAddress,
      route: "/crossmint/onramp/orders",
      ip: req.ip,
      reason: "Valid wallet signature required.",
    });
    res.status(401).json({ error: "Valid wallet signature required." });
    return;
  }

  const sessionId = crossmintSessionId("onramp");
  try {
    await createFundingProviderSession({
      id: sessionId,
      provider: "Crossmint",
      kind: "fiat_onramp",
      userAddress: ownerAddress,
      status: "created",
      metadata: {
        environment: getCrossmintPublicStatus().environment,
        walletAddress,
        amountRaw: amountRaw.toString(),
        amountUsd: rawUsdcToUsdString(amountRaw),
      },
    });

    const payload = buildCrossmintOnrampPayload({ ownerAddress, walletAddress, amountRaw, email, sessionId });
    const order = await createCrossmintOrder("onramp", payload, sessionId);
    await updateFundingProviderSession({
      id: sessionId,
      status: order.status === "completed" ? "completed" : "pending",
      providerSessionId: order.providerOrderId,
      redirectUrl: order.redirectUrl,
      metadata: {
        environment: getCrossmintPublicStatus().environment,
        orderId: order.providerOrderId,
        amountRaw: amountRaw.toString(),
        amountUsd: rawUsdcToUsdString(amountRaw),
        walletAddress,
        checkoutUrlPresent: Boolean(order.redirectUrl),
        clientSecretPresent: Boolean(order.clientSecret),
        providerStatus: order.status,
      },
    });

    res.json({
      sessionId,
      orderId: order.providerOrderId,
      redirectUrl: order.redirectUrl,
      clientSecret: order.clientSecret,
      status: order.status,
    });
  } catch (error) {
    await updateFundingProviderSessionStatus(sessionId, "failed", {
      error: error instanceof Error ? error.message : "Crossmint onramp failed",
    }).catch(() => undefined);
    providerError(res, error);
  }
});

router.post("/offramp/orders", async (req: Request, res: Response) => {
  const ownerAddress = String(req.body?.ownerAddress || "").toLowerCase();
  const claimWalletAddress = String(req.body?.claimWalletAddress || "").toLowerCase();
  const amount = parsePositiveAmount(req.body?.amountRaw);
  const email = normalizeEmail(req.body?.email);
  const paymentMethodId = normalizePaymentMethodId(req.body?.paymentMethodId);

  if (!isAddress(ownerAddress) || !isAddress(claimWalletAddress) || !amount) {
    res.status(400).json({ error: "Valid ownerAddress, claimWalletAddress, and amountRaw are required." });
    return;
  }
  if (REQUIRE_EMAIL_CONFIRMATION && !email) {
    res.status(400).json({ error: "A verified email is required to confirm bank cash-outs." });
    return;
  }

  const verified = await verifyWalletProof(ownerAddress, "withdrawal", req.body?.walletProof);
  if (!verified) {
    await recordSecurityEvent({
      eventType: "crossmint_offramp_signature_failed",
      actorAddress: ownerAddress,
      route: "/crossmint/offramp/orders",
      ip: req.ip,
      reason: "Valid wallet signature required.",
    });
    res.status(401).json({ error: "Valid wallet signature required." });
    return;
  }

  const db = getDb();
  const validation = await validateTipsEarnedWithdrawal(ownerAddress, claimWalletAddress, amount, db);
  if (!validation.ok) {
    res.status(validation.status).json(validation);
    return;
  }

  const breakdown = await getTipsEarnedBreakdown(ownerAddress, amount, db);
  const sessionId = crossmintSessionId("offramp");
  try {
    await createFundingProviderSession({
      id: sessionId,
      provider: "Crossmint",
      kind: "fiat_offramp",
      userAddress: ownerAddress,
      status: "created",
      metadata: {
        environment: getCrossmintPublicStatus().environment,
        source: "tipsEarned",
        grossAmountRaw: amount.toString(),
        netAmountRaw: breakdown.netAmount.toString(),
        feeAmountRaw: breakdown.feeAmount.toString(),
        claimWalletAddress,
      },
    });

    const payload = buildCrossmintOfframpPayload({
      ownerAddress,
      claimWalletAddress,
      grossAmountRaw: amount,
      netAmountRaw: breakdown.netAmount,
      feeAmountRaw: breakdown.feeAmount,
      paymentMethodId,
      email,
      sessionId,
    });
    const order = await createCrossmintOrder("offramp", payload, sessionId);
    if (!order.depositAddress) {
      throw new CrossmintProviderError("Crossmint did not return a valid crypto deposit address.", 502, sanitizeProviderPayload(order.raw));
    }

    const code = String(crypto.randomInt(100000, 1_000_000));
    const requestId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + CONFIRMATION_TTL_MS;
    const emailResult = REQUIRE_EMAIL_CONFIRMATION && email
      ? await maybeSendConfirmationEmail(email, code)
      : { delivered: false, devCode: code };

    await db.prepare(`
      INSERT INTO withdrawal_confirmations (
        id, owner_address, destination_address, source, amount_raw, email, code_hash, status, created_at, expires_at
      ) VALUES (?, ?, ?, 'tipsEarned', ?, ?, ?, 'pending', ?, ?)
    `).run(requestId, ownerAddress, order.depositAddress, amount.toString(), email, hashCode(code), now, expiresAt);

    await updateFundingProviderSession({
      id: sessionId,
      status: order.status === "completed" ? "completed" : "pending",
      providerSessionId: order.providerOrderId,
      redirectUrl: order.redirectUrl,
      metadata: {
        environment: getCrossmintPublicStatus().environment,
        source: "tipsEarned",
        withdrawalRequestId: requestId,
        orderId: order.providerOrderId,
        providerStatus: order.status,
        depositAddress: order.depositAddress,
        grossAmountRaw: amount.toString(),
        netAmountRaw: breakdown.netAmount.toString(),
        feeAmountRaw: breakdown.feeAmount.toString(),
        protocolAmountRaw: breakdown.protocolAmount.toString(),
        referrerAmountRaw: breakdown.referrerAmount.toString(),
        referrerAddress: breakdown.referrerAddress,
        claimWalletAddress,
        checkoutUrlPresent: Boolean(order.redirectUrl),
      },
    });

    res.json({
      sessionId,
      orderId: order.providerOrderId,
      requestId,
      expiresAt,
      depositAddress: order.depositAddress,
      redirectUrl: order.redirectUrl,
      status: order.status,
      emailConfirmationRequired: REQUIRE_EMAIL_CONFIRMATION,
      emailDelivered: emailResult.delivered,
      devCode: emailResult.devCode,
      amountRaw: amount.toString(),
      netAmount: breakdown.netAmount.toString(),
      feeAmount: breakdown.feeAmount.toString(),
      protocolAmount: breakdown.protocolAmount.toString(),
      protocolTreasury: breakdown.protocolTreasury,
      referrerAmount: breakdown.referrerAmount.toString(),
      referrerAddress: breakdown.referrerAddress,
      feeBps: breakdown.feeBps,
    });
  } catch (error) {
    await updateFundingProviderSessionStatus(sessionId, "failed", {
      error: error instanceof Error ? error.message : "Crossmint offramp failed",
    }).catch(() => undefined);
    providerError(res, error);
  }
});

router.post("/offramp/sessions/:sessionId/deposit", async (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId || "");
  const txHash = String(req.body?.txHash || "").toLowerCase();
  const ownerAddress = String(req.body?.ownerAddress || "").toLowerCase();
  const requestId = String(req.body?.requestId || "");
  if (!sessionId.startsWith("crossmint_offramp_") || !/^0x[a-f0-9]{64}$/.test(txHash) || !isAddress(ownerAddress) || !requestId) {
    res.status(400).json({ error: "Valid sessionId, requestId, ownerAddress, and txHash are required." });
    return;
  }

  const db = getDb();
  const confirmation = await db.prepare(
    "SELECT id, owner_address, record_token_hash, tx_hash FROM withdrawal_confirmations WHERE id = ? AND owner_address = ?"
  ).get(requestId, ownerAddress) as {
    id: string;
    owner_address: string;
    record_token_hash: string | null;
    tx_hash: string | null;
  } | undefined;
  if (!confirmation) {
    res.status(404).json({ error: "Withdrawal confirmation not found." });
    return;
  }
  if (!verifyRecordToken(req.body?.recordToken, confirmation.record_token_hash)) {
    res.status(401).json({ error: "Valid withdrawal record token required." });
    return;
  }

  const session = await db.prepare(
    "SELECT metadata_json FROM funding_provider_sessions WHERE id = ? AND user_address = ? AND provider = 'Crossmint' AND kind = 'fiat_offramp'"
  ).get(sessionId, ownerAddress) as { metadata_json: string | null } | undefined;
  if (!session) {
    res.status(404).json({ error: "Crossmint off-ramp session not found." });
    return;
  }

  const metadata = session.metadata_json ? JSON.parse(session.metadata_json) : {};
  if (metadata.withdrawalRequestId && metadata.withdrawalRequestId !== requestId) {
    res.status(409).json({ error: "Crossmint session does not match this withdrawal request." });
    return;
  }
  await updateFundingProviderSession({
    id: sessionId,
    status: "pending",
    metadata: {
      ...metadata,
      withdrawalRequestId: requestId,
      depositTxHash: txHash,
      depositSubmittedAt: Date.now(),
    },
  });
  res.json({ recorded: true });
});

router.get("/sessions/:sessionId", async (req: Request, res: Response) => {
  const sessionId = String(req.params.sessionId || "");
  const ownerAddress = String(req.query.ownerAddress || "").toLowerCase();
  if (!sessionId.startsWith("crossmint_") || !isAddress(ownerAddress)) {
    res.status(400).json({ error: "Valid sessionId and ownerAddress are required." });
    return;
  }

  const db = getDb();
  const session = await db.prepare(
    `SELECT id, provider_session_id as providerSessionId, kind, status, redirect_url as redirectUrl, metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt
     FROM funding_provider_sessions
     WHERE id = ? AND user_address = ? AND provider = 'Crossmint'`
  ).get(sessionId, ownerAddress) as {
    id: string;
    providerSessionId: string | null;
    kind: string;
    status: string;
    redirectUrl: string | null;
    metadataJson: string | null;
    createdAt: number;
    updatedAt: number;
  } | undefined;
  if (!session) {
    res.status(404).json({ error: "Crossmint session not found." });
    return;
  }

  const metadata = session.metadataJson ? JSON.parse(session.metadataJson) : {};
  if (session.providerSessionId) {
    try {
      const kind = session.kind === "fiat_offramp" ? "offramp" : "onramp";
      const order = await fetchCrossmintOrderStatus(kind, session.providerSessionId);
      await updateFundingProviderSession({
        id: session.id,
        status: order.status === "completed" ? "completed" : session.status as any,
        metadata: { ...metadata, providerStatus: order.status, lastStatusSyncAt: Date.now() },
      });
      metadata.providerStatus = order.status;
      metadata.lastStatusSyncAt = Date.now();
    } catch {
      metadata.statusSync = "unavailable";
    }
  }

  res.json({
    id: session.id,
    orderId: session.providerSessionId,
    kind: session.kind,
    status: session.status,
    redirectUrl: session.redirectUrl,
    metadata,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
});

export default router;
