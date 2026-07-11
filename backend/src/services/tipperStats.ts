import { getDb } from "../db/database";

type IndexedTipRow = {
  content_id: string;
  author_id: string;
  amount: string;
  tx_hash: string | null;
  timestamp: number;
  author_handle: string | null;
  profile_image_url: string | null;
};

export type UnifiedTipperCreator = {
  authorId: string;
  username: string | null;
  profileImageUrl: string | null;
  totalRaw: string;
  total: string;
  tipCount: number;
  isVerified: boolean;
  claimWalletDeployed: boolean;
  claimStatus: "unclaimed" | "verified" | "claim_wallet_active";
};

export type UnifiedTipperStats = {
  address: string;
  totalSent: string;
  tipCount: number;
  thankYouReceivedCount: number;
  recentTips: Array<{
    contentId: string;
    authorId: string;
    username: string | null;
    amountRaw: string;
    amount: string;
    txHash: string | null;
    timestamp: number;
    claimStatus: "unclaimed" | "verified" | "claim_wallet_active";
  }>;
  creatorsSupported: UnifiedTipperCreator[];
};

function toRawBigInt(value: unknown): bigint {
  try {
    return BigInt(String(value ?? "0"));
  } catch {
    return 0n;
  }
}

function rawToUsdString(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function normalizeUsername(value?: string | null): string | null {
  const normalized = value?.trim().replace(/^@/, "").toLowerCase();
  return normalized || null;
}

function creatorKey(authorId?: string | null, handle?: string | null, fallback?: string | null) {
  if (authorId) return `author:${authorId}`;
  const normalizedHandle = normalizeUsername(handle);
  if (normalizedHandle) return `handle:${normalizedHandle}`;
  return `unknown:${fallback || "creator"}`;
}

function mergeClaimStatus(
  current: UnifiedTipperCreator["claimStatus"],
  next: UnifiedTipperCreator["claimStatus"],
): UnifiedTipperCreator["claimStatus"] {
  if (current === "claim_wallet_active" || next === "claim_wallet_active") return "claim_wallet_active";
  if (current === "verified" || next === "verified") return "verified";
  return "unclaimed";
}

export async function getUnifiedTipperStats(addressParam: string): Promise<UnifiedTipperStats> {
  const address = addressParam.toLowerCase();
  const db = getDb();
  const currentContract = (process.env.TIP_CONTRACT_ADDRESS || "").toLowerCase();

  const indexedTips = (currentContract
    ? await db.prepare(
        `SELECT t.content_id, t.author_id, t.amount, t.tx_hash, t.timestamp,
                m.author_handle
         FROM tips t
         LEFT JOIN tip_metadata m ON t.content_id = m.content_id
         WHERE t.from_address = ? AND LOWER(t.tip_contract_address) = ?
         ORDER BY t.timestamp DESC`
      ).all(address, currentContract)
    : await db.prepare(
        `SELECT t.content_id, t.author_id, t.amount, t.tx_hash, t.timestamp,
                m.author_handle
         FROM tips t
         LEFT JOIN tip_metadata m ON t.content_id = m.content_id
         WHERE t.from_address = ?
         ORDER BY t.timestamp DESC`
      ).all(address)) as IndexedTipRow[];

  const xBotTips = await db.prepare(
    `SELECT
       '' as content_id,
       recipient_x_user_id as author_id,
       amount_raw as amount,
       tx_hash,
       CAST(created_at / 1000 AS INTEGER) as timestamp,
       recipient_x_username as author_handle
     FROM x_bot_tips
     WHERE LOWER(sender_address) = ?
       AND status = 'completed'
     ORDER BY created_at DESC`
  ).all(address) as IndexedTipRow[];

  const seenTipTxHashes = new Set<string>();
  const allSentTips = [...indexedTips, ...xBotTips].filter((tip) => {
    const hash = tip.tx_hash?.toLowerCase();
    if (!hash) return true;
    if (seenTipTxHashes.has(hash)) return false;
    seenTipTxHashes.add(hash);
    return true;
  });

  let totalSent = 0n;
  let tipCount = 0;
  const creators = new Map<string, { authorId: string; username: string | null; profileImageUrl: string | null; totalRaw: bigint; tipCount: number }>();
  const thankYouReceived = await db
    .prepare("SELECT COUNT(*) as count FROM supporter_thank_yous WHERE LOWER(supporter_address) = ?")
    .get(address) as { count: number } | undefined;

  function addCreator(params: { authorId?: string | null; username?: string | null; profileImageUrl?: string | null; handle?: string | null; fallback?: string | null; amount: bigint }) {
    const normalizedHandle = normalizeUsername(params.handle);
    const normalizedUsername = normalizeUsername(params.username) || normalizedHandle;
    const key = creatorKey(params.authorId, normalizedUsername, params.fallback);
    const existing = creators.get(key) || {
      authorId: params.authorId || "",
      username: normalizedUsername,
      profileImageUrl: params.profileImageUrl || null,
      totalRaw: 0n,
      tipCount: 0,
    };
    existing.totalRaw += params.amount;
    existing.tipCount += 1;
    if (!existing.authorId && params.authorId) existing.authorId = params.authorId;
    if (!existing.username && normalizedUsername) existing.username = normalizedUsername;
    if (!existing.profileImageUrl && params.profileImageUrl) existing.profileImageUrl = params.profileImageUrl;
    creators.set(key, existing);
  }

  for (const tip of allSentTips) {
    const amount = toRawBigInt(tip.amount);
    totalSent += amount;
    tipCount += 1;
    addCreator({
      authorId: tip.author_id,
      username: null,
      profileImageUrl: null,
      handle: tip.author_handle,
      fallback: tip.content_id,
      amount,
    });
  }

  const resolvedCreators = Array.from(creators.values())
    .map(async (creator) => {
        const claim = creator.authorId
          ? creator.username
            ? await db.prepare(
                `SELECT author_id, username, profile_image_url
                 FROM verified_claims
                 WHERE author_id = ? OR LOWER(username) = LOWER(?)
                 ORDER BY CASE WHEN author_id = ? THEN 0 ELSE 1 END, verified_at DESC
                 LIMIT 1`
              ).get(creator.authorId, creator.username, creator.authorId) as { author_id?: string; username: string; profile_image_url: string | null } | undefined
            : await db.prepare(
                `SELECT author_id, username, profile_image_url
                 FROM verified_claims
                 WHERE author_id = ?
                 ORDER BY verified_at DESC
                 LIMIT 1`
              ).get(creator.authorId) as { author_id?: string; username: string; profile_image_url: string | null } | undefined
          : creator.username
            ? await db.prepare("SELECT author_id, username, profile_image_url FROM verified_claims WHERE LOWER(username) = ? ORDER BY verified_at DESC LIMIT 1").get(creator.username.toLowerCase()) as { author_id: string; username: string; profile_image_url: string | null } | undefined
            : undefined;
        const authorId = creator.authorId || ("author_id" in (claim || {}) ? (claim as { author_id?: string }).author_id || "" : "");
        const wallet = authorId
          ? await db.prepare("SELECT wallet_address FROM claim_wallets WHERE author_id = ? LIMIT 1").get(authorId) as { wallet_address: string } | undefined
          : undefined;
        const isVerified = Boolean(claim);
        const claimWalletDeployed = Boolean(wallet);
        const claimStatus: UnifiedTipperCreator["claimStatus"] = claimWalletDeployed ? "claim_wallet_active" : isVerified ? "verified" : "unclaimed";
        return {
          authorId,
          username: normalizeUsername(claim?.username) || normalizeUsername(creator.username),
          profileImageUrl: claim?.profile_image_url || creator.profileImageUrl,
          totalRaw: creator.totalRaw.toString(),
          total: rawToUsdString(creator.totalRaw),
          tipCount: creator.tipCount,
          isVerified,
          claimWalletDeployed,
          claimStatus,
        };
      });
  const resolvedCreatorRows = await Promise.all(resolvedCreators);

  const mergedCreators = new Map<string, UnifiedTipperCreator & { raw: bigint }>();
  const aliasToMergedKey = new Map<string, string>();
  for (const creator of resolvedCreatorRows) {
    const normalizedUsername = normalizeUsername(creator.username);
    const mergeKey = normalizedUsername
      ? `handle:${normalizedUsername}`
      : creator.authorId
        ? `author:${creator.authorId}`
        : `unknown:${creator.profileImageUrl || creator.totalRaw}`;
    const raw = toRawBigInt(creator.totalRaw);
    const existing = mergedCreators.get(mergeKey);

    if (!existing) {
      mergedCreators.set(mergeKey, { ...creator, totalRaw: raw.toString(), total: rawToUsdString(raw), raw });
    } else {
      const nextRaw = existing.raw + raw;
      mergedCreators.set(mergeKey, {
        ...existing,
        authorId: existing.authorId || creator.authorId,
        username: existing.username || creator.username,
        profileImageUrl: existing.profileImageUrl || creator.profileImageUrl,
        totalRaw: nextRaw.toString(),
        total: rawToUsdString(nextRaw),
        tipCount: existing.tipCount + creator.tipCount,
        isVerified: existing.isVerified || creator.isVerified,
        claimWalletDeployed: existing.claimWalletDeployed || creator.claimWalletDeployed,
        claimStatus: mergeClaimStatus(existing.claimStatus, creator.claimStatus),
        raw: nextRaw,
      });
    }

    if (creator.authorId) aliasToMergedKey.set(`author:${creator.authorId}`, mergeKey);
    if (normalizedUsername) aliasToMergedKey.set(`handle:${normalizedUsername}`, mergeKey);
  }

  const creatorsSupported = Array.from(mergedCreators.values())
    .sort((a, b) => Number(b.raw - a.raw))
    .slice(0, 20)
    .map(({ raw: _raw, ...creator }) => creator);
  const creatorStatusByKey = new Map<string, UnifiedTipperCreator>();
  for (const [alias, mergeKey] of aliasToMergedKey) {
    const creator = mergedCreators.get(mergeKey);
    if (creator) {
      const { raw: _raw, ...publicCreator } = creator;
      creatorStatusByKey.set(alias, publicCreator);
    }
  }

  return {
    address,
    totalSent: totalSent.toString(),
    tipCount,
    thankYouReceivedCount: Number(thankYouReceived?.count || 0),
    recentTips: allSentTips
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
      .slice(0, 8)
      .map((tip) => {
      const handle = tip.author_handle?.replace(/^@/, "").toLowerCase() || null;
      const creator = (tip.author_id ? creatorStatusByKey.get(`author:${tip.author_id}`) : undefined) || (handle ? creatorStatusByKey.get(`handle:${handle}`) : undefined);
      const amount = toRawBigInt(tip.amount);
      return {
        contentId: tip.content_id,
        authorId: creator?.authorId || tip.author_id || "",
        username: creator?.username || handle,
        amountRaw: amount.toString(),
        amount: rawToUsdString(amount),
        txHash: tip.tx_hash,
        timestamp: tip.timestamp,
        claimStatus: creator?.claimStatus || "unclaimed",
      };
    }),
    creatorsSupported,
  };
}
