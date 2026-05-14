import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { API_BASE, CHROME_STORE_URL, RECEIPT_BASE_URL, DOCS_URL, CHAIN_NAME, EXPLORER_TX_URL, HAS_CHROME_STORE_LISTING } from "../config";

interface ReceiptData {
  fromAddress: string;
  toAddress: string;
  amount: string;
  txHash: string;
  timestamp: number;
  authorId: string;
  contentId: string;
  authorHandle: string | null;
  tweetId: string | null;
}

function formatUsdRaw(raw: string): string {
  const n = Number(raw) / 1e6;
  if (isNaN(n)) return "0.00";
  return n.toFixed(2);
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
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

function XLogoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="20" height="20" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const installLabel = HAS_CHROME_STORE_LISTING ? "Install Extension" : "Join Beta";
const claimLabel = HAS_CHROME_STORE_LISTING ? "Claim My Tip Now" : "Get Teep";

export default function TxReceipt() {
  const { txHash } = useParams<{ txHash: string }>();
  const [data, setData] = useState<ReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const [oembed, setOembed] = useState<{ author_name: string | null; excerpt: string | null } | null>(null);

  const receiptUrl = txHash ? `${RECEIPT_BASE_URL}/tx/${txHash}` : "";

  useEffect(() => {
    if (!txHash) {
      setError("Missing transaction hash");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setOembed(null);
    fetch(`${API_BASE}/tips/receipt/${txHash}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Tip not found for this transaction." : "Failed to load receipt.");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [txHash]);

  const tweetUrl =
    data?.authorHandle && data?.tweetId
      ? `https://x.com/${data.authorHandle}/status/${data.tweetId}`
      : null;

  useEffect(() => {
    if (!tweetUrl) return;
    fetch(`${API_BASE}/api/v1/oembed?url=${encodeURIComponent(tweetUrl)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { author_name?: string; excerpt?: string } | null) => {
        if (!json) return;
        setOembed({
          author_name: json.author_name ?? null,
          excerpt: json.excerpt ?? null,
        });
      })
      .catch(() => {});
  }, [tweetUrl]);

  // Open Graph / link preview: set title and meta when receipt data is loaded
  useEffect(() => {
    if (!data || !txHash) return;
    const creatorLabel = data.authorHandle ? `@${data.authorHandle}` : "Creator";
    const amountUsd = formatUsdRaw(data.amount);
    const title = `${creatorLabel} received a $${amountUsd} tip — Teep`;
    const description = "Claim your tip in seconds.";
    const url = `${RECEIPT_BASE_URL}/tx/${txHash}`;
    const prevTitle = document.title;
    document.title = title;
    setMeta("og:title", title);
    setMeta("og:description", description);
    setMeta("og:url", url);
    setMeta("og:type", "website");
    setMeta("twitter:card", "summary");
    setMeta("twitter:title", title);
    setMeta("twitter:description", description);
    return () => {
      document.title = prevTitle;
    };
  }, [data, txHash]);

  const shareOnX = () => {
    if (!data) return;
    const creator = data.authorHandle ? `@${data.authorHandle}` : "the creator";
    const amount = formatUsdRaw(data.amount);
    const text = `I just tipped ${creator} $${amount} with Teep.\n\nReceipt: ${receiptUrl}\nSupport creators directly.`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  const copyLink = () => {
    navigator.clipboard.writeText(receiptUrl);
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 2000);
  };

  if (loading) {
    return (
      <div className="tx-receipt-page">
        <header className="tx-receipt-header">
          <Link to="/" className="tx-receipt-logo">
            <img src="/logo.svg" alt="Teep" width={32} height={32} />
            <span>Teep</span>
          </Link>
          <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="tx-receipt-install">
            {installLabel}
          </a>
        </header>
        <main className="tx-receipt-main">
          <p style={{ color: "var(--text-muted)" }}>Loading receipt…</p>
        </main>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="tx-receipt-page">
        <header className="tx-receipt-header">
          <Link to="/" className="tx-receipt-logo">
            <img src="/logo.svg" alt="Teep" width={32} height={32} />
            <span>Teep</span>
          </Link>
          <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="tx-receipt-install">
            {installLabel}
          </a>
        </header>
        <main className="tx-receipt-main">
          <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-4)" }}>{error || "Receipt not found."}</p>
          <Link to="/" className="btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="material-symbols-outlined">home</span>
            Back to home
          </Link>
        </main>
      </div>
    );
  }

  const amountUsd = formatUsdRaw(data.amount);
  const creatorHandle = data.authorHandle ? `@${data.authorHandle}` : truncateAddress(data.toAddress);
  const tweetDisplayName = oembed?.author_name ?? creatorHandle;
  const tweetSnippet = oembed?.excerpt ?? "Post linked to this tip";
  const explorerUrl = `${EXPLORER_TX_URL}/${data.txHash}`;
  const dateStr = new Date(data.timestamp * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="tx-receipt-page">
      <header className="tx-receipt-header">
        <Link to="/" className="tx-receipt-logo">
          <img src="/logo.svg" alt="Teep" width={32} height={32} />
          <span>Teep</span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: "var(--text-small)", color: "var(--text-secondary)", textDecoration: "none" }}>
            View on Explorer
          </a>
          <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="tx-receipt-install">
            {installLabel}
          </a>
        </div>
      </header>

      <main className="tx-receipt-main">
        <div className="tx-receipt-hero">
          <div className="tx-receipt-success-icon">
            <span className="material-symbols-outlined" style={{ fontSize: 40 }}>check_circle</span>
          </div>
          <h1 className="tx-receipt-title">Tip Sent Successfully</h1>
          <p className="tx-receipt-line">
            <span className="tx-receipt-handle">{truncateAddress(data.fromAddress)}</span> tipped <span className="tx-receipt-handle">{creatorHandle}</span>
          </p>
          <div className="tx-receipt-amount">${amountUsd} USD</div>
        </div>

        {tweetUrl && (
          <div className="tx-receipt-tweet-card">
            <div className="tx-receipt-tweet-header">
              <img src={`https://unavatar.io/twitter/${data.authorHandle}`} alt="" className="tx-receipt-tweet-avatar" onError={(e) => { e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${data.authorHandle}`; }} />
              <div>
                <p className="tx-receipt-tweet-handle">{tweetDisplayName}</p>
                <p className="tx-receipt-tweet-time">{dateStr}</p>
              </div>
              <div style={{ marginLeft: "auto", color: "#3b82f6" }}><XLogoIcon /></div>
            </div>
            <p className="tx-receipt-tweet-snippet">{tweetSnippet}</p>
            <a href={tweetUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--accent)", marginTop: 8, display: "inline-block" }}>View Post</a>
          </div>
        )}

        <div className="tx-receipt-status-pill">
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>schedule</span>
          Waiting for creator to claim
        </div>

        <div className="tx-receipt-claim-card">
          <h3 className="tx-receipt-claim-title">
            <span className="material-symbols-outlined" style={{ color: "var(--accent)", fontSize: 28 }}>payments</span>
            You received a tip
          </h3>
          <p className="tx-receipt-claim-desc">
            Install the Teep extension to claim your funds instantly. All tips are held securely on-chain until you connect your wallet.
          </p>
          <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="tx-receipt-claim-cta">
            {claimLabel}
          </a>
        </div>

        <div className="tx-receipt-actions">
          <button type="button" onClick={shareOnX} className="tx-receipt-btn-share">
            <XLogoIcon />
            Share on X
          </button>
          <button type="button" onClick={copyLink} className="tx-receipt-btn-copy">
            <span className="material-symbols-outlined">link</span>
            {copyDone ? "Copied!" : "Copy Link"}
          </button>
        </div>

        <details className="tx-receipt-details" open={detailsOpen} onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="tx-receipt-details-summary">
            <span className="material-symbols-outlined" style={{ color: "var(--text-muted)" }}>receipt_long</span>
            Transaction Details
            <span className="material-symbols-outlined" style={{ transform: detailsOpen ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }}>expand_more</span>
          </summary>
          <div className="tx-receipt-details-inner">
            <div className="tx-receipt-detail-row"><span>Amount</span><span>${amountUsd} USD</span></div>
            <div className="tx-receipt-detail-row"><span>Sender</span><span className="tx-receipt-mono">{truncateAddress(data.fromAddress)}</span></div>
            <div className="tx-receipt-detail-row"><span>Receiver</span><span className="tx-receipt-mono">{truncateAddress(data.toAddress)}</span></div>
            <div className="tx-receipt-detail-row"><span>Transaction Hash</span><span className="tx-receipt-mono">{data.txHash.slice(0, 10)}…{data.txHash.slice(-8)}</span></div>
            <div className="tx-receipt-detail-row"><span>Network</span><span>{CHAIN_NAME}</span></div>
            <div className="tx-receipt-detail-row"><span>Timestamp</span><span>{dateStr}</span></div>
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--accent)", marginTop: 8, display: "inline-block" }}>View on block explorer</a>
          </div>
        </details>

        <div className="tx-receipt-how">
          <h4 className="tx-receipt-how-title">
            <span className="material-symbols-outlined" style={{ color: "var(--accent)" }}>verified_user</span>
            How Teep Works
          </h4>
          <p className="tx-receipt-how-p">
            Teep lets fans tip creators directly from posts on X. Tips go directly from sender wallet to creator wallet. <strong>Teep never holds your funds.</strong> All transactions are transparent and verifiable on Arc.
          </p>
        </div>
      </main>

      <footer className="tx-receipt-footer">
        <div className="tx-receipt-footer-brand">
          <img src="/logo.svg" alt="" width={20} height={20} />
          <span>Teep © {new Date().getFullYear()}</span>
        </div>
        <div className="tx-receipt-footer-links">
          <Link to="/">About</Link>
          <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">Docs</a>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/support">Support</Link>
        </div>
      </footer>
    </div>
  );
}
