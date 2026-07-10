import { Router, Request, Response } from "express";
import { erc20Abi } from "viem";
import { getDb } from "../db/database";
import {
  getDefaultChainId,
  getDefaultTokenAddress,
} from "../services/teepBalance";
import { formatUsdcRaw } from "../services/xBot/parseTipCommand";
import { verifyWalletProof } from "../services/walletAuth";
import { isAddress } from "../utils/security";
import { createBackendPublicClient } from "../services/rpcClient";
import { getOnchainXTippingReadiness } from "../services/xTippingRouter";

const router = Router();

function dbBool(value: unknown) {
  return value === true || value === 1;
}

function err(res: Response, status: number, message: string) {
  res.status(status).json({ error: message });
}

async function requireWallet(req: Request, res: Response, purpose: string): Promise<string | null> {
  const address = String(req.body?.address || req.query?.address || "").toLowerCase();
  if (!isAddress(address)) {
    err(res, 400, "Valid address is required");
    return null;
  }
  const ok = await verifyWalletProof(address, purpose, req.body?.proof);
  if (!ok) {
    err(res, 401, "Wallet verification failed");
    return null;
  }
  return address;
}

/**
 * GET /x-balance/:address
 * Returns the user's on-chain Teep balance and X tipping status.
 */
router.get("/:address", async (req: Request, res: Response) => {
  const address = String(req.params.address || "").toLowerCase();
  if (!isAddress(address)) {
    err(res, 400, "Invalid address");
    return;
  }

  const tokenAddress = getDefaultTokenAddress();
  const chainId = getDefaultChainId();
  let amountRaw = 0n;
  try {
    const publicClient = createBackendPublicClient();
    amountRaw = await publicClient.readContract({
      address: tokenAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    });
  } catch (error) {
    console.warn("[x-balance] On-chain balance read failed:", error instanceof Error ? error.message : error);
  }
  const db = getDb();
  const permissions = await db
    .prepare(
      `SELECT enabled, max_per_tip_raw, max_daily_raw FROM x_tipping_permissions WHERE user_address = ?`
    )
    .get(address) as { enabled: boolean | number; max_per_tip_raw: string; max_daily_raw: string } | undefined;
  const linkedXAccount = await db
    .prepare(`SELECT x_user_id, x_username, verified_at FROM x_accounts WHERE user_address = ?`)
    .get(address) as { x_user_id: string; x_username: string; verified_at: string } | undefined;
  const verifiedCreator = linkedXAccount
    ? undefined
    : (await db
        .prepare(
          `SELECT author_id, username, verified_at FROM verified_claims
           WHERE owner_address = ? ORDER BY verified_at DESC LIMIT 1`
        )
        .get(address) as { author_id: string; username: string; verified_at: string } | undefined);
  const xAccount = linkedXAccount
    ?? (verifiedCreator
      ? {
          x_user_id: verifiedCreator.author_id,
          x_username: verifiedCreator.username,
          verified_at: verifiedCreator.verified_at,
        }
      : undefined);

  let enabled = permissions ? dbBool(permissions.enabled) : Boolean(xAccount);
  if (enabled) {
    const readiness = await getOnchainXTippingReadiness({ senderAddress: address, totalRaw: 0n });
    enabled = readiness.ok;
  }

  res.json({
    address,
    tokenAddress,
    chainId,
    balanceRaw: amountRaw.toString(),
    balanceUsd: formatUsdcRaw(amountRaw),
    xAccount: xAccount
      ? { xUserId: xAccount.x_user_id, username: xAccount.x_username, verifiedAt: xAccount.verified_at }
      : null,
    permissions: {
      enabled,
      maxPerTipRaw: permissions?.max_per_tip_raw || process.env.X_BOT_MAX_PER_TIP_RAW || "10000000",
      maxDailyRaw: permissions?.max_daily_raw || process.env.X_BOT_MAX_DAILY_RAW || "50000000",
    },
  });
});

/**
 * POST /x-balance/permissions
 * Enable or update X tipping limits for a wallet.
 */
router.post("/permissions", async (req: Request, res: Response) => {
  const address = await requireWallet(req, res, "account-settings");
  if (!address) return;

  const enabled = req.body?.enabled === true;
  const maxPerTipRaw = String(req.body?.maxPerTipRaw || process.env.X_BOT_MAX_PER_TIP_RAW || "10000000");
  const maxDailyRaw = String(req.body?.maxDailyRaw || process.env.X_BOT_MAX_DAILY_RAW || "50000000");
  const tokenAddress = getDefaultTokenAddress();

  if (!/^[0-9]+$/.test(maxPerTipRaw) || !/^[0-9]+$/.test(maxDailyRaw)) {
    err(res, 400, "Invalid limit values");
    return;
  }

  const db = getDb();
  const linked = await db
    .prepare(
      `SELECT x_user_id FROM x_accounts WHERE user_address = ?
       UNION
       SELECT author_id AS x_user_id FROM verified_claims WHERE owner_address = ?
       LIMIT 1`
    )
    .get(address, address) as
    | { x_user_id: string }
    | undefined;
  if (enabled && !linked) {
    err(res, 409, "Link your X account before enabling X tipping");
    return;
  }
  if (enabled) {
    const readiness = await getOnchainXTippingReadiness({ senderAddress: address, totalRaw: 0n });
    if (!readiness.ok) {
      err(res, 409, readiness.reason);
      return;
    }
  }

  await db.prepare(
    `INSERT INTO x_tipping_permissions (user_address, enabled, token_address, max_per_tip_raw, max_daily_raw, updated_at)
     VALUES (?, ?, ?, ?, ?, now())
     ON CONFLICT(user_address) DO UPDATE SET
       enabled = excluded.enabled,
       token_address = excluded.token_address,
       max_per_tip_raw = excluded.max_per_tip_raw,
       max_daily_raw = excluded.max_daily_raw,
       updated_at = now()`
  ).run(address, enabled, tokenAddress, maxPerTipRaw, maxDailyRaw);

  res.json({ ok: true, enabled, maxPerTipRaw, maxDailyRaw });
});

export default router;
