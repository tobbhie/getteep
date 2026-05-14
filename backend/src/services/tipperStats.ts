import { getDb } from "../db/database";

type IndexedTipRow = {
  content_id: string;
  author_id: string;
  amount: string;
  tx_hash: string | null;
  timestamp: number;
  author_handle: string | null;
  username: string | null;
};

type ActivityTipRow = {
  amount: string;
  tx_hash: string | null;
  timestamp: number;
  author_handle: string | null;
  tweet_id: string | null;
  to_address: string | null;
};

export type UnifiedTipperCreator = {
  authorId: string;
  username: string | null;
  totalRaw: string;
  total: string;
  tipCount: number;
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
                m.author_handle, vc.username
         FROM tips t
         LEFT JOIN tip_metadata m ON t.content_id = m.content_id
         LEFT JOIN verified_claims vc ON vc.author_id = t.author_id
         WHERE t.from_address = ? AND LOWER(t.tip_contract_address) = ?
         ORDER BY t.timestamp DESC`
      ).all(address, currentContract)
    : db.prepare(
        `SELECT t.content_id, t.author_id, t.amount, t.tx_hash, t.timestamp,
                m.author_handle, vc.username
         FROM tips t
         LEFT JOIN tip_metadata m ON t.content_id = m.content_id
         LEFT JOIN verified_claims vc ON vc.author_id = t.author_id
         WHERE t.from_address = ?
         ORDER BY t.timestamp DESC`
      ).all(address)) as IndexedTipRow[];

  const seenTxHashes = new Set(
    indexedTips
      .map((tip) => tip.tx_hash?.toLowerCase())
      .filter((hash): hash is string => Boolean(hash))
  );

  const activityTips = db.prepare(
    `SELECT amount, tx_hash, timestamp, author_handle, tweet_id, to_address
     FROM user_activity
     WHERE from_address = ? AND type = 'tip_sent'
     ORDER BY timestamp DESC`
  ).all(address) as ActivityTipRow[];

  let totalSent = 0n;
  let tipCount = 0;
  const creators = new Map<string, { authorId: string; username: string | null; totalRaw: bigint; tipCount: number }>();

  function addCreator(params: { authorId?: string | null; username?: string | null; handle?: string | null; fallback?: string | null; amount: bigint }) {
    const normalizedHandle = params.handle?.replace(/^@/, "").toLowerCase() || null;
    const key = creatorKey(params.authorId, params.username || normalizedHandle, params.fallback);
    const existing = creators.get(key) || {
      authorId: params.authorId || "",
      username: params.username || normalizedHandle,
      totalRaw: 0n,
      tipCount: 0,
    };
    existing.totalRaw += params.amount;
    existing.tipCount += 1;
    if (!existing.authorId && params.authorId) existing.authorId = params.authorId;
    if (!existing.username && (params.username || normalizedHandle)) existing.username = params.username || normalizedHandle;
    creators.set(key, existing);
  }

  for (const tip of indexedTips) {
    const amount = toRawBigInt(tip.amount);
    totalSent += amount;
    tipCount += 1;
    addCreator({
      authorId: tip.author_id,
      username: tip.username,
      handle: tip.author_handle,
      fallback: tip.content_id,
      amount,
    });
  }

  const claimByHandle = db.prepare(
    "SELECT author_id, username FROM verified_claims WHERE LOWER(username) = ? ORDER BY verified_at DESC LIMIT 1"
  );
  for (const activity of activityTips) {
    const hash = activity.tx_hash?.toLowerCase();
    if (hash && seenTxHashes.has(hash)) continue;
    const amount = toRawBigInt(activity.amount);
    totalSent += amount;
    tipCount += 1;

    const handle = activity.author_handle?.replace(/^@/, "").toLowerCase() || null;
    const claim = handle ? (claimByHandle.get(handle) as { author_id: string; username: string } | undefined) : undefined;
    addCreator({
      authorId: claim?.author_id || null,
      username: claim?.username || handle,
      handle,
      fallback: activity.to_address || activity.tx_hash,
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
      .map((creator) => ({
        authorId: creator.authorId,
        username: creator.username,
        totalRaw: creator.totalRaw.toString(),
        total: rawToUsdString(creator.totalRaw),
        tipCount: creator.tipCount,
      })),
  };
}
