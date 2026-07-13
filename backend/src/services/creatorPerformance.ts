import { getDb } from "../db/database";
import { resolveAddressIdentities } from "./identity";

type Period = "7d" | "30d" | "90d" | "all";

type CreatorClaim = {
  author_id: string;
  username: string;
  display_name: string | null;
  profile_image_url: string | null;
};

type TipRow = {
  content_id: string;
  author_id: string;
  from_address: string;
  to_address: string;
  amount: string;
  tx_hash: string;
  block_number: number;
  log_index: number;
  timestamp: number;
  author_handle: string | null;
  tweet_id: string | null;
  kind: string | null;
};

type SupporterAggregate = {
  address: string;
  totalRaw: bigint;
  tipCount: number;
  lastTipAt: number;
};

type PostAggregate = {
  contentId: string;
  tweetId: string | null;
  authorHandle: string | null;
  totalRaw: bigint;
  tipCount: number;
  uniqueSupporters: Set<string>;
  lastTipAt: number;
  firstTipAt: number;
  hasOembedCandidate: boolean;
};

export type CreatorPerformanceResult = Awaited<ReturnType<typeof getCreatorPerformance>>;

const DAY_SECONDS = 24 * 60 * 60;

function normalizeCreatorIdentifier(value: string) {
  const raw = value.trim();
  return {
    authorId: raw,
    username: raw.replace(/^@/, "").toLowerCase(),
  };
}

function safeBigInt(value: unknown): bigint {
  try {
    return BigInt(String(value ?? "0"));
  } catch {
    return 0n;
  }
}

function rawToUsd(raw: bigint) {
  const sign = raw < 0n ? "-" : "";
  const abs = raw < 0n ? -raw : raw;
  const whole = abs / 1_000_000n;
  const fraction = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${sign}${whole}.${fraction}`;
}

function addRaw(values: Iterable<bigint>) {
  let total = 0n;
  for (const value of values) total += value;
  return total;
}

function compareRawDesc(a: bigint, b: bigint) {
  if (a === b) return 0;
  return a > b ? -1 : 1;
}

function periodToDays(period: Period) {
  if (period === "7d") return 7;
  if (period === "90d") return 90;
  if (period === "all") return null;
  return 30;
}

function parsePeriod(value: unknown): Period {
  if (value === "7d" || value === "30d" || value === "90d" || value === "all") return value;
  return "30d";
}

function parseUnixDay(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}T23:59:59.999Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function dayKey(timestamp: number) {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function xPostUrl(authorHandle: string | null, tweetId: string | null) {
  if (!authorHandle || !tweetId) return null;
  return `https://x.com/${authorHandle.replace(/^@/, "")}/status/${tweetId}`;
}

function isDirectTip(row: TipRow) {
  return row.kind === "direct_creator_tip" || !row.tweet_id;
}

function previousWindow(startAt: number | null, endAt: number, days: number | null) {
  if (startAt == null || days == null) return null;
  const previousEndAt = startAt - 1;
  return {
    startAt: previousEndAt - days * DAY_SECONDS + 1,
    endAt: previousEndAt,
  };
}

function filterRows(rows: TipRow[], startAt: number | null, endAt: number) {
  return rows.filter((row) => row.timestamp <= endAt && (startAt == null || row.timestamp >= startAt));
}

function summarizeRows(rows: TipRow[]) {
  const totalRaw = addRaw(rows.map((row) => safeBigInt(row.amount)));
  const supporters = new Map<string, number>();
  const postIds = new Set<string>();
  let directTipCount = 0;
  let postTipCount = 0;

  for (const row of rows) {
    const supporter = row.from_address.toLowerCase();
    supporters.set(supporter, (supporters.get(supporter) ?? 0) + 1);
    if (isDirectTip(row)) {
      directTipCount += 1;
    } else {
      postTipCount += 1;
      postIds.add(row.content_id);
    }
  }

  const repeatSupporterCount = Array.from(supporters.values()).filter((count) => count > 1).length;
  const averageRaw = rows.length > 0 ? totalRaw / BigInt(rows.length) : 0n;

  return {
    totalRaw,
    totalUsd: rawToUsd(totalRaw),
    tipCount: rows.length,
    postTipCount,
    directTipCount,
    uniqueSupporterCount: supporters.size,
    repeatSupporterCount,
    supportedPostCount: postIds.size,
    averageTipRaw: averageRaw.toString(),
    averageTipUsd: rawToUsd(averageRaw),
  };
}

function deltaPercent(currentRaw: bigint, previousRaw: bigint) {
  if (previousRaw === 0n) return null;
  const scaled = Number((currentRaw - previousRaw) * 10_000n / previousRaw) / 100;
  return Number.isFinite(scaled) ? scaled : null;
}

export async function getCreatorPerformance(
  usernameParam: string,
  options: { period?: unknown; endDate?: unknown; recentPage?: unknown; recentLimit?: unknown } = {},
) {
  const identifier = normalizeCreatorIdentifier(usernameParam);
  const period = parsePeriod(options.period);
  const days = periodToDays(period);
  const requestedRecentPage = Math.max(1, Number(options.recentPage || 1) || 1);
  const recentLimit = Math.min(50, Math.max(1, Number(options.recentLimit || 7) || 7));
  const endAt = parseUnixDay(options.endDate) ?? Math.floor(Date.now() / 1000);
  const startAt = days == null ? null : endAt - days * DAY_SECONDS + 1;
  const previous = previousWindow(startAt, endAt, days);
  const db = getDb();

  let claim = await db
    .prepare(
      `SELECT author_id, username, display_name, profile_image_url
       FROM verified_claims
       WHERE author_id = ? OR LOWER(username) = ?
       ORDER BY verified_at DESC
       LIMIT 1`
    )
    .get(identifier.authorId, identifier.username) as CreatorClaim | undefined;
  if (!claim) {
    const linked = await db
      .prepare(
        `SELECT x_user_id as author_id, x_username as username
         FROM x_accounts
         WHERE x_user_id = ? OR LOWER(x_username) = ?
         ORDER BY verified_at DESC
         LIMIT 1`
      )
      .get(identifier.authorId, identifier.username) as { author_id: string; username: string } | undefined;
    if (linked) {
      claim = {
        author_id: linked.author_id,
        username: linked.username,
        display_name: null,
        profile_image_url: null,
      };
    }
  }

  if (!claim) return null;

  const indexedRows = await db
    .prepare(
      `SELECT t.content_id, t.author_id, t.from_address, t.to_address, t.amount, t.tx_hash,
              t.block_number, t.log_index, t.timestamp,
              m.author_handle, m.tweet_id, m.kind
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE (t.author_id = ? OR LOWER(COALESCE(m.author_handle, '')) = LOWER(?))
      ORDER BY t.timestamp DESC, t.block_number DESC, t.log_index DESC`
    )
    .all(claim.author_id, claim.username) as TipRow[];

  const xBotRows = await db
    .prepare(
      `SELECT
          COALESCE(xbt.content_id, xbt.source_tweet_id) as content_id,
          xbt.recipient_x_user_id as author_id,
          xbt.sender_address as from_address,
          xbt.recipient_address as to_address,
          xbt.amount_raw as amount,
          xbt.tx_hash,
          0 as block_number,
          0 as log_index,
          CAST(xbt.created_at / 1000 AS INTEGER) as timestamp,
          CASE
            WHEN COALESCE(xbt.tip_kind, 'direct_creator_tip') = 'post_tip'
              THEN COALESCE(xbt.context_author_username, xbt.recipient_x_username)
            ELSE xbt.recipient_x_username
          END as author_handle,
          COALESCE(xbt.context_tweet_id, xbt.source_tweet_id) as tweet_id,
          COALESCE(xbt.tip_kind, 'direct_creator_tip') as kind
       FROM x_bot_tips xbt
       WHERE xbt.status = 'completed'
         AND (xbt.recipient_x_user_id = ? OR LOWER(COALESCE(xbt.recipient_x_username, '')) = LOWER(?))
         AND NOT EXISTS (
           SELECT 1 FROM tips t
           WHERE xbt.tx_hash IS NOT NULL AND LOWER(t.tx_hash) = LOWER(xbt.tx_hash)
         )
       ORDER BY xbt.created_at DESC`
    )
    .all(claim.author_id, claim.username) as TipRow[];

  const allRows = [...indexedRows, ...xBotRows]
    .sort((a, b) => {
      if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
      if (b.block_number !== a.block_number) return b.block_number - a.block_number;
      return b.log_index - a.log_index;
    });

  const currentRows = filterRows(allRows, startAt, endAt);
  const previousRows = previous ? filterRows(allRows, previous.startAt, previous.endAt) : [];
  const allTimeSummary = summarizeRows(allRows);
  const currentSummary = summarizeRows(currentRows);
  const previousSummary = summarizeRows(previousRows);

  const supporters = new Map<string, SupporterAggregate>();
  const posts = new Map<string, PostAggregate>();
  const daily = new Map<string, { totalRaw: bigint; tipCount: number; postTipCount: number; directTipCount: number }>();
  let postTipsRaw = 0n;
  let directTipsRaw = 0n;

  for (const row of currentRows) {
    const amount = safeBigInt(row.amount);
    const supporterAddress = row.from_address.toLowerCase();
    const supporter = supporters.get(supporterAddress) ?? { address: supporterAddress, totalRaw: 0n, tipCount: 0, lastTipAt: 0 };
    supporter.totalRaw += amount;
    supporter.tipCount += 1;
    supporter.lastTipAt = Math.max(supporter.lastTipAt, row.timestamp);
    supporters.set(supporterAddress, supporter);

    const key = dayKey(row.timestamp);
    const day = daily.get(key) ?? { totalRaw: 0n, tipCount: 0, postTipCount: 0, directTipCount: 0 };
    day.totalRaw += amount;
    day.tipCount += 1;

    if (isDirectTip(row)) {
      directTipsRaw += amount;
      day.directTipCount += 1;
    } else {
      postTipsRaw += amount;
      day.postTipCount += 1;
      const post = posts.get(row.content_id) ?? {
        contentId: row.content_id,
        tweetId: row.tweet_id,
        authorHandle: row.author_handle,
        totalRaw: 0n,
        tipCount: 0,
        uniqueSupporters: new Set<string>(),
        lastTipAt: 0,
        firstTipAt: row.timestamp,
        hasOembedCandidate: Boolean(row.author_handle && row.tweet_id),
      };
      post.totalRaw += amount;
      post.tipCount += 1;
      post.uniqueSupporters.add(supporterAddress);
      post.lastTipAt = Math.max(post.lastTipAt, row.timestamp);
      post.firstTipAt = Math.min(post.firstTipAt, row.timestamp);
      post.tweetId ||= row.tweet_id;
      post.authorHandle ||= row.author_handle;
      post.hasOembedCandidate ||= Boolean(row.author_handle && row.tweet_id);
      posts.set(row.content_id, post);
    }

    daily.set(key, day);
  }

  const dailySeries = days == null
    ? Array.from(daily.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, value]) => ({
          date,
          totalRaw: value.totalRaw.toString(),
          totalUsd: rawToUsd(value.totalRaw),
          tipCount: value.tipCount,
          postTipCount: value.postTipCount,
          directTipCount: value.directTipCount,
        }))
    : Array.from({ length: days }, (_, index) => {
        const date = new Date((endAt - (days - 1 - index) * DAY_SECONDS) * 1000).toISOString().slice(0, 10);
        const value = daily.get(date) ?? { totalRaw: 0n, tipCount: 0, postTipCount: 0, directTipCount: 0 };
        return {
          date,
          totalRaw: value.totalRaw.toString(),
          totalUsd: rawToUsd(value.totalRaw),
          tipCount: value.tipCount,
          postTipCount: value.postTipCount,
          directTipCount: value.directTipCount,
        };
      });

  const topPosts = Array.from(posts.values())
    .sort((a, b) => {
      const byTotal = compareRawDesc(a.totalRaw, b.totalRaw);
      if (byTotal !== 0) return byTotal;
      if (b.tipCount !== a.tipCount) return b.tipCount - a.tipCount;
      return b.lastTipAt - a.lastTipAt;
    })
    .slice(0, 7)
    .map((post) => ({
      contentId: post.contentId,
      tweetId: post.tweetId,
      authorHandle: post.authorHandle,
      xUrl: xPostUrl(post.authorHandle, post.tweetId),
      totalRaw: post.totalRaw.toString(),
      totalUsd: rawToUsd(post.totalRaw),
      tipCount: post.tipCount,
      uniqueSupporterCount: post.uniqueSupporters.size,
      firstTipAt: post.firstTipAt,
      lastTipAt: post.lastTipAt,
      hasOembedCandidate: post.hasOembedCandidate,
      thumbnailSource: post.hasOembedCandidate ? "oembed_candidate" : "fallback",
      receiptAvailable: true,
    }));

  const supporterList = Array.from(supporters.values()).sort((a, b) => {
    const byTotal = compareRawDesc(a.totalRaw, b.totalRaw);
    if (byTotal !== 0) return byTotal;
    if (b.tipCount !== a.tipCount) return b.tipCount - a.tipCount;
    return b.lastTipAt - a.lastTipAt;
  });

  const supporterIdentityByAddress = await resolveAddressIdentities(supporterList.map((supporter) => supporter.address));

  const formatSupporter = (supporter: SupporterAggregate) => {
    const identity = supporterIdentityByAddress.get(supporter.address);
    return {
      address: supporter.address,
      truncatedAddress: identity?.truncatedAddress ?? supporter.address,
      displayName: identity?.displayName ?? "Teep supporter",
      teepUsername: identity?.teepUsername ?? null,
      socialXHandle: identity?.socialXHandle ?? null,
      publicAddress: identity?.publicAddress ?? null,
      creatorUsername: identity?.creatorUsername ?? null,
      creatorDisplayName: identity?.creatorDisplayName ?? null,
      profileImageUrl: identity?.profileImageUrl ?? null,
      totalRaw: supporter.totalRaw.toString(),
      totalUsd: rawToUsd(supporter.totalRaw),
      tipCount: supporter.tipCount,
      lastTipAt: supporter.lastTipAt,
    };
  };

  const topSupporters = supporterList.slice(0, 7).map((supporter) => ({
    ...formatSupporter(supporter),
    isRepeat: supporter.tipCount > 1,
  }));

  const recentSupporters = [...supporterList]
    .sort((a, b) => {
      if (b.lastTipAt !== a.lastTipAt) return b.lastTipAt - a.lastTipAt;
      const byTotal = compareRawDesc(a.totalRaw, b.totalRaw);
      if (byTotal !== 0) return byTotal;
      return b.tipCount - a.tipCount;
    })
    .slice(0, 7)
    .map((supporter) => ({
      ...formatSupporter(supporter),
      isRepeat: supporter.tipCount > 1,
    }));

  const repeatSupporters = supporterList
    .filter((supporter) => supporter.tipCount > 1)
    .slice(0, 7)
    .map((supporter) => ({
      ...formatSupporter(supporter),
      isRepeat: true,
    }));

  const formatRecentSupport = (row: TipRow) => ({
    type: isDirectTip(row) ? "direct_tip" : "post_tip",
    contentId: row.content_id,
    tweetId: row.tweet_id,
    authorHandle: row.author_handle,
    xUrl: xPostUrl(row.author_handle, row.tweet_id),
    fromAddress: row.from_address.toLowerCase(),
    toAddress: row.to_address.toLowerCase(),
    amountRaw: safeBigInt(row.amount).toString(),
    amountUsd: rawToUsd(safeBigInt(row.amount)),
    txHash: row.tx_hash,
    timestamp: row.timestamp,
    receiptAvailable: true,
    fromIdentity: supporterIdentityByAddress.get(row.from_address.toLowerCase()) ?? null,
  });

  const recentSupportPageCount = Math.max(1, Math.ceil(currentRows.length / recentLimit));
  const recentPage = Math.min(requestedRecentPage, recentSupportPageCount);
  const recentSupportOffset = (recentPage - 1) * recentLimit;
  const recentSupport = currentRows
    .slice(recentSupportOffset, recentSupportOffset + recentLimit)
    .map(formatRecentSupport);
  const latestSupport = currentRows.slice(0, 7).map(formatRecentSupport);

  const latestSignals = latestSupport.slice(0, 3).map((tip) => ({
    type: tip.type === "direct_tip" ? "direct_tip_received" : "tip_received",
    title: tip.type === "direct_tip" ? "Direct tip received" : "New tip received",
    amountRaw: tip.amountRaw,
    amountUsd: tip.amountUsd,
    timestamp: tip.timestamp,
    contentId: tip.contentId,
    txHash: tip.txHash,
  }));

  const topPost = topPosts[0] ?? null;
  const decisions = [
    ...(topPost
      ? [{
          type: "post_to_x",
          title: "Post to X",
          body: `Your top supported post received $${topPost.totalUsd} in this period. Open X with a prefilled post when you want to share the momentum.`,
          contentId: topPost.contentId,
          tweetId: topPost.tweetId,
          xUrl: topPost.xUrl,
        }]
      : []),
    ...(repeatSupporters.length > 0
      ? [{
          type: "thank_repeat_supporters",
          title: "Thank repeat supporters",
          body: `${repeatSupporters.length} supporter${repeatSupporters.length === 1 ? "" : "s"} tipped more than once in this period.`,
        }]
      : []),
    ...(currentSummary.directTipCount > 0
      ? [{
          type: "review_direct_tips",
          title: "Review direct tips",
          body: `${currentSummary.directTipCount} direct profile tip${currentSummary.directTipCount === 1 ? "" : "s"} received. Keep these separate from post ranking.`,
        }]
      : []),
  ].slice(0, 3);

  return {
    creator: {
      username: claim.username,
      displayName: claim.display_name,
      profileImageUrl: claim.profile_image_url,
      authorId: claim.author_id,
    },
    filters: {
      period,
      days,
      startAt,
      endAt,
      previousStartAt: previous?.startAt ?? null,
      previousEndAt: previous?.endAt ?? null,
    },
    summary: {
      ...currentSummary,
      totalRaw: currentSummary.totalRaw.toString(),
      allTimeTotalRaw: allTimeSummary.totalRaw.toString(),
      allTimeTotalUsd: allTimeSummary.totalUsd,
      allTimeTipCount: allTimeSummary.tipCount,
      previous: {
        ...previousSummary,
        totalRaw: previousSummary.totalRaw.toString(),
      },
      delta: {
        totalPercent: deltaPercent(currentSummary.totalRaw, previousSummary.totalRaw),
        tipCount: currentSummary.tipCount - previousSummary.tipCount,
        uniqueSupporterCount: currentSummary.uniqueSupporterCount - previousSummary.uniqueSupporterCount,
        supportedPostCount: currentSummary.supportedPostCount - previousSummary.supportedPostCount,
      },
    },
    supportMix: {
      postTipsRaw: postTipsRaw.toString(),
      postTipsUsd: rawToUsd(postTipsRaw),
      directTipsRaw: directTipsRaw.toString(),
      directTipsUsd: rawToUsd(directTipsRaw),
      referralEarningsRaw: "0",
      referralEarningsUsd: "0.00",
      note: "Referral earnings are not included in content performance unless a referral event source is added.",
    },
    topPosts,
    supporters: {
      top: topSupporters,
      recent: recentSupporters,
      repeat: repeatSupporters,
    },
    recentSupport,
    recentSupportPage: {
      page: recentPage,
      limit: recentLimit,
      total: currentRows.length,
      pageCount: recentSupportPageCount,
    },
    latestSignals,
    decisions,
    daily: dailySeries,
    provenance: {
      sourceTables: ["tips", "x_bot_tips", "tip_metadata", "verified_claims", "user_settings"],
      computedFromRows: currentRows.length,
      allCreatorRows: allRows.length,
      notes: [
        "All summary figures are computed from the same filtered creator tip rows.",
        "Post performance excludes direct creator tips.",
        "X post thumbnails require oEmbed lookup by the client or a dedicated media service.",
        "Referral earnings are reported as zero until referral event accounting is wired into this service.",
      ],
    },
  };
}
