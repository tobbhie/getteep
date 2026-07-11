import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { API_BASE } from "../config";

type ClaimStatus = {
  verified: boolean;
  claims?: Array<{ username: string; display_name?: string | null; profile_image_url?: string | null }>;
};

function cleanHandle(value: string | null) {
  return (value || "").replace(/^@/, "").trim().toLowerCase();
}

function cleanAmount(value: string | null) {
  const normalized = (value || "").trim().replace(/^\$/, "");
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? normalized : "";
}

function appendParams(path: string, params: URLSearchParams) {
  const next = new URLSearchParams();
  const [base, existingQuery] = path.split("?");
  if (existingQuery) {
    new URLSearchParams(existingQuery).forEach((value, key) => next.set(key, value));
  }
  for (const key of ["intent", "tweetId", "recipient", "amount"]) {
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

export default function XTipRegister() {
  const [searchParams] = useSearchParams();
  const { ready, authenticated, user, login } = usePrivy();
  const { wallets } = useWallets();
  const { client: smartWalletClient } = useSmartWallets();
  const [claimStatus, setClaimStatus] = useState<ClaimStatus | null>(null);

  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");
  const address = (smartWalletClient?.account?.address || embeddedWallet?.address || (user?.wallet as { address?: string } | undefined)?.address || "").toLowerCase();
  const recipient = cleanHandle(searchParams.get("recipient"));
  const amount = cleanAmount(searchParams.get("amount"));
  const intent = searchParams.get("intent") || "x-tip";
  const isTipIntent = intent === "x-tip" && recipient && amount;
  const claimPath = appendParams("/dashboard?claim=creator", searchParams);

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

  const shareText = isTipIntent
    ? `@${recipient}, you have a $${amount} tip waiting on Teep. Claim it here: ${window.location.href}`
    : `Claim your Teep tip here: ${window.location.href}`;
  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;

  if (!ready) {
    return (
      <main className="x-tip-link-page">
        <header className="x-tip-link-topbar">
          <Link to="/" className="x-tip-link-brand">
            <img src="/logo.svg" alt="" />
            <span>Teep</span>
          </Link>
        </header>
        <section className="x-tip-link-card">
          <p className="eyebrow">Teep claim link</p>
          <h1>Preparing this tip.</h1>
        </section>
      </main>
    );
  }

  if (!isTipIntent) {
    return (
      <main className="x-tip-link-page">
        <header className="x-tip-link-topbar">
          <Link to="/" className="x-tip-link-brand">
            <img src="/logo.svg" alt="" />
            <span>Teep</span>
          </Link>
        </header>
        <section className="x-tip-link-card">
          <p className="eyebrow">Teep claim link</p>
          <h1>This link is incomplete.</h1>
          <p>Open the claim link from the Teep reply on X, or launch Teep to continue.</p>
          <Link to="/dashboard" className="btn-primary">Launch App</Link>
        </section>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="x-tip-link-page">
        <header className="x-tip-link-topbar">
          <Link to="/" className="x-tip-link-brand">
            <img src="/logo.svg" alt="" />
            <span>Teep</span>
          </Link>
        </header>
        <section className="x-tip-link-hero x-tip-link-hero--claim">
          <span className="x-tip-link-badge">Tip waiting</span>
          <div className="x-tip-link-avatar" aria-hidden>
            <span>@</span>
          </div>
          <h1>${amount} is reserved for @{recipient}</h1>
          <p>This tip is waiting for @{recipient}. Continue with Teep, then connect that X account to claim it.</p>
          <div className="x-tip-link-panel">
            <div className="x-tip-link-summary" aria-label="Reserved tip details">
              <div>
                <span>Recipient</span>
                <strong>@{recipient}</strong>
              </div>
              <div>
                <span>Tip amount</span>
                <strong>${amount}</strong>
              </div>
            </div>
            <button type="button" onClick={login} className="btn-primary x-tip-link-primary">
              I am this creator
            </button>
            <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary x-tip-link-primary">
              Share link
            </a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="x-tip-link-page">
      <header className="x-tip-link-topbar">
        <Link to="/" className="x-tip-link-brand">
          <img src="/logo.svg" alt="" />
          <span>Teep</span>
        </Link>
      </header>
      <section className="x-tip-link-hero x-tip-link-hero--claim">
        <span className="x-tip-link-badge">Tip waiting</span>
        <div className="x-tip-link-avatar" aria-hidden>
          <span>{recipient.slice(0, 2).toUpperCase()}</span>
        </div>
        <h1>${amount} is reserved for @{recipient}</h1>
        {linkedRecipient ? (
          <p>
            You are signed in as {signedInName}. Finish the claim flow to make this tip available.
          </p>
        ) : (
          <p>
            You are signed in as {signedInName}. This claim link is for @{recipient}. If that is not you, share the link with them.
          </p>
        )}

        <div className="x-tip-link-panel">
          <div className="x-tip-link-summary" aria-label="Reserved tip details">
            <div>
              <span>Recipient</span>
              <strong>@{recipient}</strong>
            </div>
            <div>
              <span>Signed in as</span>
              <strong>{signedInName}</strong>
            </div>
            <div>
              <span>Tip amount</span>
              <strong>${amount}</strong>
            </div>
          </div>

          <div className="x-tip-link-actions">
            <Link to={claimPath} className="btn-primary">
              {linkedRecipient ? "Finish claim" : "I am this creator"}
            </Link>
            <a href={shareUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary">
              Share with @{recipient}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
