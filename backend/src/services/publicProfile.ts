import { getDb } from "../db/database";
import { resolveAddressIdentities, type AddressDisplayIdentity } from "./identity";
import { getUserSettings } from "./userSettings";

export type PublicProfilePost = {
  contentId: string;
  total: string;
  count: number;
  tweetId: string | null;
  authorHandle: string | null;
};

export type PublicProfileSupporter = {
  address: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
  isPrivate: boolean;
  total: string;
};

export type PublicProfileRecentTip = {
  address: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
  isPrivate: boolean;
  amount: string;
  timestamp: number;
  txHash: string;
  tweetId: string | null;
  authorHandle: string | null;
};

export type PublicCreatorProfile = {
  username: string;
  displayName: string | null;
  profileImageUrl: string | null;
  authorId: string;
  totalReceived: string;
  tipCount: number;
  supporterCount: number;
  topPosts: PublicProfilePost[];
  privacy: {
    hideSupporterNamesPublicly: boolean;
    hideGrowthActivity: boolean;
  };
  topSupporters: PublicProfileSupporter[];
  recentTips: PublicProfileRecentTip[];
};

type CreatorClaim = {
  author_id: string;
  username: string;
  display_name: string | null;
  profile_image_url: string | null;
  owner_address: string;
};

type SupporterRow = { from_address: string; total: string | number };

type RecentTipRow = {
  from_address: string;
  amount: string | number;
  timestamp: number;
  tx_hash: string;
  tweet_id: string | null;
  author_handle: string | null;
};

function creatorTipPredicate(alias = "t"): string {
  return `(${alias}.author_id = ? OR LOWER(COALESCE(m.author_handle, '')) = LOWER(?))`;
}

function safeBigInt(value: unknown): bigint {
  try {
    return BigInt(String(value ?? "0"));
  } catch {
    return 0n;
  }
}

function rawToDisplay(raw: bigint): string {
  const whole = raw / 1_000_000n;
  const fraction = (raw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function mergeSupporterRows(rows: SupporterRow[], extraRows: SupporterRow[]) {
  const merged = new Map<string, { from_address: string; totalRaw: bigint }>();
  for (const row of [...rows, ...extraRows]) {
    const key = row.from_address.toLowerCase();
    const existing = merged.get(key) ?? { from_address: row.from_address, totalRaw: 0n };
    existing.totalRaw += safeBigInt(row.total);
    merged.set(key, existing);
  }
  return Array.from(merged.values())
    .sort((a, b) => (a.totalRaw === b.totalRaw ? 0 : a.totalRaw > b.totalRaw ? -1 : 1))
    .slice(0, 10)
    .map((row) => ({ from_address: row.from_address, total: row.totalRaw.toString() }));
}

export async function getPublicCreatorProfileByUsername(usernameParam: string): Promise<PublicCreatorProfile | null> {
  const username = usernameParam.replace(/^@/, "").toLowerCase();
  const db = getDb();

  let claim = await db
    .prepare(
      "SELECT author_id, username, display_name, profile_image_url, owner_address FROM verified_claims WHERE LOWER(username) = ?",
    )
    .get(username) as CreatorClaim | undefined;
  if (!claim) {
    const linked = await db
      .prepare(
        `SELECT x_user_id as author_id, x_username as username, user_address as owner_address
         FROM x_accounts
         WHERE LOWER(x_username) = ?
         ORDER BY verified_at DESC
         LIMIT 1`,
      )
      .get(username) as { author_id: string; username: string; owner_address: string } | undefined;
    if (linked) {
      claim = {
        author_id: linked.author_id,
        username: linked.username,
        display_name: null,
        profile_image_url: null,
        owner_address: linked.owner_address,
      };
    }
  }

  if (!claim) return null;

  const indexedTotal = await db
    .prepare(
      `SELECT COALESCE(SUM(CAST(t.amount AS NUMERIC)), 0) as total, COUNT(*) as count
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE ${creatorTipPredicate("t")}`,
    )
    .get(claim.author_id, claim.username) as { total: number; count: number } | undefined;

  const topPosts = await db
    .prepare(
      `SELECT t.content_id, SUM(CAST(t.amount AS NUMERIC)) as total, COUNT(*) as count,
              MAX(m.tweet_id) as tweet_id, MAX(m.author_handle) as author_handle
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE ${creatorTipPredicate("t")}
       GROUP BY t.content_id
       ORDER BY total DESC
       LIMIT 10`,
    )
    .all(claim.author_id, claim.username) as Array<{
    content_id: string;
    total: string;
    count: number;
    tweet_id: string | null;
    author_handle: string | null;
  }>;

  const xBotTotal = await db
    .prepare(
      `SELECT COALESCE(SUM(CAST(xbt.amount_raw AS NUMERIC)), 0) as total, COUNT(*) as count
       FROM x_bot_tips xbt
       WHERE xbt.status = 'completed'
         AND (xbt.recipient_x_user_id = ? OR LOWER(COALESCE(xbt.recipient_x_username, '')) = LOWER(?))
         AND NOT EXISTS (
           SELECT 1 FROM tips t
           WHERE xbt.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(xbt.tx_hash)
         )`,
    )
    .get(claim.author_id, claim.username) as { total: string | number; count: string | number } | undefined;

  const topSupporters = await db
    .prepare(
      `SELECT t.from_address, SUM(CAST(t.amount AS NUMERIC)) as total
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE ${creatorTipPredicate("t")}
       GROUP BY t.from_address
       ORDER BY total DESC
       LIMIT 10`,
    )
    .all(claim.author_id, claim.username) as SupporterRow[];

  const xBotTopSupporters = await db
    .prepare(
      `SELECT xbt.sender_address as from_address, SUM(CAST(xbt.amount_raw AS NUMERIC)) as total
       FROM x_bot_tips xbt
       WHERE xbt.status = 'completed'
         AND (xbt.recipient_x_user_id = ? OR LOWER(COALESCE(xbt.recipient_x_username, '')) = LOWER(?))
         AND NOT EXISTS (
           SELECT 1 FROM tips t
           WHERE xbt.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(xbt.tx_hash)
         )
       GROUP BY xbt.sender_address
       ORDER BY total DESC
       LIMIT 10`,
    )
    .all(claim.author_id, claim.username) as SupporterRow[];

  const mergedTopSupporters = mergeSupporterRows(topSupporters, xBotTopSupporters);

  const recentTips = await db
    .prepare(
      `SELECT t.from_address, t.amount, t.timestamp, t.tx_hash,
              m.tweet_id, m.author_handle
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE ${creatorTipPredicate("t")}
       ORDER BY t.timestamp DESC
       LIMIT 12`,
    )
    .all(claim.author_id, claim.username) as RecentTipRow[];

  const xBotRecentTips = await db
    .prepare(
      `SELECT xbt.sender_address as from_address,
              xbt.amount_raw as amount,
              CAST(xbt.created_at / 1000 AS INTEGER) as timestamp,
              xbt.tx_hash,
              xbt.source_tweet_id as tweet_id,
              xbt.recipient_x_username as author_handle
       FROM x_bot_tips xbt
       WHERE xbt.status = 'completed'
         AND (xbt.recipient_x_user_id = ? OR LOWER(COALESCE(xbt.recipient_x_username, '')) = LOWER(?))
         AND NOT EXISTS (
           SELECT 1 FROM tips t
           WHERE xbt.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(xbt.tx_hash)
         )
       ORDER BY xbt.created_at DESC
       LIMIT 12`,
    )
    .all(claim.author_id, claim.username) as RecentTipRow[];

  const mergedRecentTips = [...recentTips, ...xBotRecentTips]
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
    .slice(0, 12);

  const indexedSupporterAddresses = await db
    .prepare(
      `SELECT DISTINCT LOWER(t.from_address) as address
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE ${creatorTipPredicate("t")}`,
    )
    .all(claim.author_id, claim.username) as Array<{ address: string }>;

  const xBotSupporterAddresses = await db
    .prepare(
      `SELECT DISTINCT LOWER(xbt.sender_address) as address
       FROM x_bot_tips xbt
       WHERE xbt.status = 'completed'
         AND (xbt.recipient_x_user_id = ? OR LOWER(COALESCE(xbt.recipient_x_username, '')) = LOWER(?))
         AND NOT EXISTS (
           SELECT 1 FROM tips t
           WHERE xbt.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(xbt.tx_hash)
         )`,
    )
    .all(claim.author_id, claim.username) as Array<{ address: string }>;

  const creatorSettings = await getUserSettings(claim.owner_address);
  const hideSupporterNames = creatorSettings.privacy.hideSupporterNamesPublicly;
  const supporterIdentities: Map<string, AddressDisplayIdentity> = hideSupporterNames
    ? new Map()
    : await resolveAddressIdentities([
        ...mergedTopSupporters.map((supporter) => supporter.from_address),
        ...mergedRecentTips.map((tip) => tip.from_address),
      ]);
  const totalRaw = safeBigInt(indexedTotal?.total) + safeBigInt(xBotTotal?.total);
  const tipCount = Number(indexedTotal?.count || 0) + Number(xBotTotal?.count || 0);
  const supporterCount = new Set([
    ...indexedSupporterAddresses.map((row) => row.address),
    ...xBotSupporterAddresses.map((row) => row.address),
  ]).size;

  return {
    username: claim.username,
    displayName: claim.display_name,
    profileImageUrl: claim.profile_image_url,
    authorId: claim.author_id,
    totalReceived: totalRaw.toString(),
    tipCount,
    supporterCount,
    topPosts: topPosts.map((post) => ({
      contentId: post.content_id,
      total: (Number(post.total) / 1e6).toString(),
      count: Number(post.count),
      tweetId: post.tweet_id,
      authorHandle: post.author_handle,
    })),
    privacy: {
      hideSupporterNamesPublicly: hideSupporterNames,
      hideGrowthActivity: creatorSettings.privacy.hideGrowthActivity,
    },
    topSupporters: mergedTopSupporters.map((supporter, index) => ({
      address: hideSupporterNames ? null : supporter.from_address,
      displayName: hideSupporterNames
        ? `Private supporter ${index + 1}`
        : supporterIdentities.get(supporter.from_address.toLowerCase())?.displayName || null,
      profileImageUrl: hideSupporterNames
        ? null
        : supporterIdentities.get(supporter.from_address.toLowerCase())?.profileImageUrl || null,
      isPrivate: hideSupporterNames,
      total: rawToDisplay(safeBigInt(supporter.total)),
    })),
    recentTips: mergedRecentTips.map((tip, index) => {
      const identity = hideSupporterNames ? null : supporterIdentities.get(tip.from_address.toLowerCase());
      return {
        address: hideSupporterNames ? null : tip.from_address,
        displayName: hideSupporterNames ? `Private supporter ${index + 1}` : identity?.displayName || null,
        profileImageUrl: hideSupporterNames ? null : identity?.profileImageUrl || null,
        isPrivate: hideSupporterNames,
        amount: rawToDisplay(safeBigInt(tip.amount)),
        timestamp: tip.timestamp,
        txHash: tip.tx_hash,
        tweetId: tip.tweet_id,
        authorHandle: tip.author_handle,
      };
    }),
  };
}
