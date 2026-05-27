import { Router, Request, Response } from "express";
import { getDb } from "../db/database";
import crypto from "crypto";
import { referralSignerService } from "../services/referralSigner";
import { getRpcUrl } from "../config/chain";
import { isAddress } from "../utils/security";
import { verifyWalletProof } from "../services/walletAuth";
import { inspectReferralForAbuse } from "../services/abuse";
import { createBackendPublicClient } from "../services/rpcClient";

const router = Router();

const REGISTRY_ABI = [
  { name: "getReferrer", type: "function", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "address" }] },
] as const;

const FEE_BPS = parseInt(process.env.WITHDRAWAL_FEE_BPS || "500", 10); // 5%
const REFERRER_SHARE_BPS = parseInt(process.env.REFERRER_SHARE_BPS || "3000", 10); // 30% of fee
const PROTOCOL_TREASURY = (process.env.PROTOCOL_TREASURY_ADDRESS || "").toLowerCase();
const REFERRAL_ACTIVATION_MIN_TIPS = parseInt(process.env.REFERRAL_ACTIVATION_MIN_TIPS || "1", 10);
const REFERRAL_CAP_PER_REFERRER = parseInt(process.env.REFERRAL_CAP_PER_REFERRER || "100", 10);
const ALLOW_UNSIGNED_REFERRAL_WRITES = process.env.ALLOW_UNSIGNED_REFERRAL_WRITES === "true";

async function requireWalletProof(req: Request, res: Response, address: unknown, purpose: string): Promise<boolean> {
  if (!isAddress(address)) {
    res.status(400).json({ error: "Valid wallet address is required" });
    return false;
  }
  if (ALLOW_UNSIGNED_REFERRAL_WRITES) return true;
  const verified = await verifyWalletProof(address, purpose, req.body?.walletProof);
  if (!verified) {
    res.status(401).json({ error: "Valid wallet signature required" });
    return false;
  }
  return true;
}

/**
 * GET /referral/code/:address
 * Get or create a referral code for the given address (owner of claim wallet or any user).
 */
router.get("/code/:address", (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  if (!isAddress(address)) {
    res.status(400).json({ error: "Valid address is required" });
    return;
  }
  const db = getDb();

  let row = db.prepare(
    "SELECT code FROM referral_codes WHERE referrer_address = ?"
  ).get(address) as { code: string } | undefined;

  if (!row) {
    res.status(403).json({ error: "Wallet signature required to create referral code" });
    return;
  }

  res.json({ address, code: row.code });
});

router.post("/code", async (req: Request, res: Response) => {
  const address = (req.body?.address as string | undefined)?.toLowerCase();
  if (!(await requireWalletProof(req, res, address, "referral-code"))) return;
  const db = getDb();

  let row = db.prepare(
    "SELECT code FROM referral_codes WHERE referrer_address = ?"
  ).get(address) as { code: string } | undefined;

  if (!row) {
    const code = crypto.randomBytes(4).toString("hex").toLowerCase();
    db.prepare(
      "INSERT INTO referral_codes (code, referrer_address) VALUES (?, ?)"
    ).run(code, address);
    row = { code };
  }

  res.json({ address, code: row.code });
});

/**
 * POST /referral/link
 * Link the current user (wallet) to a referrer. Body: { userAddress, code }
 * Anti-abuse: no self-referral, referrer must exist, user not already linked.
 * Referral activates after REFERRAL_ACTIVATION_MIN_TIPS tips (checked at withdrawal time).
 */
router.post("/link", async (req: Request, res: Response) => {
  const { userAddress, code } = req.body;

  if (!userAddress || !code || typeof userAddress !== "string" || typeof code !== "string") {
    res.status(400).json({ error: "userAddress and code are required" });
    return;
  }

  const user = userAddress.toLowerCase();
  const codeNorm = code.trim().toLowerCase();

  if (!isAddress(user)) {
    res.status(400).json({ error: "Invalid user address" });
    return;
  }
  if (!(await requireWalletProof(req, res, user, "referral-link"))) return;

  const db = getDb();

  const referrerRow = db.prepare(
    "SELECT referrer_address FROM referral_codes WHERE code = ?"
  ).get(codeNorm) as { referrer_address: string } | undefined;

  if (!referrerRow) {
    res.status(404).json({ error: "Invalid referral code" });
    return;
  }

  const referrer = referrerRow.referrer_address.toLowerCase();
  if (referrer === user) {
    res.status(400).json({ error: "You cannot use your own referral code" });
    return;
  }

  const existing = db.prepare(
    "SELECT 1 FROM user_referrals WHERE user_address = ?"
  ).get(user);

  if (existing) {
    res.json({ success: true, alreadyLinked: true, referrer });
    return;
  }

  db.prepare(
    "INSERT INTO user_referrals (user_address, referrer_address, referral_code) VALUES (?, ?, ?)"
  ).run(user, referrer, codeNorm);
  inspectReferralForAbuse(user, referrer, codeNorm);

  try {
    const { expiresAt, nonce, signature } = await referralSignerService.signSetReferrer(user, referrer);
    res.json({
      success: true,
      referrer,
      setReferrerExpiresAt: expiresAt,
      setReferrerNonce: nonce,
      setReferrerSignature: signature,
    });
  } catch (e) {
    res.json({ success: true, referrer });
  }
});

/**
 * GET /referral/sign-set-referrer
 * Query: userAddress
 * Returns { referrer, setReferrerExpiresAt, setReferrerNonce, setReferrerSignature } so the client can call ReferralRegistry.setReferrer on-chain.
 * Use when the user is already linked in DB but has not yet set referrer on-chain.
 */
router.get("/sign-set-referrer", (_req: Request, res: Response) => {
  res.status(403).json({ error: "Wallet signature required" });
});

router.post("/sign-set-referrer", async (req: Request, res: Response) => {
  const userAddress = (req.body?.userAddress as string | undefined)?.toLowerCase();
  if (!isAddress(userAddress)) {
    res.status(400).json({ error: "Valid userAddress required" });
    return;
  }
  if (!(await requireWalletProof(req, res, userAddress, "referral-set-referrer"))) return;
  const db = getDb();
  const row = db.prepare(
    "SELECT referrer_address FROM user_referrals WHERE user_address = ?"
  ).get(userAddress) as { referrer_address: string } | undefined;
  if (!row) {
    res.status(404).json({ error: "No referrer linked for this address" });
    return;
  }
  const referrer = row.referrer_address.toLowerCase();
  try {
    const { expiresAt, nonce, signature } = await referralSignerService.signSetReferrer(userAddress, referrer);
    res.json({
      referrer,
      setReferrerExpiresAt: expiresAt,
      setReferrerNonce: nonce,
      setReferrerSignature: signature,
    });
  } catch {
    res.status(500).json({ error: "Failed to sign" });
  }
});

/**
 * GET /referral/status/:address
 * Returns whether this address has a referrer (in DB) and their code.
 * When REFERRAL_REGISTRY_ADDRESS and RPC_URL are set, also returns hasReferrerOnChain
 * so the frontend can show "re-apply" when the contract was reset (e.g. new registry deploy).
 */
router.get("/status/:address", async (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const db = getDb();

  const row = db.prepare(
    "SELECT referrer_address, referral_code FROM user_referrals WHERE user_address = ?"
  ).get(address) as { referrer_address: string; referral_code: string } | undefined;

  if (!row) {
    return res.json({ address, hasReferrer: false });
  }

  let hasReferrerOnChain: boolean | undefined;
  const registryAddress = process.env.REFERRAL_REGISTRY_ADDRESS as `0x${string}` | undefined;
  const rpcUrl = getRpcUrl();
  if (registryAddress && rpcUrl) {
    try {
      const client = createBackendPublicClient({ url: rpcUrl });
      const refOnChain = await client.readContract({
        address: registryAddress,
        abi: REGISTRY_ABI,
        functionName: "getReferrer",
        args: [address as `0x${string}`],
      });
      const zero = "0x0000000000000000000000000000000000000000";
      hasReferrerOnChain = (refOnChain as string).toLowerCase() !== zero.toLowerCase();
    } catch {
      hasReferrerOnChain = undefined;
    }
  }

  res.json({
    address,
    hasReferrer: true,
    referrerAddress: row.referrer_address,
    referralCode: row.referral_code,
    hasReferrerOnChain,
  });
});

/**
 * GET /referral/stats/:address
 * Returns referrer stats: number of users referred (who used this address's code).
 */
router.get("/stats/:address", (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const db = getDb();

  const row = db.prepare(
    "SELECT COUNT(*) AS referred_count FROM user_referrals WHERE referrer_address = ?"
  ).get(address) as { referred_count: number };

  res.json({
    address,
    referredCount: row?.referred_count ?? 0,
  });
});

export default router;
export { FEE_BPS, REFERRER_SHARE_BPS, PROTOCOL_TREASURY, REFERRAL_ACTIVATION_MIN_TIPS, REFERRAL_CAP_PER_REFERRER };
