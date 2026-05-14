import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="page-section" style={{ paddingTop: "var(--space-12)", textAlign: "center", minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <h1 style={{ fontSize: "4rem", fontWeight: 900, margin: "0 0 var(--space-2)", letterSpacing: "-0.03em", color: "var(--text-primary)" }}>404</h1>
      <p style={{ fontSize: "1.25rem", color: "var(--text-secondary)", marginBottom: "var(--space-6)" }}>
        This page doesn’t exist or has been moved.
      </p>
      <Link to="/" className="btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <span className="material-symbols-outlined">home</span>
        Back to home
      </Link>
    </div>
  );
}
