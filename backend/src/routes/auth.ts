import { Router, Request, Response } from "express";
import crypto from "crypto";
import { createPublicClient, http } from "viem";
import { XOAuthService } from "../services/oauth";
import { AttestationService } from "../services/attestation";
import { getDb } from "../db/database";
import { escapeHtml, isAddress, normalizeHandle } from "../utils/security";
import { getConfiguredChain, getRpcUrl } from "../config/chain";
import { createWalletChallenge, isWalletAuthPurpose, verifyWalletProof } from "../services/walletAuth";

const FACTORY_ABI = [
  { name: "isDeployed", type: "function", stateMutability: "view", inputs: [{ name: "_authorId", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "computeClaimWallet", type: "function", stateMutability: "view", inputs: [{ name: "_authorId", type: "uint256" }], outputs: [{ type: "address" }] },
] as const;

function authorIdFromXUserId(userId: string): string {
  if (!/^[0-9]+$/.test(userId)) {
    throw new Error("X user ID must be numeric");
  }
  return userId;
}

const router = Router();
const oauthService = new XOAuthService();
const attestationService = new AttestationService();
const ALLOW_UNSIGNED_ATTESTATION = process.env.ALLOW_UNSIGNED_ATTESTATION === "true";

// Temporary in-memory state for OAuth flows (short-lived, CSRF protection only)
const pendingOAuthFlows = new Map<
  string,
  { ownerAddress: string; codeVerifier: string; expiresAt: number }
>();

function createPkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString("base64url");
  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingOAuthFlows) {
    if (val.expiresAt < now) pendingOAuthFlows.delete(key);
  }
}, 60_000);

/**
 * POST /auth/x/start
 * Initiates X OAuth flow for wallet claiming.
 */
router.post("/x/start", (req: Request, res: Response) => {
  const { ownerAddress } = req.body;

  if (!isAddress(ownerAddress)) {
    res.status(400).json({ error: "Valid ownerAddress is required" });
    return;
  }

  const state = crypto.randomBytes(32).toString("hex");
  const { codeVerifier, codeChallenge } = createPkcePair();

  pendingOAuthFlows.set(state, {
    ownerAddress,
    codeVerifier,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  const authUrl = oauthService.getAuthUrl(state, codeChallenge);
  res.json({ authUrl, state });
});

/**
 * POST /auth/wallet/challenge
 * Issues a short-lived message that proves the caller controls a wallet address.
 */
router.post("/wallet/challenge", (req: Request, res: Response) => {
  const { address, purpose } = req.body;

  if (!isAddress(address) || !isWalletAuthPurpose(purpose)) {
    res.status(400).json({ error: "Valid address and purpose are required" });
    return;
  }

  res.json(createWalletChallenge(address, purpose));
});

/**
 * GET /auth/x/callback
 * X OAuth callback. Verifies the user, stores claim in DB, returns success page.
 */
router.get("/x/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query;

  if (!code || !state || typeof code !== "string" || typeof state !== "string") {
    res.status(400).json({ error: "Missing code or state" });
    return;
  }

  const flow = pendingOAuthFlows.get(state);
  if (!flow) {
    res.status(400).json({ error: "Invalid or expired state" });
    return;
  }

  if (flow.expiresAt < Date.now()) {
    pendingOAuthFlows.delete(state);
    res.status(400).json({ error: "OAuth flow expired" });
    return;
  }

  try {
    // 1. Verify with X and get profile
    const profile = await oauthService.verifyAndGetProfile(code, flow.codeVerifier);
    pendingOAuthFlows.delete(state);

    // 2. Use X's stable numeric user ID for on-chain author identity.
    const authorId = authorIdFromXUserId(profile.id);
    const authorIdHash = authorId; // Backward-compatible local name for older logging paths.

    // 3. Create attestation (for on-chain claim wallet deployment)
    const attestation = await attestationService.createAttestation(
      authorId,
      flow.ownerAddress
    );

    // 4. Store verified claim in database (source of truth)
    // author_id must match tips.author_id from the indexer (stable X numeric user ID)
    const authorIdForDb = authorId;
    const db = getDb();

    // One claim per X account (first claim wins) — prevent sybil: same X linked to multiple wallets
    const existing = db.prepare(
      "SELECT owner_address FROM verified_claims WHERE author_id = ?"
    ).get(authorIdForDb) as { owner_address: string } | undefined;
    if (existing) {
      const sameWallet = existing.owner_address === flow.ownerAddress.toLowerCase();
      if (!sameWallet) {
        res.status(409).send(`
          <html><body style="font-family:system-ui;padding:2rem;text-align:center;">
            <h2>This X account is already linked</h2>
            <p>@${escapeHtml(profile.username)} is already linked to another wallet. Only one wallet can claim an X account.</p>
            <p>If this is your account, use the wallet that claimed it first, or contact support.</p>
          </body></html>
        `);
        return;
      }
      // Same wallet re-verifying: fall through to replace (refresh display_name etc.)
    }

    db.prepare(`
      INSERT OR REPLACE INTO verified_claims (author_id, username, display_name, owner_address, profile_image_url)
      VALUES (?, ?, ?, ?, ?)
    `).run(authorIdForDb, profile.username, profile.name, flow.ownerAddress.toLowerCase(), profile.profile_image_url ?? null);

    console.log(`[Auth] Claim verified: @${profile.username} (${profile.id}) → ${flow.ownerAddress} [authorIdHash: ${authorIdHash}]`);

    // 5. Store attestation keyed by owner address for extension to retrieve
    db.prepare(`
      CREATE TABLE IF NOT EXISTS pending_attestations (
        owner_address TEXT PRIMARY KEY,
        attestation_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run();
    db.prepare(`
      INSERT OR REPLACE INTO pending_attestations (owner_address, attestation_json)
      VALUES (?, ?)
    `).run(flow.ownerAddress.toLowerCase(), JSON.stringify(attestation));

    // 6. Return styled success page
    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html><head><title>Teep - Verified</title>
<style>
  body { background: #0a0a0a; color: #e5e5e5; font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { text-align: center; padding: 40px; background: #111; border-radius: 16px; border: 1px solid #1a1a2e; max-width: 400px; }
  h1 { font-size: 24px; color: #00ba7c; margin-bottom: 8px; }
  p { color: #71767b; font-size: 14px; line-height: 1.5; }
  .handle { color: #1d9bf0; font-weight: 700; }
  .hint { margin-top: 20px; font-size: 12px; color: #536471; }
</style></head><body>
<div class="card">
  <h1>Verified!</h1>
  <p>Welcome, <span class="handle">@${escapeHtml(profile.username)}</span></p>
  <p>Your X account has been verified. Return to the Teep extension to complete the claim.</p>
  <p class="hint">This tab will close automatically.</p>
</div>
</body></html>`);
  } catch (err: any) {
    console.error("[Auth] OAuth callback error:", err.message);
    res.setHeader("Content-Type", "text/html");
    res.status(500).send(`<!DOCTYPE html>
<html><head><title>Teep - Error</title>
<style>
  body { background: #0a0a0a; color: #e5e5e5; font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { text-align: center; padding: 40px; background: #111; border-radius: 16px; border: 1px solid #67000d; max-width: 400px; }
  h1 { font-size: 24px; color: #f4212e; }
  p { color: #71767b; font-size: 14px; }
</style></head><body>
<div class="card">
  <h1>Verification Failed</h1>
  <p>Something went wrong. Please try again from the Teep extension.</p>
</div>
</body></html>`);
  }
});

/**
 * GET /auth/claim-wallet-status/:address
 * Returns whether the claim wallet is deployed for this owner (from indexer) and its address.
 * Use this as source of truth so the extension doesn't ask to deploy when already deployed.
 */
const DEBUG = process.env.DEBUG_TEEP === "true" || process.env.DEBUG_TIPCOIN === "true" || process.env.DEBUG === "true";

router.get("/claim-wallet-status/:address", async (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const db = getDb();
  if (DEBUG) console.log("[Teep:Backend] claim-wallet-status request", { address: address.slice(0, 10) + "…" });

  const claim = db.prepare(
    "SELECT author_id, username FROM verified_claims WHERE owner_address = ? LIMIT 1"
  ).get(address) as { author_id: string; username: string } | undefined;

  if (!claim) {
    res.json({ deployed: false, claimWalletAddress: null, totalEarnedRaw: "0" });
    return;
  }

  const authorIdForChain = claim.author_id;

  // Total earned (cumulative tips received for this creator); does not decrease on withdrawal. Use authorIdForChain to match indexer.
  const totalEarnedRow = db.prepare(
    "SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total FROM tips WHERE author_id = ?"
  ).get(authorIdForChain) as { total: number } | undefined;
  const totalEarnedRaw = String(Math.round(totalEarnedRow?.total ?? 0));

  // Always use current factory's computeClaimWallet for where tips go (CREATE2 address receives even if not deployed).
  // Return legacy address(es) from DB when different so extension can sum balances (old + new after redeploy).
  const factoryAddress = process.env.FACTORY_ADDRESS as `0x${string}` | undefined;
  const rpcUrl = getRpcUrl();
  const row = db.prepare(
    "SELECT wallet_address FROM claim_wallets WHERE author_id = ?"
  ).get(authorIdForChain) as { wallet_address: string } | undefined;

  if (factoryAddress && rpcUrl) {
    try {
      const chain = getConfiguredChain();
      const client = createPublicClient({
        chain,
        transport: http(rpcUrl),
      });
      const authorIdBigInt = BigInt(authorIdForChain);
      const deployed = await client.readContract({
        address: factoryAddress,
        abi: FACTORY_ABI,
        functionName: "isDeployed",
        args: [authorIdBigInt],
      });
      const walletAddress = await client.readContract({
        address: factoryAddress,
        abi: FACTORY_ABI,
        functionName: "computeClaimWallet",
        args: [authorIdBigInt],
      });
      const claimWalletAddress = (walletAddress as string).toLowerCase();
      if (DEBUG) console.log("[Teep:Backend] claim-wallet-status: isDeployed =", deployed, "claimWalletAddress =", claimWalletAddress.slice(0, 10) + "…");

      // When DB has a different address (old factory), record it as legacy so we always return it for balance summing
      if (row && row.wallet_address) {
        const dbAddr = row.wallet_address.toLowerCase();
        if (dbAddr !== claimWalletAddress) {
          try {
            db.prepare(
              "INSERT OR IGNORE INTO claim_wallet_legacy (author_id, wallet_address) VALUES (?, ?)"
            ).run(authorIdForChain, dbAddr);
          } catch (e) {
            if (DEBUG) console.warn("[Teep:Backend] claim-wallet-status: failed to record legacy", e);
          }
        }
      }

      // Sync DB so claim_wallets matches current contract for future lookups
      if (!row || row.wallet_address?.toLowerCase() !== claimWalletAddress) {
        try {
          db.prepare(
            "INSERT INTO claim_wallets (author_id, wallet_address, owner_address, deployed_at_block, tx_hash) VALUES (?, ?, ?, 0, '') ON CONFLICT(author_id) DO UPDATE SET wallet_address = excluded.wallet_address, owner_address = excluded.owner_address"
          ).run(authorIdForChain, claimWalletAddress, address);
          if (DEBUG) console.log("[Teep:Backend] claim-wallet-status: synced claim_wallets with chain address");
        } catch (e) {
          if (DEBUG) console.warn("[Teep:Backend] claim-wallet-status: failed to sync claim_wallets", e);
        }
      }

      // All legacy addresses for this author (old factory claim wallets) so extension can sum USDC for Total Earned
      const legacyRows = db.prepare(
        "SELECT wallet_address FROM claim_wallet_legacy WHERE author_id = ?"
      ).all(authorIdForChain) as Array<{ wallet_address: string }>;
      const legacyClaimWalletAddresses = legacyRows.map((r) => r.wallet_address.toLowerCase());

      res.json({
        deployed: !!deployed,
        claimWalletAddress,
        legacyClaimWalletAddresses: legacyClaimWalletAddresses.length ? legacyClaimWalletAddresses : undefined,
        totalEarnedRaw,
      });
      return;
    } catch (e) {
      if (DEBUG) console.warn("[Teep:Backend] claim-wallet-status chain check failed:", e);
    }
  }

  // Fallback when chain not configured: use indexer DB
  if (row) {
    if (DEBUG) console.log("[Teep:Backend] claim-wallet-status: from DB", { claimWalletAddress: row.wallet_address?.slice(0, 10) + "…" });
    res.json({ deployed: true, claimWalletAddress: row.wallet_address, legacyClaimWalletAddresses: undefined, totalEarnedRaw });
    return;
  }

  if (DEBUG) console.log("[Teep:Backend] claim-wallet-status: no claim wallet");
  res.json({ deployed: false, claimWalletAddress: null, legacyClaimWalletAddresses: undefined, totalEarnedRaw });
});

/**
 * GET /auth/claim-status/:address
 * Check if a wallet address has any verified X claims.
 * This is the source of truth — backed by the database.
 */
router.get("/claim-status/:address", (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const db = getDb();

  const claims = db.prepare(
    "SELECT author_id, username, display_name, profile_image_url, verified_at FROM verified_claims WHERE owner_address = ? ORDER BY verified_at DESC"
  ).all(address) as Array<{
    author_id: string;
    username: string;
    display_name: string;
    profile_image_url: string | null;
    verified_at: string;
  }>;

  res.json({
    address,
    verified: claims.length > 0,
    claims,
  });
});

/**
 * GET /auth/attestation/:address
 * Create a FRESH attestation for on-chain wallet deployment.
 * Checks that the address has a verified claim, then issues a new attestation
 * with a current timestamp so it won't expire before the deploy tx lands.
 */
router.get("/attestation/:address", async (req: Request, res: Response) => {
  if (!ALLOW_UNSIGNED_ATTESTATION) {
    res.status(403).json({ error: "Wallet signature required" });
    return;
  }
  return issueAttestation(req.params.address as string, res);
});

router.post("/attestation/:address", async (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const verified = await verifyWalletProof(address, "claim-attestation", req.body?.walletProof);
  if (!verified) {
    res.status(401).json({ error: "Valid wallet signature required" });
    return;
  }
  return issueAttestation(address, res);
});

async function issueAttestation(addressParam: string, res: Response) {
  const address = addressParam.toLowerCase();
  const db = getDb();

  // Verify the address has a verified claim
  const claim = db.prepare(
      "SELECT author_id FROM verified_claims WHERE owner_address = ?"
  ).get(address) as { author_id: string } | undefined;

  if (!claim) {
    res.status(404).json({ error: "No verified claim for this address. Please verify with X first." });
    return;
  }

  try {
    const attestation = await attestationService.createAttestation(
      claim.author_id,
      address
    );

    res.json({
      success: true,
      attestation,
    });
  } catch (err: any) {
    console.error("[Auth] Error creating fresh attestation:", err);
    res.status(500).json({ error: "Failed to create attestation" });
  }
}

/**
 * GET /auth/x/user/:username
 * Resolve an X handle to X's stable numeric user ID before constructing tip transactions.
 */
router.get("/x/user/:username", async (req: Request, res: Response) => {
  const username = normalizeHandle(req.params.username);
  if (!username) {
    res.status(400).json({ error: "Valid X username is required" });
    return;
  }

  try {
    const profile = await oauthService.getUserByUsername(username);
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      id: profile.id,
      username: profile.username,
      name: profile.name,
      profileImageUrl: profile.profile_image_url ?? null,
    });
  } catch (err: any) {
    console.error("[Auth] X username resolve failed:", err.message);
    const db = getDb();
    const row = db.prepare(
      "SELECT author_id, username, display_name, profile_image_url FROM verified_claims WHERE lower(username) = ? ORDER BY verified_at DESC LIMIT 1"
    ).get(username) as {
      author_id: string;
      username: string;
      display_name: string;
      profile_image_url: string | null;
    } | undefined;

    if (row?.author_id && /^[0-9]+$/.test(row.author_id)) {
      res.set("Cache-Control", "private, max-age=300");
      res.json({
        id: row.author_id,
        username: row.username,
        name: row.display_name,
        profileImageUrl: row.profile_image_url,
        source: "verified_claims",
      });
      return;
    }

    res.status(502).json({ error: "Could not verify this X creator" });
  }
});

/**
 * GET /auth/signer
 * Returns the attestation signer address (for client to verify)
 */
router.get("/signer", (_req: Request, res: Response) => {
  const address = attestationService.signerAddress;
  if (!address) {
    res.status(503).json({ error: "Attestation service not configured" });
    return;
  }
  res.json({ signerAddress: address });
});

export default router;
