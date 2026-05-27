import { useEffect, useMemo, useState } from "react";
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

function formatUsdRaw(raw: string): string {
  return (Number(raw) / 1e6).toFixed(2);
}

function formatUsdAlreadyDollars(val: string): string {
  return Number(val).toFixed(2);
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
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

function reachedMilestones(totalUsd: number): Array<{ label: string; detail: string; reached: boolean }> {
  return [1, 5, 10, 25, 50, 100].map((amount) => ({
    label: `$${amount}`,
    detail: amount === 1 ? "First public proof" : `${amount} received`,
    reached: totalUsd >= amount,
  }));
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

  const cleanUsername = username?.replace(/^@/, "") || "";
  const profileUrl = cleanUsername ? `${RECEIPT_BASE_URL}/${cleanUsername}` : "";

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

  const totalUsd = profile ? formatUsdRaw(profile.totalReceived) : "0.00";
  const totalUsdNum = Number(totalUsd);
  const milestones = useMemo(() => reachedMilestones(totalUsdNum), [totalUsdNum]);
  const hasAnyTips = Boolean(profile && profile.tipCount > 0);
  const supporterCount = profile?.topSupporters.length || 0;
  const avgTip = profile && profile.tipCount > 0 ? (totalUsdNum / profile.tipCount).toFixed(2) : "0.00";

  function handleCopyProfile() {
    if (!profileUrl) return;
    navigator.clipboard?.writeText(profileUrl);
    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 2000);
  }

  function handleShareX() {
    if (!profile) return;
    const text = hasAnyTips
      ? `@${profile.username} has received $${totalUsd} from supporters on Teep.\n\n${profileUrl}`
      : `Support @${profile.username} directly on Teep.\n\n${profileUrl}`;
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  if (error) {
    return (
      <main className="page-container">
        <section className="dashboard-card public-empty">{error}</section>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="page-container">
        <section className="dashboard-card public-empty">Loading profile...</section>
      </main>
    );
  }

  return (
    <main className="page-container public-profile">
      <section className="public-profile-hero">
        <div className="public-profile-avatar">{profile.username.slice(0, 2).toUpperCase()}</div>
        <div className="public-profile-identity">
          <div className="public-page-kicker">Creator profile</div>
          <h1>@{profile.username}</h1>
          <p>{profile.displayName || "Verified Teep creator"}</p>
          <div className="public-profile-actions">
            <a className="btn-primary" href={`https://x.com/${profile.username}`} target="_blank" rel="noopener noreferrer">
              Support on X
            </a>
            <button type="button" className="btn-secondary" onClick={handleShareX}>Share to X</button>
            <button type="button" className="btn-secondary" onClick={handleCopyProfile}>{shareCopied ? "Copied" : "Copy link"}</button>
          </div>
        </div>
        <aside className="public-profile-proof">
          <strong>{hasAnyTips ? `$${totalUsd}` : "Ready for first tip"}</strong>
          <span>{hasAnyTips ? "received from supporters" : "public profile ready"}</span>
        </aside>
      </section>

      <section className="public-stat-grid" aria-label="Creator support totals">
        {[
          { label: "Received", value: `$${totalUsd}`, icon: "payments" },
          { label: "Tips", value: profile.tipCount.toLocaleString(), icon: "bolt" },
          { label: "Supporters", value: supporterCount.toLocaleString(), icon: "groups" },
          { label: "Avg tip", value: `$${avgTip}`, icon: "insert_chart" },
        ].map((item) => (
          <article className="public-stat-card" key={item.label}>
            <span className="material-symbols-outlined" aria-hidden>{item.icon}</span>
            <small>{item.label}</small>
            <strong>{item.value}</strong>
          </article>
        ))}
      </section>

      {!hasAnyTips && (
        <section className="public-growth-card public-profile-empty-callout">
          <span className="material-symbols-outlined" aria-hidden>auto_awesome</span>
          <h3>Be the first supporter</h3>
          <p>When tips arrive, this page becomes a public proof page with milestones, top posts, and supporter history.</p>
          <button type="button" className="btn-primary" onClick={handleShareX}>Share profile</button>
        </section>
      )}

      <section className="public-profile-grid">
        <div className="dashboard-card public-profile-section">
          <div className="creator-section-head">
            <div>
              <h3>Top supported posts</h3>
              <p>Posts that converted attention into direct support.</p>
            </div>
          </div>
          {profile.topPosts.length === 0 ? (
            <div className="public-empty">Top post data will appear after tips are indexed.</div>
          ) : profile.topPosts.map((post, index) => (
            <article className="public-post-card" key={post.contentId}>
              <span className="public-avatar"><span className="material-symbols-outlined" aria-hidden>tag</span></span>
              <div>
                <strong>Supported post #{index + 1}</strong>
                <small>{formatUsdAlreadyDollars(post.total)} received - {post.count} tip{post.count === 1 ? "" : "s"}</small>
              </div>
              {post.tweetId && (
                <a href={`https://x.com/${post.authorHandle || profile.username}/status/${post.tweetId}`} target="_blank" rel="noopener noreferrer">
                  View post
                </a>
              )}
            </article>
          ))}
        </div>

        <aside className="dashboard-card public-profile-section">
          <div className="creator-section-head">
            <div>
              <h3>Milestones</h3>
              <p>Shareable moments as support compounds.</p>
            </div>
          </div>
          <div className="public-milestone-list">
            {milestones.map((milestone) => (
              <div key={milestone.label} className={milestone.reached ? "is-reached" : ""}>
                <span className="material-symbols-outlined" aria-hidden>{milestone.reached ? "check_circle" : "radio_button_unchecked"}</span>
                <strong>{milestone.label}</strong>
                <small>{milestone.detail}</small>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="public-profile-grid public-profile-grid--support">
        <div className="dashboard-card public-profile-section">
          <div className="creator-section-head">
            <div>
              <h3>Top supporters</h3>
              <p>Privacy-aware public proof from people backing this creator.</p>
            </div>
          </div>
          {profile.topSupporters.length === 0 ? (
            <div className="public-empty">Supporter rankings will appear once this creator has indexed supporter data.</div>
          ) : profile.topSupporters.map((supporter, index) => (
            <div className="public-rank-row public-rank-row--static" key={supporter.address}>
              <b>#{index + 1}</b>
              <span className="public-avatar">{supporter.address.slice(2, 4).toUpperCase()}</span>
              <span>
                <strong>{shortAddress(supporter.address)}</strong>
                <small>Supporter</small>
              </span>
              <em>${formatUsdAlreadyDollars(supporter.total)}</em>
            </div>
          ))}
        </div>

        <aside className="public-growth-card">
          <span className="material-symbols-outlined" aria-hidden>ios_share</span>
          <h3>Public proof grows with every tip.</h3>
          <p>Creator profiles give supporters a place to point to, and give creators a link worth sharing after every milestone.</p>
          <button type="button" className="btn-primary" onClick={handleShareX}>Share profile</button>
        </aside>
      </section>
    </main>
  );
}
