import { Router, Request, Response } from "express";
import crypto from "crypto";
import { Wallet, keccak256, toUtf8Bytes } from "ethers";
import { getDb } from "../db/database";
import { isAddress } from "../utils/security";
import { verifyWalletProof } from "../services/walletAuth";
import { recordSecurityEvent } from "../services/ops";
import { getConfiguredChain } from "../config/chain";
import { createReferralEarnedNotification, createWithdrawalConfirmedNotification } from "../services/notifications";
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
const USDC_ADDRESS = (process.env.USDC_ADDRESS || "").toLowerCase();
const WITHDRAWAL_AUTH_PRIVATE_KEY = process.env.WITHDRAWAL_AUTHORIZATION_PRIVATE_KEY || process.env.ATTESTATION_PRIVATE_KEY;

type WithdrawalSource = "tipBalance" | "tipsEarned";

function parsePositiveAmount(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) return null;
  const amount = BigInt(value);
  return amount > 0n ? amount : null;
}

function normalizeSource(value: unknown): WithdrawalSource | null {
  return value === "tipBalance" || value === "tipsEarned" ? value : null;
}

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function requestNonce(requestId: string): string {
  return keccak256(toUtf8Bytes(`teep-withdrawal:${requestId}`));
}

async function signWithdrawalAuthorization(params: {
  requestId: string;
  ownerAddress: string;
  claimWalletAddress: string;
  destinationAddress: string;
  amountRaw: string;
  expiresAtMs: number;
}) {
  if (!WITHDRAWAL_AUTH_PRIVATE_KEY) throw new Error("Withdrawal authorization signer is not configured");
  if (!USDC_ADDRESS || !isAddress(USDC_ADDRESS)) throw new Error("USDC_ADDRESS is not configured");
  const signer = new Wallet(WITHDRAWAL_AUTH_PRIVATE_KEY);
  const expiresAt = Math.floor(params.expiresAtMs / 1000);
  const nonce = requestNonce(params.requestId);
  const signature = await signer.signTypedData(
    {
      name: "TeepClaimWallet",
      version: "1",
      chainId: getConfiguredChain().id,
      verifyingContract: params.claimWalletAddress,
    },
    {
      WithdrawalAuthorization: [
        { name: "owner", type: "address" },
        { name: "token", type: "address" },
        { name: "destination", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "expiresAt", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    {
      owner: params.ownerAddress,
      token: USDC_ADDRESS,
      destination: params.destinationAddress,
      amount: params.amountRaw,
      expiresAt,
      nonce,
    }
  );
  return {
    claimWalletAddress: params.claimWalletAddress,
    token: USDC_ADDRESS,
    destination: params.destinationAddress,
    amount: params.amountRaw,
    expiresAt,
    nonce,
    signature,
  };
}

function getUtcDayStartMs(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function sumRows(rows: Array<{ amount_raw?: string; amount?: string }>): bigint {
  return rows.reduce((sum, row) => {
    const value = row.amount_raw ?? row.amount;
    return /^[0-9]+$/.test(value || "") ? sum + BigInt(value as string) : sum;
  }, 0n);
}

function getDailyUsage(ownerAddress: string, db = getDb()) {
  const dayStart = getUtcDayStartMs();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const recorded = db.prepare(
    "SELECT amount_raw FROM withdrawal_records WHERE owner_address = ? AND created_at >= ? AND created_at < ?"
  ).all(ownerAddress, dayStart, dayEnd) as Array<{ amount_raw: string }>;
  const legacy = db.prepare(
    "SELECT amount FROM user_activity WHERE from_address = ? AND type IN ('withdraw', 'withdraw_balance') AND timestamp >= ? AND timestamp < ?"
  ).all(ownerAddress, Math.floor(dayStart / 1000), Math.floor(dayEnd / 1000)) as Array<{ amount: string }>;
  const pending = db.prepare(
    "SELECT amount_raw FROM withdrawal_confirmations WHERE owner_address = ? AND status IN ('pending', 'confirmed') AND expires_at >= ? AND created_at >= ? AND created_at < ?"
  ).all(ownerAddress, Date.now(), dayStart, dayEnd) as Array<{ amount_raw: string }>;
  const used = sumRows(recorded) + sumRows(legacy) + sumRows(pending);
  const remaining = DAILY_LIMIT_RAW > used ? DAILY_LIMIT_RAW - used : 0n;
  return { used, remaining, limit: DAILY_LIMIT_RAW, windowStart: dayStart, windowEnd: dayEnd };
}

function assertVerifiedCreator(ownerAddress: string, source: WithdrawalSource, res: Response): boolean {
  if (source !== "tipsEarned") return true;
  const db = getDb();
  const claim = db.prepare(
    "SELECT author_id FROM verified_claims WHERE owner_address = ? LIMIT 1"
  ).get(ownerAddress) as { author_id: string } | undefined;
  if (claim) return true;
  res.status(403).json({ error: "Verify your X account before withdrawing tips earned." });
  return false;
}

function validateDailyLimit(ownerAddress: string, amount: bigint, res: Response): boolean {
  const usage = getDailyUsage(ownerAddress);
  if (amount <= usage.remaining) return true;
  res.status(429).json({
    error: "This withdrawal exceeds your daily limit.",
    code: "WITHDRAWAL_DAILY_LIMIT",
    dailyLimitRaw: usage.limit.toString(),
    dailyUsedRaw: usage.used.toString(),
    dailyRemainingRaw: usage.remaining.toString(),
    windowResetAt: new Date(usage.windowEnd).toISOString(),
  });
  return false;
}

async function maybeSendConfirmationEmail(email: string, code: string): Promise<{ delivered: boolean; devCode?: string }> {
  const webhookUrl = process.env.WITHDRAWAL_EMAIL_WEBHOOK_URL;
  if (webhookUrl) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: email,
        subject: "Confirm your Teep withdrawal",
        text: `Your Teep withdrawal confirmation code is ${code}. It expires in ${Math.round(CONFIRMATION_TTL_MS / 60000)} minutes.`,
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

/**
 * GET /withdrawal/breakdown
 * Query: ownerAddress (wallet doing the withdraw = claim wallet owner), amountRaw (USDC 6 decimals string)
 * Returns net amount, fee amount, protocol amount, referrer amount and address (or zero address if no referrer).
 * Used by clients to show the fee breakdown before the user agrees. When ReferralRegistry is in use,
 * the contract performs the split in one tx (withdrawWithFee). For any offchain withdrawal path (e.g. to bank),
 * deduction and distribution (treasury + referrer) must be done on-chain first (withdrawWithFee or legacy multi-withdraw), then proceed with offchain.
 */
router.get("/breakdown", (req: Request, res: Response) => {
  const ownerAddress = (req.query.ownerAddress as string)?.toLowerCase();
  const amountRaw = req.query.amountRaw as string;
  const source = normalizeSource(req.query.source || "tipsEarned");

  if (!isAddress(ownerAddress) || !amountRaw || !source) {
    res.status(400).json({ error: "ownerAddress, amountRaw, and source required" });
    return;
  }

  const amount = parsePositiveAmount(amountRaw);
  if (!amount) {
    res.status(400).json({ error: "amount must be positive" });
    return;
  }
  if (!assertVerifiedCreator(ownerAddress, source, res)) return;
  if (!validateDailyLimit(ownerAddress, amount, res)) return;

  const feeBps = BigInt(FEE_BPS);
  const referrerShareBps = BigInt(REFERRER_SHARE_BPS);
  const feeAmount = (amount * feeBps) / 10000n;
  const netAmount = amount - feeAmount;

  let referrerAddress: string | null = null;
  let referrerAmount = 0n;
  let protocolAmount = feeAmount;

  const db = getDb();

  // Check if this user was referred and referral is active (e.g. has sent at least 1 tip)
  const tipCount = db.prepare(
    "SELECT COUNT(*) as c FROM tips WHERE from_address = ?"
  ).get(ownerAddress) as { c: number } | undefined;
  const hasActiveReferral = (tipCount?.c ?? 0) >= REFERRAL_ACTIVATION_MIN_TIPS;

  if (hasActiveReferral && feeAmount > 0n) {
    const refRow = db.prepare(
      "SELECT referrer_address FROM user_referrals WHERE user_address = ?"
    ).get(ownerAddress) as { referrer_address: string } | undefined;

    if (refRow) {
      const refAddr = refRow.referrer_address.toLowerCase();
      // No self-referral (withdrawer is claim wallet owner; referrer must be different)
      if (refAddr !== ownerAddress) {
        const refCount = db.prepare(
          "SELECT COUNT(*) as c FROM user_referrals WHERE referrer_address = ?"
        ).get(refAddr) as { c: number } | undefined;
        if ((refCount?.c ?? 0) <= REFERRAL_CAP_PER_REFERRER) {
          referrerAddress = refAddr;
          referrerAmount = (feeAmount * referrerShareBps) / 10000n;
          protocolAmount = feeAmount - referrerAmount;
        }
      }
    }
  }

  const treasury = PROTOCOL_TREASURY || "0x0000000000000000000000000000000000000000";

  res.json({
    amountRaw: amount.toString(),
    netAmount: netAmount.toString(),
    feeAmount: feeAmount.toString(),
    protocolAmount: protocolAmount.toString(),
    protocolTreasury: treasury,
    referrerAmount: referrerAmount.toString(),
    referrerAddress: referrerAddress || "0x0000000000000000000000000000000000000000",
    feeBps: FEE_BPS,
    safeguards: {
      emailConfirmationRequired: REQUIRE_EMAIL_CONFIRMATION,
      dailyLimitRaw: DAILY_LIMIT_RAW.toString(),
      dailyUsedRaw: getDailyUsage(ownerAddress).used.toString(),
      dailyRemainingRaw: getDailyUsage(ownerAddress).remaining.toString(),
      source,
    },
  });
});

router.post("/request", async (req: Request, res: Response) => {
  const ownerAddress = String(req.body?.ownerAddress || "").toLowerCase();
  const destinationAddress = String(req.body?.destinationAddress || "").toLowerCase();
  const amount = parsePositiveAmount(req.body?.amountRaw);
  const source = normalizeSource(req.body?.source || "tipsEarned");
  const email = normalizeEmail(req.body?.email);

  if (!isAddress(ownerAddress) || !isAddress(destinationAddress) || !amount || !source) {
    res.status(400).json({ error: "Valid ownerAddress, destinationAddress, source, and amountRaw are required." });
    return;
  }
  if (REQUIRE_EMAIL_CONFIRMATION && !email) {
    res.status(400).json({ error: "A verified email is required to confirm withdrawals." });
    return;
  }

  const verified = await verifyWalletProof(ownerAddress, "withdrawal", req.body?.walletProof);
  if (!verified) {
    recordSecurityEvent({
      eventType: "withdrawal_signature_failed",
      actorAddress: ownerAddress,
      route: "/withdrawal/request",
      ip: req.ip,
      reason: "Valid wallet signature required.",
    });
    res.status(401).json({ error: "Valid wallet signature required." });
    return;
  }
  if (!assertVerifiedCreator(ownerAddress, source, res)) return;
  if (!validateDailyLimit(ownerAddress, amount, res)) return;

  const code = String(crypto.randomInt(100000, 1_000_000));
  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + CONFIRMATION_TTL_MS;

  try {
    const emailResult = REQUIRE_EMAIL_CONFIRMATION && email
      ? await maybeSendConfirmationEmail(email, code)
      : { delivered: false, devCode: code };

    getDb().prepare(`
      INSERT INTO withdrawal_confirmations (
        id, owner_address, destination_address, source, amount_raw, email, code_hash, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, ownerAddress, destinationAddress, source, amount.toString(), email, hashCode(code), now, expiresAt);

    res.json({
      requestId: id,
      expiresAt,
      emailConfirmationRequired: REQUIRE_EMAIL_CONFIRMATION,
      emailDelivered: emailResult.delivered,
      devCode: emailResult.devCode,
      message: emailResult.delivered ? "Confirmation code sent." : "Confirmation code generated for local testing.",
    });
  } catch (err: any) {
    res.status(503).json({ error: err.message || "Could not send withdrawal confirmation." });
  }
});

router.post("/confirm", async (req: Request, res: Response) => {
  const requestId = String(req.body?.requestId || "");
  const code = String(req.body?.code || "").trim();
  const claimWalletAddress = String(req.body?.claimWalletAddress || "").toLowerCase();
  if (!requestId || !/^[0-9]{6}$/.test(code)) {
    res.status(400).json({ error: "Valid requestId and 6-digit code required." });
    return;
  }

  const db = getDb();
  const row = db.prepare(
    "SELECT id, owner_address, destination_address, source, amount_raw, status, expires_at, code_hash FROM withdrawal_confirmations WHERE id = ?"
  ).get(requestId) as {
    id: string;
    owner_address: string;
    destination_address: string;
    source: string;
    amount_raw: string;
    status: string;
    expires_at: number;
    code_hash: string;
  } | undefined;

  if (!row) {
    res.status(404).json({ error: "Withdrawal confirmation not found." });
    return;
  }
  if (row.status !== "pending") {
    res.status(409).json({ error: "Withdrawal confirmation is no longer pending." });
    return;
  }
  if (row.expires_at < Date.now()) {
    db.prepare("UPDATE withdrawal_confirmations SET status = 'expired' WHERE id = ?").run(requestId);
    res.status(410).json({ error: "Withdrawal confirmation expired." });
    return;
  }
  if (row.code_hash !== hashCode(code)) {
    res.status(401).json({ error: "Incorrect confirmation code." });
    return;
  }

  let withdrawalAuthorization: Awaited<ReturnType<typeof signWithdrawalAuthorization>> | undefined;
  if (row.source === "tipsEarned" && row.destination_address !== row.owner_address) {
    if (!isAddress(claimWalletAddress)) {
      res.status(400).json({ error: "claimWalletAddress is required for non-owner withdrawal destinations." });
      return;
    }
    try {
      withdrawalAuthorization = await signWithdrawalAuthorization({
        requestId: row.id,
        ownerAddress: row.owner_address,
        claimWalletAddress,
        destinationAddress: row.destination_address,
        amountRaw: row.amount_raw,
        expiresAtMs: row.expires_at,
      });
    } catch (err: any) {
      res.status(503).json({ error: err.message || "Could not sign withdrawal authorization." });
      return;
    }
  }

  db.prepare("UPDATE withdrawal_confirmations SET status = 'confirmed', confirmed_at = ? WHERE id = ?").run(Date.now(), requestId);
  res.json(withdrawalAuthorization ? { confirmed: true, withdrawalAuthorization } : { confirmed: true });
});

router.post("/record", async (req: Request, res: Response) => {
  const requestId = String(req.body?.requestId || "");
  const txHash = String(req.body?.txHash || "").toLowerCase();
  const ownerAddress = String(req.body?.ownerAddress || "").toLowerCase();
  if (!requestId || !/^0x[a-f0-9]{64}$/.test(txHash) || !isAddress(ownerAddress)) {
    res.status(400).json({ error: "Valid requestId, ownerAddress, and txHash required." });
    return;
  }
  const verified = await verifyWalletProof(ownerAddress, "withdrawal", req.body?.walletProof);
  if (!verified) {
    recordSecurityEvent({
      eventType: "withdrawal_record_signature_failed",
      actorAddress: ownerAddress,
      route: "/withdrawal/record",
      ip: req.ip,
      reason: "Valid wallet signature required.",
    });
    res.status(401).json({ error: "Valid wallet signature required." });
    return;
  }

  const db = getDb();
  const row = db.prepare(
    "SELECT * FROM withdrawal_confirmations WHERE id = ? AND owner_address = ?"
  ).get(requestId, ownerAddress) as {
    id: string;
    owner_address: string;
    destination_address: string;
    source: string;
    amount_raw: string;
    status: string;
    expires_at: number;
  } | undefined;

  if (!row) {
    res.status(404).json({ error: "Withdrawal confirmation not found." });
    return;
  }
  if (row.status !== "confirmed") {
    res.status(409).json({ error: "Withdrawal was not confirmed." });
    return;
  }
  if (row.expires_at < Date.now()) {
    db.prepare("UPDATE withdrawal_confirmations SET status = 'expired' WHERE id = ?").run(requestId);
    res.status(410).json({ error: "Withdrawal confirmation expired." });
    return;
  }

  const now = Date.now();
  try {
    let referrerAddress: string | null = null;
    let referrerAmount = 0n;
    const feeAmount = (BigInt(row.amount_raw) * BigInt(FEE_BPS)) / 10000n;
    const hasActiveReferral = ((db.prepare("SELECT COUNT(*) as c FROM tips WHERE from_address = ?").get(ownerAddress) as { c: number } | undefined)?.c ?? 0) >= REFERRAL_ACTIVATION_MIN_TIPS;
    if (hasActiveReferral && feeAmount > 0n) {
      const refRow = db.prepare("SELECT referrer_address FROM user_referrals WHERE user_address = ?").get(ownerAddress) as { referrer_address: string } | undefined;
      const refAddr = refRow?.referrer_address?.toLowerCase();
      if (refAddr && refAddr !== ownerAddress) {
        const refCount = (db.prepare("SELECT COUNT(*) as c FROM user_referrals WHERE referrer_address = ?").get(refAddr) as { c: number } | undefined)?.c ?? 0;
        if (refCount <= REFERRAL_CAP_PER_REFERRER) {
          referrerAddress = refAddr;
          referrerAmount = (feeAmount * BigInt(REFERRER_SHARE_BPS)) / 10000n;
        }
      }
    }

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO withdrawal_records (
          owner_address, destination_address, source, amount_raw, tx_hash, confirmation_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(row.owner_address, row.destination_address, row.source, row.amount_raw, txHash, row.id, now);
      db.prepare("UPDATE withdrawal_confirmations SET status = 'used', tx_hash = ?, used_at = ? WHERE id = ?")
        .run(txHash, now, row.id);
      if (referrerAddress && referrerAmount > 0n) {
        db.prepare(
          `INSERT INTO user_activity (type, from_address, to_address, amount, tx_hash, detail, author_handle, tweet_id, timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          "referral_fee_received",
          ownerAddress,
          referrerAddress,
          referrerAmount.toString(),
          txHash,
          "Referral fee from eligible withdrawal",
          null,
          null,
          Math.floor(now / 1000)
        );
      }
    });
    tx();
    createWithdrawalConfirmedNotification({ userAddress: ownerAddress, amountRaw: row.amount_raw, txHash });
    if (referrerAddress && referrerAmount > 0n) {
      createReferralEarnedNotification({ userAddress: referrerAddress, amountRaw: referrerAmount.toString(), txHash, referredAddress: ownerAddress });
    }
    res.json({ recorded: true });
  } catch (err: any) {
    if (String(err.message || "").includes("UNIQUE")) {
      res.json({ recorded: true, duplicate: true });
      return;
    }
    res.status(500).json({ error: "Could not record withdrawal." });
  }
});

export default router;
