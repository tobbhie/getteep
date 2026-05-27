import { useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import DashboardShell from "../components/DashboardShell";
import TeepTipModal from "../components/TeepTipModal";

const DEV_ADDRESS = "0xa0dfd197c2011fc1b78f542ac587265765e77794";
const pages = new Set(["dashboard", "discover", "referrals", "settings"]);

const creators = [
  {
    handle: "pipsandbills",
    name: "Alter Ego",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=pipsandbills",
    total: "$56.05",
    tips: 11,
    status: "Top Supported",
  },
  {
    handle: "maya_builds",
    name: "Product builder",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=maya",
    total: "$18.20",
    tips: 7,
    status: "Trending",
  },
];

const activityRows = [
  ["@pipsandbills", "Post Tip", "$1.00", "May 14, 2026"],
  ["@pipsandbills", "Direct Creator Tip", "$5.00", "May 14, 2026"],
  ["@maya_builds", "Post Tip", "$0.50", "May 13, 2026"],
  ["@designnotes", "Post Tip", "$0.50", "May 13, 2026"],
  ["@xyberinc", "Direct Creator Tip", "$2.00", "May 12, 2026"],
  ["@visual_monk", "Post Tip", "$1.50", "May 11, 2026"],
  ["@sara_codes", "Post Tip", "$0.75", "May 10, 2026"],
];

const discoverPosts = [
  {
    handle: "pipsandbills",
    name: "Alter Ego",
    total: "$56.05",
    tippers: 3,
    today: "0 tips",
    badge: "3 people tipped this post",
    quote: "I had a discussion with @mztacat recently where the creator economy finally clicked: support should live where the post already lives.",
  },
  {
    handle: "maya_builds",
    name: "Maya Builds",
    total: "$18.20",
    tippers: 4,
    today: "2 tips",
    badge: "High velocity",
    quote: "Creator tools need to feel invisible until the moment support happens. No new behavior to teach, just native appreciation.",
  },
  {
    handle: "sara_codes",
    name: "Frontend engineer",
    total: "$12.40",
    tippers: 2,
    today: "1 tip",
    badge: "Top post",
    quote: "The new tipping flow feels like a tiny receipt layer for the social web. That is exactly the kind of abstraction I want.",
  },
  {
    handle: "designnotes",
    name: "Design Notes",
    total: "$8.20",
    tippers: 2,
    today: "0 tips",
    badge: "Awaiting claim",
    quote: "Creators should not need to become finance experts before their audience can support them.",
  },
];

function DashboardPreview() {
  const [tipOpen, setTipOpen] = useState(false);
  const [activityMenuOpen, setActivityMenuOpen] = useState<string | null>(null);
  return (
    <div className="dashboard-body-inner">
      <div className="dashboard-page-heading">
        <div>
          <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 var(--space-1)", letterSpacing: "-0.02em" }}>Your creator support</h1>
          <p style={{ color: "var(--text-secondary)", margin: 0 }}>Tip again, track receipts, and see when creators can claim what you sent.</p>
        </div>
      </div>

      <div className="dashboard-tipper-overview">
        <div className="dashboard-metric-card dashboard-balance-readiness">
          <div className="dashboard-metric-label">Balance Readiness</div>
          <div className="dashboard-metric-value">$26.88<span className="dashboard-metric-value-sub">USD</span></div>
          <div className="dashboard-ready-state"><span aria-hidden />Ready to tip</div>
          <div className="dashboard-balance-actions">
            <button type="button" className="btn-primary"><span className="material-symbols-outlined" aria-hidden>add_circle</span>Add Funds</button>
            <a href="#withdraw" className="dashboard-balance-withdraw"><span className="material-symbols-outlined" aria-hidden>arrow_downward</span>Withdraw</a>
          </div>
          <div className="dashboard-balance-watermark" aria-hidden>$</div>
        </div>

        <div className="dashboard-metric-card dashboard-tip-impact">
          <div className="dashboard-impact-main">
            <div className="dashboard-impact-icon"><span className="material-symbols-outlined" aria-hidden>volunteer_activism</span></div>
            <div>
              <div className="dashboard-impact-title">You supported 2 creators</div>
              <div className="dashboard-metric-footer">Across 18 tips this month</div>
            </div>
          </div>
          <div className="dashboard-impact-stats">
            <div>
              <div className="dashboard-metric-label">Most Supported</div>
              <div className="dashboard-most-supported"><img src={creators[0].avatar} alt="" /><span>@pipsandbills</span></div>
            </div>
            <div>
              <div className="dashboard-metric-label">Average Tip</div>
              <div className="dashboard-impact-stat">$0.82</div>
            </div>
          </div>
        </div>

        <div className="dashboard-metric-card dashboard-referral-impact-card">
          <div className="dashboard-referral-impact-watermark" aria-hidden><span className="material-symbols-outlined">rocket_launch</span></div>
          <div className="dashboard-metric-label">Referral Impact</div>
          <h3>Invite users to Teep</h3>
          <p>Invite users and earn when eligible referred withdrawals happen.</p>
          <a href="#referral" className="dashboard-referral-impact-action">Share Invite Link</a>
        </div>

        <div className="dashboard-metric-card dashboard-next-action">
          <div className="dashboard-next-action-main">
            <div className="dashboard-metric-label">Next Best Action</div>
            <h3>Invite @designnotes to claim</h3>
            <p>Your tips are sent. Help this creator discover Teep and activate their receiving account.</p>
            <div className="dashboard-next-target">
              <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=designnotes" alt="" className="dashboard-next-target-avatar" />
              <div><strong>@designnotes</strong><span>$8.20 sent across 3 tips</span></div>
              <span>Awaiting claim</span>
            </div>
          </div>
          <div className="dashboard-next-action-side">
            <div><div className="dashboard-metric-label">Invite 1 of 3</div><p>Share a ready-made X post that points the creator back to Teep.</p></div>
            <a href="#share" className="btn-primary">Share Invite to X</a>
          </div>
        </div>
      </div>

      <div className="dashboard-section-heading"><h3>Creators to tip again</h3></div>
      <div className="dashboard-creator-repeat-grid">
        {creators.map((creator) => (
          <div key={creator.handle} className="dashboard-repeat-card">
            <div className="dashboard-repeat-cover" />
            <div className="dashboard-repeat-body">
              <img src={creator.avatar} alt="" className="dashboard-repeat-avatar" />
              <h4>@{creator.handle}<span>{creator.status}</span></h4>
              <p>{creator.name}</p>
              <div className="dashboard-repeat-stats">
                <div><span>Total Tipped</span><strong>{creator.total}</strong></div>
                <div><span>Tips Given</span><strong>{creator.tips}</strong></div>
              </div>
              <button type="button" className="btn-primary" onClick={() => setTipOpen(true)}>Send Direct Tip</button>
            </div>
          </div>
        ))}
        <Link to="/dashboard/dev-preview?page=discover" className="dashboard-repeat-card dashboard-repeat-discover">
          <div>
            <div className="dashboard-impact-icon"><span className="material-symbols-outlined" aria-hidden>person_add</span></div>
            <h4>Discover creators on Teep</h4>
            <p>Creators receiving support across Teep.</p>
          </div>
        </Link>
      </div>

      <div className="dashboard-activity-section">
        <div className="dashboard-history-header dashboard-history-header--table">
          <div><div className="dashboard-metric-label">Activity</div><h3 style={{ fontSize: "1.25rem", margin: 0 }}>Tip activity and receipts</h3></div>
          <div className="dashboard-history-tools">
            <button type="button" className="btn-secondary">Download CSV</button>
            <button type="button" className="dashboard-filter-icon-btn" aria-label="Filter activity"><span className="material-symbols-outlined" aria-hidden>tune</span></button>
          </div>
        </div>
        <div className="dashboard-card" style={{ padding: 0 }}>
          <div className="dashboard-table-container">
            <table className="dashboard-table">
              <thead><tr><th>Creator</th><th>Amount</th><th>Date</th><th>Actions</th></tr></thead>
              <tbody>
                {activityRows.map((row) => {
                  const actionKey = `${row[0]}-${row[1]}-${row[3]}`;
                  const isActionMenuOpen = activityMenuOpen === actionKey;

                  return (
                  <tr key={actionKey}>
                    <td><div className="dashboard-table-cell-content" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}><span style={{ fontWeight: 700 }}>{row[0]}</span><span className={`dashboard-history-type-pill ${row[1].startsWith("Direct") ? "is-direct" : "is-post"}`}>{row[1]}</span></div></td>
                    <td style={{ fontWeight: 700 }}>{row[2]}</td>
                    <td>{row[3]}</td>
                    <td>
                      <div className="dashboard-history-menu-wrap">
                        <button
                          type="button"
                          className="dashboard-history-menu-trigger"
                          aria-label="Activity actions"
                          aria-expanded={isActionMenuOpen}
                          onClick={() => setActivityMenuOpen((open) => open === actionKey ? null : actionKey)}
                        >
                          <span className="material-symbols-outlined" aria-hidden>more_horiz</span>
                        </button>
                        {isActionMenuOpen && (
                          <div className="dashboard-history-actions-menu">
                            <a href="#post" className="dashboard-history-action" onClick={() => setActivityMenuOpen(null)}>
                              <span className="material-symbols-outlined" aria-hidden>open_in_new</span>
                              Post
                            </a>
                            <button type="button" className="dashboard-history-action" onClick={() => setActivityMenuOpen(null)}>
                              <span className="material-symbols-outlined" aria-hidden>ios_share</span>
                              Share to X
                            </button>
                            <button type="button" className="dashboard-history-action" onClick={() => setActivityMenuOpen(null)}>
                              <span className="material-symbols-outlined" aria-hidden>receipt_long</span>
                              Download Receipt
                            </button>
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
        </div>
      </div>
      <TeepTipModal open={tipOpen} title="Tip this creator" modeLabel="Direct tip" recipientLabel="@pipsandbills" context="This sends support directly to the creator without tying it to a post." amount="5.00" onAmountChange={() => {}} confirmLabel="Send Direct Tip" onConfirm={() => {}} onClose={() => setTipOpen(false)} />
    </div>
  );
}

function DiscoverPreview() {
  const [tipOpen, setTipOpen] = useState(false);
  return (
    <main className="dashboard-body-inner dashboard-discover-page">
      <div className="dashboard-discover-hero">
        <div><h1>Discover Creators</h1><p>Find tipped posts, active creators, and people with support waiting to be claimed.</p></div>
        <div className="dashboard-discover-search-wrap"><label className="dashboard-discover-search"><span className="material-symbols-outlined" aria-hidden>search</span><input type="search" placeholder="Search creators, handles, or tipped posts" /></label></div>
      </div>
      <div className="dashboard-discover-tabs" role="tablist" aria-label="Creator discovery filters">
        {["Trending", "Recent", "Top Creators", "Unclaimed", "Tipped Before"].map((label, index) => <button key={label} type="button" className={index === 0 ? "is-active" : ""}>{label}</button>)}
      </div>
      <div className="dashboard-discover-grid-v2">
        <div className="dashboard-discover-main">
          <section>
            <div className="dashboard-discover-section-head"><div><h3>Trending tipped posts</h3><p>Posts receiving support from tippers right now.</p></div></div>
            <div className="dashboard-discover-card-grid">
              {discoverPosts.map((post) => (
                <article key={post.handle + post.total} className="dashboard-discover-post-card dashboard-card">
                  <div className="dashboard-discover-card-top">
                    <div className="dashboard-discover-identity"><img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${post.handle}`} alt="" /><div><strong>@{post.handle}</strong><span>{post.name} · tip received recently</span></div></div>
                    <span className="dashboard-discover-badge is-green">{post.badge}</span>
                  </div>
                  <blockquote className="dashboard-discover-x-quote"><span>X post</span><p>{post.quote}</p></blockquote>
                  <div className="dashboard-discover-metrics"><div><span>Tipped</span><strong>{post.total}</strong></div><div><span>Tippers</span><strong>{post.tippers}</strong></div><div><span>Today</span><strong>{post.today}</strong></div></div>
                  <div className="dashboard-discover-actions"><button type="button" className="btn-primary" onClick={() => setTipOpen(true)}>Tip Post</button><a href="#x" className="btn-secondary">Open on X</a><a href="#share" className="btn-secondary dashboard-discover-icon-btn" aria-label="Share post"><span className="material-symbols-outlined" aria-hidden>ios_share</span></a></div>
                </article>
              ))}
            </div>
          </section>
          <section>
            <div className="dashboard-discover-section-head"><div><h3>Recommended creators</h3><p>Recommendations follow recent tips, unique supporters, unclaimed support, re-tip activity, and similarity to creators you tipped.</p></div></div>
            <div className="dashboard-discover-creator-list">
              {creators.map((creator, index) => (
                <article key={creator.handle} className="dashboard-discover-creator-row dashboard-card">
                  <div className="dashboard-discover-creator-main">
                    <img src={creator.avatar} alt="" />
                    <div><h4>@{creator.handle}<span className={`dashboard-discover-badge ${index ? "is-amber" : "is-purple"}`}>{index ? "Awaiting claim" : "Verified"}</span></h4><p>{creator.name}</p><div className="dashboard-discover-reason"><span className="material-symbols-outlined" aria-hidden>repeat</span>High re-tip activity</div><div className="dashboard-discover-inline-signal">{creator.total} received · {creator.tips} posts</div></div>
                  </div>
                  <div className="dashboard-discover-row-actions"><button type="button" className="btn-primary" onClick={() => setTipOpen(true)}>{index ? "Tip Anyway" : "Send Direct Tip"}</button><button type="button" className="btn-secondary">View Details</button></div>
                </article>
              ))}
            </div>
          </section>
        </div>
        <aside className="dashboard-discover-rail">
          <section className="dashboard-card dashboard-discover-rail-card"><div className="dashboard-discover-rail-head"><h3>Top creators</h3><div className="dashboard-discover-period-toggle"><button className="is-active" type="button">This week</button><button type="button">All time</button></div></div><div className="dashboard-discover-rail-list">{creators.map((creator, i) => <button key={creator.handle} type="button"><span>{i + 1}</span><img src={creator.avatar} alt="" /><strong>{creator.handle}</strong><b>{creator.total}</b></button>)}</div></section>
          <section className="dashboard-card dashboard-discover-rail-card"><div className="dashboard-discover-rail-head"><h3>Tips waiting</h3></div><div className="dashboard-discover-waiting-list"><div><span className="material-symbols-outlined" aria-hidden>alternate_email</span><div><strong>@designnotes</strong><small>$8.20 pending · 3 tips</small></div><a href="#invite">Invite</a></div></div></section>
          <section className="dashboard-card dashboard-discover-rail-card"><div className="dashboard-discover-rail-head"><h3>Your tipping orbit</h3></div><div className="dashboard-discover-orbit"><div className="dashboard-discover-orbit-ring dashboard-discover-orbit-ring--outer"><span className="dashboard-discover-orbit-dot is-purple" /></div><div className="dashboard-discover-orbit-ring dashboard-discover-orbit-ring--inner"><span className="dashboard-discover-orbit-dot is-green" /><span className="dashboard-discover-orbit-dot is-amber" /></div><div className="dashboard-discover-orbit-center"><span className="material-symbols-outlined" aria-hidden>person</span></div><div className="dashboard-discover-orbit-caption"><span>Connections</span><strong>2 creators</strong></div></div></section>
        </aside>
      </div>
      <TeepTipModal open={tipOpen} title="Tip this post" modeLabel="Post tip" recipientLabel="@pipsandbills" context="Receipt and share copy stay tied to this X post." amount="5.00" onAmountChange={() => {}} confirmLabel="Send Post Tip" onConfirm={() => {}} onClose={() => setTipOpen(false)} />
    </main>
  );
}

function ReferralsPreview() {
  return (
    <main className="dashboard-body-inner">
      <div className="dashboard-page-heading"><div><h1>Referral program</h1><p>Invite people to Teep and earn when referred users become active and withdraw earned tips.</p></div></div>
      <div className="dashboard-referral-grid">
        <section className="dashboard-metric-card dashboard-referral-hero"><div className="dashboard-metric-label">Your Referral Link</div><h3>Ready to share</h3><div className="dashboard-referral-link-box"><span>https://teep.app/?ref=THEVIRUS</span></div><div className="dashboard-referral-actions"><button type="button" className="btn-primary">Copy Link</button><a href="#x" className="btn-secondary">Share to X</a></div></section>
        <section className="dashboard-metric-card"><div className="dashboard-metric-label">Eligible referrals</div><div className="dashboard-metric-value">4<span className="dashboard-metric-value-sub">users</span></div><p className="dashboard-metric-footer">Fees are credited after eligible referred withdrawals.</p></section>
      </div>
      <div className="dashboard-referral-split"><div className="dashboard-card"><h3>Fee split</h3><p>Referral rewards come from eligible Teep fees. The referred user keeps their normal product experience.</p></div><div className="dashboard-card"><h3>Anti-gaming</h3><p>Self-referrals, duplicated accounts, and suspicious withdrawal loops are excluded from referral earnings.</p></div></div>
    </main>
  );
}

function SettingsPreview() {
  const [tab, setTab] = useState("identity");
  const [editing, setEditing] = useState(false);
  const tabs = useMemo(() => [
    ["identity", "badge", "Identity"],
    ["tipping", "payments", "Tipping"],
    ["receipts", "receipt_long", "Receipts"],
    ["funding", "account_balance_wallet", "Funding"],
    ["notifications", "notifications", "Notifications"],
    ["privacy", "shield", "Privacy"],
    ["support", "help", "Support"],
  ], []);
  return (
    <main className="dashboard-body-inner dashboard-settings-page">
      <div className="dashboard-page-heading"><div><h1>Settings</h1><p>Manage the account details and product preferences that shape your Teep experience across the dashboard and extension.</p></div><button type="button" className="btn-secondary">Saved</button></div>
      <div className="dashboard-settings-workspace">
        <nav className="dashboard-settings-menu" aria-label="Settings sections">{tabs.map(([id, icon, label]) => <button key={id} type="button" className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}><span className="material-symbols-outlined" aria-hidden>{icon}</span><span><strong>{label}</strong></span></button>)}</nav>
        <section className="dashboard-settings-panel">
          <div className="dashboard-settings-panel-head"><div><h3>{tabs.find(([id]) => id === tab)?.[2]}</h3><p>{tab === "identity" ? "Choose the public username Teep uses on receipts, direct tips, referral records, and account-facing surfaces." : "Previewing this settings section with realistic controls and spacing."}</p></div></div>
          <div className="dashboard-settings-panel-body">
            {tab === "identity" && <div className="dashboard-settings-identity-grid"><div className="dashboard-settings-subcard dashboard-settings-identity-card"><div className="dashboard-settings-field"><label htmlFor="dev-username">Display username</label><div className={`dashboard-settings-input-row ${editing ? "is-editing" : "is-readonly"}`}><span aria-hidden>@</span><input id="dev-username" value="thevirusonton" readOnly={!editing} /><button type="button" onClick={() => setEditing((value) => !value)}><span className="material-symbols-outlined" aria-hidden>{editing ? "check" : "edit"}</span></button></div><p>This is your identifier across Teep.</p></div></div><div className="dashboard-settings-subcard"><h4>Connected account</h4><div className="dashboard-settings-row"><span>Email</span><strong>thevirusonton@gmail.com</strong></div><div className="dashboard-settings-row"><span>Account Address</span><div className="dashboard-settings-copy-value"><strong>0xa0df...7794</strong><button type="button"><span className="material-symbols-outlined" aria-hidden>content_copy</span></button></div></div></div></div>}
            {tab === "tipping" && <div className="dashboard-settings-subcard"><h4>Extension default</h4><p>This value is read by the extension when an account is connected.</p><div className="dashboard-settings-field"><label htmlFor="dev-tip">Default tip amount</label><div className="dashboard-settings-input-row is-readonly"><span aria-hidden>$</span><input id="dev-tip" value="5.00" readOnly /><button type="button"><span className="material-symbols-outlined" aria-hidden>edit</span></button></div></div></div>}
            {tab === "funding" && <div className="dashboard-settings-two-col"><div className="dashboard-settings-history-card"><div className="dashboard-settings-history-card-head"><div><h4>Funding history</h4><p>Funds added to your Teep account.</p><span className="dashboard-settings-sync-note">Latest funding activity checked.</span></div><div className="dashboard-settings-history-tools"><label><span>Go to:</span><input type="date" /></label><button type="button" className="dashboard-settings-download-btn" aria-label="Download funding history"><span className="material-symbols-outlined" aria-hidden>download</span><span className="dashboard-settings-download-text">Download</span></button></div></div><div className="dashboard-settings-table"><div className="dashboard-settings-table-row dashboard-settings-table-row--funding is-head"><div>Type</div><div>Amount</div><div>Date</div><div>Status</div></div><div className="dashboard-settings-table-row dashboard-settings-table-row--funding"><div data-label="Type">Faucet Funding</div><div data-label="Amount">$20.00</div><div data-label="Date">May 21, 2026</div><div data-label="Status"><span className="dashboard-settings-status-pill is-success">Completed</span></div></div></div></div><div className="dashboard-settings-history-card"><div className="dashboard-settings-history-card-head"><div><h4>Withdrawal history</h4><p>Funds withdrawn from your Teep account.</p></div><div className="dashboard-settings-history-tools"><label><span>Go to:</span><input type="date" /></label><button type="button" className="dashboard-settings-download-btn" aria-label="Download withdrawal history"><span className="material-symbols-outlined" aria-hidden>download</span><span className="dashboard-settings-download-text">Download</span></button></div></div><div className="dashboard-settings-table"><div className="dashboard-settings-table-row dashboard-settings-table-row--withdrawal is-head"><div>Type</div><div>Amount</div><div>Date</div><div>Status</div></div><div className="dashboard-settings-table-row dashboard-settings-table-row--withdrawal"><div data-label="Type">Balance Withdrawal</div><div data-label="Amount">$5.00</div><div data-label="Date">May 20, 2026</div><div data-label="Status"><span className="dashboard-settings-status-pill is-success">Completed</span></div></div></div></div></div>}
            {!["identity", "tipping", "funding"].includes(tab) && <div className="dashboard-settings-list"><div className="dashboard-settings-list-row"><div><strong>Include amount in shared copy</strong><span>Controls whether Teep-generated share text includes the tip amount.</span></div><button type="button" className="teep-switch is-on" aria-label="Preview switch"><span><span className="material-symbols-outlined" aria-hidden>check</span></span></button></div><div className="dashboard-settings-list-row"><div><strong>Private activity by default</strong><span>Dashboard activity is private unless you explicitly share a receipt.</span></div><button type="button" className="teep-switch is-on" aria-label="Preview switch"><span><span className="material-symbols-outlined" aria-hidden>check</span></span></button></div></div>}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function DashboardDevPreview() {
  const [params] = useSearchParams();
  const page = params.get("page") || "dashboard";
  if (!import.meta.env.DEV) return <Navigate to="/dashboard" replace />;
  if (!pages.has(page)) return <Navigate to="/dashboard/dev-preview?page=dashboard" replace />;
  return (
    <DashboardShell address={DEV_ADDRESS} title={page === "dashboard" ? "Overview" : page === "discover" ? "Discover Creators" : page === "referrals" ? "Referrals" : "Settings"}>
      {page === "dashboard" && <DashboardPreview />}
      {page === "discover" && <DiscoverPreview />}
      {page === "referrals" && <ReferralsPreview />}
      {page === "settings" && <SettingsPreview />}
    </DashboardShell>
  );
}
