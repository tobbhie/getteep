import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import CreatorDashboardShell from "../components/CreatorDashboardShell";
import { API_BASE, RECEIPT_BASE_URL } from "../config";

type Period = "7d" | "30d" | "90d";
type SupporterTab = "top" | "recent" | "repeat";

type AddressIdentity = {
  displayName?: string | null;
  truncatedAddress?: string | null;
  teepUsername?: string | null;
  socialXHandle?: string | null;
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
  profileImageUrl?: string | null;
};

type Supporter = AddressIdentity & {
  address: string;
  totalUsd: string;
  tipCount: number;
  lastTipAt: number;
  isRepeat?: boolean;
};

type RecentSupport = {
  type: "direct_tip" | "post_tip";
  contentId: string;
  tweetId: string | null;
  authorHandle: string | null;
  xUrl: string | null;
  fromAddress: string;
  amountUsd: string;
  txHash: string;
  timestamp: number;
  fromIdentity: AddressIdentity | null;
};

type PerformanceData = {
  creator: {
    username: string;
    displayName: string | null;
    profileImageUrl?: string | null;
    authorId: string;
  };
  summary: {
    totalUsd: string;
    tipCount: number;
    uniqueSupporterCount: number;
    repeatSupporterCount: number;
    averageTipUsd: string;
    allTimeTotalUsd: string;
    allTimeTipCount: number;
    delta: {
      totalPercent: number | null;
      tipCount: number;
      uniqueSupporterCount: number;
      supportedPostCount: number;
    };
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
  }>;
  supporters: {
    top: Supporter[];
    recent: Supporter[];
    repeat: Supporter[];
  };
  recentSupport: RecentSupport[];
  recentSupportPage: {
    page: number;
    limit: number;
    total: number;
    pageCount: number;
  };
  daily: Array<{
    date: string;
    totalUsd: string;
    tipCount: number;
    postTipCount: number;
    directTipCount: number;
  }>;
};

type CreatorClaim = {
  username: string;
  authorId: string;
};

type AccountData = {
  tipsEarnedRaw: string;
  mainBalanceRaw: string;
  claimWalletDeployed: boolean;
};

type PostPreview = {
  excerpt: string | null;
};

const ACTIVITY_PAGE_SIZE = 5;

function money(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return `$${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function rawMoney(value: string | number | null | undefined) {
  const raw = Number(value || 0);
  return money(Number.isFinite(raw) ? raw / 1e6 : 0);
}

function identityName(_address: string, identity?: AddressIdentity | null) {
  return identity?.displayName || identity?.creatorDisplayName || "Teep supporter";
}

function initials(address: string, identity?: AddressIdentity | null) {
  return identityName(address, identity).replace(/^@/, "").slice(0, 2).toUpperCase();
}

function shortDate(value: string) {
  if (!value) return "";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function activityDate(timestamp: number) {
  if (!timestamp) return "Just now";
  return new Date(timestamp * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function periodLabel(period: Period) {
  return period.toUpperCase();
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function postFallback(post: PerformanceData["topPosts"][number]) {
  return post.tweetId ? `Post #${post.tweetId.slice(-7)}` : "Direct creator support";
}

function openShare(text: string) {
  window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

async function optionalJson(url: string) {
  try {
    const response = await fetch(url);
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

async function requiredJson(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Required creator account data is unavailable.");
  return response.json();
}

function CreatorWorkspaceSkeleton() {
  return (
    <main className="dashboard-body-inner creator-workspace creator-workspace-skeleton" aria-busy="true" aria-label="Loading creator workspace">
      <section className="creator-workspace-heading">
        <div className="creator-workspace-skeleton-copy">
          <div className="creator-workspace-heading-row">
            <span className="dashboard-skeleton-line creator-workspace-skeleton-greeting" />
            <span className="dashboard-skeleton-line creator-workspace-skeleton-profile" />
          </div>
          <span className="dashboard-skeleton-line creator-workspace-skeleton-description" />
        </div>
      </section>

      <div className="creator-workspace-grid">
        <div className="creator-workspace-main">
          <section className="creator-workspace-metrics">
            {Array.from({ length: 4 }).map((_, index) => (
              <span className="dashboard-skeleton-card creator-workspace-skeleton-metric" key={index} />
            ))}
          </section>
          <span className="dashboard-skeleton-card creator-workspace-skeleton-chart" />
          <span className="dashboard-skeleton-table creator-workspace-skeleton-table" />
        </div>
        <aside className="creator-workspace-rail">
          <span className="dashboard-skeleton-card creator-workspace-skeleton-withdraw" />
          <span className="dashboard-skeleton-card creator-workspace-skeleton-pulse" />
          <span className="dashboard-skeleton-card creator-workspace-skeleton-posts" />
        </aside>
      </div>
    </main>
  );
}

export default function CreatorDashboardHome() {
  const { ready, authenticated } = usePrivy();
  const { client: smartWalletClient } = useSmartWallets();
  const address = ready && authenticated ? (smartWalletClient?.account?.address || "").toLowerCase() : "";
  const [chartPeriod, setChartPeriod] = useState<Period>("30d");
  const [activityPage, setActivityPage] = useState(1);
  const [claim, setClaim] = useState<CreatorClaim | null>(null);
  const [account, setAccount] = useState<AccountData>({
    tipsEarnedRaw: "0",
    mainBalanceRaw: "0",
    claimWalletDeployed: false,
  });
  const [data, setData] = useState<PerformanceData | null>(null);
  const [chartData, setChartData] = useState<PerformanceData | null>(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);
  const [error, setError] = useState("");
  const [supporterTab, setSupporterTab] = useState<SupporterTab>("top");
  const [openAction, setOpenAction] = useState<string | null>(null);
  const [postPreviews, setPostPreviews] = useState<Record<string, PostPreview>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!openAction) return;
    const closeMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".creator-workspace-action-wrap")) setOpenAction(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenAction(null);
    };
    document.addEventListener("mousedown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openAction]);

  useEffect(() => {
    if (!address) {
      setAccountLoading(false);
      setClaim(null);
      return;
    }

    let cancelled = false;
    setAccountLoading(true);
    setError("");

    Promise.all([
      requiredJson(`${API_BASE}/auth/claim-status/${address}`),
      optionalJson(`${API_BASE}/auth/claim-wallet-status/${address}`),
      optionalJson(`${API_BASE}/api/v1/wallet/${address}/balance`),
      optionalJson(`${API_BASE}/api/v1/wallet/${address}/usdc-balance`),
    ]).then(([claimPayload, walletPayload, tipsPayload, mainPayload]) => {
      if (cancelled) return;
      const firstClaim = claimPayload?.verified ? claimPayload?.claims?.[0] : null;
      setClaim(firstClaim?.username ? {
        username: firstClaim.username,
        authorId: firstClaim.author_id || firstClaim.username,
      } : null);
      setAccount({
        tipsEarnedRaw: tipsPayload?.balanceRaw || "0",
        mainBalanceRaw: mainPayload?.balanceRaw || "0",
        claimWalletDeployed: Boolean(walletPayload?.deployed),
      });
    }).catch(() => {
      if (!cancelled) setError("The creator workspace could not be loaded.");
    }).finally(() => {
      if (!cancelled) setAccountLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [address, reloadKey]);

  useEffect(() => {
    if (!claim) {
      setData(null);
      setPerformanceLoading(false);
      return;
    }

    let cancelled = false;
    setPerformanceLoading(true);
    setError("");
    const identifier = encodeURIComponent(claim.authorId || claim.username);
    fetch(
      `${API_BASE}/api/v1/creators/${identifier}/performance?period=30d&recentPage=${activityPage}&recentLimit=${ACTIVITY_PAGE_SIZE}`,
    )
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load creator activity.")))
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load creator activity.");
      })
      .finally(() => {
        if (!cancelled) setPerformanceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activityPage, claim, reloadKey]);

  useEffect(() => {
    if (!claim || chartPeriod === "30d") {
      setChartData(null);
      setChartLoading(false);
      return;
    }

    let cancelled = false;
    setChartLoading(true);
    const identifier = encodeURIComponent(claim.authorId || claim.username);
    fetch(`${API_BASE}/api/v1/creators/${identifier}/performance?period=${chartPeriod}&recentPage=1&recentLimit=1`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load the selected chart period.")))
      .then((payload) => {
        if (!cancelled) setChartData(payload);
      })
      .catch(() => {
        if (!cancelled) setChartData(null);
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [chartPeriod, claim, reloadKey]);

  useEffect(() => {
    if (!data?.topPosts.length) {
      setPostPreviews({});
      return;
    }

    let cancelled = false;
    const candidates = data.topPosts.filter((post) => post.xUrl).slice(0, 3);
    Promise.all(candidates.map(async (post) => {
      const payload = await optionalJson(`${API_BASE}/api/v1/oembed?url=${encodeURIComponent(post.xUrl || "")}`);
      return [post.contentId, { excerpt: payload?.excerpt || null }] as const;
    })).then((entries) => {
      if (!cancelled) setPostPreviews(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [data?.topPosts]);

  const supporters = useMemo(() => {
    if (!data) return [];
    return data.supporters[supporterTab] || [];
  }, [data, supporterTab]);

  const chartReport = chartPeriod === "30d" ? data : chartData;
  const chartMax = useMemo(
    () => Math.max(0, ...(chartReport?.daily || []).map((day) => Number(day.totalUsd || 0))),
    [chartReport?.daily],
  );

  const withdrawalState = useMemo(() => {
    const balance = Number(account.tipsEarnedRaw || 0);
    if (!account.claimWalletDeployed) return { label: "Setup needed", ready: false };
    if (balance <= 0) return { label: "No balance", ready: false };
    return { label: "Ready", ready: true };
  }, [account]);

  const retry = useCallback(() => setReloadKey((value) => value + 1), []);
  const initialLoading = accountLoading || Boolean(claim && performanceLoading && !data);
  const pageCount = data?.recentSupportPage?.pageCount || 1;
  const safeActivityPage = Math.min(activityPage, pageCount);
  const chartDelta = chartReport?.summary.delta.totalPercent;
  const creatorName = data?.creator.displayName || (data?.creator.username ? `@${data.creator.username}` : claim?.username ? `@${claim.username}` : "creator");

  return (
    <CreatorDashboardShell title="Overview">
      {initialLoading ? (
        <CreatorWorkspaceSkeleton />
      ) : !claim ? (
        <main className="dashboard-body-inner creator-workspace">
          <section className="dashboard-card creator-workspace-state">
            <span className="material-symbols-outlined" aria-hidden>verified_user</span>
            <h1>Connect your creator identity</h1>
            <p>Verify your X creator account before Teep can attribute support, posts, and payout balances to this workspace.</p>
            <Link className="btn-primary" to="/creator/settings">Open creator settings</Link>
          </section>
        </main>
      ) : error && !data ? (
        <main className="dashboard-body-inner creator-workspace">
          <section className="dashboard-card creator-workspace-state" role="alert">
            <span className="material-symbols-outlined" aria-hidden>cloud_off</span>
            <h1>Creator data is unavailable</h1>
            <p>{error}</p>
            <button type="button" className="btn-primary" onClick={retry}>Try again</button>
          </section>
        </main>
      ) : data ? (
        <main id="main-content" className="dashboard-body-inner creator-workspace" aria-busy={performanceLoading || chartLoading}>
          <section className="creator-workspace-heading">
            <div className="creator-workspace-heading-row">
              <span className="creator-workspace-greeting">{greeting()}, {creatorName}</span>
              <Link
                className="btn-secondary creator-workspace-profile creator-workspace-profile--desktop"
                to={`/creator/${data.creator.username}`}
                aria-label={`View @${data.creator.username}'s public profile`}
              >
                <span className="material-symbols-outlined" aria-hidden>open_in_new</span>
                <span>Public profile</span>
              </Link>
            </div>
            <p>Track what your audience supports, understand which posts work, and move earned tips when you are ready.</p>
            <Link
              className="creator-workspace-profile creator-workspace-profile--mobile"
              to={`/creator/${data.creator.username}`}
              aria-label={`View @${data.creator.username}'s public profile`}
            >
              <span>View public profile</span>
              <span className="material-symbols-outlined" aria-hidden>open_in_new</span>
            </Link>
          </section>

          <div className="creator-workspace-grid">
            <div className="creator-workspace-main">
              <section className="creator-workspace-metrics" aria-label="Creator support summary">
                {[
                  {
                    label: "Support received",
                    value: money(data.summary.allTimeTotalUsd),
                    detail: "Across all confirmed tips",
                    icon: "payments",
                  },
                  {
                    label: "Tips in 30D",
                    value: String(data.summary.tipCount),
                    detail: `${data.summary.delta.tipCount >= 0 ? "+" : ""}${data.summary.delta.tipCount} from the previous 30 days`,
                    icon: "bolt",
                  },
                  {
                    label: "Supporters in 30D",
                    value: String(data.summary.uniqueSupporterCount),
                    detail: `${data.summary.repeatSupporterCount} returned to tip again`,
                    icon: "group",
                  },
                  {
                    label: "Average tip",
                    value: money(data.summary.averageTipUsd),
                    detail: "Per confirmed tip in 30D",
                    icon: "monitoring",
                  },
                ].map((metric) => (
                  <article className="creator-workspace-metric" key={metric.label}>
                    <div className="creator-workspace-metric-head">
                      <span>{metric.label}</span>
                      <span className="material-symbols-outlined" aria-hidden>{metric.icon}</span>
                    </div>
                    <strong>{metric.value}</strong>
                    <small>{metric.detail}</small>
                  </article>
                ))}
              </section>

              <section className="creator-workspace-section">
                <div className="creator-workspace-section-head">
                  <div>
                    <h2>Earnings report</h2>
                    <p>Confirmed creator support received over time.</p>
                  </div>
                  <div className="creator-workspace-period" role="tablist" aria-label="Earnings period">
                    {(["7d", "30d", "90d"] as Period[]).map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={chartPeriod === value}
                        className={chartPeriod === value ? "is-active" : ""}
                        onClick={() => setChartPeriod(value)}
                      >
                        {periodLabel(value)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="creator-workspace-chart-panel" aria-busy={chartLoading}>
                  <div className="creator-workspace-chart-summary">
                    <div>
                      <strong>{money(chartReport?.summary.totalUsd)}</strong>
                      <span>Received this period</span>
                    </div>
                    <span className={chartDelta != null && chartDelta < 0 ? "is-negative" : ""}>
                      {chartDelta == null
                        ? "No previous-period baseline yet"
                        : `${chartDelta >= 0 ? "+" : ""}${chartDelta.toFixed(1)}% from previous period`}
                    </span>
                  </div>

                  <div className={`creator-workspace-chart${(chartReport?.daily.length || 0) > 45 ? " is-dense" : ""}`} aria-label={`Creator earnings for ${periodLabel(chartPeriod)}`}>
                    <div className="creator-workspace-chart-axis" aria-hidden>
                      <span>{money(chartMax)}</span>
                      <span>{money(chartMax / 2)}</span>
                      <span>$0.00</span>
                    </div>
                    <div className="creator-workspace-bars" style={{ gridTemplateColumns: `repeat(${chartReport?.daily.length || 1}, minmax(0, 1fr))` }}>
                      {(chartReport?.daily || []).map((day) => {
                        const amount = Number(day.totalUsd || 0);
                        const height = chartMax > 0 ? Math.max(amount > 0 ? 6 : 2, (amount / chartMax) * 100) : 2;
                        const mixClass = day.directTipCount > 0 && day.postTipCount > 0
                          ? "is-mixed"
                          : day.directTipCount > day.postTipCount
                            ? "is-direct"
                            : "is-post";
                        return (
                          <div
                            className="creator-workspace-bar-wrap"
                            key={day.date}
                            title={`${shortDate(day.date)}: ${money(day.totalUsd)} from ${day.tipCount} tip${day.tipCount === 1 ? "" : "s"}`}
                            aria-label={`${shortDate(day.date)}, ${money(day.totalUsd)}, ${day.tipCount} tips`}
                          >
                            <span
                              className={`creator-workspace-bar ${mixClass}`}
                              style={{ "--bar-height": `${height}%` } as CSSProperties}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="creator-workspace-chart-labels" aria-hidden>
                    <span>{shortDate(chartReport?.daily[0]?.date || "")}</span>
                    <span>{shortDate(chartReport?.daily[Math.floor((chartReport?.daily.length || 1) / 2)]?.date || "")}</span>
                    <span>{shortDate(chartReport?.daily[(chartReport?.daily.length || 1) - 1]?.date || "")}</span>
                  </div>
                  <div className="creator-workspace-chart-legend" aria-label="Chart legend">
                    <span><i className="is-post" />Post support</span>
                    <span><i className="is-direct" />Direct support</span>
                    <span><i className="is-mixed" />Mixed day</span>
                  </div>
                </div>
              </section>

              <section className="creator-workspace-section">
                <div className="creator-workspace-section-head">
                  <div>
                    <h2>Recent support</h2>
                    <p>Latest confirmed tips with their post and receipt status.</p>
                  </div>
                  {performanceLoading && <span className="creator-workspace-refreshing" role="status">Updating</span>}
                </div>

                <div className="creator-workspace-activity">
                  {data.recentSupport.length === 0 ? (
                    <div className="dashboard-empty-state">New confirmed tips will appear here after they are indexed.</div>
                  ) : (
                    <div className="creator-workspace-table-wrap">
                      <table className="creator-workspace-table">
                        <thead>
                          <tr>
                            <th>Supporter</th>
                            <th>Amount</th>
                            <th>Supported post</th>
                            <th>Date</th>
                            <th>Status</th>
                            <th><span className="visually-hidden">Actions</span></th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.recentSupport.map((item) => {
                            const actionKey = `${item.txHash}-${item.contentId}`;
                            const supporterName = identityName(item.fromAddress, item.fromIdentity);
                            return (
                              <tr key={actionKey}>
                                <td data-label="Supporter">
                                  <span className="creator-workspace-supporter">
                                    <span className="creator-workspace-avatar">{initials(item.fromAddress, item.fromIdentity)}</span>
                                    <strong>{supporterName}</strong>
                                  </span>
                                </td>
                                <td data-label="Amount"><strong className="creator-workspace-amount">{money(item.amountUsd)}</strong></td>
                                <td data-label="Supported post">
                                  {item.xUrl ? (
                                    <a className="creator-workspace-post-link" href={item.xUrl} target="_blank" rel="noreferrer">
                                      {item.type === "direct_tip" ? "Direct creator support" : "Open supported post"}
                                    </a>
                                  ) : (
                                    <span className="creator-workspace-post-link">{item.type === "direct_tip" ? "Direct creator support" : "Supported post"}</span>
                                  )}
                                </td>
                                <td data-label="Date">{activityDate(item.timestamp)}</td>
                                <td data-label="Status"><span className="creator-workspace-status">Confirmed</span></td>
                                <td className="creator-workspace-action-cell">
                                  <div className="creator-workspace-action-wrap">
                                    <button
                                      type="button"
                                      className="creator-workspace-action-button"
                                      aria-label={`Actions for ${supporterName}`}
                                      aria-expanded={openAction === actionKey}
                                      onClick={() => setOpenAction((current) => current === actionKey ? null : actionKey)}
                                    >
                                      <span className="material-symbols-outlined" aria-hidden>more_horiz</span>
                                    </button>
                                    {openAction === actionKey && (
                                      <div className="creator-workspace-action-menu">
                                        {item.xUrl && (
                                          <a href={item.xUrl} target="_blank" rel="noreferrer">
                                            <span className="material-symbols-outlined" aria-hidden>open_in_new</span>
                                            View post
                                          </a>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => openShare(
                                            `Thank you ${supporterName} for supporting my work with ${money(item.amountUsd)} on Teep.\n\nReceipt: ${RECEIPT_BASE_URL}/tx/${item.txHash}`,
                                          )}
                                        >
                                          <span className="material-symbols-outlined" aria-hidden>ios_share</span>
                                          Share to X
                                        </button>
                                        <a href={`${RECEIPT_BASE_URL}/tx/${item.txHash}`}>
                                          <span className="material-symbols-outlined" aria-hidden>receipt_long</span>
                                          View receipt
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {data.recentSupportPage.total > 0 && (
                    <div className="creator-workspace-pagination">
                      <span>
                        Showing {(safeActivityPage - 1) * ACTIVITY_PAGE_SIZE + 1}-
                        {Math.min(safeActivityPage * ACTIVITY_PAGE_SIZE, data.recentSupportPage.total)} of {data.recentSupportPage.total} tips
                      </span>
                      <div>
                        <button
                          type="button"
                          aria-label="Previous support page"
                          disabled={safeActivityPage <= 1 || performanceLoading}
                          onClick={() => setActivityPage((current) => Math.max(1, current - 1))}
                        >
                          <span className="material-symbols-outlined" aria-hidden>chevron_left</span>
                        </button>
                        <strong>{safeActivityPage} / {pageCount}</strong>
                        <button
                          type="button"
                          aria-label="Next support page"
                          disabled={safeActivityPage >= pageCount || performanceLoading}
                          onClick={() => setActivityPage((current) => Math.min(pageCount, current + 1))}
                        >
                          <span className="material-symbols-outlined" aria-hidden>chevron_right</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>

            <aside className="creator-workspace-rail">
              <section className="creator-workspace-withdraw">
                <div className="creator-workspace-withdraw-top">
                  <span>Available to withdraw</span>
                  <span className={withdrawalState.ready ? "is-ready" : ""}>
                    <i aria-hidden />
                    {withdrawalState.label}
                  </span>
                </div>
                <strong>{rawMoney(account.tipsEarnedRaw)}</strong>
                <p>Earned creator tips held in your claim wallet and available to move.</p>
                <div className="creator-workspace-withdraw-actions">
                  {Number(account.tipsEarnedRaw || 0) > 0 ? (
                    <Link className="btn-primary" to="/creator/withdraw?source=tipsEarned">
                      <span className="material-symbols-outlined" aria-hidden>account_balance_wallet</span>
                      Withdraw
                    </Link>
                  ) : (
                    <button type="button" className="btn-primary" disabled>
                      <span className="material-symbols-outlined" aria-hidden>account_balance_wallet</span>
                      No funds
                    </button>
                  )}
                  <Link className="btn-secondary creator-workspace-grow-action" to="/creator/grow/earn">
                    <span className="material-symbols-outlined" aria-hidden>eco</span>
                    Grow Tips
                  </Link>
                </div>
                <div className="creator-workspace-balance-split">
                  <div><span>Tips earned</span><strong>{rawMoney(account.tipsEarnedRaw)}</strong></div>
                  <div><span>Main balance</span><strong>{rawMoney(account.mainBalanceRaw)}</strong></div>
                </div>
              </section>

              <section className="creator-workspace-rail-section">
                <div className="creator-workspace-section-head">
                  <div>
                    <h2>Supporter pulse</h2>
                    <p>Who is returning and driving momentum.</p>
                  </div>
                  <div className="creator-workspace-supporter-tabs" role="tablist" aria-label="Supporter view">
                    {(["top", "recent", "repeat"] as SupporterTab[]).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        role="tab"
                        aria-selected={supporterTab === tab}
                        className={supporterTab === tab ? "is-active" : ""}
                        onClick={() => setSupporterTab(tab)}
                      >
                        {tab[0].toUpperCase() + tab.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="creator-workspace-pulse-summary">
                  <div>
                    <span>Returning</span>
                    <strong>{data.summary.repeatSupporterCount} of {data.summary.uniqueSupporterCount}</strong>
                    <small>
                      {data.summary.uniqueSupporterCount
                        ? `${Math.round((data.summary.repeatSupporterCount / data.summary.uniqueSupporterCount) * 100)}% repeat rate`
                        : "No supporter baseline"}
                    </small>
                  </div>
                  <div>
                    <span>Momentum</span>
                    <strong>{data.summary.tipCount}</strong>
                    <small>Tips in 30D</small>
                  </div>
                </div>

                <div className="creator-workspace-supporter-list">
                  {supporters.length === 0 ? (
                    <div className="creator-workspace-inline-empty">
                      {supporterTab === "repeat" ? "Repeat supporters will appear after someone tips more than once." : "Supporters will appear after tips are indexed."}
                    </div>
                  ) : supporters.slice(0, 3).map((supporter) => (
                    <Link to={`/tipper/${supporter.address}`} className="creator-workspace-supporter-row" key={supporter.address}>
                      <span className="creator-workspace-avatar">{initials(supporter.address, supporter)}</span>
                      <span>
                        <strong>{identityName(supporter.address, supporter)}</strong>
                        <small>{supporter.tipCount} tip{supporter.tipCount === 1 ? "" : "s"}</small>
                      </span>
                      <b>{money(supporter.totalUsd)}</b>
                    </Link>
                  ))}
                </div>
              </section>

              <section className="creator-workspace-rail-section">
                <div className="creator-workspace-section-head">
                  <div>
                    <h2>Top posts</h2>
                    <p>Ranked by support received.</p>
                  </div>
                  <span className="creator-workspace-period-label">30D</span>
                </div>
                <div className="creator-workspace-post-list">
                  {data.topPosts.length === 0 ? (
                    <div className="creator-workspace-inline-empty">Supported posts will appear after tips are indexed.</div>
                  ) : data.topPosts.slice(0, 3).map((post) => (
                    <a
                      className="creator-workspace-top-post"
                      href={post.xUrl || undefined}
                      target={post.xUrl ? "_blank" : undefined}
                      rel={post.xUrl ? "noreferrer" : undefined}
                      aria-disabled={!post.xUrl}
                      key={post.contentId}
                    >
                      <span>
                        <strong>{postPreviews[post.contentId]?.excerpt || postFallback(post)}</strong>
                        <small>{post.tipCount} tips - {post.uniqueSupporterCount} supporters</small>
                      </span>
                      <b>{money(post.totalUsd)}</b>
                    </a>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </main>
      ) : (
        <CreatorWorkspaceSkeleton />
      )}
    </CreatorDashboardShell>
  );
}
