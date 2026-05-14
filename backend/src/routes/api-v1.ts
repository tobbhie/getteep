import { Router, Request, Response } from "express";
import { getDb } from "../db/database";
import { keccak256, toBytes } from "viem";
import { createPublicClient, http } from "viem";
import { ARC_TESTNET_USDC, getConfiguredChain, getRpcUrl } from "../config/chain";
import { getUnifiedTipperStats } from "../services/tipperStats";

const router = Router();

const CHAIN = getConfiguredChain();
const RPC_URL = getRpcUrl();
const USDC_ADDRESS = (process.env.MOCK_USDC_ADDRESS || process.env.USDC_ADDRESS || ARC_TESTNET_USDC) as `0x${string}`;

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

/** On-chain authorId = keccak256(handle). Legacy DB may have X profile.id (19 digits). */
function resolveAuthorId(db: ReturnType<typeof getDb>, ownerAddress: string): string | null {
  const claim = db
    .prepare("SELECT author_id, username FROM verified_claims WHERE owner_address = ? LIMIT 1")
    .get(ownerAddress) as { author_id: string; username: string } | undefined;
  if (!claim) return null;
  if (claim.author_id.length >= 50) return claim.author_id; // Already correct (keccak256 decimal)
  const correct = BigInt(keccak256(toBytes(claim.username.toLowerCase()))).toString();
  try {
    db.prepare("UPDATE verified_claims SET author_id = ? WHERE owner_address = ?").run(correct, ownerAddress);
  } catch {
    /* ignore */
  }
  return correct;
}

/** Standard error response */
function err(res: Response, status: number, message: string, code?: string) {
  res.status(status).json({ error: message, ...(code && { code }) });
}

// ─── GET /posts/:handle/:tweetId ─────────────────────────────────────────
router.get("/posts/:handle/:tweetId", (req: Request, res: Response) => {
  const handle = String(req.params.handle || "").replace(/^@/, "");
  const tweetId = String(req.params.tweetId || "");
  if (!handle || !tweetId) {
    err(res, 400, "handle and tweetId required");
    return;
  }
  const contentId = contentIdFromPost(handle, tweetId);
  const db = getDb();

  const total = db
    .prepare(
      "SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total, COUNT(*) as count FROM tips WHERE content_id = ?"
    )
    .get(contentId) as { total: number; count: number } | undefined;

  const recentTips = db
    .prepare(
      "SELECT from_address, amount, tx_hash, timestamp FROM tips WHERE content_id = ? ORDER BY block_number DESC LIMIT 20"
    )
    .all(contentId) as Array<{ from_address: string; amount: string; tx_hash: string; timestamp: number }>;

  res.set("Cache-Control", "public, max-age=30");
  res.json({
    contentId,
    handle,
    tweetId,
    totalAmountUsd: ((total?.total ?? 0) / 1e6).toFixed(2),
    tipCount: total?.count ?? 0,
    recentTips: recentTips.map((t) => ({
      fromAddress: t.from_address,
      amountUsd: (Number(t.amount) / 1e6).toFixed(2),
      txHash: t.tx_hash,
      timestamp: t.timestamp,
    })),
  });
});

// ─── GET /creators/:username ─────────────────────────────────────────────
router.get("/creators/:username", (req: Request, res: Response) => {
  const username = (req.params.username as string).replace(/^@/, "").toLowerCase();
  const db = getDb();

  const claim = db
    .prepare("SELECT author_id, username, display_name, profile_image_url FROM verified_claims WHERE LOWER(username) = ?")
    .get(username) as { author_id: string; username: string; display_name: string | null; profile_image_url: string | null } | undefined;

  if (!claim) {
    err(res, 404, "Creator not found or not verified", "NOT_FOUND");
    return;
  }

  const total = db
    .prepare("SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total, COUNT(*) as count FROM tips WHERE author_id = ?")
    .get(claim.author_id) as { total: number; count: number } | undefined;

  const topPosts = db
    .prepare(
      `SELECT t.content_id, SUM(CAST(t.amount AS REAL)) as total, COUNT(*) as count, m.tweet_id, m.author_handle
       FROM tips t LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE t.author_id = ? GROUP BY t.content_id ORDER BY total DESC LIMIT 10`
    )
    .all(claim.author_id) as Array<{
      content_id: string;
      total: number;
      count: number;
      tweet_id: string | null;
      author_handle: string | null;
    }>;

  const topSupporters = db
    .prepare(
      "SELECT from_address, SUM(CAST(amount AS REAL)) as total FROM tips WHERE author_id = ? GROUP BY from_address ORDER BY total DESC LIMIT 10"
    )
    .all(claim.author_id) as Array<{ from_address: string; total: number }>;

  res.set("Cache-Control", "public, max-age=60");
  res.json({
    username: claim.username,
    displayName: claim.display_name,
    profileImageUrl: claim.profile_image_url,
    authorId: claim.author_id,
    totalReceivedUsd: ((total?.total ?? 0) / 1e6).toFixed(2),
    tipCount: total?.count ?? 0,
    topPosts: topPosts.map((p) => ({
      contentId: p.content_id,
      totalUsd: (p.total / 1e6).toFixed(2),
      count: p.count,
      tweetId: p.tweet_id,
      authorHandle: p.author_handle,
    })),
    topSupporters: topSupporters.map((s) => ({
      address: s.from_address,
      totalUsd: (s.total / 1e6).toFixed(2),
    })),
  });
});

// ─── GET /creators/:username/earnings-over-time ───────────────────────────
router.get("/creators/:username/earnings-over-time", (req: Request, res: Response) => {
  const username = (req.params.username as string).replace(/^@/, "").toLowerCase();
  const days = Math.min(parseInt(req.query.days as string) || 30, 90);
  const db = getDb();

  const claim = db
    .prepare("SELECT author_id FROM verified_claims WHERE LOWER(username) = ?")
    .get(username) as { author_id: string } | undefined;

  if (!claim) {
    err(res, 404, "Creator not found or not verified", "NOT_FOUND");
    return;
  }

  const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  const rows = db
    .prepare(
      `SELECT date(timestamp, 'unixepoch') as day, SUM(CAST(amount AS REAL)) as total
       FROM tips WHERE author_id = ? AND timestamp >= ?
       GROUP BY day ORDER BY day ASC`
    )
    .all(claim.author_id, since) as Array<{ day: string; total: number }>;

  res.set("Cache-Control", "public, max-age=60");
  res.json({
    daily: rows.map((r) => ({
      date: r.day,
      amountRaw: r.total.toString(),
      amountUsd: (r.total / 1e6).toFixed(2),
    })),
  });
});

// ─── GET /tippers/:address ───────────────────────────────────────────────
router.get("/tippers/:address", (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const stats = getUnifiedTipperStats(address);

  res.set("Cache-Control", "public, max-age=60");
  res.json({
    address,
    totalSentUsd: (Number(stats.totalSent) / 1e6).toFixed(2),
    totalSent: stats.totalSent,
    tipCount: stats.tipCount,
    creatorsSupported: stats.creatorsSupported.map((c) => ({
      authorId: c.authorId,
      username: c.username,
      totalUsd: (Number(c.totalRaw) / 1e6).toFixed(2),
      totalRaw: c.totalRaw,
      tipCount: c.tipCount,
    })),
  });
});

// ─── GET /stats ──────────────────────────────────────────────────────────
router.get("/stats", (req: Request, res: Response) => {
  const db = getDb();
  const tipsAgg = db.prepare(
    `SELECT COUNT(*) as total_tips, COALESCE(SUM(CAST(amount AS REAL)), 0) as total_volume, COUNT(DISTINCT from_address) as distinct_tippers FROM tips`
  ).get() as { total_tips: number; total_volume: number; distinct_tippers: number };
  const creatorsCount = db.prepare("SELECT COUNT(DISTINCT author_id) as count FROM verified_claims").get() as { count: number };

  res.set("Cache-Control", "public, max-age=60");
  res.json({
    totalTips: tipsAgg.total_tips,
    totalVolumeUsd: (tipsAgg.total_volume / 1e6).toFixed(2),
    distinctTippers: tipsAgg.distinct_tippers,
    verifiedCreators: creatorsCount.count,
  });
});

// ─── GET /leaderboard/creators ────────────────────────────────────────────
router.get("/leaderboard/creators", (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const period = req.query.period as string;
  const since = period === "30d" ? Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60 : null;
  const db = getDb();

  const whereClause =
    since != null
      ? "WHERE t.author_id IN (SELECT author_id FROM verified_claims) AND t.timestamp >= ?"
      : "WHERE t.author_id IN (SELECT author_id FROM verified_claims)";
  const args = since != null ? [since, limit] : [limit];

  const rows = db
    .prepare(
      `SELECT t.author_id, SUM(CAST(t.amount AS REAL)) as total FROM tips t ${whereClause} GROUP BY t.author_id ORDER BY total DESC LIMIT ?`
    )
    .all(...args) as Array<{ author_id: string; total: number }>;

  const authorIds = rows.map((r) => r.author_id);
  const claims =
    authorIds.length > 0
      ? (db
          .prepare("SELECT author_id, username, display_name FROM verified_claims WHERE author_id IN (" + authorIds.map(() => "?").join(",") + ")")
          .all(...authorIds) as Array<{ author_id: string; username: string; display_name: string | null }>)
      : [];
  const byAuthor = Object.fromEntries(claims.map((c) => [c.author_id, { username: c.username, displayName: c.display_name }]));

  const creators = rows.map((r, i) => ({
    rank: i + 1,
    authorId: r.author_id,
    username: byAuthor[r.author_id]?.username ?? null,
    displayName: byAuthor[r.author_id]?.displayName ?? null,
    totalReceivedUsd: (r.total / 1e6).toFixed(2),
  }));

  res.set("Cache-Control", "public, max-age=60");
  res.json({ creators });
});

// ─── GET /leaderboard/tippers ─────────────────────────────────────────────
router.get("/leaderboard/tippers", (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const period = req.query.period as string;
  const since = period === "30d" ? Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60 : null;
  const db = getDb();

  const whereClause = since != null ? "WHERE timestamp >= ?" : "";
  const args = since != null ? [since, limit] : [limit];

  const rows = db
    .prepare(
      `SELECT from_address, SUM(CAST(amount AS REAL)) as total FROM tips ${whereClause} GROUP BY from_address ORDER BY total DESC LIMIT ?`
    )
    .all(...args) as Array<{ from_address: string; total: number }>;

  const tippers = rows.map((r, i) => ({
    rank: i + 1,
    address: r.from_address,
    totalSentUsd: (r.total / 1e6).toFixed(2),
  }));

  res.set("Cache-Control", "public, max-age=60");
  res.json({ tippers });
});

// ─── GET /wallet/:address/eligibility ────────────────────────────────────
router.get("/wallet/:address/eligibility", async (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  const db = getDb();

  const authorId = resolveAuthorId(db, address);
  if (!authorId) {
    res.set("Cache-Control", "public, max-age=60");
    return res.json({
      address,
      hasVerifiedClaim: false,
      claimWalletDeployed: false,
      claimWalletAddress: null,
    });
  }

  let row = db
    .prepare("SELECT wallet_address FROM claim_wallets WHERE author_id = ?")
    .get(authorId) as { wallet_address: string } | undefined;

  if (!row) {
    const factoryAddress = process.env.FACTORY_ADDRESS as `0x${string}` | undefined;
    if (factoryAddress && RPC_URL) {
      try {
        const client = createPublicClient({
          chain: CHAIN,
          transport: http(RPC_URL),
        });
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
    const client = createPublicClient({
      chain: CHAIN,
      transport: http(RPC_URL),
    });
    const balanceRaw = await client.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    });
    const rawStr = balanceRaw.toString();
    const usd = (Number(balanceRaw) / 1e6).toFixed(2);
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

  const authorId = resolveAuthorId(db, address);
  if (!authorId) {
    err(res, 404, "No claim wallet for this address", "NOT_FOUND");
    return;
  }

  let claimWalletAddress: string;
  const row = db
    .prepare("SELECT wallet_address FROM claim_wallets WHERE author_id = ?")
    .get(authorId) as { wallet_address: string } | undefined;

  if (row) {
    claimWalletAddress = row.wallet_address;
  } else {
    // Indexer may not have it; try chain
    const factoryAddress = process.env.FACTORY_ADDRESS as `0x${string}` | undefined;
    if (!factoryAddress || !RPC_URL) {
      err(res, 404, "Claim wallet not found", "NOT_FOUND");
      return;
    }
    try {
      const client = createPublicClient({
        chain: CHAIN,
        transport: http(RPC_URL),
      });
      const isDeployed = await client.readContract({
        address: factoryAddress,
        abi: [{ name: "isDeployed", type: "function", stateMutability: "view", inputs: [{ name: "_authorId", type: "uint256" }], outputs: [{ type: "bool" }] }],
        functionName: "isDeployed",
        args: [BigInt(authorId)],
      });
      if (!isDeployed) {
        err(res, 404, "Claim wallet not deployed", "NOT_FOUND");
        return;
      }
      const walletAddr = await client.readContract({
        address: factoryAddress,
        abi: [{ name: "computeClaimWallet", type: "function", stateMutability: "view", inputs: [{ name: "_authorId", type: "uint256" }], outputs: [{ type: "address" }] }],
        functionName: "computeClaimWallet",
        args: [BigInt(authorId)],
      });
      claimWalletAddress = (walletAddr as string).toLowerCase();
    } catch {
      err(res, 404, "Claim wallet not found", "NOT_FOUND");
      return;
    }
  }

  if (!USDC_ADDRESS || !RPC_URL) {
    err(res, 503, "Balance lookup not configured");
    return;
  }

  try {
    const client = createPublicClient({
      chain: CHAIN,
      transport: http(RPC_URL),
    });
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
function stripHtmlExcerpt(html: string, maxLen: number = 200): string {
  const text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
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
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}`;
    const response = await fetch(oembedUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      err(res, response.status === 404 ? 404 : 502, "Could not fetch tweet embed");
      return;
    }
    const data = (await response.json()) as {
      author_name?: string;
      author_url?: string;
      html?: string;
      width?: number;
    };
    const excerpt = data.html ? stripHtmlExcerpt(data.html) : "";
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      author_name: data.author_name ?? null,
      author_url: data.author_url ?? null,
      excerpt: excerpt || null,
      width: data.width ?? null,
    });
  } catch (e) {
    console.error("[API v1] oEmbed fetch error:", e);
    err(res, 500, "Failed to fetch tweet embed");
  }
});

export default router;
