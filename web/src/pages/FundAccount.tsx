import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { buildFundingPolicy } from "@teep/shared";
import DashboardShell from "../components/DashboardShell";
import { DashboardConnectPage, DashboardPreparingPage } from "../components/DashboardAuthState";
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
  const { ready, authenticated, user } = usePrivy();
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
      <DashboardConnectPage
        title="Add funds"
        message={intent === "x-tip" ? "Sign in to fund your Teep balance and continue with X tipping." : "Sign in to fund your Teep balance."}
      />
    );
  }

  if (!address) {
    return <DashboardPreparingPage title="Add funds" message="Getting your Teep account ready." />;
  }

  return (
    <DashboardShell title="Add funds" address={address}>
      <main className="dashboard-body-inner">
        <section className="dashboard-page-heading">
          <div>
            <p className="eyebrow">Funding</p>
            <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 var(--space-2)" }}>Fund your Teep account</h1>
            <p style={{ color: "var(--text-secondary)", maxWidth: 620, margin: 0 }}>
              Add funds to your Teep balance, then return to X and send your tip command again.
            </p>
          </div>
        </section>

        <section className="dashboard-card" style={{ display: "grid", gap: "var(--space-5)", maxWidth: 920 }}>
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

        <div style={{ marginTop: "var(--space-5)", display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <Link to="/dashboard" className="btn-secondary">Open dashboard</Link>
          <Link to="/dashboard/settings?tab=funding" className="btn-secondary">View funding history</Link>
        </div>
      </main>
    </DashboardShell>
  );
}
