import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { parseUnits } from "viem";
import LoginModal from "../components/LoginModal";
import RechargePrompt from "../components/RechargePrompt";
import TeepTipModal from "../components/TeepTipModal";
import { arcTestnet } from "../chains";
import { API_BASE, RECEIPT_BASE_URL, USDC_ADDRESS } from "../config";
import {
  computeDirectCreatorContentId,
  encodeApproveCall,
  encodeTipCall,
  TIP_CONTRACT_ADDRESS,
} from "../lib/contracts";
import { creatorAvatarUrl, localInitialsAvatar } from "../lib/avatar";

type ProfileSupporter = {
  address: string | null;
  displayName?: string | null;
  profileImageUrl?: string | null;
  isPrivate?: boolean;
  total: string;
};

type RecentTip = {
  address: string | null;
  displayName?: string | null;
  profileImageUrl?: string | null;
  isPrivate?: boolean;
  amount: string;
  timestamp: number;
  txHash: string;
  tweetId: string | null;
  authorHandle: string | null;
  tweetAuthorHandle?: string | null;
};

type ProfilePost = {
  contentId: string;
  total: string;
  count: number;
  tweetId: string | null;
  authorHandle: string | null;
};

type Profile = {
  username: string;
  displayName: string | null;
  profileImageUrl: string | null;
  authorId: string;
  totalReceived: string;
  tipCount: number;
  supporterCount?: number;
  topPosts: ProfilePost[];
  topSupporters: ProfileSupporter[];
  recentTips?: RecentTip[];
  privacy?: {
    hideSupporterNamesPublicly?: boolean;
    hideGrowthActivity?: boolean;
  };
};

type PostPreview = {
  excerpt: string | null;
  authorName: string | null;
};

const DEFAULT_TITLE = "Teep - Social finance for creators and communities";
const DEFAULT_DESCRIPTION =
  "Tip creators from posts, profiles, and links. Creators can receive, withdraw, re-tip, and grow their balance in one simple account.";

function formatUsdRaw(raw: string): string {
  const amount = Number(raw) / 1e6;
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function formatUsd(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function setMeta(propertyOrName: string, content: string): void {
  const isOg = propertyOrName.startsWith("og:") || propertyOrName.startsWith("profile:");
  const attr = isOg ? "property" : "name";
  let element = document.querySelector(`meta[${attr}="${propertyOrName}"]`) as HTMLMetaElement | null;
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attr, propertyOrName);
    document.head.appendChild(element);
  }
  element.content = content;
}

function setCanonical(href: string): void {
  let element = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.appendChild(element);
  }
  element.href = href;
}

function avatarFallback(seed: string) {
  return localInitialsAvatar(seed);
}

function avatarFor(profile: Pick<Profile, "username" | "displayName" | "profileImageUrl">) {
  return creatorAvatarUrl({ username: profile.username, profileImageUrl: profile.profileImageUrl, seed: profile.displayName || profile.username });
}

function supporterLabel(supporter: Pick<ProfileSupporter, "address" | "displayName" | "isPrivate">) {
  if (supporter.isPrivate) return supporter.displayName || "Private supporter";
  return supporter.displayName || "Teep supporter";
}

function initials(label: string) {
  const clean = label.replace(/^@/, "").trim();
  if (!clean) return "T";
  if (clean.startsWith("0x")) return clean.slice(2, 4).toUpperCase();
  return clean
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function relativeTime(timestamp: number) {
  const value = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  const diff = Math.max(0, Date.now() - value);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function postUrl(post: ProfilePost, fallbackUsername: string) {
  if (!post.tweetId) return null;
  const handle = (post.authorHandle || fallbackUsername).replace(/^@/, "");
  return `https://x.com/${handle}/status/${post.tweetId}`;
}

export default function CreatorProfile() {
  const params = useParams<{ username?: string; id?: string }>();
  const username = params.username || params.id;
  const { ready, authenticated, login } = usePrivy();
  const { client: smartWalletClient } = useSmartWallets();
  const address = (smartWalletClient?.account?.address || "").toLowerCase();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [postPreviews, setPostPreviews] = useState<Record<string, PostPreview>>({});
  const [tipAmount, setTipAmount] = useState("5.00");
  const [loginOpen, setLoginOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [pendingAfterLogin, setPendingAfterLogin] = useState(false);
  const [tipSending, setTipSending] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);
  const [tipSuccess, setTipSuccess] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [rechargeRetryStatus, setRechargeRetryStatus] = useState<"idle" | "checking" | "insufficient">("idle");
  const [rechargeRetryMessage, setRechargeRetryMessage] = useState<string | null>(null);

  const cleanUsername = username?.replace(/^@/, "") || "";
  const profileUrl = cleanUsername ? `${RECEIPT_BASE_URL}/creator/${cleanUsername}` : "";
  const amountNumber = Number(tipAmount);
  const validAmount = Number.isFinite(amountNumber) && amountNumber >= 0.5;

  const loadProfile = useCallback(() => {
    if (!cleanUsername) return;
    setLoading(true);
    setError(null);
    fetch(`${API_BASE}/api/v1/profile/username/${encodeURIComponent(cleanUsername)}`)
      .then((response) => {
        if (!response.ok) throw new Error("Creator not found or not verified");
        return response.json();
      })
      .then((payload: Profile) => setProfile(payload))
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Creator profile is unavailable"))
      .finally(() => setLoading(false));
  }, [cleanUsername]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (!profile) return;
    const candidates = profile.topPosts
      .map((post) => ({ post, url: postUrl(post, profile.username) }))
      .filter((item): item is { post: ProfilePost; url: string } => Boolean(item.url))
      .slice(0, 3);
    if (!candidates.length) return;
    let cancelled = false;
    Promise.all(
      candidates.map(async ({ post, url }) => {
        const response = await fetch(`${API_BASE}/api/v1/oembed?url=${encodeURIComponent(url)}`).catch(() => null);
        const json = response?.ok ? await response.json().catch(() => null) : null;
        return {
          contentId: post.contentId,
          excerpt: typeof json?.excerpt === "string" ? json.excerpt : null,
          authorName: typeof json?.author_name === "string" ? json.author_name : null,
        };
      }),
    ).then((items) => {
      if (cancelled) return;
      setPostPreviews((current) => {
        const next = { ...current };
        items.forEach((item) => {
          next[item.contentId] = { excerpt: item.excerpt, authorName: item.authorName };
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  useEffect(() => {
    if (!profile) return;
    const displayName = profile.displayName?.trim() || `@${profile.username}`;
    const total = formatUsdRaw(profile.totalReceived);
    const description =
      profile.tipCount > 0
        ? `Support ${displayName} on Teep. They have received $${total} across ${profile.tipCount.toLocaleString()} tips from their community.`
        : `Be among the first to support ${displayName} on Teep, where creators receive and manage support in one simple account.`;
    const title = `Support ${displayName} on Teep`;
    const image = avatarFor(profile);

    document.title = title;
    setCanonical(profileUrl);
    setMeta("description", description);
    setMeta("robots", "index, follow");
    setMeta("og:site_name", "Teep");
    setMeta("og:title", title);
    setMeta("og:description", description);
    setMeta("og:url", profileUrl);
    setMeta("og:type", "profile");
    setMeta("og:image", image);
    setMeta("og:image:alt", `${displayName}'s creator profile on Teep`);
    setMeta("profile:username", profile.username);
    setMeta("twitter:card", "summary");
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
    setMeta("twitter:image", image);
    setMeta("twitter:image:alt", `${displayName}'s creator profile on Teep`);
    setMeta("twitter:creator", `@${profile.username}`);

    return () => {
      const defaultUrl = RECEIPT_BASE_URL || window.location.origin;
      const defaultImage = "https://getteep.xyz/logo.svg";
      document.title = DEFAULT_TITLE;
      setCanonical(defaultUrl);
      setMeta("description", DEFAULT_DESCRIPTION);
      setMeta("robots", "index, follow");
      setMeta("og:site_name", "Teep");
      setMeta("og:title", DEFAULT_TITLE);
      setMeta("og:description", DEFAULT_DESCRIPTION);
      setMeta("og:url", defaultUrl);
      setMeta("og:type", "website");
      setMeta("og:image", defaultImage);
      setMeta("og:image:alt", "Teep logo");
      setMeta("profile:username", "");
      setMeta("twitter:card", "summary");
      setMeta("twitter:title", DEFAULT_TITLE);
      setMeta("twitter:description", DEFAULT_DESCRIPTION);
      setMeta("twitter:image", defaultImage);
      setMeta("twitter:image:alt", "Teep logo");
      setMeta("twitter:creator", "");
    };
  }, [profile, profileUrl]);

  const totalUsd = profile ? formatUsdRaw(profile.totalReceived) : "0.00";
  const supporterCount = profile?.supporterCount ?? profile?.topSupporters.length ?? 0;
  const visiblePosts = (profile?.topPosts || []).slice(0, 3);
  const visibleTips = (profile?.recentTips || []).slice(0, 6);
  const visibleSupporters = (profile?.topSupporters || []).slice(0, 3);

  const fetchBalance = useCallback(async () => {
    if (!address) return 0;
    const response = await fetch(`${API_BASE}/api/v1/wallet/${address}/usdc-balance`);
    if (!response.ok) return 0;
    const payload = await response.json();
    return Number(payload.balanceRaw || 0) / 1e6;
  }, [address]);

  const prepareTip = useCallback(async () => {
    setTipSuccess(false);
    setTipError(null);
    if (!validAmount) {
      setTipError("Enter an amount of at least $0.50.");
      return;
    }
    if (!ready || !authenticated) {
      setPendingAfterLogin(true);
      setLoginOpen(true);
      return;
    }
    if (!smartWalletClient?.account || !address) {
      setTipError("Your Teep wallet is still getting ready. Try again in a moment.");
      setConfirmOpen(true);
      return;
    }
    const balance = await fetchBalance();
    if (balance < amountNumber) {
      setRechargeRetryStatus("idle");
      setRechargeRetryMessage(null);
      setRechargeOpen(true);
      return;
    }
    setConfirmOpen(true);
  }, [address, amountNumber, authenticated, fetchBalance, ready, smartWalletClient?.account, validAmount]);

  useEffect(() => {
    if (!pendingAfterLogin || !authenticated || !smartWalletClient?.account) return;
    setPendingAfterLogin(false);
    setLoginOpen(false);
    prepareTip();
  }, [authenticated, pendingAfterLogin, prepareTip, smartWalletClient?.account]);

  const requestActivityProof = useCallback(async () => {
    if (!address || !smartWalletClient?.account) return null;
    const challengeResponse = await fetch(`${API_BASE}/auth/wallet/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, purpose: "activity-write" }),
    });
    const challenge = await challengeResponse.json();
    if (!challengeResponse.ok || !challenge.message) return null;
    const signature = await smartWalletClient.signMessage({
      account: smartWalletClient.account,
      message: challenge.message,
    } as Parameters<typeof smartWalletClient.signMessage>[0]);
    return { message: challenge.message, signature };
  }, [address, smartWalletClient]);

  const sendTip = useCallback(async () => {
    if (!profile || !smartWalletClient?.account || !address || !validAmount) return;
    setTipSending(true);
    setTipError(null);
    try {
      let authorId = profile.authorId;
      if (!/^\d+$/.test(authorId)) {
        const response = await fetch(`${API_BASE}/auth/x/user/${encodeURIComponent(profile.username)}`);
        const payload = response.ok ? await response.json() : null;
        authorId = payload?.authorId || payload?.id || "";
      }
      if (!/^\d+$/.test(authorId)) throw new Error("This creator could not be verified for tipping.");

      const rawAmount = parseUnits(amountNumber.toFixed(2), 6);
      const contentId = computeDirectCreatorContentId(authorId);
      const txHash = await smartWalletClient.sendTransaction({
        account: smartWalletClient.account,
        chain: arcTestnet,
        calls: [
          { to: USDC_ADDRESS, data: encodeApproveCall(TIP_CONTRACT_ADDRESS, rawAmount) },
          { to: TIP_CONTRACT_ADDRESS, data: encodeTipCall(contentId, BigInt(authorId), rawAmount) },
        ],
      } as Parameters<typeof smartWalletClient.sendTransaction>[0]);

      await fetch(`${API_BASE}/tips/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentId,
          authorHandle: profile.username,
          authorId,
          kind: "direct_creator_tip",
        }),
      }).catch(() => {});
      await fetch(`${API_BASE}/tips/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "direct_creator_tip",
          fromAddress: address,
          amount: rawAmount.toString(),
          txHash,
          authorHandle: profile.username,
          detail: `Direct tip to @${profile.username}`,
          sourceMethod: "creator_profile",
          walletProof: await requestActivityProof(),
        }),
      }).catch(() => {});

      setConfirmOpen(false);
      setTipSuccess(true);
      window.setTimeout(loadProfile, 1800);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setTipError(
        message.toLowerCase().includes("insufficient") || message.toLowerCase().includes("balance")
          ? "Your Teep balance is too low for this tip."
          : message,
      );
    } finally {
      setTipSending(false);
    }
  }, [address, amountNumber, loadProfile, profile, requestActivityProof, smartWalletClient, validAmount]);

  const retryAfterFunding = useCallback(async () => {
    setRechargeRetryStatus("checking");
    setRechargeRetryMessage(null);
    const balance = await fetchBalance();
    if (balance >= amountNumber) {
      setRechargeOpen(false);
      setRechargeRetryStatus("idle");
      setConfirmOpen(true);
      return;
    }
    const shortfall = Math.max(0, amountNumber - balance);
    setRechargeRetryStatus("insufficient");
    setRechargeRetryMessage(`Add at least $${shortfall.toFixed(2)} more to continue.`);
  }, [amountNumber, fetchBalance]);

  const handleCopyProfile = useCallback(async () => {
    if (!profileUrl) return;
    await navigator.clipboard?.writeText(profileUrl);
    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 1800);
  }, [profileUrl]);

  const handleShare = useCallback(async () => {
    if (!profile) return;
    const displayName = profile.displayName || `@${profile.username}`;
    const data = {
      title: `Support ${displayName} on Teep`,
      text: `Support ${displayName} directly on Teep.`,
      url: profileUrl,
    };
    if (navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch {
        return;
      }
    }
    window.open(
      `https://x.com/intent/tweet?text=${encodeURIComponent(`${data.text}\n\n${data.url}`)}`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [profile, profileUrl]);

  const selectedAmount = useMemo(
    () => [2, 5, 10, 25].find((amount) => amount === amountNumber),
    [amountNumber],
  );

  if (loading) {
    return (
      <div className="creator-public-page creator-public-page--loading" aria-busy="true">
        <div className="creator-public-shell">
          <div className="creator-profile-skeleton creator-profile-skeleton--identity" />
          <div className="creator-profile-skeleton creator-profile-skeleton--stats" />
          <div className="creator-profile-skeleton creator-profile-skeleton--content" />
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="creator-public-page">
        <section className="creator-profile-error">
          <span className="material-symbols-outlined" aria-hidden>person_off</span>
          <h1>Creator profile unavailable</h1>
          <p>{error || "We could not find this creator on Teep."}</p>
          <Link className="btn-primary" to="/dashboard/discover">Discover creators</Link>
        </section>
      </div>
    );
  }

  const creatorName = profile.displayName?.trim() || `@${profile.username}`;
  const creatorAvatar = avatarFor(profile);

  return (
    <div className="creator-public-page">
      <div className="creator-public-shell">
        <div className="creator-public-layout">
          <div className="creator-public-main">
            <section className="creator-public-identity" aria-labelledby="creator-profile-name">
              <div className="creator-public-avatar-wrap">
                <img
                  className="creator-public-avatar"
                  src={creatorAvatar}
                  alt={`${creatorName}'s profile`}
                  onError={(event) => {
                    event.currentTarget.src = avatarFallback(creatorName);
                  }}
                />
                <span className="creator-public-verified" title="Verified creator">
                  <span className="material-symbols-outlined" aria-hidden>check</span>
                </span>
              </div>
              <div className="creator-public-identity-copy">
                <div className="creator-public-name-row">
                  <h1 id="creator-profile-name">{creatorName}</h1>
                  <span className="creator-public-verified-label">
                    <span className="material-symbols-outlined" aria-hidden>verified</span>
                    Verified creator
                  </span>
                </div>
                <p className="creator-public-handle">@{profile.username}</p>
                <div className="creator-public-actions">
                  <button className="btn-primary" type="button" onClick={prepareTip}>
                    <span className="material-symbols-outlined" aria-hidden>send</span>
                    Tip creator
                  </button>
                  <a
                    className="btn-secondary"
                    href={`https://x.com/${profile.username}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="material-symbols-outlined" aria-hidden>alternate_email</span>
                    View on X
                  </a>
                  <button
                    className="creator-public-icon-button"
                    type="button"
                    onClick={handleCopyProfile}
                    aria-label="Copy profile link"
                    title="Copy profile link"
                  >
                    <span className="material-symbols-outlined" aria-hidden>{shareCopied ? "check" : "link"}</span>
                  </button>
                  <button
                    className="creator-public-icon-button"
                    type="button"
                    onClick={handleShare}
                    aria-label="Share creator profile"
                    title="Share creator profile"
                  >
                    <span className="material-symbols-outlined" aria-hidden>share</span>
                  </button>
                </div>
              </div>
            </section>

            <section className="creator-public-stats" aria-label="Creator support totals">
              <div>
                <small>Support received</small>
                <strong>${totalUsd}</strong>
                <span>Across confirmed tips</span>
              </div>
              <div>
                <small>Tips</small>
                <strong>{profile.tipCount.toLocaleString()}</strong>
                <span>From posts and profile</span>
              </div>
              <div>
                <small>Supporters</small>
                <strong>{supporterCount.toLocaleString()}</strong>
                <span>People backing this creator</span>
              </div>
            </section>

            <section className="creator-public-section" aria-labelledby="supported-posts-title">
              <div className="creator-public-section-heading">
                <div>
                  <h2 id="supported-posts-title">Most supported posts</h2>
                  <p>The work this creator's audience backed most.</p>
                </div>
                <span>All time</span>
              </div>
              {visiblePosts.length ? (
                <div className="creator-public-post-list">
                  {visiblePosts.map((post, index) => {
                    const url = postUrl(post, profile.username);
                    const preview = postPreviews[post.contentId];
                    return (
                      <article className="creator-public-post" key={post.contentId}>
                        <div>
                          <div className="creator-public-post-author">
                            <img src={creatorAvatar} alt="" />
                            <span><strong>{preview?.authorName || creatorName}</strong> &middot; @{profile.username}</span>
                          </div>
                          <p>{preview?.excerpt || `Supported post ${index + 1} from @${profile.username}`}</p>
                          <div className="creator-public-post-meta">
                            <span><span className="material-symbols-outlined" aria-hidden>send</span>{post.count} tip{post.count === 1 ? "" : "s"}</span>
                          </div>
                        </div>
                        <div className="creator-public-post-value">
                          <strong>${formatUsd(post.total)}</strong>
                          <small>received</small>
                          {url ? (
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              View post <span className="material-symbols-outlined" aria-hidden>arrow_outward</span>
                            </a>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="creator-public-empty">
                  <span className="material-symbols-outlined" aria-hidden>article</span>
                  <strong>No supported posts yet</strong>
                  <p>Post-level support will appear here after it is confirmed.</p>
                </div>
              )}
            </section>

            <section className="creator-public-section" id="creator-activity" aria-labelledby="recent-support-title">
              <div className="creator-public-section-heading">
                <div>
                  <h2 id="recent-support-title">Recent support</h2>
                  <p>Latest confirmed tips to this creator.</p>
                </div>
                <span className="creator-public-live-label"><i aria-hidden />Live activity</span>
              </div>
              {visibleTips.length ? (
                <div className="creator-public-activity-list">
                  {visibleTips.map((tip) => {
                    const label = supporterLabel(tip);
                    const sourceUrl = tip.tweetId
                      ? `https://x.com/${(tip.tweetAuthorHandle || tip.authorHandle || profile.username).replace(/^@/, "")}/status/${tip.tweetId}`
                      : null;
                    return (
                      <div className="creator-public-activity" key={`${tip.txHash}-${tip.timestamp}`}>
                        <div className="creator-public-supporter">
                          <span>{initials(label)}</span>
                          <span><strong>{label}</strong><small>{tip.tweetId ? "Supported a post" : "Tipped this creator"}</small></span>
                        </div>
                        <strong className="creator-public-activity-amount">+${formatUsd(tip.amount)}</strong>
                        <time>{relativeTime(tip.timestamp)}</time>
                        {sourceUrl ? (
                          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" aria-label="View supported post">
                            <span className="material-symbols-outlined" aria-hidden>arrow_outward</span>
                          </a>
                        ) : <span className="creator-public-activity-spacer" />}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="creator-public-empty">
                  <span className="material-symbols-outlined" aria-hidden>favorite</span>
                  <strong>Be the first supporter</strong>
                  <p>Your confirmed tip will begin this creator's support history.</p>
                </div>
              )}
            </section>

            <section className="creator-public-section" aria-labelledby="top-supporters-title">
              <div className="creator-public-section-heading">
                <div>
                  <h2 id="top-supporters-title">Top supporters</h2>
                  <p>People showing up most for this creator.</p>
                </div>
              </div>
              {visibleSupporters.length ? (
                <div className="creator-public-supporter-grid">
                  {visibleSupporters.map((supporter, index) => {
                    const label = supporterLabel(supporter);
                    const content = (
                      <>
                        <span>{initials(label)}</span>
                        <span><strong>{label}</strong><small>${formatUsd(supporter.total)} supported</small></span>
                      </>
                    );
                    return supporter.address && !supporter.isPrivate ? (
                      <Link className="creator-public-supporter-card" to={`/tipper/${supporter.address}`} key={supporter.address}>
                        {content}
                      </Link>
                    ) : (
                      <div className="creator-public-supporter-card" key={`${label}-${index}`}>{content}</div>
                    );
                  })}
                </div>
              ) : (
                <div className="creator-public-empty creator-public-empty--compact">
                  Supporter recognition will appear here as this community grows.
                </div>
              )}
            </section>
          </div>

          <aside className="creator-public-rail" aria-label={`Tip ${creatorName}`}>
            <section className="creator-public-tip-panel">
              <div className="creator-public-tip-head">
                <h2>Tip {creatorName}</h2>
                <span><i aria-hidden />Ready</span>
              </div>
              <p>Send stable-value support directly to this creator.</p>
              <label htmlFor="creator-tip-amount">
                <span>Amount</span>
                <span>USD</span>
              </label>
              <div className="creator-public-amount-input">
                <span aria-hidden>$</span>
                <input
                  id="creator-tip-amount"
                  type="number"
                  min="0.5"
                  step="0.5"
                  inputMode="decimal"
                  value={tipAmount}
                  onChange={(event) => {
                    setTipAmount(event.target.value);
                    setTipError(null);
                    setTipSuccess(false);
                  }}
                  aria-describedby="creator-tip-help"
                />
              </div>
              <div className="creator-public-amount-options" aria-label="Quick tip amounts">
                {[2, 5, 10, 25].map((amount) => (
                  <button
                    type="button"
                    className={selectedAmount === amount ? "is-active" : ""}
                    aria-pressed={selectedAmount === amount}
                    onClick={() => {
                      setTipAmount(amount.toFixed(2));
                      setTipError(null);
                      setTipSuccess(false);
                    }}
                    key={amount}
                  >
                    ${amount}
                  </button>
                ))}
              </div>
              <button className="btn-primary creator-public-tip-submit" type="button" onClick={prepareTip}>
                Tip creator
                <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
              </button>
              {tipError && !confirmOpen ? <p className="creator-public-tip-error" role="alert">{tipError}</p> : null}
              {tipSuccess ? (
                <p className="creator-public-tip-success" role="status">
                  <span className="material-symbols-outlined" aria-hidden>check_circle</span>
                  Tip sent. It will appear after confirmation.
                </p>
              ) : null}
              <div className="creator-public-trust" id="creator-tip-help">
                <span className="material-symbols-outlined" aria-hidden>shield</span>
                <span>Your support moves through Teep's creator-controlled payment flow.</span>
              </div>
            </section>
            <div className="creator-public-rail-note">
              <strong>Support from anywhere</strong>
              <span>Tip from this profile, supported social posts, or Teep X tip commands.</span>
            </div>
          </aside>
        </div>
      </div>

      <div className="creator-public-mobile-tip">
        <label className="creator-public-mobile-amount" htmlFor="creator-mobile-tip-amount">
          <small>Tip {creatorName}</small>
          <span>
            <span aria-hidden>$</span>
            <input
              id="creator-mobile-tip-amount"
              type="number"
              min="0.5"
              step="0.5"
              inputMode="decimal"
              value={tipAmount}
              onChange={(event) => {
                setTipAmount(event.target.value);
                setTipError(null);
                setTipSuccess(false);
              }}
              aria-label={`Tip amount for ${creatorName}`}
            />
          </span>
        </label>
        <button className="btn-primary" type="button" onClick={prepareTip}>
          <span className="material-symbols-outlined" aria-hidden>send</span>
          Tip creator
        </button>
      </div>

      <LoginModal
        open={loginOpen}
        onClose={() => {
          setLoginOpen(false);
          setPendingAfterLogin(false);
        }}
        onLogin={login}
        pendingTipSummary={`$${validAmount ? amountNumber.toFixed(2) : "0.00"} to @${profile.username}`}
      />
      <TeepTipModal
        open={confirmOpen}
        title="Review tip"
        modeLabel="Creator tip"
        recipientLabel={`@${profile.username}`}
        context="This supports the creator directly without attaching the tip to a specific post."
        amount={tipAmount}
        confirmLabel="Send tip"
        sending={tipSending}
        error={tipError}
        onAmountChange={(value) => {
          setTipAmount(value);
          setTipError(null);
        }}
        onConfirm={sendTip}
        onClose={() => {
          if (!tipSending) {
            setConfirmOpen(false);
            setTipError(null);
          }
        }}
      />
      <RechargePrompt
        open={rechargeOpen}
        onClose={() => setRechargeOpen(false)}
        onRetry={retryAfterFunding}
        amountUsd={validAmount ? amountNumber.toFixed(2) : "0.00"}
        handle={profile.username}
        embedFunding
        walletAddress={address || null}
        retryStatus={rechargeRetryStatus}
        retryMessage={rechargeRetryMessage}
      />
    </div>
  );
}
