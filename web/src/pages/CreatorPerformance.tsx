import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import CreatorDashboardShell from "../components/CreatorDashboardShell";
import { API_BASE, RECEIPT_BASE_URL } from "../config";

type Period = "7d" | "30d" | "90d" | "all";
type SupporterTab = "top" | "recent" | "repeat";

type Supporter = {
  address: string;
  truncatedAddress: string;
  displayName: string;
  teepUsername: string | null;
  socialXHandle: string | null;
  totalRaw: string;
  totalUsd: string;
  tipCount: number;
  lastTipAt: number;
  isRepeat?: boolean;
};

type PerformanceData = {
  creator: {
    username: string;
    displayName: string | null;
    authorId: string;
  };
  summary: {
    totalUsd: string;
    totalRaw: string;
    tipCount: number;
    postTipCount: number;
    directTipCount: number;
    uniqueSupporterCount: number;
    repeatSupporterCount: number;
    supportedPostCount: number;
    averageTipUsd: string;
    delta: {
      totalPercent: number | null;
      tipCount: number;
      uniqueSupporterCount: number;
      supportedPostCount: number;
    };
  };
  supportMix: {
    postTipsUsd: string;
    directTipsUsd: string;
    referralEarningsUsd: string;
    note: string;
  };
  topPosts: Array<{
    contentId: string;
    tweetId: string | null;
    authorHandle: string | null;
    xUrl: string | null;
    totalUsd: string;
    tipCount: number;
    uniqueSupporterCount: number;
    lastTipAt: number;
    hasOembedCandidate: boolean;
  }>;
  supporters: {
    top: Supporter[];
    recent: Supporter[];
    repeat: Supporter[];
  };
  latestSignals: Array<{
    type: string;
    title: string;
    amountUsd: string;
    timestamp: number;
    contentId: string;
    txHash: string;
  }>;
  decisions: Array<{
    type: string;
    title: string;
    body: string;
    contentId?: string;
    tweetId?: string | null;
    xUrl?: string | null;
  }>;
  daily: Array<{
    date: string;
    totalUsd: string;
    tipCount: number;
    postTipCount: number;
    directTipCount: number;
  }>;
  provenance: {
    computedFromRows: number;
  };
};

type ClaimStatus = {
  username: string;
  authorId: string;
};

type PostPreview = {
  excerpt: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
  unavailable?: boolean;
};

function money(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return `$${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function shortDate(date: string) {
  const parts = date.split("-");
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : date;
}

function timeAgo(timestamp: number) {
  if (!timestamp) return "No tips yet";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function postLabel(post: PerformanceData["topPosts"][number]) {
  if (post.tweetId) return `Post #${post.tweetId.slice(-6)}`;
  return "Direct support";
}

function openXIntent(text: string) {
  window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

function buildThanksCopy(supporter: Supporter) {
  const handle = supporter.socialXHandle ? `@${supporter.socialXHandle}` : supporter.displayName;
  return `Thank you ${handle} for supporting my work on Teep ${supporter.tipCount} time${supporter.tipCount === 1 ? "" : "s"} with ${money(supporter.totalUsd)}.\n\nCreator support should feel direct.`;
}

function supporterEmptyText(tab: SupporterTab) {
  if (tab === "repeat") return "Repeat supporters will appear after someone tips more than once in this period.";
  if (tab === "recent") return "Recent supporters will appear after tips are indexed.";
  return "Supporters will appear here after tips are indexed.";
}

export default function CreatorPerformance() {
  const { ready, authenticated } = usePrivy();
  const { client: smartWalletClient } = useSmartWallets();
  const address = ready && authenticated ? (smartWalletClient?.account?.address || "").toLowerCase() : "";
  const [period, setPeriod] = useState<Period>("30d");
  const [claim, setClaim] = useState<ClaimStatus | null>(null);
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [activeSupporter, setActiveSupporter] = useState<Supporter | null>(null);
  const [supporterTab, setSupporterTab] = useState<SupporterTab>("top");
  const [overlaySupporterTab, setOverlaySupporterTab] = useState<SupporterTab>("repeat");
  const [thanksStatus, setThanksStatus] = useState("");
  const [postPreviews, setPostPreviews] = useState<Record<string, PostPreview>>({});

  useEffect(() => {
    if (!address) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/auth/claim-status/${address}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled) return;
        const firstClaim = payload?.claims?.[0];
        if (payload?.verified && firstClaim?.username) {
          setClaim({ username: firstClaim.username, authorId: firstClaim.author_id || firstClaim.username });
        } else {
          setClaim(null);
          setData(null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load creator verification.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    if (!claim?.authorId && !claim?.username) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const identifier = encodeURIComponent(claim.authorId || claim.username);
    fetch(`${API_BASE}/api/v1/creators/${identifier}/performance?period=${period}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Could not load performance."))))
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load performance.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [claim, period]);

  useEffect(() => {
    if (!data?.topPosts.length) {
      setPostPreviews({});
      return;
    }
    let cancelled = false;
    const posts = data.topPosts.filter((post) => post.xUrl);
    Promise.all(
      posts.map(async (post) => {
        try {
          const response = await fetch(`${API_BASE}/api/v1/oembed?url=${encodeURIComponent(post.xUrl || "")}`);
          const json = await response.json();
          return [
            post.contentId,
            {
              excerpt: typeof json?.excerpt === "string" ? json.excerpt : null,
              authorName: typeof json?.author_name === "string" ? json.author_name : null,
              thumbnailUrl: typeof json?.thumbnail_url === "string" ? json.thumbnail_url : null,
              unavailable: Boolean(json?.unavailable),
            } satisfies PostPreview,
          ] as const;
        } catch {
          return [
            post.contentId,
            { excerpt: null, authorName: null, thumbnailUrl: null, unavailable: true } satisfies PostPreview,
          ] as const;
        }
      })
    ).then((entries) => {
      if (!cancelled) setPostPreviews(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  const maxDaily = useMemo(() => {
    if (!data?.daily.length) return 0;
    return Math.max(...data.daily.map((day) => Number(day.totalUsd || 0)));
  }, [data]);

  const totalDaily = useMemo(() => {
    if (!data?.daily.length) return 0;
    return data.daily.reduce((sum, day) => sum + Number(day.totalUsd || 0), 0);
  }, [data]);

  const dailyAxisTicks = useMemo(() => {
    if (maxDaily <= 0) return [0];
    return [maxDaily, maxDaily / 2, 0];
  }, [maxDaily]);

  const supportersToThank = useMemo(() => {
    if (!data) return [];
    return data.supporters.top;
  }, [data]);

  const getSupportersForTab = useCallback((tab: SupporterTab) => {
    if (!data) return [];
    if (tab === "recent") return data.supporters.recent || [];
    if (tab === "repeat") return data.supporters.repeat || [];
    return data.supporters.top || [];
  }, [data]);

  const visibleSupporters = getSupportersForTab(supporterTab);
  const overlaySupporters = getSupportersForTab(overlaySupporterTab);
  const selectedRepeatSupporter = activeSupporter || overlaySupporters[0] || data?.supporters.repeat[0] || data?.supporters.top.find((supporter) => supporter.isRepeat) || data?.supporters.top[0] || null;
  const latestDecision = data?.decisions.find((decision) => decision.type === "post_to_x");

  const requestWalletProof = useCallback(async () => {
    if (!address || !smartWalletClient?.account) throw new Error("Connect your creator account first.");
    const challengeRes = await fetch(`${API_BASE}/auth/wallet/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, purpose: "supporter-thank" }),
    });
    const challenge = await challengeRes.json();
    if (!challengeRes.ok || !challenge.message) throw new Error(challenge.error || "Could not verify account.");
    const signature = await smartWalletClient.signMessage({
      account: smartWalletClient.account,
      message: challenge.message,
    } as Parameters<typeof smartWalletClient.signMessage>[0]);
    return { message: challenge.message, signature };
  }, [address, smartWalletClient]);

  const openSupporterOverlay = useCallback((supporter?: Supporter | null) => {
    setOverlaySupporterTab(supporter?.isRepeat ? "repeat" : supporterTab);
    setActiveSupporter(supporter || null);
    setThanksStatus("");
    setOverlayOpen(true);
  }, [supporterTab]);

  const selectOverlaySupporterTab = useCallback((tab: SupporterTab) => {
    const nextSupporters = getSupportersForTab(tab);
    setOverlaySupporterTab(tab);
    setActiveSupporter(nextSupporters[0] || null);
    setThanksStatus("");
  }, [getSupportersForTab]);

  const handlePostTopToX = useCallback(() => {
    if (!latestDecision) return;
    const creator = data?.creator.username ? `@${data.creator.username}` : "my Teep";
    const text = latestDecision.xUrl
      ? `${creator} supporters are backing this post on Teep.\n\n${latestDecision.xUrl}`
      : `${creator} supporters are backing my work on Teep.`;
    openXIntent(text);
  }, [data, latestDecision]);

  const handleSayThanksOnX = useCallback((supporter: Supporter) => {
    openXIntent(buildThanksCopy(supporter));
  }, []);

  const handleSayThanksWithTeep = useCallback(async (supporter: Supporter) => {
    if (!claim || !address) return;
    setThanksStatus("Sending thank you...");
    try {
      const walletProof = await requestWalletProof();
      const response = await fetch(`${API_BASE}/api/v1/creators/${encodeURIComponent(claim.authorId || claim.username)}/supporters/${supporter.address}/thank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerAddress: address, walletProof }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Could not send thank you.");
      setThanksStatus("Thank you sent in Teep.");
    } catch (err) {
      setThanksStatus(err instanceof Error ? err.message : "Could not send thank you.");
    }
  }, [address, claim, requestWalletProof]);

  return (
    <CreatorDashboardShell title="Performance">
      <main className="dashboard-body-inner creator-performance">
        <section className="dashboard-page-heading creator-performance-heading">
          <div>
            <div className="dashboard-metric-label">Performance</div>
            <h1>Your support, post by post.</h1>
            <p>See which posts people tipped, who keeps supporting you, and what is worth sharing again.</p>
          </div>
          <div className="creator-performance-controls" aria-label="Performance filters">
            <div className="creator-tabs" role="tablist" aria-label="Period">
              {(["7d", "30d", "90d", "all"] as Period[]).map((value) => (
                <button key={value} type="button" className={period === value ? "is-active" : ""} onClick={() => setPeriod(value)}>
                  {value.toUpperCase()}
                </button>
              ))}
            </div>
            <button type="button" className="btn-secondary" onClick={() => window.print()}>
              <span className="material-symbols-outlined" aria-hidden>download</span>
              Export
            </button>
          </div>
        </section>

        {!address ? (
          <section className="dashboard-card creator-performance-empty">Connect your account to view creator performance.</section>
        ) : loading ? (
          <section className="dashboard-card creator-performance-empty">Loading performance...</section>
        ) : error ? (
          <section className="dashboard-card creator-performance-empty">{error}</section>
        ) : !claim ? (
          <section className="dashboard-card creator-performance-empty">Verify X before creator performance can be shown.</section>
        ) : !data ? (
          <section className="dashboard-card creator-performance-empty">No performance data yet.</section>
        ) : (
          <>
            <section className="creator-performance-stats" aria-label="Performance summary">
              {[
                { label: "Support received", value: money(data.summary.totalUsd), detail: data.summary.delta.totalPercent == null ? "No previous period baseline yet" : `${data.summary.delta.totalPercent >= 0 ? "+" : ""}${data.summary.delta.totalPercent.toFixed(1)}% vs previous`, icon: "trending_up", primary: true },
                { label: "Tips", value: String(data.summary.tipCount), detail: `${data.summary.postTipCount} post, ${data.summary.directTipCount} direct`, icon: "payments" },
                { label: "Supporters", value: String(data.summary.uniqueSupporterCount), detail: `${data.summary.repeatSupporterCount} returned`, icon: "group" },
                { label: "Posts", value: String(data.summary.supportedPostCount), detail: "Supported posts", icon: "article" },
                { label: "Avg Tip", value: money(data.summary.averageTipUsd), detail: "Per support", icon: "insert_chart" },
              ].map((card) => (
                <article className={`dashboard-metric-card creator-performance-stat${card.primary ? " is-primary" : ""}`} key={card.label}>
                  <div className="creator-performance-stat-head">
                    <div className="dashboard-metric-label">{card.label}</div>
                    <span className="material-symbols-outlined" aria-hidden>{card.icon}</span>
                  </div>
                  <div className="dashboard-metric-value">{card.value}</div>
                  <p>{card.detail}</p>
                </article>
              ))}
            </section>

            <section className="creator-performance-layout">
              <div className="creator-performance-main">
                <section className="dashboard-card creator-performance-content-card">
                  <div className="creator-section-head">
                    <div>
                      <h3>Content performance</h3>
                      <p>Ranked by confirmed support in the selected period.</p>
                    </div>
                    <span className="creator-performance-note">Showing top 7</span>
                  </div>
                  <div className="creator-performance-posts">
                    {data.topPosts.length === 0 ? (
                      <div className="creator-performance-empty-inline">Supported posts will appear here after tips are indexed.</div>
                    ) : data.topPosts.slice(0, 7).map((post) => {
                      const preview = postPreviews[post.contentId];
                      return (
                      <article className="creator-performance-post" key={post.contentId}>
                        <div className="creator-post-thumb">
                          {preview?.thumbnailUrl ? (
                            <img src={preview.thumbnailUrl} alt="" />
                          ) : (
                            <span className="material-symbols-outlined" aria-hidden>{post.hasOembedCandidate ? "tag" : "hide_image"}</span>
                          )}
                        </div>
                        <div className="creator-performance-post-body">
                          <strong>{preview?.excerpt || postLabel(post)}</strong>
                          {preview?.authorName && <small>{preview.authorName}</small>}
                          <span>{timeAgo(post.lastTipAt)} - Receipt ready {post.hasOembedCandidate ? "" : "- No thumbnail available"}</span>
                        </div>
                        <div className="creator-performance-post-money">
                          <b>{money(post.totalUsd)}</b>
                          <span>{post.tipCount} tips - {post.uniqueSupporterCount} supporters</span>
                        </div>
                        <div className="creator-row-actions">
                          {post.xUrl && <a href={post.xUrl} target="_blank" rel="noreferrer">Open post</a>}
                          <button type="button" onClick={() => openXIntent(`This post received ${money(post.totalUsd)} in support on Teep.\n\n${post.xUrl || ""}`)}>Share to X</button>
                        </div>
                      </article>
                      );
                    })}
                  </div>
                </section>

                <section className="dashboard-card creator-trend-card">
                  <div className="creator-section-head">
                    <div>
                      <h3>Support momentum</h3>
                      <p>Daily support over the selected period.</p>
                    </div>
                    <div className="creator-performance-legend">
                      <span>{money(totalDaily)} total</span>
                      <span>{money(maxDaily)} best day</span>
                      <span><i /> Post tips</span>
                      <span><i className="is-direct" /> Direct tips</span>
                    </div>
                  </div>
                  <div className="creator-trend-plot">
                    <div className="creator-trend-axis" aria-hidden>
                      {dailyAxisTicks.map((tick) => <span key={tick}>{money(tick)}</span>)}
                    </div>
                    <div className={`creator-trend-chart ${data.daily.length > 45 ? "creator-trend-chart--dense" : ""}`}>
                      {data.daily.map((day) => {
                        const value = Number(day.totalUsd || 0);
                        const height = maxDaily > 0 ? Math.max(3, Math.round((value / maxDaily) * 100)) : 3;
                        return (
                          <div className="creator-trend-bar-wrap" key={day.date} title={`${day.date}: ${money(day.totalUsd)}`}>
                            <div className={day.directTipCount > day.postTipCount ? "creator-trend-bar is-direct" : "creator-trend-bar"} style={{ height: `${height}%` }} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="creator-trend-labels">
                    <span>{shortDate(data.daily[0]?.date || "")}</span>
                    <span>{shortDate(data.daily[Math.floor(data.daily.length / 2)]?.date || "")}</span>
                    <span>{shortDate(data.daily[data.daily.length - 1]?.date || "")}</span>
                  </div>
                </section>

              </div>

              <aside className="creator-performance-side">
                <section className="dashboard-card creator-performance-decision">
                  <div className="creator-section-head">
                    <div>
                      <h3>Creator decisions</h3>
                      <p>Actions backed by current support activity.</p>
                    </div>
                  </div>
                  {latestDecision ? (
                    <div className="creator-performance-callout">
                      <span className="material-symbols-outlined" aria-hidden>auto_awesome</span>
                      <strong>{latestDecision.title}</strong>
                      <p>{latestDecision.body}</p>
                      <button type="button" className="btn-primary" onClick={handlePostTopToX}>Share to X</button>
                    </div>
                  ) : (
                    <div className="creator-performance-empty-inline">Share prompts appear after a post receives support.</div>
                  )}
                  {supportersToThank.length > 0 && (
                    <button type="button" className="creator-performance-secondary-callout" onClick={() => openSupporterOverlay(selectedRepeatSupporter)}>
                      <span className="material-symbols-outlined" aria-hidden>favorite</span>
                      <strong>Thank supporters</strong>
                      <small>
                        {supportersToThank.length} supporter{supportersToThank.length === 1 ? "" : "s"} backed you in this period. Open the list and thank them without turning this into a manual chore.
                      </small>
                      <em>View supporters</em>
                    </button>
                  )}
                </section>

                <section className="dashboard-card">
                  <div className="creator-section-head">
                    <div>
                      <h3>Latest signals</h3>
                      <p>Recent support events worth noticing.</p>
                    </div>
                  </div>
                  <div className="creator-side-stack">
                    {data.latestSignals.length === 0 ? (
                      <div className="creator-performance-empty-inline">Signals appear when new tips are indexed.</div>
                    ) : data.latestSignals.map((signal) => (
                      <div className="creator-performance-signal" key={`${signal.txHash}-${signal.contentId}`}>
                        <div className="creator-readiness-icon is-complete">
                          <span className="material-symbols-outlined" aria-hidden>{signal.type === "direct_tip_received" ? "trending_up" : "bolt"}</span>
                        </div>
                        <div>
                          <strong>{signal.title}</strong>
                          <span>{money(signal.amountUsd)} - {timeAgo(signal.timestamp)}</span>
                          <div className="creator-row-actions">
                            <a href={`${RECEIPT_BASE_URL}/tx/${signal.txHash}`}>Receipt</a>
                            <button type="button" onClick={() => openXIntent(`New Teep support received: ${money(signal.amountUsd)}.\n\nReceipt: ${RECEIPT_BASE_URL}/tx/${signal.txHash}`)}>Share to X</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="dashboard-card creator-performance-behavior-card">
                  <div className="creator-supporter-panel-tabs" aria-label="Supporter views">
                    {(["top", "recent", "repeat"] as SupporterTab[]).map((tab) => (
                      <button key={tab} type="button" className={supporterTab === tab ? "is-active" : ""} onClick={() => setSupporterTab(tab)}>
                        {tab[0].toUpperCase() + tab.slice(1)}
                      </button>
                    ))}
                  </div>
                  <div className="creator-performance-behavior-list">
                    {visibleSupporters.length === 0 ? (
                      <div className="creator-performance-empty-inline">{supporterEmptyText(supporterTab)}</div>
                    ) : visibleSupporters.slice(0, 3).map((supporter) => (
                      <button type="button" className="creator-performance-supporter-row" key={supporter.address} onClick={() => openSupporterOverlay(supporter)}>
                        <div className="creator-supporter-avatar">{supporter.displayName.slice(0, 2).replace("@", "").toUpperCase()}</div>
                        <div>
                          <strong>{supporter.displayName}</strong>
                          <span>{supporterTab === "recent" ? `${timeAgo(supporter.lastTipAt)} latest tip` : `${supporter.tipCount} tips total`}</span>
                        </div>
                        <b>{money(supporter.totalUsd)}</b>
                      </button>
                    ))}
                  </div>
                </section>
              </aside>
            </section>
          </>
        )}

        {overlayOpen && selectedRepeatSupporter && (
          <div className="creator-supporter-overlay" role="dialog" aria-modal="true" aria-label="Repeat supporter details" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOverlayOpen(false);
          }}>
            <section className="creator-supporter-panel">
              <div className="creator-supporter-panel-head">
                <div>
                  <div className="dashboard-metric-label">Repeat supporters</div>
                  <h2>Thank the people who keep showing up</h2>
                  <p>Expanded supporter detail from confirmed Teep activity.</p>
                </div>
                <button type="button" className="creator-overview-icon-btn" onClick={() => setOverlayOpen(false)} aria-label="Close">
                  <span className="material-symbols-outlined" aria-hidden>close</span>
                </button>
              </div>
              <div className="creator-supporter-panel-tabs">
                {(["top", "recent", "repeat"] as SupporterTab[]).map((tab) => (
                  <button key={tab} type="button" className={overlaySupporterTab === tab ? "is-active" : ""} onClick={() => selectOverlaySupporterTab(tab)}>
                    {tab[0].toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
              {overlaySupporters.length > 1 && (
                <div className="creator-supporter-panel-list" aria-label="Supporters to thank">
                  {overlaySupporters.slice(0, 6).map((supporter) => (
                    <button
                      type="button"
                      key={supporter.address}
                      className={supporter.address === selectedRepeatSupporter.address ? "is-active" : ""}
                      onClick={() => setActiveSupporter(supporter)}
                    >
                      <span>{supporter.displayName.slice(0, 2).replace("@", "").toUpperCase()}</span>
                      <strong>{supporter.displayName}</strong>
                      <b>{money(supporter.totalUsd)}</b>
                    </button>
                  ))}
                </div>
              )}
              <div className="creator-supporter-panel-body">
                <div className="creator-supporter-panel-avatar">{selectedRepeatSupporter.displayName.slice(0, 2).replace("@", "").toUpperCase()}</div>
                <div>
                  <h3>{selectedRepeatSupporter.displayName}</h3>
                  <p>{selectedRepeatSupporter.socialXHandle ? `@${selectedRepeatSupporter.socialXHandle}` : "No social handle saved"} - {selectedRepeatSupporter.truncatedAddress}</p>
                </div>
                <div className="creator-supporter-panel-stats">
                  <div><span>Total amount</span><b>{money(selectedRepeatSupporter.totalUsd)}</b></div>
                  <div><span>Times tipped</span><b>{selectedRepeatSupporter.tipCount}</b></div>
                </div>
                <div className="creator-supporter-panel-actions">
                  <button type="button" className="btn-primary" onClick={() => handleSayThanksOnX(selectedRepeatSupporter)}>
                    <span className="material-symbols-outlined" aria-hidden>ios_share</span>
                    Say Thanks on X
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => handleSayThanksWithTeep(selectedRepeatSupporter)}>
                    <span className="material-symbols-outlined" aria-hidden>bolt</span>
                    Say Thanks with Teep
                  </button>
                </div>
                {thanksStatus && <p className="creator-supporter-panel-status">{thanksStatus}</p>}
              </div>
            </section>
          </div>
        )}
      </main>
    </CreatorDashboardShell>
  );
}
