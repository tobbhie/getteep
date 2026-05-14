import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { API_BASE, RECEIPT_BASE_URL } from "../config";

interface Profile {
  username: string;
  displayName: string | null;
  authorId: string;
  totalReceived: string;
  tipCount: number;
  topPosts: Array<{ contentId: string; total: string; count: number; tweetId: string | null; authorHandle: string | null }>;
  topSupporters: Array<{ address: string; total: string }>;
}

/** Backend sends totalReceived in raw (1e6); topPosts/topSupporters totals are already in dollars. */
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

function reachedMilestones(totalUsd: number): number[] {
  return [1, 5, 10, 25, 50, 100, 250, 500].filter((amount) => totalUsd >= amount);
}

export default function CreatorProfile() {
  const { username } = useParams<{ username: string }>();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    if (!username) return;
    const u = username.replace(/^@/, "");
    fetch(`${API_BASE}/profile/username/${encodeURIComponent(u)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then(setProfile)
      .catch(() => setError("Creator not found or not verified"));
  }, [username]);

  const profileUrl = username ? `${RECEIPT_BASE_URL}/${username.replace(/^@/, "")}` : "";

  useEffect(() => {
    if (!profile) return;
    const title = `@${profile.username} on Teep`;
    const description = profile.tipCount > 0
      ? `@${profile.username} has received $${formatUsdRaw(profile.totalReceived)} across ${profile.tipCount} tips on Teep.`
      : `Tip @${profile.username} directly from X with Teep.`;
    const prevTitle = document.title;
    document.title = title;
    setMeta("og:title", title);
    setMeta("og:description", description);
    setMeta("og:url", profileUrl);
    setMeta("og:type", "profile");
    setMeta("twitter:card", "summary");
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
    return () => {
      document.title = prevTitle;
    };
  }, [profile, profileUrl]);

  function handleShare() {
    if (!profileUrl) return;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(profileUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } else {
      window.open(profileUrl, "_blank");
    }
  }

  if (error) {
    return (
      <div className="page-section">
        <p style={{ color: "var(--accent)", marginTop: "var(--space-4)" }}>{error}</p>
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="page-section">
        <p style={{ color: "var(--text-muted)" }}>Loading...</p>
      </div>
    );
  }

  const totalUsd = formatUsdRaw(profile.totalReceived);
  const totalUsdNum = Number(totalUsd);
  const milestones = reachedMilestones(totalUsdNum);
  const hasAnyTips = profile.tipCount > 0;
  const hasTopPosts = profile.topPosts.length > 0;
  const hasTopSupporters = profile.topSupporters.length > 0;

  return (
    <div className="page-section" style={{ paddingTop: "var(--space-4)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-3)", marginBottom: "var(--space-2)" }}>
        <h1 style={{ fontSize: "var(--text-title)", margin: 0 }}>@{profile.username}</h1>
        {profileUrl && (
          <button type="button" onClick={handleShare} className="btn-secondary">
            {shareCopied ? "Copied" : "Share profile"}
          </button>
        )}
      </div>
      {profile.displayName && (
        <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-5)" }}>{profile.displayName}</p>
      )}

      <div style={{ display: "flex", gap: "var(--space-4)", marginBottom: "var(--space-6)", flexWrap: "wrap" }}>
        <div className="card" style={{ minWidth: "140px" }}>
          <div className="card-label">Lifetime tips</div>
          <div className="card-value">${totalUsd}</div>
        </div>
        <div className="card" style={{ minWidth: "140px" }}>
          <div className="card-label">Tip count</div>
          <div className="card-value">{profile.tipCount}</div>
        </div>
      </div>

      {!hasAnyTips && (
        <div className="empty-state">
          No tips yet. When this creator receives tips, their top posts, milestones, and supporters will show here.
        </div>
      )}

      <section className="page-section">
        <h2 className="section-title">Milestones reached</h2>
        {milestones.length === 0 ? (
          <div className="empty-state">No public milestones yet. The first milestone appears after $1 in received tips.</div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
            {milestones.map((amount) => (
              <div key={amount} className="card" style={{ minWidth: 120, padding: "var(--space-4)" }}>
                <div className="card-label">Reached</div>
                <div className="card-value">${amount}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {hasTopPosts && (
        <section className="page-section">
          <h2 className="section-title">Top posts</h2>
          <ul className="list-plain">
            {profile.topPosts.map((p) => (
              <li key={p.contentId} className="list-item-card">
                <span style={{ fontWeight: 600 }}>${formatUsdAlreadyDollars(p.total)}</span>
                <span style={{ color: "var(--text-muted)", marginLeft: "var(--space-2)" }}>({p.count} tips)</span>
                {p.tweetId && (
                  <a
                    href={`https://x.com/${profile.username}/status/${p.tweetId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ marginLeft: "var(--space-3)", fontSize: "var(--text-small)" }}
                  >
                    View post
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!hasTopPosts && hasAnyTips && (
        <section className="page-section">
          <h2 className="section-title">Top posts</h2>
          <div className="empty-state">Top post data is still catching up. Recent tips will appear here after indexing.</div>
        </section>
      )}

      {hasTopSupporters && (
        <section className="page-section">
          <h2 className="section-title">Top supporters</h2>
          <ul className="list-plain">
            {profile.topSupporters.map((s) => (
              <li key={s.address} className="list-item-card" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-small)" }}>
                {s.address.slice(0, 10)}...{s.address.slice(-8)} - ${formatUsdAlreadyDollars(s.total)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!hasTopSupporters && hasAnyTips && (
        <section className="page-section">
          <h2 className="section-title">Top supporters</h2>
          <div className="empty-state">Supporter rankings will appear once this creator has indexed supporter data.</div>
        </section>
      )}
    </div>
  );
}
