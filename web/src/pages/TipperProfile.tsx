import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { API_BASE, RECEIPT_BASE_URL } from "../config";

interface TipperProfileData {
  address: string | null;
  identity?: string;
  privateActivity?: boolean;
  totalSent: string;
  tipCount: number;
  creatorsSupported: Array<{ authorId: string; username: string | null; total: string }>;
}

/** Backend sends totalSent in raw (1e6); creatorsSupported[].total is already in dollars. */
function formatUsdRaw(raw: string): string {
  return (Number(raw) / 1e6).toFixed(2);
}
function formatUsdAlreadyDollars(val: string): string {
  return Number(val).toFixed(2);
}

function setMeta(propertyOrName: string, content: string): void {
  const isOg = propertyOrName.startsWith("og:");
  const attr = isOg ? "property" : "name";
  let el = document.querySelector(`meta[${attr}="${propertyOrName}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, propertyOrName);
    document.head.appendChild(el);
  }
  el.content = content;
}

function truncateAddress(address: string): string {
  if (address.length < 14) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function profileLabel(profile: TipperProfileData): string {
  return profile.identity || (profile.address ? truncateAddress(profile.address) : "Private supporter");
}

export default function TipperProfile() {
  const { address } = useParams<{ address: string }>();
  const [profile, setProfile] = useState<TipperProfileData | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    if (!address) return;
    fetch(`${API_BASE}/profile/tipper/${encodeURIComponent(address)}`)
      .then((r) => r.json())
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [address]);

  useEffect(() => {
    if (!profile) return;
    const title = `${profileLabel(profile)} on Teep`;
    const description = profile.tipCount > 0
      ? `This Teep supporter has sent $${formatUsdRaw(profile.totalSent)} across ${profile.tipCount} tips.`
      : "A Teep supporter profile.";
    const url = `${RECEIPT_BASE_URL}/profile/tipper/${address || profile.address || ""}`;
    const prevTitle = document.title;
    document.title = title;
    setMeta("og:title", title);
    setMeta("og:description", description);
    setMeta("og:url", url);
    setMeta("og:type", "profile");
    setMeta("twitter:card", "summary");
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
    return () => {
      document.title = prevTitle;
    };
  }, [profile]);

  if (!profile) {
    return (
      <div className="page-section">
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      </div>
    );
  }

  const totalUsd = formatUsdRaw(profile.totalSent);
  const supporterBadge = profile.tipCount >= 25 ? "Super supporter" : profile.tipCount >= 5 ? "Early supporter" : "New supporter";
  const profileUrl = `${RECEIPT_BASE_URL}/profile/tipper/${address || profile.address || ""}`;

  const shareProfile = () => {
    navigator.clipboard?.writeText(profileUrl);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  return (
    <div className="page-section" style={{ paddingTop: "var(--space-4)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-2)" }}>
        <h1 style={{ fontSize: "var(--text-title)", margin: 0 }}>Tipper</h1>
        <button type="button" onClick={shareProfile} className="btn-secondary">{shareCopied ? "Copied" : "Share profile"}</button>
      </div>
      <p style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-small)", color: "var(--text-muted)", marginBottom: "var(--space-5)" }}>
        {profileLabel(profile)}
      </p>

      <div style={{ display: "flex", gap: "var(--space-4)", marginBottom: "var(--space-6)", flexWrap: "wrap" }}>
        <div className="card" style={{ minWidth: "140px" }}>
          <div className="card-label">Total tipped</div>
          <div className="card-value">${totalUsd}</div>
        </div>
        <div className="card" style={{ minWidth: "140px" }}>
          <div className="card-label">Tips sent</div>
          <div className="card-value">{profile.tipCount}</div>
        </div>
        <div className="card" style={{ minWidth: "160px" }}>
          <div className="card-label">Badge</div>
          <div className="card-value" style={{ fontSize: "1rem" }}>{supporterBadge}</div>
        </div>
      </div>

      {profile.privateActivity && (
        <section className="page-section">
          <h2 className="section-title">Private activity</h2>
          <div className="empty-state">
            This supporter keeps Teep activity private unless they share a specific receipt.
          </div>
        </section>
      )}

      <section className="page-section">
        <h2 className="section-title">Milestone participation</h2>
        <div className="empty-state">
          Creator milestone participation is planned for a later beta pass. Tips sent today still count in public creator totals.
        </div>
      </section>

      {!profile.privateActivity && profile.creatorsSupported.length === 0 ? (
        <div className="empty-state">
          No creators supported yet.
        </div>
      ) : !profile.privateActivity ? (
        <section className="page-section">
          <h2 className="section-title">Creators supported</h2>
          <ul className="list-plain">
            {profile.creatorsSupported.map((c) => (
              <li key={c.authorId} className="list-item-card">
                {c.username ? (
                  <Link to={`/${c.username}`}>@{c.username}</Link>
                ) : (
                  <span style={{ fontFamily: "var(--font-mono)" }}>{c.authorId.slice(0, 16)}...</span>
                )}
                <span style={{ color: "var(--text-muted)", marginLeft: "var(--space-2)" }}>${formatUsdAlreadyDollars(c.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
