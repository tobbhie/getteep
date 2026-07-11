import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { API_BASE, RECEIPT_BASE_URL } from "../config";
import { avatarErrorFallback, xAvatarUrl } from "../lib/avatar";

type XReceiptData = {
  kind: "x_bot";
  receiptId: string;
  fromAddress: string | null;
  toAddress: string | null;
  amount: string;
  txHash?: string;
  displayAmount?: boolean;
  timestamp: number;
  authorHandle: string | null;
  recipientHandle?: string | null;
  tweetAuthorHandle?: string | null;
  tweetId: string | null;
  source: "x_bot";
  status: "completed" | "reserved" | string;
  expiresAt?: number | null;
};

function formatUsdRaw(raw: string): string {
  const value = Number(raw || "0") / 1e6;
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function shortAddress(address?: string | null) {
  if (!address) return "Teep account";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function XReceipt() {
  const { receiptId } = useParams<{ receiptId: string }>();
  const [data, setData] = useState<XReceiptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const receiptUrl = receiptId ? `${RECEIPT_BASE_URL}/x/${receiptId}` : "";

  useEffect(() => {
    if (!receiptId || !/^[a-f0-9]{16}$/i.test(receiptId)) {
      setError("Receipt not found.");
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`${API_BASE}/tips/receipt/x/${receiptId}`, { headers: { Accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "Receipt not found." : "Could not load receipt.");
        return response.json();
      })
      .then((payload) => setData(payload))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load receipt."))
      .finally(() => setLoading(false));
  }, [receiptId]);

  const amount = data ? formatUsdRaw(data.amount) : "0.00";
  const creatorHandle = data?.recipientHandle || data?.authorHandle || null;
  const creator = creatorHandle ? `@${creatorHandle}` : "Creator";
  const tweetAuthorHandle = data?.tweetAuthorHandle || data?.authorHandle || null;
  const tweetUrl = tweetAuthorHandle && data?.tweetId ? `https://x.com/${tweetAuthorHandle}/status/${data.tweetId.split(":")[0]}` : "";
  const date = data ? new Date(data.timestamp * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "";
  const completed = data?.status === "completed";

  if (data?.txHash) {
    return <Navigate to={`/tx/${data.txHash}`} replace />;
  }

  const copyLink = async () => {
    if (!receiptUrl) return;
    await navigator.clipboard.writeText(receiptUrl);
  };

  return (
    <div className="tx-receipt-page">
      <header className="tx-receipt-header">
        <Link to="/" className="tx-receipt-logo">
          <img src="/logo.svg" alt="Teep" width={32} height={32} />
          <span>Teep</span>
        </Link>
        <Link to="/dashboard" className="tx-receipt-install">
          Launch App
        </Link>
      </header>

      <main className="tx-receipt-main">
        {loading ? (
          <p style={{ color: "var(--text-muted)" }}>Loading receipt...</p>
        ) : error || !data ? (
          <div className="tx-receipt-hero">
            <h1 className="tx-receipt-title">Receipt unavailable</h1>
            <p className="tx-receipt-line">{error || "Receipt not found."}</p>
            <Link to="/" className="btn-primary">
              Back to home
            </Link>
          </div>
        ) : (
          <>
            <div className="tx-receipt-hero">
              <div className="tx-receipt-success-icon">
                <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 40 }}>
                  {completed ? "check_circle" : "schedule"}
                </span>
              </div>
              <h1 className="tx-receipt-title">{completed ? "X Tip Sent" : "X Tip Reserved"}</h1>
              <p className="tx-receipt-line">
                <span className="tx-receipt-handle">{shortAddress(data.fromAddress)}</span> tipped{" "}
                <span className="tx-receipt-handle">{creator}</span>
              </p>
              {data.displayAmount !== false && <div className="tx-receipt-amount">${amount} USD</div>}
            </div>

            <div className="tx-receipt-tweet-card">
              <div className="tx-receipt-tweet-header">
                <img
                  src={xAvatarUrl(tweetAuthorHandle) || "/logo.svg"}
                  alt=""
                  className="tx-receipt-tweet-avatar"
                  onError={(event) => avatarErrorFallback(event, tweetAuthorHandle)}
                />
                <div>
                  <p className="tx-receipt-tweet-handle">{tweetAuthorHandle ? `@${tweetAuthorHandle}` : creator}</p>
                  <p className="tx-receipt-tweet-time">{date}</p>
                </div>
              </div>
              <p className="tx-receipt-tweet-snippet">
                {completed
                  ? "This X tip has been processed by Teep."
                  : "This X tip is waiting for the creator to connect Teep."}
              </p>
              {tweetUrl && (
                <a href={tweetUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--accent)" }}>
                  View post on X
                </a>
              )}
            </div>

            {!completed && (
              <div className="tx-receipt-claim-card">
                <h3 className="tx-receipt-claim-title">
                  <span className="material-symbols-outlined" aria-hidden style={{ color: "var(--accent)", fontSize: 28 }}>
                    payments
                  </span>
                  Claim this tip
                </h3>
                <p className="tx-receipt-claim-desc">
                  Connect the creator X account in Teep to make this reserved tip available.
                </p>
                <div className="tx-receipt-claim-actions">
                  <Link to={`/register?intent=x-tip&recipient=${encodeURIComponent(creatorHandle || "")}&amount=${encodeURIComponent(amount)}`} className="tx-receipt-claim-cta">
                    Continue in Teep
                  </Link>
                </div>
              </div>
            )}

            <div className="tx-receipt-actions">
              <button type="button" onClick={copyLink} className="tx-receipt-btn-copy">
                <span className="material-symbols-outlined" aria-hidden>
                  link
                </span>
                Copy Link
              </button>
              <Link to="/dashboard" className="tx-receipt-btn-share">
                Launch App
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
