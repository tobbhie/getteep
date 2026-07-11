import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { buildFundingPolicy } from "@teep/shared";
import DashboardShell from "../components/DashboardShell";
import { DashboardPreparingPage } from "../components/DashboardAuthState";
import {
  API_BASE,
  ENABLE_FIAT_OFFRAMP,
  ENABLE_FIAT_ONRAMP,
  FAUCET_URL,
  FUNDING_ENV,
  OFFRAMP_URL,
  ONRAMP_URL,
} from "../config";

function formatUsdRaw(raw?: string) {
  const value = Number(raw || "0") / 1e6;
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function FundAccount() {
  const [searchParams] = useSearchParams();
  const { ready, authenticated, user, login } = usePrivy();
  const { wallets } = useWallets();
  const { client: smartWalletClient } = useSmartWallets();
  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");
  const userWalletAddress = (user?.wallet as { address?: string } | undefined)?.address;
  const linkedAccounts = (user as { linkedAccounts?: Array<{ type?: string; address?: string }> } | null)?.linkedAccounts ?? [];
  const addressFromLinked =
    linkedAccounts.find((account) => account?.type === "smart_wallet" && account?.address)?.address ||
    linkedAccounts.find((account) => account?.type === "wallet" && account?.address)?.address ||
    (linkedAccounts.find((account) => account?.address?.startsWith?.("0x"))?.address ?? "");
  const address = (
    smartWalletClient?.account?.address ||
    embeddedWallet?.address ||
    userWalletAddress ||
    addressFromLinked ||
    ""
  ).toLowerCase();

  const [balanceRaw, setBalanceRaw] = useState("0");
  const [copyStatus, setCopyStatus] = useState("");
  const [faucetStatus, setFaucetStatus] = useState("");
  const [faucetLoading, setFaucetLoading] = useState(false);

  const intent = searchParams.get("intent") || "";
  const recipient = (searchParams.get("recipient") || "").replace(/^@/, "").trim();
  const amount = (searchParams.get("amount") || "").replace(/^\$/, "").trim();
  const hasXTipContext = intent === "x-tip" && recipient && /^\d+(\.\d{1,2})?$/.test(amount);
  const fundingPolicy = buildFundingPolicy({
    environment: FUNDING_ENV,
    faucetUrl: FAUCET_URL,
    fiatOnrampUrl: ONRAMP_URL,
    fiatOfframpUrl: OFFRAMP_URL,
    enableFiatOnramp: ENABLE_FIAT_ONRAMP,
    enableFiatOfframp: ENABLE_FIAT_OFFRAMP,
  });

  const onrampUrl = address && fundingPolicy.providers.fiatOnramp.enabled && fundingPolicy.providers.fiatOnramp.url
    ? fundingPolicy.providers.fiatOnramp.url.replace("WALLET", address)
    : "";

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    fetch(`${API_BASE}/x-balance/${address}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (!cancelled && payload?.balanceRaw) setBalanceRaw(String(payload.balanceRaw));
      })
      .catch(() => {
        if (!cancelled) setBalanceRaw("0");
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const copyAddress = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopyStatus("Address copied. Paste it where you are sending funds from.");
    } catch {
      setCopyStatus("Could not copy address.");
    }
    window.setTimeout(() => setCopyStatus(""), 5000);
  }, [address]);

  const openFaucet = useCallback(async () => {
    if (!address) return;
    if (!fundingPolicy.providers.faucet.enabled || !fundingPolicy.providers.faucet.url) {
      setFaucetStatus(fundingPolicy.providers.faucet.disabledReason || "Faucet funding is not available.");
      window.setTimeout(() => setFaucetStatus(""), 5000);
      return;
    }
    setFaucetLoading(true);
    try {
      await navigator.clipboard.writeText(address);
      setFaucetStatus("Address copied. Opening faucet...");
      window.open(fundingPolicy.providers.faucet.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setFaucetStatus(error instanceof Error ? error.message : "Could not open faucet.");
    }
    setFaucetLoading(false);
    window.setTimeout(() => setFaucetStatus(""), 5000);
  }, [address, fundingPolicy]);

  if (!ready) {
    return <DashboardPreparingPage title="Add funds" message="Preparing your funding options." />;
  }

  if (!authenticated) {
    return (
      <main className="public-shell" style={{ minHeight: "calc(100vh - 88px)", display: "grid", placeItems: "center", padding: "clamp(32px, 8vw, 96px) var(--space-4)" }}>
        <section className="dashboard-card" style={{ width: "min(100%, 620px)", display: "grid", gap: "var(--space-5)" }}>
          <div>
            <p className="eyebrow">Funding</p>
            <h1 style={{ margin: "0 0 var(--space-3)", fontSize: "clamp(2rem, 8vw, 3.75rem)", lineHeight: 1 }}>
              {hasXTipContext ? `Fund your $${amount} tip` : "Fund your Teep account"}
            </h1>
            <p style={{ color: "var(--text-secondary)", margin: 0, fontSize: "1.05rem", lineHeight: 1.6 }}>
              {hasXTipContext
                ? `Sign in to add funds for your tip to @${recipient}.`
                : intent === "x-tip"
                  ? "Sign in to add funds and continue with X tipping."
                  : "Sign in to add funds to your Teep balance."}
            </p>
          </div>
          {hasXTipContext && (
            <div className="dashboard-settings-list-row" style={{ alignItems: "center" }}>
              <div>
                <strong>Pending X tip</strong>
                <span>@{recipient}</span>
              </div>
              <strong style={{ color: "var(--text-primary)" }}>${amount}</strong>
            </div>
          )}
          <button type="button" onClick={login} className="btn-primary" style={{ width: "100%", justifyContent: "center" }}>
            Continue
          </button>
        </section>
      </main>
    );
  }

  if (!address) {
    return <DashboardPreparingPage title="Add funds" message="Getting your Teep account ready." />;
  }

  const fundingPanel = (
    <section className={hasXTipContext ? "dashboard-card x-tip-link-card" : "dashboard-card"} style={{ display: "grid", gap: "var(--space-5)", maxWidth: hasXTipContext ? undefined : 920 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-4)", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <p className="dashboard-metric-label" style={{ marginBottom: 6 }}>Current Teep balance</p>
          <strong style={{ color: "#fff", fontSize: "2rem", lineHeight: 1 }}>${formatUsdRaw(balanceRaw)}</strong>
        </div>
        <button type="button" onClick={copyAddress} className="btn-secondary" style={{ minHeight: 42 }}>
          {shortAddress(address)}
          <span className="material-symbols-outlined" aria-hidden style={{ fontSize: 18 }}>content_copy</span>
        </button>
      </div>

      <div className="dashboard-funding-options" style={{ display: "grid", gap: "var(--space-3)" }}>
        {onrampUrl ? (
          <a href={onrampUrl} target="_blank" rel="noopener noreferrer" className="dashboard-funding-option">
            <span>
              <strong>{fundingPolicy.providers.fiatOnramp.label}</strong>
              <small>{fundingPolicy.providers.fiatOnramp.description}</small>
            </span>
            <span>Open</span>
          </a>
        ) : (
          <button type="button" className="dashboard-funding-option" disabled title={fundingPolicy.providers.fiatOnramp.disabledReason}>
            <span>
              <strong>{fundingPolicy.providers.fiatOnramp.label}</strong>
              <small>{fundingPolicy.providers.fiatOnramp.disabledReason || fundingPolicy.providers.fiatOnramp.description}</small>
            </span>
            <span>Soon</span>
          </button>
        )}

        <button type="button" onClick={openFaucet} disabled={faucetLoading || !fundingPolicy.providers.faucet.enabled} className="dashboard-funding-option">
          <span>
            <strong>{fundingPolicy.providers.faucet.label}</strong>
            <small>{fundingPolicy.providers.faucet.description}</small>
          </span>
          <span>{faucetLoading ? "..." : "Open"}</span>
        </button>

        <button type="button" onClick={copyAddress} className="dashboard-funding-option">
          <span>
            <strong>{fundingPolicy.providers.cryptoReceive.label}</strong>
            <small>{fundingPolicy.providers.cryptoReceive.description}</small>
          </span>
          <span>Copy</span>
        </button>
      </div>

      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        <p className="dashboard-funding-note" style={{ margin: 0 }}>{fundingPolicy.testnetCopy}</p>
        {copyStatus && <p className="dashboard-funding-note dashboard-funding-note--status" style={{ margin: 0 }}>{copyStatus}</p>}
        {faucetStatus && <p className="dashboard-funding-note dashboard-funding-note--status" style={{ margin: 0 }}>{faucetStatus}</p>}
      </div>
    </section>
  );

  if (hasXTipContext) {
    return (
      <main className="x-tip-link-page x-tip-link-page--fund">
        <section className="x-tip-link-hero">
          <p className="eyebrow">X tip setup</p>
          <h1>Fund your ${amount} tip</h1>
          <p>Add funds for your tip to @{recipient}, then return to X and send the same command again.</p>
        </section>
        {fundingPanel}
      </main>
    );
  }

  return (
    <DashboardShell title="Add funds" address={address}>
      <main className="dashboard-body-inner">
        <section className="dashboard-page-heading">
          <div>
            <p className="eyebrow">Funding</p>
            <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 var(--space-2)" }}>Fund your Teep account</h1>
            <p style={{ color: "var(--text-secondary)", maxWidth: 620, margin: 0 }}>
              {hasXTipContext
                ? `Add funds for your $${amount} tip to @${recipient}, then return to X and send the command again.`
                : "Add funds to your Teep balance, then return to X and send your tip command again."}
            </p>
          </div>
        </section>

        {fundingPanel}

        <div style={{ marginTop: "var(--space-5)", display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <Link to="/dashboard" className="btn-secondary">Open dashboard</Link>
          <Link to="/dashboard/settings?tab=funding" className="btn-secondary">View funding history</Link>
        </div>
      </main>
    </DashboardShell>
  );
}
