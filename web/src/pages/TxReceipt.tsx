import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as QRCode from "qrcode";
import { API_BASE, CHROME_STORE_URL, RECEIPT_BASE_URL, CHAIN_NAME, EXPLORER_TX_URL } from "../config";
import { avatarErrorFallback, xAvatarUrl } from "../lib/avatar";

interface ReceiptData {
  fromAddress: string | null;
  fromIdentity?: string;
  toAddress: string;
  amount: string;
  displayAmount?: boolean;
  txHash: string;
  timestamp: number;
  authorId: string;
  contentId: string;
  authorHandle: string | null;
  recipientHandle?: string | null;
  tweetAuthorHandle?: string | null;
  tweetId: string | null;
  kind?: string;
  creatorClaimStatus?: "unclaimed" | "verified" | "claim_wallet_active";
  creatorVerified?: boolean;
  creatorOwnerAddress?: string | null;
  receiptPreferences?: {
    shareAmountEnabled?: boolean;
    shareLinksEnabled?: boolean;
    postAwareCopyEnabled?: boolean;
  };
}

function formatUsdRaw(raw: string): string {
  const n = Number(raw) / 1e6;
  if (isNaN(n)) return "0.00";
  return n.toFixed(2);
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

const appPath = "/dashboard";
const claimPath = "/dashboard?claim=creator";

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) ctx.fillText(line, x, y);
}

async function drawReceiptQr(ctx: CanvasRenderingContext2D, receiptUrl: string, x: number, y: number, size: number) {
  if (!receiptUrl) return;
  const qrCanvas = document.createElement("canvas");
  qrCanvas.width = size;
  qrCanvas.height = size;
  try {
    await QRCode.toCanvas(qrCanvas, receiptUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: size,
      color: {
        dark: "#111111",
        light: "#ffffff",
      },
    });
    ctx.drawImage(qrCanvas, x, y, size, size);
  } catch {
    ctx.fillStyle = "rgba(205,189,255,0.16)";
    roundRect(ctx, x, y, size, size, 18);
    ctx.fill();
  }
}

function receiptInitial(value?: string) {
  const clean = (value || "T").replace(/^@/, "").trim();
  return clean.slice(0, 2).toUpperCase() || "T";
}

async function generateReceiptImage(params: { receiptUrl: string; amount: string; title: string; subtitle: string; from?: string; to?: string; date: string }): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const from = params.from || "You";
  const to = params.to || "Creator";

  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 150, 150, 780, 780, 30);
  ctx.fill();
  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 3;
  roundRect(ctx, 150, 150, 780, 780, 30);
  ctx.stroke();

  ctx.fillStyle = "#111111";
  ctx.font = "900 36px Inter, system-ui, sans-serif";
  ctx.fillText("Teep", 205, 238);
  ctx.fillStyle = "#7c3aed";
  ctx.font = "800 18px Inter, system-ui, sans-serif";
  ctx.fillText("RECEIPT", 205, 274);

  ctx.fillStyle = "#111111";
  ctx.font = "900 82px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`$${params.amount}`, 875, 265);
  ctx.textAlign = "left";

  ctx.strokeStyle = "#eee9f8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(205, 325);
  ctx.lineTo(875, 325);
  ctx.stroke();

  ctx.fillStyle = "#111111";
  ctx.font = "900 34px Inter, system-ui, sans-serif";
  ctx.fillText(`${params.title} sent`, 205, 385);
  ctx.fillStyle = "#55505f";
  ctx.font = "500 22px Inter, system-ui, sans-serif";
  wrapCanvasText(ctx, params.subtitle || "You supported a creator and helped fuel the social internet.", 205, 425, 620, 31);

  const avatarY = 580;
  ctx.fillStyle = "#f4f0ff";
  ctx.beginPath();
  ctx.arc(300, avatarY, 50, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#7c3aed";
  ctx.beginPath();
  ctx.arc(300, avatarY, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 23px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(receiptInitial(from), 300, avatarY + 8);

  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(390, avatarY);
  ctx.lineTo(690, avatarY);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(540, avatarY, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#7c3aed";
  ctx.font = "800 29px Inter, system-ui, sans-serif";
  ctx.fillText(">", 540, avatarY + 10);

  ctx.fillStyle = "#f4f0ff";
  ctx.beginPath();
  ctx.arc(780, avatarY, 50, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#111111";
  ctx.beginPath();
  ctx.arc(780, avatarY, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 23px Inter, system-ui, sans-serif";
  ctx.fillText(receiptInitial(to), 780, avatarY + 8);

  ctx.fillStyle = "#111111";
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.fillText(from, 300, 665);
  ctx.fillText(to, 780, 665);
  ctx.textAlign = "left";

  ctx.strokeStyle = "#eee9f8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(205, 710);
  ctx.lineTo(875, 710);
  ctx.stroke();

  ctx.fillStyle = "#6b6478";
  ctx.font = "500 21px Inter, system-ui, sans-serif";
  ctx.fillText("Date", 205, 770);
  ctx.fillStyle = "#111111";
  ctx.font = "650 21px Inter, system-ui, sans-serif";
  ctx.fillText(params.date, 205, 807);

  ctx.fillStyle = "#f8f7fb";
  roundRect(ctx, 718, 730, 132, 132, 18);
  ctx.fill();
  await drawReceiptQr(ctx, params.receiptUrl, 728, 740, 112);
  ctx.fillStyle = "#7c3aed";
  ctx.font = "750 20px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Scan to view", 784, 894);
  ctx.textAlign = "left";

  ctx.fillStyle = "#ffffff";
  ctx.font = "800 24px Inter, system-ui, sans-serif";
  ctx.fillText("Support creators directly via @teepagent", 150, 990);
  ctx.fillStyle = "#a78bfa";
  ctx.font = "700 21px Inter, system-ui, sans-serif";
  ctx.fillText("https://getteep.xyz", 150, 1028);

  return canvas.toDataURL("image/png");
}

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

  const tweetAuthorHandle = data?.tweetAuthorHandle || data?.authorHandle || null;
  const baseTweetId = data?.tweetId?.split(":")[0] || null;
  const tweetUrl =
    tweetAuthorHandle && baseTweetId
      ? `https://x.com/${tweetAuthorHandle}/status/${baseTweetId}`
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
    const title = data.displayAmount === false ? `${creatorLabel} received a tip on Teep` : `${creatorLabel} received a $${amountUsd} tip on Teep`;
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
    const creator = data.recipientHandle || data.authorHandle
      ? `@${data.recipientHandle || data.authorHandle}`
      : data.kind === "deposit"
        ? "my Teep account"
        : data.kind === "withdrawal"
          ? "from Teep"
          : data.kind === "referral_fee_received"
            ? "a referral fee"
            : "the creator";
    const amount = formatUsdRaw(data.amount);
    const amountPart = data.receiptPreferences?.shareAmountEnabled === false ? "" : ` $${amount}`;
    const receiptPart = `\n\nReceipt: ${receiptUrl}`;
    const text =
      data.kind === "direct_creator_tip"
        ? `I just sent ${creator} a direct creator tip${amountPart} with Teep.${receiptPart}\nSupport creators directly via @teepagent.`
        : data.kind === "deposit"
          ? `I just added${amountPart} to ${creator}.${receiptPart}\nSupport creators directly via @teepagent.`
          : data.kind === "withdrawal"
            ? `I just withdrew${amountPart} ${creator}.${receiptPart}\nSupport creators directly via @teepagent.`
            : data.kind === "referral_fee_received"
              ? `I just earned${amountPart} from Teep referrals.${receiptPart}\nSupport creators directly via @teepagent.`
              : `I just tipped ${creator}${amountPart} with Teep.${receiptPart}\nSupport creators directly via @teepagent.`;
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  };

  const copyLink = () => {
    navigator.clipboard.writeText(receiptUrl);
    setCopyDone(true);
    setTimeout(() => setCopyDone(false), 2000);
  };

  const downloadReceipt = async () => {
    if (!data) return;
    const amountUsd = formatUsdRaw(data.amount);
    const from = data.fromIdentity || "A supporter";
    const to = data.recipientHandle || data.authorHandle ? `@${data.recipientHandle || data.authorHandle}` : "Creator";
    const date = new Date(data.timestamp * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    const imageUrl = await generateReceiptImage({
      receiptUrl,
      amount: amountUsd,
      title: receiptKind,
      subtitle: `${from} ${receiptVerb} ${to} with Teep.`,
      from,
      to,
      date,
    });
    if (!imageUrl) return;
    const link = document.createElement("a");
    link.download = `teep-receipt-${data.txHash.slice(0, 10)}.png`;
    link.href = imageUrl;
    link.click();
  };

  if (loading) {
    return (
      <div className="tx-receipt-page">
        <header className="tx-receipt-header">
          <Link to="/" className="tx-receipt-logo">
            <img src="/logo.svg" alt="Teep" width={32} height={32} />
            <span>Teep</span>
          </Link>
          <Link to={appPath} className="tx-receipt-install">Launch App</Link>
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
          <Link to={appPath} className="tx-receipt-install">Launch App</Link>
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
  const creatorHandle = data.recipientHandle || data.authorHandle ? `@${data.recipientHandle || data.authorHandle}` : "Creator";
  const isDirectTip = data.kind === "direct_creator_tip";
  const isPostTip = !data.kind || data.kind === "post_tip";
  const receiptKind =
    data.kind === "deposit" ? "Deposit" :
    data.kind === "withdrawal" ? "Withdrawal" :
    data.kind === "referral_fee_received" ? "Referral Earning" :
    isDirectTip ? "Direct Creator Tip" :
    "Post Tip";
  const receiptVerb =
    data.kind === "deposit" ? "was deposited to" :
    data.kind === "withdrawal" ? "withdrew from" :
    data.kind === "referral_fee_received" ? "earned a referral fee on" :
    "tipped";
  const receiptTitle =
    data.kind === "deposit" ? "Deposit Confirmed" :
    data.kind === "withdrawal" ? "Withdrawal Confirmed" :
    data.kind === "referral_fee_received" ? "Referral Earning Confirmed" :
    `${receiptKind} Sent Successfully`;
  const tweetDisplayName = oembed?.author_name ?? (tweetAuthorHandle ? `@${tweetAuthorHandle}` : creatorHandle);
  const tweetSnippet = oembed?.excerpt ?? "Post linked to this tip";
  const explorerUrl = `${EXPLORER_TX_URL}/${data.txHash}`;
  const dateStr = new Date(data.timestamp * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const isCreatorClaimed =
    data.creatorVerified === true ||
    data.creatorClaimStatus === "verified";
  const showCreatorClaimState = isPostTip || isDirectTip;
  const showCreatorClaimPrompt = showCreatorClaimState && !isCreatorClaimed;
  const claimCtaPath =
    isDirectTip && (data.recipientHandle || data.authorHandle)
      ? `/register?intent=x-tip&recipient=${encodeURIComponent(data.recipientHandle || data.authorHandle || "")}&amount=${encodeURIComponent(amountUsd)}`
      : claimPath;

  return (
    <div className="tx-receipt-page">
      <header className="tx-receipt-header">
        <Link to="/" className="tx-receipt-logo">
          <img src="/logo.svg" alt="Teep" width={32} height={32} />
          <span>Teep</span>
        </Link>
        <Link to={appPath} className="tx-receipt-install">Launch App</Link>
      </header>

      <main className="tx-receipt-main">
        <div className="tx-receipt-hero">
          <div className="tx-receipt-success-icon">
            <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 40 }}>check_circle</span>
          </div>
          <h1 className="tx-receipt-title">{receiptTitle}</h1>
          <p className="tx-receipt-line">
            <span className="tx-receipt-handle">{data.fromIdentity || "A supporter"}</span> {receiptVerb} <span className="tx-receipt-handle">{isPostTip || isDirectTip ? creatorHandle : "Teep"}</span>
          </p>
          {data.displayAmount !== false && <div className="tx-receipt-amount">${amountUsd} USD</div>}
        </div>

        {tweetUrl && (
          <div className="tx-receipt-tweet-card">
            <div className="tx-receipt-tweet-header">
              <img
                src={xAvatarUrl(tweetAuthorHandle) || "/logo.svg"}
                alt=""
                className="tx-receipt-tweet-avatar"
                onError={(event) => avatarErrorFallback(event, tweetAuthorHandle)}
              />
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

        {showCreatorClaimState && <div className={`tx-receipt-status-pill ${isCreatorClaimed ? "is-claimed" : "is-waiting"}`} role="status" aria-live="polite">
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18 }}>{isCreatorClaimed ? "check_circle" : "schedule"}</span>
          {isCreatorClaimed ? "Claimed by creator" : "Waiting for creator to claim"}
        </div>}

        {showCreatorClaimPrompt && <div className="tx-receipt-claim-card">
          <h3 className="tx-receipt-claim-title">
            <span className="material-symbols-outlined" aria-hidden style={{ color: "var(--accent)", fontSize: 28 }}>payments</span>
            You received a tip
          </h3>
          <p className="tx-receipt-claim-desc">
            Connect your X account in the Teep web app to claim tips sent to this creator profile. It only takes a moment.
          </p>
          <div className="tx-receipt-claim-actions">
            <Link to={claimCtaPath} className="tx-receipt-claim-cta">
              Claim in web app
            </Link>
            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="tx-receipt-claim-secondary">
              Prefer the extension?
            </a>
          </div>
        </div>}

        <div className="tx-receipt-actions">
          <button type="button" onClick={shareOnX} className="tx-receipt-btn-share">
            <XLogoIcon />
            Share on X
          </button>
          <button type="button" onClick={copyLink} className="tx-receipt-btn-copy">
            <span className="material-symbols-outlined" aria-hidden>link</span>
            {copyDone ? "Copied!" : "Copy Link"}
          </button>
          <button type="button" onClick={downloadReceipt} className="tx-receipt-btn-copy">
            <span className="material-symbols-outlined" aria-hidden>download</span>
            Download Receipt
          </button>
        </div>

        <details className="tx-receipt-details" open={detailsOpen} onToggle={(e) => setDetailsOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="tx-receipt-details-summary">
            <span className="material-symbols-outlined" aria-hidden style={{ color: "var(--text-muted)" }}>receipt_long</span>
            Transaction Details
            <span className="material-symbols-outlined" aria-hidden style={{ transform: detailsOpen ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }}>expand_more</span>
          </summary>
          <div className="tx-receipt-details-inner">
            {data.displayAmount !== false && <div className="tx-receipt-detail-row"><span>Amount</span><span>${amountUsd} USD</span></div>}
            <div className="tx-receipt-detail-row"><span>Receipt Type</span><span>{receiptKind}</span></div>
            <div className="tx-receipt-detail-row"><span>Sender</span><span className="tx-receipt-mono">{data.fromIdentity || "A supporter"}</span></div>
            <div className="tx-receipt-detail-row"><span>Receiver</span><span className="tx-receipt-mono">{isPostTip || isDirectTip ? creatorHandle : "Teep"}</span></div>
            <div className="tx-receipt-detail-row"><span>Transaction Hash</span><span className="tx-receipt-mono">{data.txHash.slice(0, 10)}…{data.txHash.slice(-8)}</span></div>
            <div className="tx-receipt-detail-row"><span>Network</span><span>{CHAIN_NAME}</span></div>
            <div className="tx-receipt-detail-row"><span>Timestamp</span><span>{dateStr}</span></div>
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--accent)", marginTop: 8, display: "inline-block" }}>View on block explorer</a>
          </div>
        </details>

        <div className="tx-receipt-how">
          <h4 className="tx-receipt-how-title">
            <span className="material-symbols-outlined" aria-hidden style={{ color: "var(--accent)" }}>verified_user</span>
            How Teep Works
          </h4>
          <p className="tx-receipt-how-p">
            Teep lets supporters tip creators directly from posts on X. Creators can connect their account, claim what they receive, and manage everything from one Teep dashboard. <strong>Teep does not take custody of creator funds.</strong>
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
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/support">Support</Link>
        </div>
      </footer>
    </div>
  );
}
