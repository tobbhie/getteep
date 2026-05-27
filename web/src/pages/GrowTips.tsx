import { Link } from "react-router-dom";
import DashboardShell from "../components/DashboardShell";

const strategyRows = [
  { label: "Beta mode", value: "Preview only" },
  { label: "Network", value: "Arc testnet" },
  { label: "First strategy", value: "Conservative USDC lending" },
  { label: "Control", value: "User-owned wallet" },
];

const roadmap = [
  "Review available tips before moving anything.",
  "Choose a Teep-approved earning route.",
  "Confirm from your own wallet.",
  "Exit back to available tips whenever the strategy allows.",
];

export default function GrowTips() {
  return (
    <DashboardShell title="Grow Tips">
        <div className="dashboard-body-inner">
          <div className="dashboard-grid-2" style={{ gridTemplateColumns: "1.25fr 0.75fr" }}>
            <section className="dashboard-card" style={{ padding: "var(--space-8)" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 999, background: "rgba(99, 36, 235, 0.1)", color: "var(--accent)", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "var(--space-5)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>eco</span>
                Beta preview
              </div>
              <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 var(--space-3)", letterSpacing: "-0.02em" }}>Grow Tips</h1>
              <p style={{ color: "var(--text-secondary)", lineHeight: 1.65, maxWidth: 680, marginBottom: "var(--space-6)" }}>
                Grow Tips will let creators put idle tip balances to work from their own wallet. For production beta, this page stays as a clear preview while the live strategy contracts remain gated until Arc testnet liquidity and provider settings are verified.
              </p>
              <div className="dashboard-grid-2">
                {strategyRows.map((row) => (
                  <div key={row.label} className="dashboard-metric-card">
                    <div className="dashboard-metric-label">{row.label}</div>
                    <div style={{ fontWeight: 900, color: "var(--text-primary)" }}>{row.value}</div>
                  </div>
                ))}
              </div>
            </section>

            <aside className="dashboard-card" style={{ padding: "var(--space-6)" }}>
              <h2 className="dashboard-card-title">What will happen here</h2>
              <ul className="dashboard-list">
                {roadmap.map((item, idx) => (
                  <li key={item} className="dashboard-list-item">
                    <span style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(99, 36, 235, 0.12)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 900, flex: "0 0 auto" }}>{idx + 1}</span>
                    <span style={{ color: "var(--text-secondary)", lineHeight: 1.45 }}>{item}</span>
                  </li>
                ))}
              </ul>
            </aside>
          </div>

          <div className="dashboard-card" style={{ padding: "var(--space-6)", borderColor: "rgba(245, 158, 11, 0.24)", background: "rgba(245, 158, 11, 0.06)" }}>
            <h2 className="dashboard-card-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="material-symbols-outlined" style={{ color: "#f59e0b" }}>shield</span>
              Why it is not active yet
            </h2>
            <p style={{ color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
              Arc is still testnet, so Teep will not invite users to treat testnet balances like production money. Faucet funding remains the right beta path. Real Grow Tips activation should happen only after strategy addresses, liquidity, exit behavior, and user-facing risk language are verified.
            </p>
            <Link to="/dashboard" className="btn-primary" style={{ display: "inline-flex", gap: 8, marginTop: "var(--space-6)", padding: "12px 24px" }}>
              <span className="material-symbols-outlined">dashboard</span>
              Back to Dashboard
            </Link>
          </div>
        </div>
    </DashboardShell>
  );
}
