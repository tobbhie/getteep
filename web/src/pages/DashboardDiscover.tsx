import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { parseUnits } from "viem";
import { arcTestnet } from "../chains";
import DashboardShell from "../components/DashboardShell";
import TeepTipModal from "../components/TeepTipModal";
import { API_BASE, USDC_ADDRESS } from "../config";
import { computeContentId, computeDirectCreatorContentId, encodeApproveCall, encodeTipCall, TIP_CONTRACT_ADDRESS } from "../lib/contracts";

type DiscoverFilter = "trending" | "recent" | "top" | "unclaimed" | "tipped";

type RecommendationReasonType = "recent_unique" | "unclaimed_recent" | "retip" | "similar" | "tipped_before" | "general";

type DiscoverCreator = {
  authorId: string;
  username: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
  totalReceivedUsd: string;
  tipCount: number | null;
  uniqueSupporters: number | null;
  tippedPosts: number | null;
  lastTipAgo: string | null;
  recentTipCount: number | null;
  isVerified: boolean;
  claimStatus: "verified" | "unclaimed" | "claim_wallet_active";
  reason: string;
  reasonType: RecommendationReasonType;
};

type DiscoverPost = {
  contentId: string;
  authorId: string;
  username: string | null;
  displayName: string | null;
  profileImageUrl: string | null;
  tweetId: string | null;
  totalTippedUsd: string;
  tipCount: number;
  uniqueTippers: number;
  tipsToday: number;
  lastTipAgo: string;
  postPreview: string;
  reason: string;
  claimStatus: "verified" | "unclaimed";
};

type DiscoverData = {
  algorithm: {
    version: string;
    signals: string[];
  };
  trendingPosts: DiscoverPost[];
  recommendedCreators: DiscoverCreator[];
  topCreators: DiscoverCreator[];
  topCreatorsAllTime: DiscoverCreator[];
  unclaimedCreators: DiscoverCreator[];
  tippedBefore: DiscoverCreator[];
  orbit: {
    connections: number;
    directTips: number;
    unclaimed: number;
    trending: number;
  };
};

type DrawerState =
  | { kind: "creator"; creator: DiscoverCreator }
  | { kind: "post"; post: DiscoverPost; creator?: DiscoverCreator };

const FILTERS: Array<{ key: DiscoverFilter; label: string }> = [
  { key: "trending", label: "Trending" },
  { key: "recent", label: "Recent" },
  { key: "top", label: "Top Creators" },
  { key: "unclaimed", label: "Unclaimed" },
  { key: "tipped", label: "Tipped Before" },
];

function fallbackAvatar(seed: string) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed || "creator")}`;
}

function avatarFor(item: { username?: string | null; authorId?: string | null; profileImageUrl?: string | null }) {
  const seed = item.username || item.authorId || "creator";
  return item.profileImageUrl || (item.username ? `https://unavatar.io/twitter/${item.username.replace(/^@/, "")}` : fallbackAvatar(seed));
}

function displayHandle(item: { username?: string | null; authorId?: string | null }) {
  if (item.username) return `@${item.username.replace(/^@/, "")}`;
  if (item.authorId) return `Creator ${item.authorId.slice(0, 6)}`;
  return "@creator";
}

function openXUrl(username?: string | null, tweetId?: string | null) {
  const handle = username?.replace(/^@/, "");
  if (!handle) return "https://x.com";
  return tweetId ? `https://x.com/${handle}/status/${tweetId}` : `https://x.com/${handle}`;
}

function reasonIcon(reasonType: RecommendationReasonType) {
  if (reasonType === "unclaimed_recent") return "paid";
  if (reasonType === "retip") return "repeat";
  if (reasonType === "similar") return "group";
  if (reasonType === "tipped_before") return "favorite";
  return "trending_up";
}

function shareInviteUrl(creator: DiscoverCreator) {
  const handle = creator.username ? `@${creator.username.replace(/^@/, "")}` : "this creator";
  const text = `${handle}, you have support waiting on Teep. Claim your creator account and receive tips from your audience.`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

export default function DashboardDiscover() {
  const { ready, authenticated } = usePrivy();
  const { client: smartWalletClient } = useSmartWallets();
  const address = (ready && authenticated ? smartWalletClient?.account?.address || "" : "").toLowerCase();
  const [data, setData] = useState<DiscoverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DiscoverFilter>("trending");
  const [topCreatorPeriod, setTopCreatorPeriod] = useState<"week" | "all">("week");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<DiscoverCreator[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [directTipTarget, setDirectTipTarget] = useState<DiscoverCreator | null>(null);
  const [directTipAmount, setDirectTipAmount] = useState("5.00");
  const [directTipSending, setDirectTipSending] = useState(false);
  const [directTipError, setDirectTipError] = useState("");
  const [postTipTarget, setPostTipTarget] = useState<DiscoverPost | null>(null);
  const [postTipAmount, setPostTipAmount] = useState("5.00");
  const [postTipSending, setPostTipSending] = useState(false);
  const [postTipError, setPostTipError] = useState("");
  const [postPreviews, setPostPreviews] = useState<Record<string, { excerpt: string | null; authorName: string | null }>>({});

  const loadDiscover = useCallback(() => {
    let url = `${API_BASE}/api/v1/discover`;
    if (address) url += `?address=${encodeURIComponent(address)}`;
    setLoading(true);
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => setData(payload))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [address]);

  const requestActivityProof = useCallback(async () => {
    if (!address || !smartWalletClient?.account) return null;
    const challengeRes = await fetch(`${API_BASE}/auth/wallet/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, purpose: "activity-write" }),
    });
    const challenge = await challengeRes.json();
    if (!challengeRes.ok || !challenge.message) return null;
    const signature = await smartWalletClient.signMessage({
      account: smartWalletClient.account,
      message: challenge.message,
    } as Parameters<typeof smartWalletClient.signMessage>[0]);
    return { message: challenge.message, signature };
  }, [address, smartWalletClient]);

  useEffect(() => {
    loadDiscover();
  }, [loadDiscover]);

  useEffect(() => {
    const posts = data?.trendingPosts || [];
    const candidates = posts
      .filter((post) => post.username && post.tweetId && !postPreviews[post.contentId])
      .slice(0, 4);
    if (candidates.length === 0) return;
    let cancelled = false;
    Promise.all(
      candidates.map(async (post) => {
        const url = openXUrl(post.username, post.tweetId);
        const response = await fetch(`${API_BASE}/api/v1/oembed?url=${encodeURIComponent(url)}`).catch(() => null);
        const json = response?.ok ? await response.json().catch(() => null) : null;
        return {
          contentId: post.contentId,
          excerpt: typeof json?.excerpt === "string" ? json.excerpt : null,
          authorName: typeof json?.author_name === "string" ? json.author_name : null,
        };
      })
    ).then((items) => {
      if (cancelled) return;
      setPostPreviews((current) => {
        const next = { ...current };
        for (const item of items) next[item.contentId] = { excerpt: item.excerpt, authorName: item.authorName };
        return next;
      });
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [data?.trendingPosts, postPreviews]);

  useEffect(() => {
    const query = search.trim().replace(/^@/, "");
    if (query.length < 2) {
      setSearchResults([]);
      setSearchOpen(false);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearchLoading(true);
      fetch(`${API_BASE}/api/v1/discover/search?q=${encodeURIComponent(query)}&limit=8`)
        .then((res) => (res.ok ? res.json() : { results: [] }))
        .then((payload) => {
          if (cancelled) return;
          setSearchResults(Array.isArray(payload?.results) ? payload.results : []);
          setSearchOpen(true);
        })
        .catch(() => {
          if (cancelled) return;
          setSearchResults([]);
          setSearchOpen(true);
        })
        .finally(() => {
          if (!cancelled) setSearchLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  const visiblePosts = useMemo(() => {
    const posts = [...(data?.trendingPosts || [])];
    if (filter === "recent") posts.sort((a, b) => (b.tipsToday || 0) - (a.tipsToday || 0));
    if (filter === "unclaimed") return posts.filter((post) => post.claimStatus === "unclaimed").slice(0, 4);
    if (filter === "tipped") return posts.slice(0, 2);
    return posts.slice(0, 4);
  }, [data?.trendingPosts, filter]);

  const visibleCreators = useMemo(() => {
    const source =
      filter === "top" ? data?.topCreators || [] :
      filter === "unclaimed" ? data?.unclaimedCreators || [] :
      filter === "tipped" ? data?.tippedBefore || [] :
      data?.recommendedCreators || [];
    return source.slice(0, 4);
  }, [data, filter]);

  const openDirectTip = useCallback((creator: DiscoverCreator) => {
    setDirectTipTarget(creator);
    setDirectTipAmount("5.00");
    setDirectTipError("");
  }, []);

  const openPostTip = useCallback((post: DiscoverPost) => {
    setPostTipTarget(post);
    setPostTipAmount("5.00");
    setPostTipError("");
  }, []);

  const sendPostTip = useCallback(async () => {
    if (!postTipTarget || !smartWalletClient?.account || !address) return;
    const handle = postTipTarget.username?.replace(/^@/, "");
    const tweetId = postTipTarget.tweetId;
    const amount = Number(postTipAmount);
    if (!handle || !tweetId) {
      setPostTipError("This post is missing the X context needed for post tipping.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setPostTipError("Enter a valid tip amount.");
      return;
    }

    setPostTipSending(true);
    setPostTipError("");
    try {
      const contentId = computeContentId(handle, tweetId);
      const resolved = await fetch(`${API_BASE}/auth/x/user/${encodeURIComponent(handle)}`);
      if (!resolved.ok) throw new Error("Could not verify this creator. Try again in a moment.");
      const resolvedData = (await resolved.json()) as { id?: string };
      if (!resolvedData.id || !/^[0-9]+$/.test(resolvedData.id)) throw new Error("Could not verify this creator.");

      const rawAmount = parseUnits(postTipAmount, 6);
      const txHash = await smartWalletClient.sendTransaction({
        account: smartWalletClient.account,
        chain: arcTestnet,
        calls: [
          { to: USDC_ADDRESS as `0x${string}`, data: encodeApproveCall(TIP_CONTRACT_ADDRESS, rawAmount) },
          { to: TIP_CONTRACT_ADDRESS, data: encodeTipCall(contentId, BigInt(resolvedData.id), rawAmount) },
        ],
      } as Parameters<typeof smartWalletClient.sendTransaction>[0]);

      await fetch(`${API_BASE}/tips/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId, authorHandle: handle, tweetId }),
      }).catch(() => {});
      await fetch(`${API_BASE}/tips/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "tip_sent",
          fromAddress: address,
          amount: rawAmount.toString(),
          txHash,
          authorHandle: handle,
          tweetId,
          detail: `Tipped @${handle}`,
          walletProof: await requestActivityProof(),
        }),
      }).catch(() => {});

      setPostTipTarget(null);
      loadDiscover();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPostTipError(message.includes("insufficient") || message.includes("balance") ? "Insufficient funds to tip this post." : message);
    } finally {
      setPostTipSending(false);
    }
  }, [address, loadDiscover, postTipAmount, postTipTarget, requestActivityProof, smartWalletClient]);

  const sendDirectTip = useCallback(async () => {
    if (!directTipTarget || !smartWalletClient?.account || !address) return;
    const handle = directTipTarget.username?.replace(/^@/, "");
    let authorId = directTipTarget.authorId;
    const amount = Number(directTipAmount);
    if (!handle) {
      setDirectTipError("This creator needs a handle before direct tipping.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setDirectTipError("Enter a valid tip amount.");
      return;
    }

    setDirectTipSending(true);
    setDirectTipError("");
    try {
      if (!authorId) {
        const resolved = await fetch(`${API_BASE}/auth/x/user/${encodeURIComponent(handle)}`);
        if (!resolved.ok) throw new Error("Could not verify this creator. Try again in a moment.");
        const user = await resolved.json();
        authorId = user.authorId || user.id;
      }
      if (!authorId) throw new Error("Could not resolve this creator.");
      const rawAmount = parseUnits(directTipAmount, 6);
      const contentId = computeDirectCreatorContentId(authorId);
      const txHash = await smartWalletClient.sendTransaction({
        account: smartWalletClient.account,
        chain: arcTestnet,
        calls: [
          { to: USDC_ADDRESS as `0x${string}`, data: encodeApproveCall(TIP_CONTRACT_ADDRESS, rawAmount) },
          { to: TIP_CONTRACT_ADDRESS, data: encodeTipCall(contentId, BigInt(authorId), rawAmount) },
        ],
      } as Parameters<typeof smartWalletClient.sendTransaction>[0]);
      await fetch(`${API_BASE}/tips/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId, authorHandle: handle, authorId, kind: "direct_creator_tip" }),
      }).catch(() => {});
      await fetch(`${API_BASE}/tips/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "direct_creator_tip",
          fromAddress: address,
          amount: rawAmount.toString(),
          txHash,
          authorHandle: handle,
          detail: `Direct tip to @${handle}`,
          walletProof: await requestActivityProof(),
        }),
      }).catch(() => {});
      setDirectTipTarget(null);
      loadDiscover();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDirectTipError(message.includes("insufficient") || message.includes("balance") ? "Insufficient funds to send this tip." : message);
    } finally {
      setDirectTipSending(false);
    }
  }, [address, directTipAmount, directTipTarget, loadDiscover, requestActivityProof, smartWalletClient]);

  const directTipModal = directTipTarget ? (
    <TeepTipModal
      open
      title="Send direct tip"
      modeLabel="Direct tip"
      recipientLabel={displayHandle(directTipTarget)}
      context="This supports the creator directly without attaching the tip to a specific post."
      amount={directTipAmount}
      onAmountChange={setDirectTipAmount}
      confirmLabel="Send Direct Tip"
      sending={directTipSending}
      error={directTipError}
      onConfirm={sendDirectTip}
      onClose={() => setDirectTipTarget(null)}
    />
  ) : null;

  const topCreatorRows = topCreatorPeriod === "week" ? data?.topCreators || [] : data?.topCreatorsAllTime || [];

  const postTipModal = postTipTarget ? (
    <TeepTipModal
      open
      title="Tip this post"
      modeLabel="Post tip"
      recipientLabel={displayHandle(postTipTarget)}
      context="Receipt and share copy stay tied to this X post."
      amount={postTipAmount}
      onAmountChange={setPostTipAmount}
      confirmLabel="Send Post Tip"
      sending={postTipSending}
      error={postTipError}
      onConfirm={sendPostTip}
      onClose={() => setPostTipTarget(null)}
    />
  ) : null;

  return (
    <DashboardShell address={address} title="Discover Creators">
      <main className="dashboard-body-inner dashboard-discover-page">
        <div className="dashboard-discover-hero">
          <div>
            <h1>Discover Creators</h1>
            <p>Find tipped posts, active creators, and people with support waiting to be claimed.</p>
          </div>
          <div className="dashboard-discover-search-wrap">
            <label className="dashboard-discover-search">
              <span className="material-symbols-outlined" aria-hidden>search</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onFocus={() => {
                  if (search.trim().length >= 2) setSearchOpen(true);
                }}
                onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)}
                placeholder="Search creators, handles, or tipped posts"
                aria-label="Search creators, handles, or tipped posts"
              />
            </label>
            {searchOpen && (
              <div className="dashboard-discover-search-results" role="listbox" aria-label="Search results">
                {searchLoading ? (
                  <p>Searching Teep records...</p>
                ) : searchResults.length === 0 ? (
                  <p>No recorded creator found.</p>
                ) : (
                  searchResults.map((creator) => (
                    <button
                      key={creator.authorId || creator.username || creator.reason}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setDrawer({ kind: "creator", creator });
                        setSearchOpen(false);
                      }}
                      role="option"
                    >
                      <img src={avatarFor(creator)} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar(creator.username || creator.authorId); }} />
                      <span>
                        <strong>{displayHandle(creator)}</strong>
                        <small>{creator.displayName || creator.reason}</small>
                      </span>
                      <b>${creator.totalReceivedUsd}</b>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <div className="dashboard-discover-tabs" role="tablist" aria-label="Creator discovery filters">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={filter === item.key ? "is-active" : ""}
              onClick={() => setFilter(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="dashboard-discover-grid-v2">
          <div className="dashboard-discover-main">
            <section>
              <div className="dashboard-discover-section-head">
                <div>
                  <h3>{filter === "unclaimed" ? "Tipped posts waiting on creators" : "Trending tipped posts"}</h3>
                  <p>Posts receiving support from tippers right now.</p>
                </div>
              </div>
              {loading ? (
                <div className="dashboard-discover-card-grid">
                  {Array.from({ length: 4 }).map((_, index) => <span key={index} className="dashboard-skeleton-card dashboard-skeleton-card--creator" />)}
                </div>
              ) : visiblePosts.length === 0 ? (
                <div className="dashboard-discover-empty">No tipped posts match this view yet.</div>
              ) : (
                <div className="dashboard-discover-card-grid">
                  {visiblePosts.map((post) => {
                    return (
                          <article key={post.contentId} className="dashboard-discover-post-card dashboard-card" onClick={() => setDrawer({ kind: "post", post: { ...post, postPreview: postPreviews[post.contentId]?.excerpt || post.postPreview } })}>
                        <div className="dashboard-discover-card-top">
                          <div className="dashboard-discover-identity">
                            <img src={avatarFor(post)} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar(post.username || post.authorId); }} />
                            <div>
                              <strong>{displayHandle(post)}</strong>
                              <span>{postPreviews[post.contentId]?.authorName || post.displayName || "Creator"} · tip received {post.lastTipAgo}</span>
                            </div>
                          </div>
                          <span className={`dashboard-discover-badge ${post.claimStatus === "unclaimed" ? "is-amber" : "is-green"}`}>
                            {post.reason}
                          </span>
                        </div>
                        <blockquote className="dashboard-discover-x-quote">
                          <span>X post</span>
                          <p>{postPreviews[post.contentId]?.excerpt || post.postPreview}</p>
                        </blockquote>
                        <div className="dashboard-discover-metrics">
                          <div><span>Tipped</span><strong>${post.totalTippedUsd}</strong></div>
                          <div><span>Tippers</span><strong>{post.uniqueTippers}</strong></div>
                          <div><span>Today</span><strong>{post.tipsToday} tips</strong></div>
                        </div>
                        <div className="dashboard-discover-actions" onClick={(event) => event.stopPropagation()}>
                          <button type="button" className="btn-primary" onClick={() => openPostTip(post)} disabled={!post.username || !post.tweetId}>Tip Post</button>
                          <a href={openXUrl(post.username, post.tweetId)} target="_blank" rel="noopener noreferrer" className="btn-secondary">Open on X</a>
                          <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`This post is receiving support on Teep: ${openXUrl(post.username, post.tweetId)}`)}`} target="_blank" rel="noopener noreferrer" className="btn-secondary dashboard-discover-icon-btn" aria-label="Share post">
                            <span className="material-symbols-outlined" aria-hidden>ios_share</span>
                          </a>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <div className="dashboard-discover-section-head">
                <div>
                  <h3>{filter === "tipped" ? "Creators you tipped before" : filter === "unclaimed" ? "Creators with tips waiting" : "Recommended creators"}</h3>
                  <p>Recommendations follow recent tips, unique supporters, unclaimed support, re-tip activity, and similarity to creators you tipped.</p>
                </div>
              </div>
              {loading ? (
                <div className="dashboard-discover-creator-list">
                  {Array.from({ length: 4 }).map((_, index) => <span key={index} className="dashboard-skeleton-card" />)}
                </div>
              ) : visibleCreators.length === 0 ? (
                <div className="dashboard-discover-empty">No creators match this view yet.</div>
              ) : (
                <div className="dashboard-discover-creator-list">
                  {visibleCreators.map((creator) => (
                    <article key={creator.authorId || creator.username || creator.reason} className="dashboard-discover-creator-row dashboard-card" onClick={() => setDrawer({ kind: "creator", creator })}>
                      <div className="dashboard-discover-creator-main">
                        <img src={avatarFor(creator)} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar(creator.username || creator.authorId); }} />
                        <div>
                          <h4>
                            {displayHandle(creator)}
                            <span className={`dashboard-discover-badge ${creator.claimStatus === "unclaimed" ? "is-amber" : "is-purple"}`}>
                              {creator.claimStatus === "unclaimed" ? "Awaiting claim" : "Verified"}
                            </span>
                          </h4>
                          <p>{creator.displayName || "Creator on Teep"}</p>
                          <div className="dashboard-discover-reason">
                            <span className="material-symbols-outlined" aria-hidden>{reasonIcon(creator.reasonType)}</span>
                            {creator.reason}
                          </div>
                          <div className="dashboard-discover-inline-signal">
                            ${creator.totalReceivedUsd} received · {creator.uniqueSupporters ?? "-"} supporters · {creator.tippedPosts ?? "-"} posts
                          </div>
                        </div>
                      </div>
                      <div className="dashboard-discover-row-actions" onClick={(event) => event.stopPropagation()}>
                        {creator.claimStatus === "unclaimed" ? (
                          <button type="button" className="btn-primary" onClick={() => openDirectTip(creator)}>Tip Anyway</button>
                        ) : (
                          <button type="button" className="btn-primary" onClick={() => openDirectTip(creator)}>Send Direct Tip</button>
                        )}
                        {creator.claimStatus === "unclaimed" ? (
                          <a href={shareInviteUrl(creator)} target="_blank" rel="noopener noreferrer" className="btn-secondary">Share Invite</a>
                        ) : (
                          <button type="button" className="btn-secondary" onClick={() => setDrawer({ kind: "creator", creator })}>View Details</button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          <aside className="dashboard-discover-rail">
            <section className="dashboard-card dashboard-discover-rail-card">
              <div className="dashboard-discover-rail-head">
                <h3>Top creators</h3>
                <div className="dashboard-discover-period-toggle" aria-label="Top creator period">
                  <button type="button" className={topCreatorPeriod === "week" ? "is-active" : ""} onClick={() => setTopCreatorPeriod("week")}>This week</button>
                  <button type="button" className={topCreatorPeriod === "all" ? "is-active" : ""} onClick={() => setTopCreatorPeriod("all")}>All time</button>
                </div>
              </div>
              <div className="dashboard-discover-rail-list">
                {topCreatorRows.slice(0, 3).map((creator, index) => (
                  <button key={creator.authorId || creator.username || index} type="button" onClick={() => setDrawer({ kind: "creator", creator })}>
                    <span>{index + 1}</span>
                    <img src={avatarFor(creator)} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar(creator.username || creator.authorId); }} />
                    <strong>{creator.username || "Creator"}</strong>
                    <b>${creator.totalReceivedUsd}</b>
                  </button>
                ))}
                {!loading && topCreatorRows.length === 0 && <p>No top creators for this period yet.</p>}
              </div>
            </section>

            <section className="dashboard-card dashboard-discover-rail-card">
              <div className="dashboard-discover-rail-head">
                <h3>Tips waiting</h3>
              </div>
              <div className="dashboard-discover-waiting-list">
                {(data?.unclaimedCreators || []).slice(0, 3).map((creator) => (
                  <div key={creator.authorId || creator.username || creator.reason}>
                    <span className="material-symbols-outlined" aria-hidden>alternate_email</span>
                    <div>
                      <strong>{displayHandle(creator)}</strong>
                      <small>${creator.totalReceivedUsd} pending · {creator.tipCount || 0} tips</small>
                    </div>
                    <a href={shareInviteUrl(creator)} target="_blank" rel="noopener noreferrer">Invite</a>
                  </div>
                ))}
                {!loading && (data?.unclaimedCreators || []).length === 0 && <p>No creators waiting to claim right now.</p>}
              </div>
            </section>

            <section className="dashboard-card dashboard-discover-rail-card">
              <div className="dashboard-discover-rail-head">
                <h3>Your tipping orbit</h3>
              </div>
              <div className="dashboard-discover-orbit" aria-label="Your tipping orbit">
                <div className="dashboard-discover-orbit-ring dashboard-discover-orbit-ring--outer">
                  <span className="dashboard-discover-orbit-dot is-purple" />
                </div>
                <div className="dashboard-discover-orbit-ring dashboard-discover-orbit-ring--inner">
                  <span className="dashboard-discover-orbit-dot is-green" />
                  <span className="dashboard-discover-orbit-dot is-amber" />
                </div>
                <div className="dashboard-discover-orbit-center">
                  <span className="material-symbols-outlined" aria-hidden>person</span>
                </div>
                <div className="dashboard-discover-orbit-caption">
                  <span>Connections</span>
                  <strong>{data?.orbit.connections || 0} creators</strong>
                </div>
              </div>
            </section>
          </aside>
        </div>
      </main>

      {drawer && (
        <aside className="dashboard-discover-drawer" aria-label="Creator detail drawer">
          <div className="dashboard-discover-drawer-head">
            <div className="dashboard-discover-identity">
              <img src={avatarFor(drawer.kind === "post" ? drawer.post : drawer.creator)} alt="" onError={(event) => { event.currentTarget.src = fallbackAvatar(drawer.kind === "post" ? drawer.post.authorId : drawer.creator.authorId); }} />
              <div>
                <strong>{displayHandle(drawer.kind === "post" ? drawer.post : drawer.creator)}</strong>
                <span>{drawer.kind === "post" ? `Post tip context · ${drawer.post.lastTipAgo}` : drawer.creator.reason}</span>
              </div>
            </div>
            <button type="button" onClick={() => setDrawer(null)} aria-label="Close details">
              <span className="material-symbols-outlined" aria-hidden>close</span>
            </button>
          </div>
          <div className="dashboard-discover-drawer-body">
            <div className="dashboard-discover-drawer-reason">
              <span>Why this {drawer.kind === "post" ? "post" : "creator"}</span>
              <strong>{drawer.kind === "post" ? drawer.post.reason : drawer.creator.reason}</strong>
            </div>
            <div className="dashboard-discover-drawer-stats">
              <div><span>Received</span><strong>${drawer.kind === "post" ? drawer.post.totalTippedUsd : drawer.creator.totalReceivedUsd}</strong></div>
              <div><span>Tippers</span><strong>{drawer.kind === "post" ? drawer.post.uniqueTippers : drawer.creator.uniqueSupporters ?? "-"}</strong></div>
              <div><span>Posts</span><strong>{drawer.kind === "post" ? 1 : drawer.creator.tippedPosts ?? "-"}</strong></div>
            </div>
            <div className="dashboard-discover-drawer-next">
              <span>Best next action</span>
              <h4>{drawer.kind === "post" ? "Tip this post" : drawer.creator.claimStatus === "unclaimed" ? "Invite this creator to claim" : "Send a direct tip"}</h4>
              <p>
                {drawer.kind === "post"
                  ? "Keep the tip tied to this post so the receipt and share copy stay specific."
                  : drawer.creator.claimStatus === "unclaimed"
                    ? "This creator has support waiting. Share an invite so they can discover Teep and claim."
                    : "Use direct tip when you want to support the creator without referencing a specific post."}
              </p>
              {drawer.kind === "post" && <button type="button" className="btn-primary" onClick={() => openPostTip(drawer.post)} disabled={!drawer.post.username || !drawer.post.tweetId}>Tip Post</button>}
              {drawer.kind === "creator" && drawer.creator.claimStatus === "unclaimed" && <a href={shareInviteUrl(drawer.creator)} target="_blank" rel="noopener noreferrer" className="btn-primary">Share Invite</a>}
              {drawer.kind === "creator" && drawer.creator.claimStatus !== "unclaimed" && <button type="button" className="btn-primary" onClick={() => openDirectTip(drawer.creator)}>Send Direct Tip</button>}
            </div>
            <div className="dashboard-discover-drawer-signals">
              <div><span>Latest tip</span><strong>{drawer.kind === "post" ? drawer.post.lastTipAgo : drawer.creator.lastTipAgo || "No recent tip"}</strong></div>
              <div><span>Recent activity</span><strong>{drawer.kind === "post" ? `${drawer.post.tipsToday} tips today` : `${drawer.creator.recentTipCount || 0} tips this week`}</strong></div>
              <div><span>Claim status</span><strong>{drawer.kind === "post" ? drawer.post.claimStatus : drawer.creator.claimStatus}</strong></div>
            </div>
          </div>
          <div className="dashboard-discover-drawer-actions">
            {drawer.kind === "creator" && drawer.creator.claimStatus === "unclaimed" && (
              <button type="button" className="btn-secondary" onClick={() => openDirectTip(drawer.creator)}>Tip Anyway</button>
            )}
            <a href={openXUrl(drawer.kind === "post" ? drawer.post.username : drawer.creator.username, drawer.kind === "post" ? drawer.post.tweetId : null)} target="_blank" rel="noopener noreferrer" className="btn-secondary">Open on X</a>
            <button type="button" className="btn-secondary" onClick={() => setDrawer(null)}>Close</button>
          </div>
        </aside>
      )}
      {directTipModal}
      {postTipModal}
    </DashboardShell>
  );
}
