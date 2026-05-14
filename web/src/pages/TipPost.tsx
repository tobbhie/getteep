import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { API_BASE, CHROME_STORE_URL } from "../config";

export default function TipPost() {
  const { handle, tweetId } = useParams<{ handle: string; tweetId: string }>();
  const [total, setTotal] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!handle || !tweetId) return;
    const h = handle.replace(/^@/, "");
    fetch(`${API_BASE}/tips/post/${encodeURIComponent(h)}/${tweetId}`)
      .then((r) => r.json())
      .then((d) => {
        setTotal(d.totalAmount != null ? (Number(d.totalAmount) / 1e6).toFixed(2) : "0");
      })
      .catch(() => setTotal("0"))
      .finally(() => setLoading(false));
  }, [handle, tweetId]);

  const cleanHandle = handle?.replace(/^@/, "") ?? "";
  const postUrl = handle && tweetId ? `https://x.com/${cleanHandle}/status/${tweetId}` : null;

  return (
    <div className="page-section" style={{ paddingTop: "var(--space-6)" }}>
      <h1 className="section-title">Tip this post</h1>
      {cleanHandle && (
        <p className="tip-post-creator" style={{ color: "var(--text-secondary)", marginBottom: "var(--space-4)" }}>
          Post by @{cleanHandle}
        </p>
      )}
      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      ) : (
        <>
          {total != null && (
            <p className="tip-post-total" style={{ fontSize: "var(--text-body)", marginBottom: "var(--space-4)" }}>
              This post has received <strong>${total}</strong> in tips.
            </p>
          )}
          <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-5)" }}>
            Install the Teep extension to tip this post from X.
          </p>
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
          >
            Get Teep extension
          </a>
          {postUrl && (
            <p style={{ marginTop: "var(--space-4)" }}>
              <a href={postUrl} target="_blank" rel="noopener noreferrer">
                View post on X →
              </a>
            </p>
          )}
        </>
      )}
    </div>
  );
}
