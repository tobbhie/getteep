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

function creatorKey(authorId?: string | null, handle?: string | null, fallback?: string | null) {
  if (authorId) return `author:${authorId}`;
  if (handle) return `handle:${handle.toLowerCase().replace(/^@/, "")}`;
  return `unknown:${fallback || "creator"}`;
}

export function getUnifiedTipperStats(addressParam: string): UnifiedTipperStats {
  const address = addressParam.toLowerCase();
  const db = getDb();
  const currentContract = (process.env.TIP_CONTRACT_ADDRESS || "").toLowerCase();

  const indexedTips = (currentContract
    ? db.prepare(
        `SELECT t.content_id, t.author_id, t.amount, t.tx_hash, t.timestamp,
                m.author_handle
         FROM tips t
         LEFT JOIN tip_metadata m ON t.content_id = m.content_id
         WHERE t.from_address = ? AND LOWER(t.tip_contract_address) = ?
         ORDER BY t.timestamp DESC`
      ).all(address, currentContract)
    : db.prepare(
        `SELECT t.content_id, t.author_id, t.amount, t.tx_hash, t.timestamp,
                m.author_handle
         FROM tips t
         LEFT JOIN tip_metadata m ON t.content_id = m.content_id
         WHERE t.from_address = ?
         ORDER BY t.timestamp DESC`
      ).all(address)) as IndexedTipRow[];

  let totalSent = 0n;
  let tipCount = 0;
  const creators = new Map<string, { authorId: string; username: string | null; profileImageUrl: string | null; totalRaw: bigint; tipCount: number }>();

  function addCreator(params: { authorId?: string | null; username?: string | null; profileImageUrl?: string | null; handle?: string | null; fallback?: string | null; amount: bigint }) {
    const normalizedHandle = params.handle?.replace(/^@/, "").toLowerCase() || null;
    const key = creatorKey(params.authorId, params.username || normalizedHandle, params.fallback);
    const existing = creators.get(key) || {
      authorId: params.authorId || "",
      username: params.username || normalizedHandle,
      profileImageUrl: params.profileImageUrl || null,
      totalRaw: 0n,
      tipCount: 0,
    };
    existing.totalRaw += params.amount;
    existing.tipCount += 1;
    if (!existing.authorId && params.authorId) existing.authorId = params.authorId;
    if (!existing.username && (params.username || normalizedHandle)) existing.username = params.username || normalizedHandle;
    if (!existing.profileImageUrl && params.profileImageUrl) existing.profileImageUrl = params.profileImageUrl;
    creators.set(key, existing);
  }

  for (const tip of indexedTips) {
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

  return {
    address,
    totalSent: totalSent.toString(),
    tipCount,
    creatorsSupported: Array.from(creators.values())
      .sort((a, b) => Number(b.totalRaw - a.totalRaw))
      .slice(0, 20)
      .map((creator) => {
        const claim = creator.authorId
          ? db.prepare(
              `SELECT author_id, username, profile_image_url
               FROM verified_claims
               WHERE author_id = ? OR (? IS NOT NULL AND LOWER(username) = LOWER(?))
               ORDER BY verified_at DESC
               LIMIT 1`
            ).get(creator.authorId, creator.username, creator.username) as { author_id?: string; username: string; profile_image_url: string | null } | undefined
          : creator.username
            ? db.prepare("SELECT author_id, username, profile_image_url FROM verified_claims WHERE LOWER(username) = ? ORDER BY verified_at DESC LIMIT 1").get(creator.username.toLowerCase()) as { author_id: string; username: string; profile_image_url: string | null } | undefined
            : undefined;
        const authorId = creator.authorId || ("author_id" in (claim || {}) ? (claim as { author_id?: string }).author_id || "" : "");
        const wallet = authorId
          ? db.prepare("SELECT wallet_address FROM claim_wallets WHERE author_id = ? LIMIT 1").get(authorId) as { wallet_address: string } | undefined
          : undefined;
        const isVerified = Boolean(claim);
        const claimWalletDeployed = Boolean(wallet);
        return {
          authorId,
          username: claim?.username || creator.username,
          profileImageUrl: claim?.profile_image_url || creator.profileImageUrl,
          totalRaw: creator.totalRaw.toString(),
          total: rawToUsdString(creator.totalRaw),
          tipCount: creator.tipCount,
          isVerified,
          claimWalletDeployed,
          claimStatus: claimWalletDeployed ? "claim_wallet_active" : isVerified ? "verified" : "unclaimed",
        };
      }),
  };
}
