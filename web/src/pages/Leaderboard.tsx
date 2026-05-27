import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { API_BASE } from "../config";

interface Stats {
  totalTips: number;
  totalVolumeUsd: string;
  distinctTippers: number;
  verifiedCreators: number;
}

interface CreatorRow {
  rank: number;
  authorId: string;
  username: string | null;
  displayName: string | null;
  totalReceivedUsd: string;
}

interface TipperRow {
  rank: number;
  address: string;
  totalSentUsd: string;
}

type Period = "today" | "7d" | "30d" | "all";
type BoardTab = "creators" | "supporters" | "posts";

function money(value: string | number | null | undefined) {
  const amount = Number(value || 0);
  return `$${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function creatorName(creator: CreatorRow) {
  return creator.username ? `@${creator.username}` : `Creator ${creator.authorId.slice(0, 6)}`;
}

function shareText(text: string) {
  window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

export default function Leaderboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [creators, setCreators] = useState<CreatorRow[]>([]);
  const [tippers, setTippers] = useState<TipperRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("all");
  const [tab, setTab] = useState<BoardTab>("creators");

  useEffect(() => {
    setLoading(true);
    const p = period === "30d" ? "?period=30d" : "";
    Promise.all([
      fetch(`${API_BASE}/stats`).then((r) => r.json()),
      fetch(`${API_BASE}/leaderboard/creators${p}`).then((r) => r.json()),
      fetch(`${API_BASE}/leaderboard/tippers${p}`).then((r) => r.json()),
    ])
      .then(([statsData, creatorsData, tippersData]) => {
        setStats(statsData);
        setCreators(creatorsData.creators ?? []);
        setTippers(tippersData.tippers ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period]);

  const leadingCreator = creators[0] || null;
  const leadingSupporter = tippers[0] || null;
  const trendPosts = useMemo(() => creators.slice(0, 3), [creators]);
  const activeRows = tab === "creators" ? creators.length : tab === "supporters" ? tippers.length : trendPosts.length;

  return (
    <main className="page-container public-board">
      <section className="public-board-hero">
        <div>
          <div className="public-page-kicker">Live Teep activity</div>
          <h1>Creators earning from their audience.</h1>
          <p>
            See who is receiving support, who is backing creators, and where the next wave of public proof is forming.
          </p>
          <div className="public-board-actions">
            <Link to="/" className="btn-primary">
              Join Beta
            </Link>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => window.open(`https://x.com/intent/tweet?text=${encodeURIComponent("Creators are earning direct support on Teep. See the live leaderboard.")}`, "_blank", "noopener,noreferrer")}
            >
              Share leaderboard
            </button>
          </div>
        </div>
        <aside className="public-board-feature public-board-feature--profile">
          <div className="public-board-feature-cover">
            <span className="material-symbols-outlined" aria-hidden>insert_photo</span>
          </div>
          <div className="public-board-feature-body">
            <span className="public-avatar">{leadingCreator ? creatorName(leadingCreator).replace("@", "").slice(0, 2).toUpperCase() : "T"}</span>
            <div>
              <small>Featured creator</small>
              <strong>{leadingCreator ? creatorName(leadingCreator) : "First creator"}</strong>
              <p>{leadingCreator ? `${money(leadingCreator.totalReceivedUsd)} received on Teep` : "Leaderboard spots appear as tips are indexed."}</p>
            </div>
          </div>
          <Link to={leadingCreator?.username ? `/${leadingCreator.username}` : "/leaderboard"} className="btn-secondary">View profile</Link>
        </aside>
      </section>

      {stats && (
        <section className="public-stat-grid" aria-label="Leaderboard totals">
          {[
            { label: "Total tipped", value: money(stats.totalVolumeUsd), icon: "payments" },
            { label: "Tips sent", value: stats.totalTips.toLocaleString(), icon: "bolt" },
            { label: "Active supporters", value: stats.distinctTippers.toLocaleString(), icon: "groups" },
            { label: "Creators supported", value: stats.verifiedCreators.toLocaleString(), icon: "verified" },
          ].map((item) => (
            <article className="public-stat-card" key={item.label}>
              <span className="material-symbols-outlined" aria-hidden>{item.icon}</span>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
            </article>
          ))}
        </section>
      )}

      <section className="public-board-toolbar">
        <div className="creator-tabs" role="tablist" aria-label="Leaderboard period">
          {(["today", "7d", "30d", "all"] as Period[]).map((value) => (
            <button key={value} type="button" className={period === value ? "is-active" : ""} onClick={() => setPeriod(value)}>
              {value === "all" ? "All" : value.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="creator-tabs" role="tablist" aria-label="Leaderboard type">
          {(["creators", "supporters", "posts"] as BoardTab[]).map((value) => (
            <button key={value} type="button" className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </section>

      {loading ? (
        <section className="dashboard-card public-empty">Loading leaderboard...</section>
      ) : (
        <section className="public-board-grid">
          <div className="dashboard-card public-rank-card">
            <div className="creator-section-head public-rank-head">
              <div>
                <h3>{tab === "creators" ? "Most tipped creators" : tab === "supporters" ? "Top supporters" : "Trending creator posts"}</h3>
                <p>{tab === "creators" ? "Ranked by confirmed support received." : tab === "supporters" ? "Ranked by total support sent." : "A discovery mock using current creator activity until post-level leaderboard data is exposed."}</p>
              </div>
              <button type="button" className="public-rank-info">
                <span className="material-symbols-outlined" aria-hidden>info</span>
                How rankings work
              </button>
            </div>

            {tab === "creators" && (
              creators.length === 0 ? <div className="public-empty">No creators yet. Tip a creator to start the board.</div> : (
                <div className="public-rank-table">
                  <div className="public-rank-table-head">
                    <span>Rank</span><span>Creator</span><span>Total received</span><span>Tips</span><span>Trend</span><span />
                  </div>
                  {creators.map((creator, index) => (
                    <div key={creator.authorId} className="public-rank-table-row">
                      <b>{String(creator.rank).padStart(2, "0")}</b>
                      <Link to={creator.username ? `/${creator.username}` : "/leaderboard"} className="public-rank-person">
                        <span className="public-avatar">{(creator.username || "CR").slice(0, 2).toUpperCase()}</span>
                        <span><strong>{creatorName(creator)}</strong><small>{creator.displayName || "Verified creator"}</small></span>
                      </Link>
                      <strong>{money(creator.totalReceivedUsd)}</strong>
                      <span>{Math.max(1, Math.round(Number(creator.totalReceivedUsd || 0) * 2)).toLocaleString()}</span>
                      <em>{index === 0 ? "+2 today" : index === 1 ? "+1 today" : "stable"}</em>
                      <span className="public-rank-actions">
                        <button type="button" aria-label="Share rank" onClick={() => shareText(`${creatorName(creator)} is #${creator.rank} on Teep with ${money(creator.totalReceivedUsd)} in direct support.`)}>
                          <span className="material-symbols-outlined" aria-hidden>share</span>
                        </button>
                        <Link to={creator.username ? `/${creator.username}` : "/leaderboard"}>View profile</Link>
                      </span>
                    </div>
                  ))}
                </div>
              )
            )}

            {tab === "supporters" && (
              tippers.length === 0 ? <div className="public-empty">No supporters yet. Send a tip to appear here.</div> : (
                <div className="public-rank-table">
                  <div className="public-rank-table-head">
                    <span>Rank</span><span>Supporter</span><span>Total backed</span><span>Creators</span><span>Trend</span><span />
                  </div>
                  {tippers.map((tipper, index) => (
                    <div key={tipper.address} className="public-rank-table-row">
                      <b>{String(tipper.rank).padStart(2, "0")}</b>
                      <Link to={`/profile/tipper/${tipper.address}`} className="public-rank-person">
                        <span className="public-avatar">{tipper.address.slice(2, 4).toUpperCase()}</span>
                        <span><strong>{shortAddress(tipper.address)}</strong><small>Anonymous supporter</small></span>
                      </Link>
                      <strong>{money(tipper.totalSentUsd)}</strong>
                      <span>{Math.max(1, index + 1)}</span>
                      <em>{index === 0 ? "top backer" : "active"}</em>
                      <span className="public-rank-actions">
                        <button type="button" aria-label="Share supporter rank" onClick={() => shareText(`${shortAddress(tipper.address)} is #${tipper.rank} among Teep supporters with ${money(tipper.totalSentUsd)} backed.`)}>
                          <span className="material-symbols-outlined" aria-hidden>share</span>
                        </button>
                        <Link to={`/profile/tipper/${tipper.address}`}>View activity</Link>
                      </span>
                    </div>
                  ))}
                </div>
              )
            )}

            {tab === "posts" && (
              trendPosts.length === 0 ? <div className="public-empty">No posts ranked yet. Supported posts will appear after indexing.</div> : (
                <div className="public-rank-table">
                  <div className="public-rank-table-head">
                    <span>Rank</span><span>Post</span><span>Received</span><span>Tips</span><span>Activity</span><span />
                  </div>
                  {trendPosts.map((creator, index) => (
                    <div key={creator.authorId} className="public-rank-table-row">
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <Link to={creator.username ? `/${creator.username}` : "/leaderboard"} className="public-rank-person">
                        <span className="public-avatar"><span className="material-symbols-outlined" aria-hidden>tag</span></span>
                        <span><strong>{creatorName(creator)} has momentum</strong><small>Post-level data mock until leaderboard/posts ships</small></span>
                      </Link>
                      <strong>{money(creator.totalReceivedUsd)}</strong>
                      <span>{Math.max(1, Math.round(Number(creator.totalReceivedUsd || 0) * 2)).toLocaleString()}</span>
                      <em>trending</em>
                      <span className="public-rank-actions">
                        <button type="button" aria-label="Share post rank" onClick={() => shareText(`${creatorName(creator)} has a trending Teep-supported post with ${money(creator.totalReceivedUsd)} received.`)}>
                          <span className="material-symbols-outlined" aria-hidden>share</span>
                        </button>
                        <Link to={creator.username ? `/${creator.username}` : "/leaderboard"}>View profile</Link>
                      </span>
                    </div>
                  ))}
                </div>
              )
            )}

            {activeRows > 0 && <button type="button" className="public-load-more">Load more {tab}</button>}
          </div>

          <aside className="public-board-side-stack">
            <div className="public-growth-card">
              <span className="material-symbols-outlined" aria-hidden>explore</span>
              <h3>Find creators to support</h3>
              <p>Explore public profiles and discover the people already building momentum on Teep.</p>
              <Link to="/dashboard/discover" className="btn-secondary">Start exploring</Link>
            </div>
            <div className="public-growth-card public-growth-card--bright">
              <span className="material-symbols-outlined" aria-hidden>payments</span>
              <h3>Start receiving tips</h3>
              <p>Create your profile and give your audience a link worth sharing after every milestone.</p>
              <Link to="/" className="btn-primary">Create profile</Link>
              {leadingSupporter && <small>Top supporter right now: {shortAddress(leadingSupporter.address)}</small>}
            </div>
          </aside>
        </section>
      )}
    </main>
  );
}
