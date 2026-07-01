import { Router, Request, Response } from "express";
import https from "https";
import { getDb } from "../db/database";
import { formatUnits, keccak256, toBytes } from "viem";
import { ARC_TESTNET_USDC, getRpcUrl } from "../config/chain";
import { getUnifiedTipperStats } from "../services/tipperStats";
import { createBackendPublicClient } from "../services/rpcClient";
import { isAddress } from "../utils/security";
import { getUserSettings, publicIdentity, settingsRowToResponse } from "../services/userSettings";
import { createLowBalanceNotification, createThankYouMessageNotification } from "../services/notifications";
import { syncInboundUsdcFunding } from "../services/fundingSync";
import { verifyWalletProof } from "../services/walletAuth";
import { getCreatorPerformance } from "../services/creatorPerformance";
import { resolveAddressIdentities } from "../services/identity";
import { XOAuthService } from "../services/oauth";

const router = Router();

const RPC_URL = getRpcUrl();
const USDC_ADDRESS = (process.env.MOCK_USDC_ADDRESS || process.env.USDC_ADDRESS || ARC_TESTNET_USDC) as `0x${string}`;
const ALLOW_INSECURE_OEMBED_TLS = process.env.ALLOW_INSECURE_OEMBED_TLS === "true" && process.env.NODE_ENV !== "production";
const ALLOW_INSECURE_AVATAR_TLS = process.env.ALLOW_INSECURE_AVATAR_TLS === "true" && process.env.NODE_ENV !== "production";
let warnedInsecureOembedTls = false;
let warnedInsecureAvatarTls = false;
const xOAuthService = new XOAuthService();

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

function contentIdFromPost(handle: string, tweetId: string): string {
  const canonical = `x.com/${handle.toLowerCase()}/status/${tweetId}`;
  return keccak256(toBytes(canonical));
}

/** On-chain authorId is X's stable numeric user ID. Legacy DBs may still contain hash-derived IDs. */
async function resolveAuthorId(db: ReturnType<typeof getDb>, ownerAddress: string): Promise<string | null> {
  const claim = await db
    .prepare("SELECT author_id, username FROM verified_claims WHERE owner_address = ? ORDER BY verified_at DESC LIMIT 1")
    .get(ownerAddress) as { author_id: string; username: string } | undefined;
  if (!claim) return null;
  return claim.author_id;
}

function creatorTipPredicate(alias = "t"): string {
  return `(${alias}.author_id = ? OR LOWER(COALESCE(m.author_handle, '')) = LOWER(?))`;
}

/** Standard error response */
function err(res: Response, status: number, message: string, code?: string) {
  res.status(status).json({ error: message, ...(code && { code }) });
}

function normalizeTeepUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(normalized)) return null;
  if (/^_+$/.test(normalized)) return null;
  return normalized;
}

function normalizeSocialXHandle(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^@/, "").toLowerCase();
  if (!normalized) return null;
  if (!/^[a-z0-9_]{1,15}$/.test(normalized)) return null;
  if (/^_+$/.test(normalized)) return null;
  return normalized;
}

function fallbackAvatarSvg(seed: string): string {
  const clean = seed.replace(/[^a-z0-9_]/gi, "").slice(0, 2).toUpperCase() || "T";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160" role="img" aria-label="Teep avatar"><rect width="160" height="160" rx="80" fill="#21143a"/><circle cx="80" cy="80" r="74" fill="none" stroke="#6d28d9" stroke-width="8"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#f6f0ff" font-family="Inter, Arial, sans-serif" font-size="52" font-weight="800">${clean}</text></svg>`;
}

async function fetchAvatarBuffer(handle: string) {
  const db = getDb();
  const cached = await db
    .prepare("SELECT profile_image_url FROM verified_claims WHERE LOWER(username) = LOWER(?) AND profile_image_url IS NOT NULL ORDER BY verified_at DESC LIMIT 1")
    .get(handle) as { profile_image_url?: string | null } | undefined;
  const urls = [
    cached?.profile_image_url || "",
    `https://unavatar.io/twitter/${encodeURIComponent(handle)}`,
  ].filter(Boolean);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    if (!cached?.profile_image_url) {
      try {
        const profile = await xOAuthService.getUserByUsername(handle);
        if (profile.profile_image_url) {
          try {
            await db.prepare(
              `UPDATE verified_claims
               SET author_id = ?, username = ?, display_name = ?, profile_image_url = ?
               WHERE LOWER(username) = LOWER(?)`
            ).run(profile.id, profile.username, profile.name, profile.profile_image_url, handle);
          } catch {
            /* best-effort avatar cache refresh */
          }
          const avatar = await fetchAvatarUrl(profile.profile_image_url, controller.signal, false);
          if (avatar) return avatar;
        }
      } catch {
        /* fall through to public avatar fallback */
      }
    }
    for (const url of urls) {
      const avatar = await fetchAvatarUrl(url, controller.signal, true);
      if (avatar) return avatar;
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAvatarUrl(url: string, signal: AbortSignal, allowUnavatar = false) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  const allowedHosts = allowUnavatar
    ? ["pbs.twimg.com", "abs.twimg.com", "unavatar.io"]
    : ["pbs.twimg.com", "abs.twimg.com"];
  if (!allowedHosts.includes(parsed.hostname.toLowerCase())) return null;

  try {
    const response = await fetch(parsed.toString(), {
      redirect: "follow",
      signal,
      headers: { "User-Agent": "TeepAvatarProxy/1.0" },
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.startsWith("image/")) return null;
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > 1_500_000) return null;
    return { body, contentType };
  } catch (error: any) {
    const code = error?.cause?.code || error?.code;
    if (!ALLOW_INSECURE_AVATAR_TLS || code !== "UNABLE_TO_VERIFY_LEAF_SIGNATURE") throw error;
    return fetchAvatarUrlInsecureDevOnly(parsed.toString(), allowUnavatar);
  }
}

function fetchAvatarUrlInsecureDevOnly(url: string, allowUnavatar: boolean, redirectCount = 0): Promise<{ body: Buffer; contentType: string } | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return Promise.resolve(null);
  }
  const allowedHosts = allowUnavatar
    ? ["pbs.twimg.com", "abs.twimg.com", "unavatar.io"]
    : ["pbs.twimg.com", "abs.twimg.com"];
  if (parsed.protocol !== "https:" || !allowedHosts.includes(parsed.hostname.toLowerCase())) return Promise.resolve(null);

  if (!warnedInsecureAvatarTls) {
    warnedInsecureAvatarTls = true;
    console.warn("[API v1] ALLOW_INSECURE_AVATAR_TLS=true is enabled. Avatar TLS verification is disabled for local development only.");
  }

  return new Promise((resolve, reject) => {
    const request = https.get(
      parsed.toString(),
      {
        headers: { "User-Agent": "TeepAvatarProxy/1.0" },
        agent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 5000,
      },
      (response) => {
        const status = response.statusCode || 500;
        const location = response.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location && redirectCount < 3) {
          const nextUrl = new URL(location, parsed).toString();
          response.resume();
          fetchAvatarUrlInsecureDevOnly(nextUrl, allowUnavatar, redirectCount + 1).then(resolve).catch(reject);
          return;
        }
        const contentType = String(response.headers["content-type"] || "");
        if (status < 200 || status >= 300 || !contentType.startsWith("image/")) {
          response.resume();
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1_500_000) {
            request.destroy(new Error("Avatar image is too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ body: Buffer.concat(chunks), contentType }));
      }
    );
    request.on("timeout", () => request.destroy(new Error("Avatar request timed out")));
    request.on("error", reject);
  });
}

function normalizeTipAmount(value: unknown): string | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim().replace(/^\$/, "") : "";
  if (!raw) return null;
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) return null;
  return amount.toFixed(2);
}

function emptyDiscoverPayload(reason = "discover_unavailable") {
  return {
    algorithm: {
      version: "discover-beta-v1",
      signals: [
        "recent tips + unique supporters",
        "unclaimed support + recent activity",
        "high re-tip activity",
        "similar to creators you tipped",
      ],
    },
    trendingPosts: [],
    recommendedCreators: [],
    topCreators: [],
    topCreatorsAllTime: [],
    unclaimedCreators: [],
    tippedBefore: [],
    orbit: {
      connections: 0,
      directTips: 0,
      unclaimed: 0,
      trending: 0,
    },
    degraded: true,
    reason,
  };
}

function boolInt(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  if (value === 0 || value === 1) return value === 1;
  return fallback;
}

function normalizeOptionalAddress(value: unknown): string | null | undefined {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return isAddress(normalized) ? normalized : undefined;
}

function normalizeChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function normalizeOptionalToken(value: unknown, maxLength = 80): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  if (!/^[a-zA-Z0-9:_-]+$/.test(normalized)) return null;
  return normalized;
}

function normalizeShortText(value: unknown, fallback: string, maxLength = 280): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function safeJson(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function rawToUsd(raw: number | string | null | undefined): string {
  const value = Number(raw || 0);
  if (!Number.isFinite(value)) return "0.00";
  return (value / 1e6).toFixed(2);
}

function timeAgoFromUnix(timestamp: number | null | undefined): string {
  if (!timestamp) return "No tips yet";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

async function getAccountBalances(address: string) {
  const balances: Array<{ key: string; label: string; raw: string; decimals: number; display: string }> = [];
  const client = createBackendPublicClient({ url: RPC_URL });

  const nativeRaw = await client.getBalance({ address: address as `0x${string}` });
  balances.push({
    key: "arc_native_usdc",
    label: "Arc USDC balance",
    raw: nativeRaw.toString(),
    decimals: 18,
    display: formatUnits(nativeRaw, 18),
  });

  if (USDC_ADDRESS && USDC_ADDRESS.toLowerCase() !== "0x0000000000000000000000000000000000000000") {
    const erc20Raw = await client.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    });
    balances.push({
      key: "arc_token_usdc",
      label: "Arc token USDC balance",
      raw: erc20Raw.toString(),
      decimals: 6,
      display: formatUnits(erc20Raw, 6),
    });
  }

  return balances;
}

async function getDeleteReadiness(address: string) {
  const balances = await getAccountBalances(address);
  const blockingBalances = balances.filter((balance) => BigInt(balance.raw) > 0n);
  return {
    address,
    canDelete: blockingBalances.length === 0,
    balances,
    blockingBalances,
  };
}

async function deletePrivyUser(userId: string) {
  const appId = process.env.PRIVY_APP_ID || process.env.VITE_PRIVY_APP_ID || "";
  const appSecret = process.env.PRIVY_APP_SECRET || "";
  if (!appId || !appSecret) {
    return {
      ok: false,
      status: 501,
      message: "Privy account deletion is not configured. Set PRIVY_APP_ID and PRIVY_APP_SECRET on the backend.",
    };
  }
  if (!/^did:privy:[a-zA-Z0-9_-]+$/.test(userId)) {
    return { ok: false, status: 400, message: "Invalid Privy user id" };
  }

  const auth = Buffer.from(`${appId}:${appSecret}`).toString("base64");
  const response = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Basic ${auth}`,
      "privy-app-id": appId,
    },
  });
  if (response.ok) return { ok: true, status: response.status, message: "" };
  const payload = await response.json().catch(() => null);
  return {
    ok: false,
    status: response.status,
    message: payload?.message || payload?.error || "Privy account deletion failed",
  };
}

router.get("/wallet/:address/settings", async (req: Request, res: Response) => {
  const address = String(req.params.address || "").toLowerCase();
  if (!isAddress(address)) {
    err(res, 400, "Invalid account address");
    return;
  }

  res.set("Cache-Control", "private, no-store");
  const preferredUsername = typeof req.query.preferredUsername === "string" ? req.query.preferredUsername : null;
  res.json(await getUserSettings(address, preferredUsername));
});

router.post("/wallet/:address/settings", async (req: Request, res: Response) => {
  const address = String(req.params.address || "").toLowerCase();
  if (!isAddress(address)) {
    err(res, 400, "Invalid account address");
    return;
  }

  const username = normalizeTeepUsername(req.body?.username);
  if (!username) {
    err(res, 400, "Username must be 3-24 characters using letters, numbers, or underscores");
    return;
  }
  const defaultTipAmount = normalizeTipAmount(req.body?.defaultTipAmount);
  if (!defaultTipAmount) {
    err(res, 400, "Default tip amount must be greater than zero");
    return;
  }
  const socialXHandle = normalizeSocialXHandle(req.body?.socialXHandle ?? req.body?.social?.xHandle);
  if ((req.body?.socialXHandle || req.body?.social?.xHandle) && !socialXHandle) {
    err(res, 400, "X handle must be 1-15 characters using letters, numbers, or underscores");
    return;
  }
  const payoutDefaultDestination = normalizeOptionalAddress(req.body?.payout?.defaultDestination);
  if (payoutDefaultDestination === undefined) {
    err(res, 400, "Default withdrawal destination must be a valid wallet address");
    return;
  }
  const payoutConfirmationPreference = normalizeChoice(req.body?.payout?.confirmationPreference, ["email", "wallet", "both"] as const, "email");
  const growDefaultStrategyId = normalizeOptionalToken(req.body?.growTips?.defaultStrategyId);
  if (req.body?.growTips?.defaultStrategyId && !growDefaultStrategyId) {
    err(res, 400, "Default Grow Tips strategy is invalid");
    return;
  }
  const growRiskVisibilityLevel = normalizeChoice(req.body?.growTips?.riskVisibilityLevel, ["minimal", "standard", "detailed"] as const, "standard");
  const defaultThankYouMessage = normalizeShortText(
    req.body?.engagement?.defaultThankYouMessage,
    "Thank you for supporting my work on Teep."
  );

  const db = getDb();
  const existing = await db
    .prepare("SELECT address FROM user_settings WHERE username = ? AND address <> ? LIMIT 1")
    .get(username, address) as { address: string } | undefined;
  if (existing) {
    err(res, 409, "Username is already taken", "USERNAME_TAKEN");
    return;
  }

  await db.prepare(
    `INSERT INTO user_settings (
      address, username, social_x_handle, default_tip_amount,
      receipt_share_links_enabled, receipt_share_amount_enabled, receipt_post_aware_copy_enabled,
      notify_creator_claimed, notify_low_balance, notify_receipt_ready,
      notify_new_tip, notify_repeat_supporter, notify_claim_wallet_activity, notify_withdrawal_completed, notify_grow_tips_status,
      privacy_hide_address, privacy_private_activity, privacy_require_verification,
      privacy_hide_supporter_names_publicly, privacy_hide_growth_activity,
      payout_default_destination, payout_confirmation_preference, payout_notifications,
      grow_default_strategy_id, grow_risk_visibility_level, grow_maturity_exit_reminders,
      engagement_default_thank_you_message, engagement_auto_suggest_x_thank_you, engagement_repeat_supporter_reminders,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
    ON CONFLICT(address) DO UPDATE SET
      username = excluded.username,
      social_x_handle = excluded.social_x_handle,
      default_tip_amount = excluded.default_tip_amount,
      receipt_share_links_enabled = excluded.receipt_share_links_enabled,
      receipt_share_amount_enabled = excluded.receipt_share_amount_enabled,
      receipt_post_aware_copy_enabled = excluded.receipt_post_aware_copy_enabled,
      notify_creator_claimed = excluded.notify_creator_claimed,
      notify_low_balance = excluded.notify_low_balance,
      notify_receipt_ready = excluded.notify_receipt_ready,
      notify_new_tip = excluded.notify_new_tip,
      notify_repeat_supporter = excluded.notify_repeat_supporter,
      notify_claim_wallet_activity = excluded.notify_claim_wallet_activity,
      notify_withdrawal_completed = excluded.notify_withdrawal_completed,
      notify_grow_tips_status = excluded.notify_grow_tips_status,
      privacy_hide_address = excluded.privacy_hide_address,
      privacy_private_activity = excluded.privacy_private_activity,
      privacy_require_verification = excluded.privacy_require_verification,
      privacy_hide_supporter_names_publicly = excluded.privacy_hide_supporter_names_publicly,
      privacy_hide_growth_activity = excluded.privacy_hide_growth_activity,
      payout_default_destination = excluded.payout_default_destination,
      payout_confirmation_preference = excluded.payout_confirmation_preference,
      payout_notifications = excluded.payout_notifications,
      grow_default_strategy_id = excluded.grow_default_strategy_id,
      grow_risk_visibility_level = excluded.grow_risk_visibility_level,
      grow_maturity_exit_reminders = excluded.grow_maturity_exit_reminders,
      engagement_default_thank_you_message = excluded.engagement_default_thank_you_message,
      engagement_auto_suggest_x_thank_you = excluded.engagement_auto_suggest_x_thank_you,
      engagement_repeat_supporter_reminders = excluded.engagement_repeat_supporter_reminders,
      updated_at = now()`
  ).run(
    address,
    username,
    socialXHandle,
    defaultTipAmount,
    1,
    boolInt(req.body?.receipts?.shareAmountEnabled, true),
    1,
    boolInt(req.body?.notifications?.creatorClaimed, true),
    boolInt(req.body?.notifications?.lowBalance, true),
    boolInt(req.body?.notifications?.receiptReady, false),
    boolInt(req.body?.notifications?.newTip, true),
    boolInt(req.body?.notifications?.repeatSupporter, true),
    boolInt(req.body?.notifications?.claimWalletActivity, true),
    boolInt(req.body?.notifications?.withdrawalCompleted, true),
    boolInt(req.body?.notifications?.growTipsStatus, true),
    boolInt(req.body?.privacy?.hideAddress, true),
    boolInt(req.body?.privacy?.privateActivity, true),
    boolInt(req.body?.privacy?.requireVerification, true),
    boolInt(req.body?.privacy?.hideSupporterNamesPublicly, false),
    boolInt(req.body?.privacy?.hideGrowthActivity, false),
    payoutDefaultDestination,
    payoutConfirmationPreference,
    boolInt(req.body?.payout?.notifications, true),
    growDefaultStrategyId,
    growRiskVisibilityLevel,
    boolInt(req.body?.growTips?.maturityExitReminders, true),
    defaultThankYouMessage,
    boolInt(req.body?.engagement?.autoSuggestXThankYou, true),
    boolInt(req.body?.engagement?.repeatSupporterReminders, true)
  );

  const saved = await db
    .prepare("SELECT *, updated_at as updatedAt FROM user_settings WHERE address = ? LIMIT 1")
    .get(address);

  res.set("Cache-Control", "private, no-store");
  res.json(settingsRowToResponse(address, saved));
});

router.post("/wallet/:address/social-profile", async (req: Request, res: Response) => {
  const address = String(req.params.address || "").toLowerCase();
  if (!isAddress(address)) {
    err(res, 400, "Invalid account address");
    return;
  }

  const verified = await verifyWalletProof(address, "account-settings", req.body?.walletProof);
  if (!verified) {
    err(res, 401, "Account verification failed");
    return;
  }

  const socialXHandle = normalizeSocialXHandle(req.body?.socialXHandle ?? req.body?.social?.xHandle);
  if ((req.body?.socialXHandle || req.body?.social?.xHandle) && !socialXHandle) {
    err(res, 400, "X handle must be 1-15 characters using letters, numbers, or underscores");
    return;
  }

  const db = getDb();
  await db.prepare(
    `INSERT INTO user_settings (address, social_x_handle, updated_at)
     VALUES (?, ?, now())
     ON CONFLICT(address) DO UPDATE SET
       social_x_handle = excluded.social_x_handle,
       updated_at = now()`
  ).run(address, socialXHandle);

  const saved = await db
    .prepare("SELECT *, updated_at as updatedAt FROM user_settings WHERE address = ? LIMIT 1")
    .get(address);

  res.set("Cache-Control", "private, no-store");
  res.json(settingsRowToResponse(address, saved));
});

router.get("/wallet/:address/tipper-settings-public", async (req: Request, res: Response) => {
  const address = String(req.params.address || "").toLowerCase();
  if (!isAddress(address)) {
    err(res, 400, "Invalid account address");
    return;
  }
  const settings = await getUserSettings(address);
  const identity = await publicIdentity(address);
  res.set("Cache-Control", "private, max-age=60");
  res.json({
    address,
    publicIdentity: {
      label: identity.label,
      socialXHandle: identity.socialXHandle,
      address: identity.address,
    },
    defaultTipAmount: settings.defaultTipAmount,
    receipts: settings.receipts,
    privacy: settings.privacy,
  });
});

router.get("/wallet/:address/funding-history", async (req: Request, res: Response) => {
  const address = String(req.params.address || "").toLowerCase();
  if (!isAddress(address)) {
    err(res, 400, "Invalid account address");
    return;
  }
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const limit = Math.min(7, Math.max(1, Number(req.query.limit || 7) || 7));
  const day = typeof req.query.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day) ? req.query.day : "";
  const db = getDb();
  const where = ["user_address = ?"];
  const params: any[] = [address];
  if (day) {
    const start = new Date(`${day}T00:00:00.000Z`).getTime();
    const end = start + 24 * 60 * 60 * 1000;
    where.push("created_at >= ? AND created_at < ?");
    params.push(start, end);
  }
  let syncState: { status: "synced" | "delayed"; message: string } = {
    status: "synced",
    message: "Latest funding activity checked.",
  };
  try {
    await syncInboundUsdcFunding(address);
  } catch (error) {
    console.warn("[Funding Sync] Could not sync inbound funding transfers:", error instanceof Error ? error.message : error);
    syncState = {
      status: "delayed",
      message: "Checking latest funding activity. Recent transfers may appear shortly.",
    };
  }
  const whereSql = where.join(" AND ");
  const total = await db.prepare(`SELECT COUNT(*) as count FROM funding_provider_sessions WHERE ${whereSql}`).get(...params) as { count: number | string };
  const rows = (await db
    .prepare(`SELECT id, provider, kind, status, provider_session_id as providerSessionId, metadata_json as metadataJson, created_at as createdAt, updated_at as updatedAt FROM funding_provider_sessions WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, (page - 1) * limit))
    .map((row: any) => ({
      ...row,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null,
      metadataJson: undefined,
    }));
  res.set("Cache-Control", "private, no-store");
  res.json({ page, limit, total: Number(total.count), records: rows, sync: syncState });
});

router.get("/wallet/:address/withdrawal-history", async (req: Request, res: Response) => {
  const address = String(req.params.address || "").toLowerCase();
  if (!isAddress(address)) {
    err(res, 400, "Invalid account address");
    return;
  }
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const limit = Math.min(7, Math.max(1, Number(req.query.limit || 7) || 7));
  const day = typeof req.query.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.day) ? req.query.day : "";
  const db = getDb();
  const recordWhere = ["LOWER(owner_address) = ?"];
  const recordParams: any[] = [address];
  const activityWhere = ["LOWER(from_address) = ?", "type IN ('withdraw', 'withdraw_balance')"];
  const activityParams: any[] = [address];
  if (day) {
    const start = new Date(`${day}T00:00:00.000Z`).getTime();
    const end = start + 24 * 60 * 60 * 1000;
    recordWhere.push("created_at >= ? AND created_at < ?");
    recordParams.push(start, end);
    activityWhere.push("timestamp >= ? AND timestamp < ?");
    activityParams.push(Math.floor(start / 1000), Math.floor(end / 1000));
  }
  const recordRows = await db
    .prepare(
      `SELECT destination_address as destinationAddress, source, amount_raw as amountRaw,
              tx_hash as txHash, created_at as createdAt, 'withdrawal_records' as origin
       FROM withdrawal_records
       WHERE ${recordWhere.join(" AND ")}`
    )
    .all(...recordParams) as Array<{ destinationAddress: string; source: string; amountRaw: string; txHash: string; createdAt: number; origin: string }>;
  const activityRows = await db
    .prepare(
      `SELECT COALESCE(to_address, '') as destinationAddress,
              CASE WHEN type = 'withdraw_balance' THEN 'tipBalance' ELSE 'tipsEarned' END as source,
              amount as amountRaw, tx_hash as txHash, timestamp * 1000 as createdAt,
              'user_activity' as origin
       FROM user_activity
       WHERE ${activityWhere.join(" AND ")}`
    )
    .all(...activityParams) as Array<{ destinationAddress: string; source: string; amountRaw: string; txHash: string | null; createdAt: number; origin: string }>;

  const deduped = new Map<string, { destinationAddress: string; source: string; amountRaw: string; txHash: string; createdAt: number; origin: string }>();
  for (const row of [...recordRows, ...activityRows]) {
    const txHash = row.txHash || "";
    const key = txHash ? `tx:${txHash.toLowerCase()}` : `${row.origin}:${row.source}:${row.createdAt}:${row.amountRaw}:${row.destinationAddress}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        ...row,
        destinationAddress: row.destinationAddress || address,
        txHash,
      });
    }
  }

  const sorted = Array.from(deduped.values()).sort((a, b) => b.createdAt - a.createdAt);
  const rows = sorted.slice((page - 1) * limit, page * limit);
  const identities = await resolveAddressIdentities(rows.map((row) => row.destinationAddress).filter((value) => isAddress(value)));
  res.set("Cache-Control", "private, no-store");
  res.json({
    page,
    limit,
    total: sorted.length,
    records: rows.map((row) => ({
      ...row,
      destinationIdentity: identities.get(row.destinationAddress.toLowerCase()) ?? null,
    })),
  });
});

// ─── GET /posts/:handle/:tweetId ─────────────────────────────────────────
router.post("/wallet/:address/export", async (req: Request, res: Response) => {
  const address = String(req.params.address || "").toLowerCase();
  if (!isAddress(address)) {
    err(res, 400, "Invalid account address");
    return;
  }
  const verified = await verifyWalletProof(address, "account-settings", req.body?.walletProof);
  if (!verified) {
    err(res, 401, "Account verification failed");
    return;
  }

  const db = getDb();
  try {
    await syncInboundUsdcFunding(address);
  } catch (error) {
    console.warn("[Account Export] Could not sync funding before export:", error instanceof Error ? error.message : error);
  }

  const settings = await getUserSettings(address);
  const identity = await publicIdentity(address);
  const tipsSent = await db
    .prepare(
      `SELECT t.content_id as contentId, t.author_id as authorId, t.to_address as toAddress, t.amount, t.tx_hash as txHash,
              t.timestamp, m.author_handle as authorHandle, m.tweet_id as tweetId, m.kind
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE LOWER(t.from_address) = ?
       ORDER BY t.timestamp DESC`
    )
    .all(address);
  const activity = await db
    .prepare(
      `SELECT type, from_address as fromAddress, to_address as toAddress, amount, tx_hash as txHash, detail,
              author_handle as authorHandle, tweet_id as tweetId, timestamp
       FROM user_activity
       WHERE LOWER(from_address) = ? OR LOWER(COALESCE(to_address, '')) = ?
       ORDER BY timestamp DESC`
    )
    .all(address, address);
  const funding = (await db
    .prepare(
      `SELECT id, provider, provider_session_id as providerSessionId, kind, status, metadata_json as metadataJson,
              created_at as createdAt, updated_at as updatedAt
       FROM funding_provider_sessions
       WHERE LOWER(user_address) = ?
       ORDER BY created_at DESC`
    )
    .all(address))
    .map((row: any) => ({ ...row, metadata: safeJson(row.metadataJson), metadataJson: undefined }));
  const withdrawals = await db
    .prepare(
      `SELECT destination_address as destinationAddress, source, amount_raw as amountRaw, tx_hash as txHash,
              confirmation_id as confirmationId, created_at as createdAt
       FROM withdrawal_records
       WHERE LOWER(owner_address) = ?
       ORDER BY created_at DESC`
    )
    .all(address);
  const withdrawalRequests = await db
    .prepare(
      `SELECT id, destination_address as destinationAddress, source, amount_raw as amountRaw, email, status,
              tx_hash as txHash, created_at as createdAt, expires_at as expiresAt, confirmed_at as confirmedAt, used_at as usedAt
       FROM withdrawal_confirmations
       WHERE LOWER(owner_address) = ?
       ORDER BY created_at DESC`
    )
    .all(address);
  const referralCode = await db
    .prepare("SELECT code, created_at as createdAt FROM referral_codes WHERE LOWER(referrer_address) = ? LIMIT 1")
    .get(address);
  const referralAttribution = await db
    .prepare("SELECT referrer_address as referrerAddress, referral_code as referralCode, referred_at as referredAt FROM user_referrals WHERE LOWER(user_address) = ? LIMIT 1")
    .get(address);
  const notifications = (await db
    .prepare(
      `SELECT id, type, title, body, status, metadata_json as metadataJson, created_at as createdAt
       FROM user_notifications
       WHERE LOWER(user_address) = ?
       ORDER BY created_at DESC`
    )
    .all(address))
    .map((row: any) => ({ ...row, metadata: safeJson(row.metadataJson), metadataJson: undefined }));
  const creatorClaims = await db
    .prepare(
      `SELECT author_id as authorId, username, display_name as displayName, profile_image_url as profileImageUrl, verified_at as verifiedAt
       FROM verified_claims
       WHERE LOWER(owner_address) = ?
       ORDER BY verified_at DESC`
    )
    .all(address);

  res.set("Cache-Control", "private, no-store");
  res.set("Content-Disposition", `attachment; filename="teep-account-export-${address.slice(2, 8)}.json"`);
  res.json({
    exportedAt: new Date().toISOString(),
    account: {
      address,
      username: settings.username,
      publicIdentity: identity,
    },
    settings,
    creatorClaims,
    tipsSent,
    activity,
    funding,
    withdrawals,
    withdrawalRequests,
    referrals: {
      code: referralCode || null,
      attribution: referralAttribution || null,
    },
    notifications,
  });
});

router.get("/wallet/:address/delete-readiness", async (req: Request, res: Response) => {
  const address = String(req.params.address || "").toLowerCase();
  if (!isAddress(address)) {
    err(res, 400, "Invalid account address");
    return;
  }
  try {
    res.set("Cache-Control", "private, no-store");
    res.json(await getDeleteReadiness(address));
  } catch (error) {
    console.error("[Account Delete] Readiness check failed:", error);
    err(res, 500, "Could not verify account balance before deletion");
  }
});

router.post("/wallet/:address/delete-local-data", async (req: Request, res: Response) => {
  const address = String(req.params.address || "").toLowerCase();
  if (!isAddress(address)) {
    err(res, 400, "Invalid account address");
    return;
  }
  if (req.body?.confirmation !== "DELETE") {
    err(res, 400, "Deletion confirmation is required");
    return;
  }
  const userId = typeof req.body?.privyUserId === "string" ? req.body.privyUserId : "";
  const verified = await verifyWalletProof(address, "account-settings", req.body?.walletProof);
  if (!verified) {
    err(res, 401, "Account verification failed");
    return;
  }

  try {
    const readiness = await getDeleteReadiness(address);
    if (!readiness.canDelete) {
      res.status(409).json({
        error: "Transfer or withdraw your remaining balance before deleting your account.",
        code: "POSITIVE_BALANCE",
        ...readiness,
      });
      return;
    }

    const privyDeletion = await deletePrivyUser(userId);
    if (!privyDeletion.ok) {
      err(res, privyDeletion.status, privyDeletion.message);
      return;
    }

    const db = getDb();
    await db.transaction(async (txDb) => {
      await txDb.prepare("DELETE FROM user_notifications WHERE LOWER(user_address) = ?").run(address);
      await txDb.prepare("DELETE FROM funding_sync_state WHERE LOWER(user_address) = ?").run(address);
      await txDb.prepare("DELETE FROM referral_codes WHERE LOWER(referrer_address) = ?").run(address);
      await txDb.prepare("DELETE FROM user_referrals WHERE LOWER(user_address) = ?").run(address);
      await txDb.prepare("DELETE FROM user_settings WHERE LOWER(address) = ?").run(address);
    })();

    res.set("Cache-Control", "private, no-store");
    res.json({ success: true });
  } catch (error) {
    console.error("[Account Delete] Local cleanup failed:", error);
    err(res, 500, "Could not delete local account data");
  }
});

router.get("/wallet/:address/notifications", async (req: Request, res: Response) => {
  try {
    const address = String(req.params.address || "").toLowerCase();
    if (!isAddress(address)) {
      err(res, 400, "Invalid account address");
      return;
    }
    const page = Math.max(1, Number(req.query.page || 1) || 1);
    const limit = Math.min(20, Math.max(1, Number(req.query.limit || 7) || 7));
    const db = getDb();
    const total = await db.prepare("SELECT COUNT(*) as count FROM user_notifications WHERE user_address = ?").get(address) as { count: number | string };
    const unread = await db.prepare("SELECT COUNT(*) as count FROM user_notifications WHERE user_address = ? AND status = 'unread'").get(address) as { count: number | string };
    const records = (await db
      .prepare(
        `SELECT id, type, title, body, status, metadata_json as metadataJson, created_at as createdAt
         FROM user_notifications
         WHERE user_address = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(address, limit, (page - 1) * limit))
      .map((row: any) => ({
        ...row,
        metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null,
        metadataJson: undefined,
      }));
    res.set("Cache-Control", "private, no-store");
    res.json({ page, limit, total: Number(total.count), unread: Number(unread.count), records });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[API v1] Notifications failed:", message);
    res.set("Cache-Control", "private, no-store");
    res.status(200).json({ page: 1, limit: 7, total: 0, unread: 0, records: [], degraded: true });
  }
});

router.post("/wallet/:address/notifications/:id/read", async (req: Request, res: Response) => {
  const address = String(req.params.address || "").toLowerCase();
  const id = Number(req.params.id || 0);
  if (!isAddress(address) || !Number.isInteger(id) || id <= 0) {
    err(res, 400, "Invalid notification request");
    return;
  }
  const db = getDb();
  await db.prepare("UPDATE user_notifications SET status = 'read' WHERE user_address = ? AND id = ?").run(address, id);
  res.json({ success: true });
});

router.post("/wallet/:address/notifications/read-all", async (req: Request, res: Response) => {
  const address = String(req.params.address || "").toLowerCase();
  if (!isAddress(address)) {
    err(res, 400, "Invalid account address");
    return;
  }
  const db = getDb();
  await db.prepare("UPDATE user_notifications SET status = 'read' WHERE user_address = ?").run(address);
  res.json({ success: true });
});

router.get("/posts/:handle/:tweetId", async (req: Request, res: Response) => {
  const handle = String(req.params.handle || "").replace(/^@/, "");
  const tweetId = String(req.params.tweetId || "");
  if (!handle || !tweetId) {
    err(res, 400, "handle and tweetId required");
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
    .all(contentId) as Array<{ from_address: string; amount: string; tx_hash: string; timestamp: number }>;

  res.set("Cache-Control", "public, max-age=30");
  res.json({
    contentId,
    handle,
    tweetId,
    totalAmountUsd: (Number(total?.total ?? 0) / 1e6).toFixed(2),
    tipCount: Number(total?.count ?? 0),
    recentTips: recentTips.map((t) => ({
      fromAddress: t.from_address,
      amountUsd: (Number(t.amount) / 1e6).toFixed(2),
      txHash: t.tx_hash,
      timestamp: t.timestamp,
    })),
  });
});

// ─── GET /creators/:username ─────────────────────────────────────────────
router.get("/creators/:username", async (req: Request, res: Response) => {
  const username = (req.params.username as string).replace(/^@/, "").toLowerCase();
  const db = getDb();

  const claim = await db
    .prepare("SELECT author_id, username, display_name, profile_image_url FROM verified_claims WHERE LOWER(username) = ?")
    .get(username) as { author_id: string; username: string; display_name: string | null; profile_image_url: string | null } | undefined;

  if (!claim) {
    err(res, 404, "Creator not found or not verified", "NOT_FOUND");
    return;
  }

  const total = await db
    .prepare(
      `SELECT COALESCE(SUM(CAST(t.amount AS NUMERIC)), 0) as total, COUNT(*) as count
       FROM tips t LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE ${creatorTipPredicate("t")}`
    )
    .get(claim.author_id, claim.username) as { total: string; count: string } | undefined;

  const topPosts = await db
    .prepare(
      `SELECT t.content_id, SUM(CAST(t.amount AS NUMERIC)) as total, COUNT(*) as count, m.tweet_id, m.author_handle
       FROM tips t LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE ${creatorTipPredicate("t")} GROUP BY t.content_id ORDER BY total DESC LIMIT 10`
    )
    .all(claim.author_id, claim.username) as Array<{
      content_id: string;
      total: string;
      count: string;
      tweet_id: string | null;
      author_handle: string | null;
    }>;

  const topSupporters = await db
    .prepare(
      `SELECT t.from_address, SUM(CAST(t.amount AS NUMERIC)) as total
       FROM tips t LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE ${creatorTipPredicate("t")}
       GROUP BY t.from_address ORDER BY total DESC LIMIT 10`
    )
    .all(claim.author_id, claim.username) as Array<{ from_address: string; total: string }>;

  const recentTips = await db
    .prepare(
      `SELECT 'tip_received' as type, t.amount, t.tx_hash, t.timestamp,
              t.from_address as from_addr, m.author_handle, m.tweet_id
       FROM tips t LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE ${creatorTipPredicate("t")}
       ORDER BY t.timestamp DESC
       LIMIT 100`
    )
    .all(claim.author_id, claim.username);
  const supporterIdentities = await resolveAddressIdentities([
    ...topSupporters.map((supporter) => supporter.from_address),
    ...(recentTips as Array<{ from_addr?: string | null }>).map((tip) => tip.from_addr || "").filter(Boolean),
  ]);

  res.set("Cache-Control", "public, max-age=60");
  res.json({
    username: claim.username,
    displayName: claim.display_name,
    profileImageUrl: claim.profile_image_url,
    authorId: claim.author_id,
    totalReceivedUsd: (Number(total?.total ?? 0) / 1e6).toFixed(2),
    tipCount: Number(total?.count ?? 0),
    topPosts: topPosts.map((p) => ({
      contentId: p.content_id,
      totalUsd: (Number(p.total) / 1e6).toFixed(2),
      count: Number(p.count),
      tweetId: p.tweet_id,
      authorHandle: p.author_handle,
    })),
    topSupporters: topSupporters.map((s) => ({
      address: s.from_address,
      ...(supporterIdentities.get(s.from_address.toLowerCase()) ?? {}),
      totalUsd: (Number(s.total) / 1e6).toFixed(2),
    })),
    recentTips: (recentTips as Array<Record<string, any>>).map((tip) => ({
      ...tip,
      fromIdentity: tip.from_addr ? supporterIdentities.get(String(tip.from_addr).toLowerCase()) ?? null : null,
    })),
  });
});

// ─── GET /creators/:username/earnings-over-time ───────────────────────────
router.get("/creators/:username/earnings-over-time", async (req: Request, res: Response) => {
  const username = (req.params.username as string).replace(/^@/, "").toLowerCase();
  const days = Math.min(parseInt(req.query.days as string) || 30, 90);
  const db = getDb();

  const claim = await db
    .prepare("SELECT author_id, username FROM verified_claims WHERE LOWER(username) = ? ORDER BY verified_at DESC LIMIT 1")
    .get(username) as { author_id: string; username: string } | undefined;

  if (!claim) {
    err(res, 404, "Creator not found or not verified", "NOT_FOUND");
    return;
  }

  const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  const rows = await db
    .prepare(
      `SELECT to_char(to_timestamp(timestamp), 'YYYY-MM-DD') as day, SUM(CAST(amount AS NUMERIC)) as total
       FROM tips t LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE ${creatorTipPredicate("t")} AND t.timestamp >= ?
       GROUP BY day ORDER BY day ASC`
    )
    .all(claim.author_id, claim.username, since) as Array<{ day: string; total: string }>;
  const totalsByDay = new Map(rows.map((r) => [r.day, Number(r.total)]));
  const today = new Date();
  const daily = Array.from({ length: days }, (_, index) => {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    day.setUTCDate(day.getUTCDate() - (days - 1 - index));
    const date = day.toISOString().slice(0, 10);
    const total = totalsByDay.get(date) ?? 0;
    return {
      date,
      amountRaw: total.toString(),
      amountUsd: (total / 1e6).toFixed(2),
    };
  });

  res.set("Cache-Control", "public, max-age=60");
  res.json({
    daily,
  });
});

// ─── GET /tippers/:address ───────────────────────────────────────────────
// GET /creators/:username/performance
// Source-of-truth service for creator performance figures. Every number is
// derived from indexed DB rows and returned with raw values plus display values.
router.get("/creators/:username/performance", async (req: Request, res: Response) => {
  const result = await getCreatorPerformance(req.params.username as string, {
    period: req.query.period,
    endDate: req.query.endDate,
    recentPage: req.query.recentPage,
    recentLimit: req.query.recentLimit,
  });

  if (!result) {
    err(res, 404, "Creator not found or not verified", "NOT_FOUND");
    return;
  }

  res.set("Cache-Control", "public, max-age=60");
  res.json(result);
});

router.post("/creators/:username/supporters/:supporterAddress/thank", async (req: Request, res: Response) => {
  const creatorIdentifier = String(req.params.username || "").trim();
  const supporterAddress = String(req.params.supporterAddress || "").toLowerCase();
  const ownerAddress = String(req.body?.ownerAddress || "").toLowerCase();
  if (!creatorIdentifier || !isAddress(supporterAddress) || !isAddress(ownerAddress)) {
    err(res, 400, "Invalid creator, supporter, or owner address");
    return;
  }

  const verified = await verifyWalletProof(ownerAddress, "supporter-thank", req.body?.walletProof);
  if (!verified) {
    err(res, 401, "Account verification failed");
    return;
  }

  const db = getDb();
  const username = creatorIdentifier.replace(/^@/, "").toLowerCase();
  const claim = await db
    .prepare(
      `SELECT author_id, username, display_name, owner_address
       FROM verified_claims
       WHERE LOWER(owner_address) = ? AND (author_id = ? OR LOWER(username) = ?)
       ORDER BY verified_at DESC
       LIMIT 1`
    )
    .get(ownerAddress, creatorIdentifier, username) as
    | { author_id: string; username: string; display_name: string | null; owner_address: string }
    | undefined;

  if (!claim) {
    err(res, 403, "Creator account is not verified for this owner", "CREATOR_NOT_VERIFIED");
    return;
  }

  const supporter = await db
    .prepare(
      `SELECT LOWER(t.from_address) as address, COUNT(*) as tipCount, COALESCE(SUM(CAST(t.amount AS NUMERIC)), 0) as totalRaw
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE LOWER(t.from_address) = ?
         AND (t.author_id = ? OR LOWER(COALESCE(m.author_handle, '')) = LOWER(?))
       GROUP BY LOWER(t.from_address)
       LIMIT 1`
    )
    .get(supporterAddress, claim.author_id, claim.username) as
    | { address: string; tipCount: string; totalRaw: string }
    | undefined;

  if (!supporter) {
    err(res, 404, "Supporter has no recorded tips for this creator", "SUPPORTER_NOT_FOUND");
    return;
  }

  const totalRaw = String(Math.trunc(Number(supporter.totalRaw || 0)));
  const creatorSettings = await getUserSettings(ownerAddress);
  const notificationId = await createThankYouMessageNotification({
    userAddress: supporterAddress,
    creatorUsername: claim.username,
    creatorDisplayName: claim.display_name,
    creatorOwnerAddress: ownerAddress,
    totalRaw,
    tipCount: Number(supporter.tipCount),
    message: creatorSettings.engagement.defaultThankYouMessage,
  });

  await db.prepare(
    `INSERT INTO supporter_thank_yous (
      supporter_address,
      creator_owner_address,
      creator_author_id,
      creator_username,
      tip_count,
      total_raw,
      message,
      notification_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    supporterAddress,
    ownerAddress,
    claim.author_id,
    claim.username,
    Number(supporter.tipCount),
    totalRaw,
    creatorSettings.engagement.defaultThankYouMessage,
    notificationId,
    Date.now()
  );

  res.set("Cache-Control", "private, no-store");
  res.json({
    success: true,
    notificationId,
    supporter: {
      address: supporterAddress,
      truncatedAddress: `${supporterAddress.slice(0, 6)}...${supporterAddress.slice(-4)}`,
      totalRaw,
      totalUsd: rawToUsd(totalRaw),
      tipCount: Number(supporter.tipCount),
    },
  });
});

router.get("/tippers/:address", async (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const stats = await getUnifiedTipperStats(address);

  res.set("Cache-Control", "public, max-age=60");
  res.json({
    address,
    totalSentUsd: (Number(stats.totalSent) / 1e6).toFixed(2),
    totalSent: stats.totalSent,
    tipCount: stats.tipCount,
    thankYouReceivedCount: stats.thankYouReceivedCount,
    recentTips: stats.recentTips,
    creatorsSupported: stats.creatorsSupported.map((c) => ({
      authorId: c.authorId,
      username: c.username,
      profileImageUrl: c.profileImageUrl,
      totalUsd: (Number(c.totalRaw) / 1e6).toFixed(2),
      totalRaw: c.totalRaw,
      tipCount: c.tipCount,
      isVerified: c.isVerified,
      claimWalletDeployed: c.claimWalletDeployed,
      claimStatus: c.claimStatus,
    })),
  });
});

// ─── GET /stats ──────────────────────────────────────────────────────────
router.get("/stats", async (req: Request, res: Response) => {
  const db = getDb();
  const tipsAgg = await db.prepare(
    `SELECT COUNT(*) as total_tips, COALESCE(SUM(CAST(amount AS NUMERIC)), 0) as total_volume, COUNT(DISTINCT from_address) as distinct_tippers FROM tips`
  ).get() as { total_tips: string; total_volume: string; distinct_tippers: string };
  const creatorsCount = await db.prepare("SELECT COUNT(DISTINCT author_id) as count FROM verified_claims").get() as { count: string };

  res.set("Cache-Control", "public, max-age=60");
  res.json({
    totalTips: Number(tipsAgg.total_tips),
    totalVolumeUsd: (Number(tipsAgg.total_volume) / 1e6).toFixed(2),
    distinctTippers: Number(tipsAgg.distinct_tippers),
    verifiedCreators: Number(creatorsCount.count),
  });
});

// ─── GET /discover ────────────────────────────────────────────────────────
router.get("/discover", async (req: Request, res: Response) => {
  try {
    const addressParam = typeof req.query.address === "string" ? req.query.address.toLowerCase() : "";
    const address = addressParam && isAddress(addressParam) ? addressParam : "";
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - 7 * 24 * 60 * 60;
    const todayStart = now - 24 * 60 * 60;
    const weekStart = Math.floor(Date.UTC(
      new Date().getUTCFullYear(),
      new Date().getUTCMonth(),
      new Date().getUTCDate() - ((new Date().getUTCDay() + 6) % 7),
      0, 0, 0, 0
    ) / 1000);

  const trendingRows = await db
    .prepare(
      `SELECT
         t.content_id,
         t.author_id,
         COALESCE(SUM(CAST(t.amount AS NUMERIC)), 0) as total,
         COUNT(*) as tip_count,
         COUNT(DISTINCT t.from_address) as unique_tippers,
         MAX(t.timestamp) as last_tip_at,
         SUM(CASE WHEN t.timestamp >= ? THEN 1 ELSE 0 END) as tips_today,
         m.author_handle,
         m.tweet_id,
         (
           SELECT username FROM verified_claims
           WHERE author_id = t.author_id OR (m.author_handle IS NOT NULL AND LOWER(username) = LOWER(m.author_handle))
           ORDER BY verified_at DESC
           LIMIT 1
         ) as username,
         (
           SELECT display_name FROM verified_claims
           WHERE author_id = t.author_id OR (m.author_handle IS NOT NULL AND LOWER(username) = LOWER(m.author_handle))
           ORDER BY verified_at DESC
           LIMIT 1
         ) as display_name,
         (
           SELECT profile_image_url FROM verified_claims
           WHERE author_id = t.author_id OR (m.author_handle IS NOT NULL AND LOWER(username) = LOWER(m.author_handle))
           ORDER BY verified_at DESC
           LIMIT 1
         ) as profile_image_url
       FROM tips t
       LEFT JOIN tip_metadata m ON m.content_id = t.content_id
       WHERE COALESCE(m.kind, 'post_tip') = 'post_tip'
       GROUP BY t.content_id
       ORDER BY tips_today DESC, unique_tippers DESC, total DESC, last_tip_at DESC
       LIMIT 4`
    )
    .all(todayStart) as Array<{
      content_id: string;
      author_id: string;
      total: string;
      tip_count: string;
      unique_tippers: string;
      last_tip_at: number;
      tips_today: string;
      author_handle: string | null;
      tweet_id: string | null;
      username: string | null;
      display_name: string | null;
      profile_image_url: string | null;
    }>;

  const creatorRows = await db
    .prepare(
      `SELECT
         t.author_id,
         COALESCE(SUM(CAST(t.amount AS NUMERIC)), 0) as total,
         COUNT(*) as tip_count,
         COUNT(DISTINCT t.from_address) as unique_supporters,
         COUNT(DISTINCT t.content_id) as tipped_posts,
         MAX(t.timestamp) as last_tip_at,
         SUM(CASE WHEN t.timestamp >= ? THEN 1 ELSE 0 END) as recent_tip_count,
         SUM(CASE WHEN t.timestamp >= ? THEN CAST(t.amount AS NUMERIC) ELSE 0 END) as total_this_week,
         (
           SELECT username FROM verified_claims
           WHERE author_id = t.author_id
              OR LOWER(username) = LOWER((
                SELECT tm.author_handle
                FROM tips rt
                LEFT JOIN tip_metadata tm ON tm.content_id = rt.content_id
                WHERE rt.author_id = t.author_id AND tm.author_handle IS NOT NULL
                ORDER BY rt.timestamp DESC
                LIMIT 1
              ))
           ORDER BY verified_at DESC
           LIMIT 1
         ) as username,
         (
           SELECT display_name FROM verified_claims
           WHERE author_id = t.author_id
              OR LOWER(username) = LOWER((
                SELECT tm.author_handle
                FROM tips rt
                LEFT JOIN tip_metadata tm ON tm.content_id = rt.content_id
                WHERE rt.author_id = t.author_id AND tm.author_handle IS NOT NULL
                ORDER BY rt.timestamp DESC
                LIMIT 1
              ))
           ORDER BY verified_at DESC
           LIMIT 1
         ) as display_name,
         (
           SELECT profile_image_url FROM verified_claims
           WHERE author_id = t.author_id
              OR LOWER(username) = LOWER((
                SELECT tm.author_handle
                FROM tips rt
                LEFT JOIN tip_metadata tm ON tm.content_id = rt.content_id
                WHERE rt.author_id = t.author_id AND tm.author_handle IS NOT NULL
                ORDER BY rt.timestamp DESC
                LIMIT 1
              ))
           ORDER BY verified_at DESC
           LIMIT 1
         ) as profile_image_url,
         (
           SELECT tm.author_handle
           FROM tips rt
           LEFT JOIN tip_metadata tm ON tm.content_id = rt.content_id
           WHERE rt.author_id = t.author_id AND tm.author_handle IS NOT NULL
           ORDER BY rt.timestamp DESC
           LIMIT 1
         ) as latest_handle
       FROM tips t
       GROUP BY t.author_id
       ORDER BY recent_tip_count DESC, unique_supporters DESC, total DESC
       LIMIT 60`
    )
    .all(sevenDaysAgo, weekStart) as Array<{
      author_id: string;
      total: string;
      tip_count: string;
      unique_supporters: string;
      tipped_posts: string;
      last_tip_at: number;
      recent_tip_count: string;
      total_this_week: string;
      username: string | null;
      display_name: string | null;
      profile_image_url: string | null;
      latest_handle: string | null;
    }>;

  const tippedBeforeAuthors = address
    ? new Set(
        (await db
          .prepare("SELECT DISTINCT author_id FROM tips WHERE LOWER(from_address) = ?")
          .all(address) as Array<{ author_id: string }>)
          .map((row) => row.author_id)
      )
    : new Set<string>();
  const tippedBeforeArgs = Array.from(tippedBeforeAuthors);
  const sharedSupporterSql = tippedBeforeArgs.length
    ? `SELECT COUNT(DISTINCT from_address) as count
       FROM tips
       WHERE author_id = ?
         AND LOWER(from_address) IN (
           SELECT DISTINCT LOWER(from_address)
           FROM tips
           WHERE author_id IN (${tippedBeforeArgs.map(() => "?").join(",")})
         )`
    : null;

  const recommendations = await Promise.all(creatorRows.map(async (row) => {
    const isVerified = Boolean(row.username);
    const handle = (row.username || row.latest_handle || "").replace(/^@/, "");
    const isTippedBefore = tippedBeforeAuthors.has(row.author_id);
    const recentTipCount = Number(row.recent_tip_count || 0);
    const uniqueSupporters = Number(row.unique_supporters || 0);
    const repeatTips = Math.max(0, Number(row.tip_count || 0) - Number(row.unique_supporters || 0));
    const sharedSupporters = sharedSupporterSql
      ? Number(((await db.prepare(sharedSupporterSql).get(row.author_id, ...tippedBeforeArgs) as { count: string } | undefined)?.count || 0))
      : 0;
    const unclaimedSignal = !isVerified && Number(row.total || 0) > 0 ? 1 : 0;
    const score =
      recentTipCount * 4 +
      uniqueSupporters * 3 +
      unclaimedSignal * 6 +
      repeatTips * 2 +
      sharedSupporters * 3 +
      Number(row.total || 0) / 1e6 * 0.05;

    let reason = "Receiving support across Teep";
    let reasonType: "recent_unique" | "unclaimed_recent" | "retip" | "similar" | "tipped_before" | "general" = "general";
    if (!isVerified && recentTipCount > 0) {
      reason = "Has tips waiting to be claimed";
      reasonType = "unclaimed_recent";
    } else if (isTippedBefore) {
      reason = "You tipped this creator before";
      reasonType = "tipped_before";
    } else if (sharedSupporters > 0) {
      reason = "Similar to creators you tipped before";
      reasonType = "similar";
    } else if (repeatTips > 0) {
      reason = "Supporters keep tipping this creator";
      reasonType = "retip";
    } else if (recentTipCount > 0 && uniqueSupporters > 1) {
      reason = "Recently received support from multiple tippers";
      reasonType = "recent_unique";
    }

    return {
      authorId: row.author_id,
      username: handle || null,
      displayName: row.display_name,
      profileImageUrl: row.profile_image_url,
      totalReceivedUsd: rawToUsd(row.total),
      totalThisWeekUsd: rawToUsd(row.total_this_week),
      tipCount: Number(row.tip_count),
      uniqueSupporters,
      tippedPosts: Number(row.tipped_posts),
      lastTipAt: row.last_tip_at,
      lastTipAgo: timeAgoFromUnix(row.last_tip_at),
      recentTipCount,
      isVerified,
      claimStatus: isVerified ? "verified" : "unclaimed",
      reason,
      reasonType,
      score,
    };
  }));

  const recommendedCreators = recommendations
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
  const topCreators = recommendations
    .filter((creator) => creator.isVerified)
    .slice()
    .map((creator) => ({ ...creator, totalReceivedUsd: creator.totalThisWeekUsd }))
    .filter((creator) => Number(creator.totalReceivedUsd) > 0)
    .sort((a, b) => Number(b.totalReceivedUsd) - Number(a.totalReceivedUsd))
    .slice(0, 3);
  const topCreatorsAllTime = recommendations
    .filter((creator) => creator.isVerified)
    .slice()
    .sort((a, b) => Number(b.totalReceivedUsd) - Number(a.totalReceivedUsd))
    .slice(0, 3);
  const unclaimedCreators = recommendations
    .filter((creator) => creator.claimStatus === "unclaimed")
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  const tipperStats = address ? await getUnifiedTipperStats(address) : null;
  const allUserSupportedCreators = tipperStats?.creatorsSupported || [];
  const tippedBefore = address
    ? allUserSupportedCreators.slice(0, 4).map((creator) => ({
        authorId: creator.authorId,
        username: creator.username,
        displayName: null,
        profileImageUrl: creator.profileImageUrl,
        totalReceivedUsd: creator.total,
        tipCount: creator.tipCount,
        uniqueSupporters: null,
        tippedPosts: null,
        lastTipAt: null,
        lastTipAgo: null,
        recentTipCount: null,
        isVerified: creator.isVerified,
        claimStatus: creator.claimStatus,
        reason: "You tipped this creator before",
        reasonType: "tipped_before",
      }))
    : [];

  const trendingPosts = trendingRows.map((row) => {
    const handle = (row.username || row.author_handle || "").replace(/^@/, "");
    const tipsToday = Number(row.tips_today);
    const uniqueTippers = Number(row.unique_tippers);
    const tipCount = Number(row.tip_count);
    const reason = tipsToday > 1
      ? `${row.tips_today} tips in the last 24h`
      : uniqueTippers > 1
        ? `${uniqueTippers} people tipped this post`
        : "Recently tipped";
    return {
      contentId: row.content_id,
      authorId: row.author_id,
      username: handle || null,
      displayName: row.display_name,
      profileImageUrl: row.profile_image_url,
      tweetId: row.tweet_id,
      totalTippedUsd: rawToUsd(row.total),
      tipCount,
      uniqueTippers,
      tipsToday,
      lastTipAt: row.last_tip_at,
      lastTipAgo: timeAgoFromUnix(row.last_tip_at),
      postPreview: row.tweet_id ? "Tipped post on X" : "Tipped creator content",
      reason,
      claimStatus: row.username ? "verified" : "unclaimed",
    };
  });

  const userSupportedAuthorIds = new Set(allUserSupportedCreators.map((creator) => creator.authorId).filter(Boolean));
  const userTrendingConnections = recommendations.filter((creator) => userSupportedAuthorIds.has(creator.authorId) && creator.recentTipCount > 0).length;

    res.set("Cache-Control", "public, max-age=30");
    res.json({
      algorithm: {
        version: "discover-beta-v1",
        signals: [
          "recent tips + unique supporters",
          "unclaimed support + recent activity",
          "high re-tip activity",
          "similar to creators you tipped",
        ],
      },
      trendingPosts,
      recommendedCreators,
      topCreators,
      topCreatorsAllTime,
      unclaimedCreators,
      tippedBefore,
      orbit: {
        connections: userSupportedAuthorIds.size,
        directTips: tipperStats?.tipCount || 0,
        unclaimed: allUserSupportedCreators.filter((creator) => creator.claimStatus === "unclaimed").length,
        trending: userTrendingConnections,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[API v1] Discover failed:", message);
    res.set("Cache-Control", "no-store");
    res.status(200).json(emptyDiscoverPayload("discover_fetch_failed"));
  }
});

// ─── GET /leaderboard/creators ────────────────────────────────────────────
// ─── GET /discover/search ─────────────────────────────────────────────────────
router.get("/discover/search", async (req: Request, res: Response) => {
  try {
    const rawQuery = typeof req.query.q === "string" ? req.query.q.trim().replace(/^@/, "").toLowerCase() : "";
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 8, 1), 20);
    if (rawQuery.length < 2) {
      res.json({ results: [] });
      return;
    }

  const db = getDb();
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const like = `%${rawQuery}%`;
  const rows = await db
    .prepare(
      `WITH creator_activity AS (
         SELECT
           t.author_id,
           COALESCE(SUM(CAST(t.amount AS NUMERIC)), 0) as total,
           COUNT(*) as tip_count,
           COUNT(DISTINCT t.from_address) as unique_supporters,
           COUNT(DISTINCT t.content_id) as tipped_posts,
           MAX(t.timestamp) as last_tip_at,
           SUM(CASE WHEN t.timestamp >= ? THEN 1 ELSE 0 END) as recent_tip_count,
           (
             SELECT username FROM verified_claims
             WHERE author_id = t.author_id
                OR LOWER(username) = LOWER((
                  SELECT tm.author_handle
                  FROM tips rt
                  LEFT JOIN tip_metadata tm ON tm.content_id = rt.content_id
                  WHERE rt.author_id = t.author_id AND tm.author_handle IS NOT NULL
                  ORDER BY rt.timestamp DESC
                  LIMIT 1
                ))
             ORDER BY verified_at DESC
             LIMIT 1
           ) as username,
           (
             SELECT display_name FROM verified_claims
             WHERE author_id = t.author_id
                OR LOWER(username) = LOWER((
                  SELECT tm.author_handle
                  FROM tips rt
                  LEFT JOIN tip_metadata tm ON tm.content_id = rt.content_id
                  WHERE rt.author_id = t.author_id AND tm.author_handle IS NOT NULL
                  ORDER BY rt.timestamp DESC
                  LIMIT 1
                ))
             ORDER BY verified_at DESC
             LIMIT 1
           ) as display_name,
           (
             SELECT profile_image_url FROM verified_claims
             WHERE author_id = t.author_id
                OR LOWER(username) = LOWER((
                  SELECT tm.author_handle
                  FROM tips rt
                  LEFT JOIN tip_metadata tm ON tm.content_id = rt.content_id
                  WHERE rt.author_id = t.author_id AND tm.author_handle IS NOT NULL
                  ORDER BY rt.timestamp DESC
                  LIMIT 1
                ))
             ORDER BY verified_at DESC
             LIMIT 1
           ) as profile_image_url,
           (
             SELECT tm.author_handle
             FROM tips rt
             LEFT JOIN tip_metadata tm ON tm.content_id = rt.content_id
             WHERE rt.author_id = t.author_id AND tm.author_handle IS NOT NULL
             ORDER BY rt.timestamp DESC
             LIMIT 1
           ) as latest_handle
         FROM tips t
         GROUP BY t.author_id
       )
       SELECT *
       FROM creator_activity
       WHERE LOWER(COALESCE(username, latest_handle, '')) LIKE ?
          OR LOWER(COALESCE(display_name, '')) LIKE ?
          OR LOWER(author_id) LIKE ?
       ORDER BY last_tip_at DESC, total DESC
       LIMIT ?`
    )
    .all(sevenDaysAgo, like, like, like, limit) as Array<{
      author_id: string;
      total: string;
      tip_count: string;
      unique_supporters: string;
      tipped_posts: string;
      last_tip_at: number;
      recent_tip_count: string;
      username: string | null;
      display_name: string | null;
      profile_image_url: string | null;
      latest_handle: string | null;
    }>;

    res.set("Cache-Control", "private, max-age=10");
    res.json({
      results: rows.map((row) => {
        const isVerified = Boolean(row.username);
        const handle = (row.username || row.latest_handle || "").replace(/^@/, "");
        return {
          authorId: row.author_id,
          username: handle || null,
          displayName: row.display_name,
          profileImageUrl: row.profile_image_url,
          totalReceivedUsd: rawToUsd(row.total),
          tipCount: Number(row.tip_count),
          uniqueSupporters: Number(row.unique_supporters),
          tippedPosts: Number(row.tipped_posts),
          lastTipAt: row.last_tip_at,
          lastTipAgo: timeAgoFromUnix(row.last_tip_at),
          recentTipCount: Number(row.recent_tip_count),
          isVerified,
          claimStatus: isVerified ? "verified" : "unclaimed",
          reason: "Recorded in Teep tip activity",
          reasonType: "general",
        };
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[API v1] Discover search failed:", message);
    res.set("Cache-Control", "private, no-store");
    res.status(200).json({ results: [], degraded: true });
  }
});

router.get("/leaderboard/creators", async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const period = req.query.period as string;
  const since = period === "30d" ? Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60 : null;
  const db = getDb();

  const whereClause =
    since != null
      ? "WHERE t.author_id IN (SELECT author_id FROM verified_claims) AND t.timestamp >= ?"
      : "WHERE t.author_id IN (SELECT author_id FROM verified_claims)";
  const args = since != null ? [since, limit] : [limit];

  const rows = await db
    .prepare(
      `SELECT t.author_id, SUM(CAST(t.amount AS NUMERIC)) as total FROM tips t ${whereClause} GROUP BY t.author_id ORDER BY total DESC LIMIT ?`
    )
    .all(...args) as Array<{ author_id: string; total: string }>;

  const authorIds = rows.map((r) => r.author_id);
  const claims =
    authorIds.length > 0
      ? (await db
          .prepare("SELECT author_id, username, display_name FROM verified_claims WHERE author_id IN (" + authorIds.map(() => "?").join(",") + ")")
          .all(...authorIds) as Array<{ author_id: string; username: string; display_name: string | null }>)
      : [];
  const byAuthor = Object.fromEntries(claims.map((c) => [c.author_id, { username: c.username, displayName: c.display_name }]));

  const creators = rows.map((r, i) => ({
    rank: i + 1,
    authorId: r.author_id,
    username: byAuthor[r.author_id]?.username ?? null,
    displayName: byAuthor[r.author_id]?.displayName ?? null,
    totalReceivedUsd: (Number(r.total) / 1e6).toFixed(2),
  }));

  res.set("Cache-Control", "public, max-age=60");
  res.json({ creators });
});

// ─── GET /leaderboard/tippers ─────────────────────────────────────────────
router.get("/leaderboard/tippers", async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const period = req.query.period as string;
  const since = period === "30d" ? Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60 : null;
  const db = getDb();

  const whereClause = since != null ? "WHERE timestamp >= ?" : "";
  const args = since != null ? [since, limit] : [limit];

  const rows = await db
    .prepare(
      `SELECT from_address, SUM(CAST(amount AS NUMERIC)) as total FROM tips ${whereClause} GROUP BY from_address ORDER BY total DESC LIMIT ?`
    )
    .all(...args) as Array<{ from_address: string; total: string }>;

  const tippers = rows.map((r, i) => ({
    rank: i + 1,
    address: r.from_address,
    totalSentUsd: (Number(r.total) / 1e6).toFixed(2),
  }));

  res.set("Cache-Control", "public, max-age=60");
  res.json({ tippers });
});

// ─── GET /wallet/:address/eligibility ────────────────────────────────────
router.get("/wallet/:address/eligibility", async (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const db = getDb();

  const authorId = await resolveAuthorId(db, address);
  if (!authorId) {
    res.set("Cache-Control", "public, max-age=60");
    return res.json({
      address,
      hasVerifiedClaim: false,
      claimWalletDeployed: false,
      claimWalletAddress: null,
    });
  }

  let row = await db
    .prepare("SELECT wallet_address FROM claim_wallets WHERE author_id = ?")
    .get(authorId) as { wallet_address: string } | undefined;

  if (!row) {
    const factoryAddress = process.env.FACTORY_ADDRESS as `0x${string}` | undefined;
    if (factoryAddress && RPC_URL) {
      try {
        const client = createBackendPublicClient({ url: RPC_URL });
        const deployed = await client.readContract({
          address: factoryAddress,
          abi: [{ name: "isDeployed", type: "function", stateMutability: "view", inputs: [{ name: "_authorId", type: "uint256" }], outputs: [{ type: "bool" }] }],
          functionName: "isDeployed",
          args: [BigInt(authorId)],
        });
        if (deployed) {
          const walletAddr = await client.readContract({
            address: factoryAddress,
            abi: [{ name: "computeClaimWallet", type: "function", stateMutability: "view", inputs: [{ name: "_authorId", type: "uint256" }], outputs: [{ type: "address" }] }],
            functionName: "computeClaimWallet",
            args: [BigInt(authorId)],
          });
          row = { wallet_address: (walletAddr as string).toLowerCase() };
        }
      } catch {
        /* fall through */
      }
    }
  }

  const deployed = !!row;
  const claimWalletAddress = row?.wallet_address ?? null;

  res.set("Cache-Control", "public, max-age=60");
  res.json({
    address,
    hasVerifiedClaim: true,
    claimWalletDeployed: deployed,
    claimWalletAddress: deployed ? claimWalletAddress : null,
  });
});

// ─── GET /wallet/:address/usdc-balance ────────────────────────────────────
// Returns USDC balance of the given wallet (for tippers / tip balance). No claim needed.
router.get("/wallet/:address/usdc-balance", async (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    err(res, 400, "Invalid address");
    return;
  }
  if (!USDC_ADDRESS || !RPC_URL) {
    err(res, 503, "Balance lookup not configured");
    return;
  }
  try {
    const client = createBackendPublicClient({ url: RPC_URL });
    const balanceRaw = await client.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    });
    const rawStr = balanceRaw.toString();
    const usd = (Number(balanceRaw) / 1e6).toFixed(2);
    const settings = await getUserSettings(address);
    const thresholdRaw = BigInt(Math.round(Number(settings.defaultTipAmount) * 1e6));
    if (settings.notifications.lowBalance && thresholdRaw > 0n && balanceRaw < thresholdRaw) {
      await createLowBalanceNotification({ userAddress: address, balanceRaw: rawStr, thresholdUsd: settings.defaultTipAmount });
    }
    res.set("Cache-Control", "public, max-age=15");
    res.json({ address, balanceRaw: rawStr, balanceUsd: usd });
  } catch (e) {
    console.error("[API v1] USDC balance fetch error:", e);
    err(res, 500, "Failed to fetch balance");
  }
});

// ─── GET /wallet/:address/balance ─────────────────────────────────────────
// Returns creator's claim-wallet USDC balance (verified creators only). For tipper balance use /wallet/:address/usdc-balance.
router.get("/wallet/:address/balance", async (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const db = getDb();

  const authorId = await resolveAuthorId(db, address);
  if (!authorId) {
    err(res, 404, "No claim wallet for this address", "NOT_FOUND");
    return;
  }

  const factoryAddress = process.env.FACTORY_ADDRESS as `0x${string}` | undefined;
  let claimWalletAddress: string | null = null;
  if (factoryAddress && RPC_URL) {
    try {
      const client = createBackendPublicClient({ url: RPC_URL });
      const walletAddr = await client.readContract({
        address: factoryAddress,
        abi: [{ name: "computeClaimWallet", type: "function", stateMutability: "view", inputs: [{ name: "_authorId", type: "uint256" }], outputs: [{ type: "address" }] }],
        functionName: "computeClaimWallet",
        args: [BigInt(authorId)],
      });
      claimWalletAddress = (walletAddr as string).toLowerCase();
    } catch {
      claimWalletAddress = null;
    }
  }

  if (!claimWalletAddress) {
    const currentWallet = await db
      .prepare("SELECT wallet_address FROM claim_wallets WHERE author_id = ? AND LOWER(owner_address) = ? LIMIT 1")
      .get(authorId, address) as { wallet_address: string } | undefined;
    claimWalletAddress = currentWallet?.wallet_address?.toLowerCase() || null;
  }
  if (!claimWalletAddress || !/^0x[a-f0-9]{40}$/.test(claimWalletAddress)) {
    err(res, 404, "Current claim wallet not found", "NOT_FOUND");
    return;
  }

  if (!USDC_ADDRESS || !RPC_URL) {
    err(res, 503, "Balance lookup not configured");
    return;
  }

  try {
    const client = createBackendPublicClient({ url: RPC_URL });
    const balanceRaw = await client.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [claimWalletAddress as `0x${string}`],
    });
    const rawStr = balanceRaw.toString();
    const usd = (Number(balanceRaw) / 1e6).toFixed(2);

    res.set("Cache-Control", "public, max-age=30");
    res.json({
      address,
      claimWalletAddress,
      balanceRaw: rawStr,
      balanceUsd: usd,
    });
  } catch (e) {
    console.error("[API v1] Balance fetch error:", e);
    err(res, 500, "Failed to fetch balance");
  }
});

/** Strip HTML tags to get plain text (for tweet excerpt from oEmbed html). */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&mdash;/g, "-")
    .replace(/&nbsp;/g, " ");
}

function stripHtmlExcerpt(html: string, maxLen: number = 200): string {
  const paragraph = html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? html;
  const text = decodeHtmlEntities(paragraph
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}...` : text;
}

function extractOembedImage(html: string): string | null {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1] || null;
}

function oembedFallback(res: Response, url: string, reason: string) {
  res.set("Cache-Control", "public, max-age=60");
  res.json({
    author_name: null,
    author_url: null,
    excerpt: null,
    width: null,
    unavailable: true,
    source_url: url,
    reason,
  });
}

function fetchJsonInsecureDevOnly(url: string, redirectCount = 0): Promise<{ ok: boolean; status: number; json: unknown }> {
  if (!ALLOW_INSECURE_OEMBED_TLS) {
    return fetch(url, { headers: { Accept: "application/json", "User-Agent": "Teep/1.0 (+https://teep.app)" } }).then(async (response) => ({
      ok: response.ok,
      status: response.status,
      json: response.ok ? await response.json() : null,
    }));
  }

  if (!warnedInsecureOembedTls) {
    warnedInsecureOembedTls = true;
    console.warn("[API v1] ALLOW_INSECURE_OEMBED_TLS=true is enabled. X oEmbed TLS verification is disabled for local development only.");
  }

  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: { Accept: "application/json", "User-Agent": "Teep/1.0 (+https://teep.app)" },
        agent: new https.Agent({ rejectUnauthorized: false }),
        timeout: 8000,
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          const status = response.statusCode || 500;
          const location = response.headers.location;
          if ([301, 302, 303, 307, 308].includes(status) && location && redirectCount < 3) {
            const nextUrl = new URL(location, url).toString();
            fetchJsonInsecureDevOnly(nextUrl, redirectCount + 1).then(resolve).catch(reject);
            return;
          }
          try {
            resolve({ ok: status >= 200 && status < 300, status, json: body ? JSON.parse(body) : null });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on("timeout", () => request.destroy(new Error("oEmbed request timed out")));
    request.on("error", reject);
  });
}

/**
 * GET /api/v1/oembed?url=<tweet_url>
 * Proxies Twitter/X oEmbed and returns author_name, author_url, excerpt (plain text from embed html).
 * Tweet URL must be https://x.com/:handle/status/:id or https://twitter.com/...
 */
router.get("/oembed", async (req: Request, res: Response) => {
  const rawUrl = (req.query.url as string) || "";
  const url = rawUrl.trim();
  if (!url) {
    err(res, 400, "url query required");
    return;
  }
  const allowed =
    /^https:\/\/(www\.)?(x\.com|twitter\.com)\/[^/]+\/(status|statuses)\/\d+(\/.*)?$/i.test(url) ||
    /^https:\/\/(www\.)?(x\.com|twitter\.com)\/[^/]+$/i.test(url);
  if (!allowed) {
    err(res, 400, "Invalid tweet URL");
    return;
  }
  try {
    const oembedUrl = `https://publish.x.com/oembed?url=${encodeURIComponent(url)}`;
    const response = await fetchJsonInsecureDevOnly(oembedUrl);
    if (!response.ok) {
      if (response.status === 404) {
        err(res, 404, "Could not fetch tweet embed");
        return;
      }
      oembedFallback(res, url, "embed_unavailable");
      return;
    }
    const data = response.json as {
      author_name?: string;
      author_url?: string;
      html?: string;
      thumbnail_url?: string;
      width?: number;
    };
    const excerpt = data.html ? stripHtmlExcerpt(data.html) : "";
    const imageUrl = data.thumbnail_url || (data.html ? extractOembedImage(data.html) : null);
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      author_name: data.author_name ?? null,
      author_url: data.author_url ?? null,
      excerpt: excerpt || null,
      thumbnail_url: imageUrl,
      width: data.width ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn("[API v1] oEmbed unavailable:", message);
    oembedFallback(res, url, "embed_fetch_failed");
  }
});

router.get("/avatar", async (req: Request, res: Response) => {
  const source = typeof req.query.src === "string" ? req.query.src : "";
  const seed = typeof req.query.seed === "string" ? req.query.seed : "teep";
  if (!source) {
    err(res, 400, "Avatar source is required");
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const avatar = await fetchAvatarUrl(source, controller.signal, false);
    res.set("Cache-Control", avatar ? "public, max-age=86400, stale-while-revalidate=604800" : "public, max-age=3600");
    res.set("X-Content-Type-Options", "nosniff");
    if (!avatar) {
      res.type("image/svg+xml").send(fallbackAvatarSvg(seed));
      return;
    }
    res.type(avatar.contentType).send(avatar.body);
  } catch {
    res.set("Cache-Control", "public, max-age=3600");
    res.type("image/svg+xml").send(fallbackAvatarSvg(seed));
  } finally {
    clearTimeout(timeout);
  }
});

router.get("/avatar/x/:handle", async (req: Request, res: Response) => {
  const handle = normalizeSocialXHandle(req.params.handle);
  if (!handle) {
    err(res, 400, "Invalid X handle");
    return;
  }
  try {
    const avatar = await fetchAvatarBuffer(handle);
    res.set("Cache-Control", avatar ? "public, max-age=86400, stale-while-revalidate=604800" : "public, max-age=3600");
    res.set("X-Content-Type-Options", "nosniff");
    if (!avatar) {
      res.type("image/svg+xml").send(fallbackAvatarSvg(handle));
      return;
    }
    res.type(avatar.contentType).send(avatar.body);
  } catch (error) {
    res.set("Cache-Control", "public, max-age=3600");
    res.type("image/svg+xml").send(fallbackAvatarSvg(handle));
  }
});

export default router;
