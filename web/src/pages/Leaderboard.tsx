import { useEffect, useState } from "react";
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

export default function Leaderboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [creators, setCreators] = useState<CreatorRow[]>([]);
  const [tippers, setTippers] = useState<TipperRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"all" | "30d">("all");

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

  return (
    <div className="page-section" style={{ paddingTop: "var(--space-4)" }}>
      <h1 style={{ fontSize: "var(--text-title)", marginBottom: "var(--space-2)" }}>Leaderboard</h1>
      <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-5)" }}>
        Top creators by tips received and top tippers by amount sent.
      </p>

      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: "var(--space-4)",
            marginBottom: "var(--space-8)",
          }}
        >
          <div className="card">
            <div className="card-label">Total tips</div>
            <div className="card-value">{stats.totalTips.toLocaleString()}</div>
          </div>
          <div className="card">
            <div className="card-label">Total volume</div>
            <div className="card-value">${stats.totalVolumeUsd}</div>
          </div>
          <div className="card">
            <div className="card-label">Tippers</div>
            <div className="card-value">{stats.distinctTippers.toLocaleString()}</div>
          </div>
          <div className="card">
            <div className="card-label">Creators</div>
            <div className="card-value">{stats.verifiedCreators.toLocaleString()}</div>
          </div>
        </div>
      )}

      <div style={{ marginBottom: "var(--space-4)" }}>
        <span style={{ fontSize: "var(--text-small)", color: "var(--text-muted)", marginRight: "var(--space-2)" }}>
          Period:
        </span>
        <button
          type="button"
          onClick={() => setPeriod("all")}
          className={period === "all" ? "btn-primary" : "btn-secondary"}
          style={{ marginRight: "var(--space-2)", padding: "var(--space-1) var(--space-3)" }}
        >
          All time
        </button>
        <button
          type="button"
          onClick={() => setPeriod("30d")}
          className={period === "30d" ? "btn-primary" : "btn-secondary"}
          style={{ padding: "var(--space-1) var(--space-3)" }}
        >
          Last 30 days
        </button>
      </div>

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      ) : (
        <div style={{ display: "grid", gap: "var(--space-8)" }}>
          <section>
            <h2 className="section-title">Most tipped creators</h2>
            {creators.length === 0 ? (
              <div className="empty-state">No creators yet.</div>
            ) : (
              <ul className="list-plain">
                {creators.map((c) => (
                  <li key={c.authorId} className="list-item-card" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                    <span style={{ fontWeight: 600, minWidth: "28px" }}>#{c.rank}</span>
                    {c.username ? (
                      <Link to={`/${c.username}`}>@{c.username}</Link>
                    ) : (
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-small)" }}>
                        {c.authorId.slice(0, 12)}…
                      </span>
                    )}
                    <span style={{ marginLeft: "auto", fontWeight: 500 }}>${c.totalReceivedUsd}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="section-title">Top tippers</h2>
            {tippers.length === 0 ? (
              <div className="empty-state">No tippers yet.</div>
            ) : (
              <ul className="list-plain">
                {tippers.map((t) => (
                  <li key={t.address} className="list-item-card" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                    <span style={{ fontWeight: 600, minWidth: "28px" }}>#{t.rank}</span>
                    <Link to={`/profile/tipper/${t.address}`} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-small)" }}>
                      {t.address.slice(0, 10)}…{t.address.slice(-8)}
                    </Link>
                    <span style={{ marginLeft: "auto", fontWeight: 500 }}>${t.totalSentUsd}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
