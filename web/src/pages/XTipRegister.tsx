import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { API_BASE } from "../config";
import { avatarErrorFallback, localInitialsAvatar, xAvatarUrl } from "../lib/avatar";

type ClaimStatus = {
  verified: boolean;
  claims?: Array<{ username: string; display_name?: string | null; profile_image_url?: string | null }>;
};

type XTipReceipt = {
  receiptId: string;
  amount: string;
  authorHandle: string | null;
  recipientHandle?: string | null;
  status?: string;
  txHash?: string | null;
};

function cleanHandle(value: string | null | undefined) {
  return (value || "").replace(/^@/, "").trim().toLowerCase();
}

function cleanAmount(value: string | null) {
  const normalized = (value || "").trim().replace(/^\$/, "");
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? normalized : "";
}

function cleanReceiptId(value: string | null) {
  const normalized = (value || "").trim();
  return /^[a-f0-9]{16}$/i.test(normalized) ? normalized : "";
}

function formatUsdRaw(raw?: string | null): string {
  const value = Number(raw || "0") / 1e6;
  return Number.isFinite(value) ? value.toFixed(2) : "";
}

function appendParams(path: string, params: URLSearchParams) {
  const next = new URLSearchParams();
  const [base, existingQuery] = path.split("?");
  if (existingQuery) {
    new URLSearchParams(existingQuery).forEach((value, key) => next.set(key, value));
  }
  for (const key of ["intent", "tweetId", "recipient", "amount", "receipt"]) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  const query = next.toString();
  return `${base}${query ? `?${query}` : ""}`;
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function privyDisplayName(user: unknown, fallbackAddress: string) {
  const candidate = user as {
    email?: { address?: string | null } | null;
    google?: { email?: string | null; name?: string | null } | null;
    twitter?: { username?: string | null; name?: string | null } | null;
  } | null;
  return (
    candidate?.twitter?.username ||
    candidate?.twitter?.name ||
    candidate?.google?.name ||
    candidate?.google?.email ||
    candidate?.email?.address ||
    (fallbackAddress ? shortAddress(fallbackAddress) : "your Teep account")
  );
}

function PageMessage({ title, body, cta }: { title: string; body?: string; cta?: ReactNode }) {
  return (
    <main className="x-tip-link-page">
      <section className="x-tip-link-card x-tip-link-card--message">
        <p className="eyebrow">Teep claim link</p>
        <h1>{title}</h1>
        {body && <p>{body}</p>}
        {cta}
      </section>
    </main>
  );
}

export default function XTipRegister() {
  const [searchParams] = useSearchParams();
  const { ready, authenticated, user, login } = usePrivy();
  const { wallets } = useWallets();
  const { client: smartWalletClient } = useSmartWallets();
  const [claimStatus, setClaimStatus] = useState<ClaimStatus | null>(null);
  const [receipt, setReceipt] = useState<XTipReceipt | null>(null);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState("");

  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");
  const address = (smartWalletClient?.account?.address || embeddedWallet?.address || (user?.wallet as { address?: string } | undefined)?.address || "").toLowerCase();
  const receiptId = cleanReceiptId(searchParams.get("receipt") || searchParams.get("receiptId"));
  const queryRecipient = cleanHandle(searchParams.get("recipient"));
  const queryAmount = cleanAmount(searchParams.get("amount"));
  const intent = searchParams.get("intent") || "x-tip";

  useEffect(() => {
    if (!receiptId) {
      setReceipt(null);
      setReceiptError("");
      setReceiptLoading(false);
      return;
    }
    let cancelled = false;
    setReceiptLoading(true);
    setReceiptError("");
    fetch(`${API_BASE}/tips/receipt/x/${receiptId}`, { headers: { Accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error(response.status === 404 ? "This claim link could not be found." : "Could not verify this claim link.");
        return response.json();
      })
      .then((payload: XTipReceipt) => {
        if (!cancelled) setReceipt(payload);
      })
      .catch((error) => {
        if (!cancelled) {
          setReceipt(null);
          setReceiptError(error instanceof Error ? error.message : "Could not verify this claim link.");
        }
      })
      .finally(() => {
        if (!cancelled) setReceiptLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [receiptId]);

  const recipient = cleanHandle(receipt?.recipientHandle || receipt?.authorHandle) || queryRecipient;
  const sender = cleanHandle(receipt?.authorHandle);
  const amount = receipt ? formatUsdRaw(receipt.amount) : queryAmount;
  const isTipIntent = intent === "x-tip" && recipient && (amount || receiptId);
  const claimPath = appendParams("/dashboard?claim=creator", searchParams);
  const avatarSrc = xAvatarUrl(recipient) || localInitialsAvatar(recipient);
  const headline = amount ? (
    <>
      A <span className="x-tip-link-amount">${amount}</span> tip is waiting for{" "}
      <span className="x-tip-link-handle">@{recipient}</span>
    </>
  ) : (
    <>
      A tip is waiting for <span className="x-tip-link-handle">@{recipient}</span>
    </>
  );
  const hasReceiptSource = Boolean(receipt);

  useEffect(() => {
    if (!address) {
      setClaimStatus(null);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/auth/claim-status/${address}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!cancelled) setClaimStatus(payload);
      })
      .catch(() => {
        if (!cancelled) setClaimStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const linkedRecipient = useMemo(() => {
    if (!recipient || !claimStatus?.claims?.length) return false;
    return claimStatus.claims.some((claim) => cleanHandle(claim.username) === recipient);
  }, [claimStatus, recipient]);
  const matchingClaim = useMemo(() => {
    if (!recipient || !claimStatus?.claims?.length) return null;
    return claimStatus.claims.find((claim) => cleanHandle(claim.username) === recipient) || null;
  }, [claimStatus, recipient]);
  const signedInName = matchingClaim?.display_name || (matchingClaim?.username ? `@${matchingClaim.username}` : privyDisplayName(user, address));

  const shareText =
    isTipIntent && amount
      ? `@${recipient}, you have a $${amount} tip waiting on Teep. Claim it here: ${window.location.href}`
      : `@${recipient}, you have a tip waiting on Teep. Claim it here: ${window.location.href}`;
  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;

  if (!ready || receiptLoading) {
    return <PageMessage title="Preparing this tip." body="Checking the claim link before showing the details." />;
  }

  if (receiptId && receiptError && !queryRecipient) {
    return (
      <PageMessage
        title="This claim link is unavailable."
        body={receiptError}
        cta={<Link to="/" className="btn-primary">Back to Teep</Link>}
      />
    );
  }

  if (!isTipIntent) {
    return (
      <PageMessage
        title="This link is incomplete."
        body="Open the claim link from the Teep reply on X, or launch Teep to continue."
        cta={<Link to="/dashboard" className="btn-primary">Launch App</Link>}
      />
    );
  }

  const intro = "Confirm your X account to move this tip into your Teep balance.";

  return (
    <main className="x-tip-link-page">
      <section className="x-tip-link-claim-shell">
        <div className="x-tip-link-claim-copy">
          <div className="x-tip-link-hero-top">
            <span className="x-tip-link-badge">Tip waiting</span>
            <img
              src={avatarSrc}
              alt=""
              className="x-tip-link-avatar-img"
              onError={(event) => avatarErrorFallback(event, recipient)}
            />
          </div>
          <h1>{headline}</h1>
          <p>{intro}</p>
        </div>

        <div className="x-tip-link-panel x-tip-link-panel--claim">
          <p className="x-tip-link-panel-kicker">Claim your tip</p>
          <h2 className="x-tip-link-panel-title">Confirm @{recipient} on X.</h2>

          <div className="x-tip-link-signed-in" aria-label="Current Teep account">
            <span>{authenticated ? "Signed in as" : "Sign in to continue"}</span>
            <strong>{authenticated ? signedInName : "Teep account"}</strong>
            <button type="button" onClick={login}>{authenticated ? "Switch" : "Sign in"}</button>
          </div>

          <div className="x-tip-link-summary" aria-label="Reserved tip details">
            <div>
              <span>Recipient</span>
              <strong>@{recipient}</strong>
            </div>
            <div>
              <span>Amount</span>
              <strong>{amount ? `$${amount}` : "Tip waiting"}</strong>
            </div>
            <div>
              <span>{sender ? "Sent by" : "Source"}</span>
              <strong>{sender ? `@${sender}` : "Sent via X"}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong className="x-tip-link-status">Ready to claim</strong>
            </div>
          </div>

          {!hasReceiptSource && (
            <p className="x-tip-link-note">
              This is an older claim link. Teep will confirm the actual reserved tips during creator verification.
            </p>
          )}

          <div className="x-tip-link-actions">
            {authenticated ? (
              <Link to={claimPath} className="btn-primary">
                {linkedRecipient ? "Finish claim" : `Claim as @${recipient}`}
              </Link>
            ) : (
              <button type="button" onClick={login} className="btn-primary">
                Claim as @{recipient}
              </button>
            )}
            <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">
              Share with @{recipient}
            </a>
          </div>

          <p className="x-tip-link-panel-note">After confirmation, this tip moves into your Teep balance.</p>
        </div>
      </section>
    </main>
  );
}
