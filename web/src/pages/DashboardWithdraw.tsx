import { useEffect, useState, useCallback, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { parseUnits } from "viem";
import { buildFundingPolicy } from "@teep/shared";
import { arcTestnet } from "../chains";
import { API_BASE, ENABLE_FIAT_OFFRAMP, ENABLE_FIAT_ONRAMP, FAUCET_URL, FUNDING_ENV, OFFRAMP_URL, ONRAMP_URL, REFERRAL_REGISTRY_ADDRESS, USDC_ADDRESS } from "../config";
import { encodeWithdrawCall, encodeWithdrawWithAuthorizationCall, encodeWithdrawWithFeeCall, encodeTransferCall } from "../lib/contracts";
import DashboardShell from "../components/DashboardShell";
import { DashboardConnectPage, DashboardPreparingPage } from "../components/DashboardAuthState";

function formatUsd(raw: string): string {
  const n = Number(raw);
  if (n === 0) return "0.00";
  return (n / 1e6).toFixed(2);
}

async function readApiPayload(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {
      error: response.status === 429
        ? "Too many withdrawal attempts. Wait a moment and try again."
        : text.slice(0, 240),
    };
  }
}

function shortAddress(value: string | null | undefined): string {
  if (!value) return "Not available";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

const primary = "var(--accent)";
const success = "var(--metric-positive)";
const danger = "var(--danger)";

type WithdrawalConfirmationDialog = {
  requestId: string;
  sourceLabel: string;
  amountLabel: string;
  destinationLabel: string;
  emailLabel: string;
  code: string;
  error?: string;
};

export default function DashboardWithdraw() {
  const { pathname, search } = useLocation();
  const { ready, authenticated, user } = usePrivy();
  const { client: smartWalletClient } = useSmartWallets();
  const liveAddress = (ready && authenticated ? smartWalletClient?.account?.address || "" : "").toLowerCase();
  const [stableAddress, setStableAddress] = useState("");
  const address = liveAddress || stableAddress;

  const [claimStatus, setClaimStatus] = useState<{
    verified: boolean;
    claims: Array<{ username: string; author_id: string }>;
  } | null>(null);
  const [walletStatus, setWalletStatus] = useState<{
    deployed: boolean;
    claimWalletAddress: string | null;
  } | null>(null);
  const [tipBalance, setTipBalance] = useState<string>("0");
  const [tipsEarnedBalance, setTipsEarnedBalance] = useState<string>("0");
  const [withdrawalSource, setWithdrawalSource] = useState<"tipBalance" | "tipsEarned">("tipBalance");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [breakdown, setBreakdown] = useState<{ protocolFeeUsd: string; netUsd: string } | null>(null);
  const [confirmationDialog, setConfirmationDialog] = useState<WithdrawalConfirmationDialog | null>(null);
  const confirmationResolverRef = useRef<((code: string | null) => void) | null>(null);
  const fundingPolicy = buildFundingPolicy({
    environment: FUNDING_ENV,
    faucetUrl: FAUCET_URL,
    fiatOnrampUrl: ONRAMP_URL,
    fiatOfframpUrl: OFFRAMP_URL,
    enableFiatOnramp: ENABLE_FIAT_ONRAMP,
    enableFiatOfframp: ENABLE_FIAT_OFFRAMP,
  });

  const hasClaim = claimStatus?.verified && claimStatus?.claims?.[0]?.username;
  const isDeployed = walletStatus?.deployed;
  const claimAddr = walletStatus?.claimWalletAddress || null;

  useEffect(() => {
    if (liveAddress) setStableAddress(liveAddress);
  }, [liveAddress]);

  const selectWithdrawalSource = useCallback((source: "tipBalance" | "tipsEarned") => {
    setWithdrawalSource(source);
    setWithdrawAmount("");
    setBreakdown(null);
    setMsg(null);
  }, []);

  useEffect(() => {
    const requestedSource = new URLSearchParams(search).get("source");
    if (requestedSource === "tipsEarned" || requestedSource === "tipBalance") {
      selectWithdrawalSource(requestedSource);
    }
  }, [search, selectWithdrawalSource]);

  const createWalletProof = useCallback(async (purpose: string) => {
    if (!address || !smartWalletClient) {
      throw new Error("Wallet not ready");
    }
    const challengeRes = await fetch(`${API_BASE}/auth/wallet/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, purpose }),
    });
    const challenge = await challengeRes.json();
    if (!challengeRes.ok || !challenge.message) {
      throw new Error(challenge.error || "Could not verify wallet");
    }
    const signature = await smartWalletClient.signMessage({
      account: smartWalletClient.account,
      message: challenge.message,
    } as any);
    return { message: challenge.message, signature };
  }, [address, smartWalletClient]);

  const resolveConfirmationDialog = useCallback((code: string | null) => {
    confirmationResolverRef.current?.(code);
    confirmationResolverRef.current = null;
    setConfirmationDialog(null);
  }, []);

  const requestConfirmationCode = useCallback((
    confirmation: { requestId: string; devCode?: string | number | null },
    rawAmount: bigint,
    destination: `0x${string}`,
  ) => {
    const devCode = confirmation.devCode == null ? "" : String(confirmation.devCode).trim();
    if (devCode) return Promise.resolve(devCode);

    confirmationResolverRef.current?.(null);
    return new Promise<string | null>((resolve) => {
      confirmationResolverRef.current = resolve;
      setConfirmationDialog({
        requestId: confirmation.requestId,
        sourceLabel: withdrawalSource === "tipsEarned" ? "Tips Earned account" : "Tip Balance account",
        amountLabel: `$${formatUsd(rawAmount.toString())}`,
        destinationLabel: shortAddress(destination),
        emailLabel: user?.email?.address || "your email",
        code: "",
      });
    });
  }, [user?.email?.address, withdrawalSource]);

  const updateConfirmationCode = useCallback((code: string) => {
    setConfirmationDialog((current) => current ? { ...current, code, error: undefined } : current);
  }, []);

  const submitConfirmationDialog = useCallback(() => {
    const code = confirmationDialog?.code.trim();
    if (!confirmationDialog) return;
    if (!code) {
      setConfirmationDialog({ ...confirmationDialog, error: "Enter the confirmation code to continue." });
      return;
    }
    resolveConfirmationDialog(code);
  }, [confirmationDialog, resolveConfirmationDialog]);

  useEffect(() => {
    return () => {
      confirmationResolverRef.current?.(null);
      confirmationResolverRef.current = null;
    };
  }, []);

  const loadData = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const [claimRes, walletRes, tipBalanceRes] = await Promise.all([
        fetch(`${API_BASE}/auth/claim-status/${address}`).then((r) => r.json()),
        fetch(`${API_BASE}/auth/claim-wallet-status/${address}`).then((r) => r.json()),
        fetch(`${API_BASE}/api/v1/wallet/${address}/usdc-balance`).then((r) => (r.ok ? r.json() : { balanceRaw: "0" })),
      ]);
      setClaimStatus({ verified: claimRes.verified, claims: claimRes.claims || [] });
      setWalletStatus({
        deployed: walletRes.deployed,
        claimWalletAddress: walletRes.claimWalletAddress || null,
      });
      setTipBalance(tipBalanceRes.balanceRaw || "0");

      const tipsEarnedSourceAddress = walletRes.claimWalletAddress || null;
      const tipsEarnedRes = tipsEarnedSourceAddress
        ? await fetch(`${API_BASE}/api/v1/wallet/${tipsEarnedSourceAddress}/usdc-balance`).catch(() => null)
        : null;
      if (tipsEarnedRes?.ok) {
        const data = await readApiPayload(tipsEarnedRes);
        setTipsEarnedBalance(data.balanceRaw || "0");
      } else {
        setTipsEarnedBalance("0");
      }
    } catch {
      setClaimStatus(null);
      setWalletStatus(null);
      setTipBalance("0");
      setTipsEarnedBalance("0");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (address) loadData();
  }, [address, loadData]);

  useEffect(() => {
    if (!address || withdrawTo.trim()) return;
    let cancelled = false;
    fetch(`${API_BASE}/api/v1/wallet/${address}/settings`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => {
        if (cancelled || withdrawTo.trim()) return;
        const destination = String(payload?.payout?.defaultDestination || "").trim();
        if (/^0x[a-fA-F0-9]{40}$/.test(destination)) setWithdrawTo(destination);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [address, withdrawTo]);

  const selectedClaimWalletAddress = claimAddr?.toLowerCase() || null;
  const selectedClaimWalletBalance = tipsEarnedBalance;
  const canUseTipsEarned = Boolean(hasClaim && isDeployed && selectedClaimWalletAddress);
  const activeBalance = withdrawalSource === "tipBalance" ? tipBalance : selectedClaimWalletBalance;
  const activeBalanceUsd = formatUsd(activeBalance);
  const parsedWithdrawAmount = (() => {
    if (!withdrawAmount.trim()) return null;
    try {
      return parseUnits(withdrawAmount, 6);
    } catch {
      return null;
    }
  })();
  const amountExceedsActiveBalance = parsedWithdrawAmount !== null && parsedWithdrawAmount > BigInt(activeBalance || "0");
  useEffect(() => {
    if (!address || withdrawalSource !== "tipsEarned" || !withdrawAmount.trim()) {
      setBreakdown(null);
      return;
    }
    const amountNum = parseFloat(withdrawAmount);
    if (isNaN(amountNum) || amountNum <= 0 || amountNum > Number(activeBalanceUsd)) {
      setBreakdown(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const rawAmount = parseUnits(withdrawAmount, 6);
        const res = await fetch(
          `${API_BASE}/withdrawal/breakdown?ownerAddress=${encodeURIComponent(address)}&amountRaw=${rawAmount.toString()}&source=tipsEarned`
        );
        const data = await readApiPayload(res);
        if (cancelled || !res.ok) return;
        setBreakdown({
          protocolFeeUsd: formatUsd(data.feeAmount || "0"),
          netUsd: formatUsd(data.netAmount || "0"),
        });
      } catch {
        if (!cancelled) setBreakdown(null);
      }
    })();
    return () => { cancelled = true; };
  }, [address, withdrawalSource, activeBalanceUsd, withdrawAmount]);

  const handleWithdraw = async () => {
    if (!withdrawTo?.trim() || !withdrawAmount?.trim()) {
      setMsg({ text: "Enter amount and destination", ok: false });
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(withdrawTo.trim())) {
      setMsg({ text: "Enter a valid destination address", ok: false });
      return;
    }
    const amountNum = parseFloat(withdrawAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setMsg({ text: "Enter a valid amount", ok: false });
      return;
    }
    let rawAmount: bigint;
    try {
      rawAmount = parseUnits(withdrawAmount, 6);
    } catch {
      setMsg({ text: "Enter a valid USDC amount", ok: false });
      return;
    }
    const dest = withdrawTo.trim() as `0x${string}`;
    if (rawAmount > BigInt(activeBalance || "0")) {
      setMsg({
        text: withdrawalSource === "tipsEarned"
          ? "Amount exceeds your Tips Earned balance"
          : "Amount exceeds your tip balance",
        ok: false,
      });
      return;
    }

    if (withdrawalSource === "tipBalance") {
      if (!address || !smartWalletClient) {
        setMsg({ text: "Connect your wallet to withdraw", ok: false });
        return;
      }
    setSubmitting(true);
    setMsg(null);
    try {
      const confirmationProof = await createWalletProof("withdrawal");
      const confirmationRes = await fetch(`${API_BASE}/withdrawal/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerAddress: address,
          destinationAddress: dest,
          source: withdrawalSource,
          amountRaw: rawAmount.toString(),
          email: user?.email?.address,
          walletProof: confirmationProof,
        }),
      });
      const confirmation = await readApiPayload(confirmationRes);
      if (!confirmationRes.ok || !confirmation.requestId) {
        setMsg({ text: confirmation.error || "Could not prepare withdrawal confirmation", ok: false });
        setSubmitting(false);
        return;
      }
      const confirmationCode = await requestConfirmationCode(
        { requestId: String(confirmation.requestId), devCode: confirmation.devCode },
        rawAmount,
        dest
      );
      if (!confirmationCode) {
        setMsg({ text: "Withdrawal confirmation cancelled", ok: false });
        setSubmitting(false);
        return;
      }
      const confirmRes = await fetch(`${API_BASE}/withdrawal/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: confirmation.requestId, code: confirmationCode, claimWalletAddress: claimAddr }),
      });
      const confirmData = await readApiPayload(confirmRes);
      if (!confirmRes.ok || !confirmData.confirmed) {
        setMsg({ text: confirmData.error || "Could not confirm withdrawal", ok: false });
        setSubmitting(false);
        return;
      }

      const txHash = await smartWalletClient.sendTransaction({
        to: USDC_ADDRESS,
        data: encodeTransferCall(dest, rawAmount),
        chain: arcTestnet,
        account: smartWalletClient.account,
      } as any);
      await fetch(`${API_BASE}/withdrawal/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: confirmation.requestId,
          ownerAddress: address,
          txHash,
          recordToken: confirmData.recordToken,
        }),
      }).catch(() => null);
      setMsg({ text: "Withdrawal successful!", ok: true });
        setWithdrawTo("");
        setWithdrawAmount("");
        setBreakdown(null);
        window.setTimeout(() => { void loadData(); }, 3000);
      } catch (err: unknown) {
        const e = err as { shortMessage?: string; message?: string };
        setMsg({ text: e.shortMessage || e.message || "Withdrawal failed", ok: false });
      }
      setSubmitting(false);
      return;
    }

    if (withdrawalSource === "tipsEarned") {
      if (!address || !smartWalletClient || !selectedClaimWalletAddress) {
        setMsg({ text: "Verify your account to withdraw tips earned", ok: false });
        return;
      }
    }

    setSubmitting(true);
    setMsg(null);
    try {
      const breakdownRes = await fetch(
        `${API_BASE}/withdrawal/breakdown?ownerAddress=${encodeURIComponent(address)}&amountRaw=${rawAmount.toString()}&source=tipsEarned`
      );
      const breakdownData = await readApiPayload(breakdownRes);
      if (!breakdownRes.ok) {
        setMsg({ text: breakdownData.error || "Could not calculate fees", ok: false });
        setSubmitting(false);
        return;
      }

      const useWithdrawWithFee = !!REFERRAL_REGISTRY_ADDRESS;
      const confirmationProof = await createWalletProof("withdrawal");
      const confirmationRes = await fetch(`${API_BASE}/withdrawal/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerAddress: address,
          destinationAddress: dest,
          source: "tipsEarned",
          amountRaw: rawAmount.toString(),
          email: user?.email?.address,
          walletProof: confirmationProof,
        }),
      });
      const confirmation = await readApiPayload(confirmationRes);
      if (!confirmationRes.ok || !confirmation.requestId) {
        setMsg({ text: confirmation.error || "Could not prepare withdrawal confirmation", ok: false });
        setSubmitting(false);
        return;
      }
      const confirmationCode = await requestConfirmationCode(
        { requestId: String(confirmation.requestId), devCode: confirmation.devCode },
        rawAmount,
        dest
      );
      if (!confirmationCode) {
        setMsg({ text: "Withdrawal confirmation cancelled", ok: false });
        setSubmitting(false);
        return;
      }
      const withdrawalClaimAddr = selectedClaimWalletAddress;
      if (!withdrawalClaimAddr || rawAmount > BigInt(selectedClaimWalletBalance)) {
        setMsg({
          text: "Amount exceeds your Tips Earned balance.",
          ok: false,
        });
        setSubmitting(false);
        return;
      }
      const confirmRes = await fetch(`${API_BASE}/withdrawal/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: confirmation.requestId, code: confirmationCode, claimWalletAddress: withdrawalClaimAddr }),
      });
      const confirmData = await readApiPayload(confirmRes);
      if (!confirmRes.ok || !confirmData.confirmed) {
        setMsg({ text: confirmData.error || "Could not confirm withdrawal", ok: false });
        setSubmitting(false);
        return;
      }

      let txHash: string;
      if (useWithdrawWithFee) {
        const auth = confirmData.withdrawalAuthorization;
        const data = auth
          ? encodeWithdrawWithAuthorizationCall(dest, rawAmount, {
              expiresAt: auth.expiresAt,
              nonce: auth.nonce,
              signature: auth.signature,
            })
          : encodeWithdrawWithFeeCall(dest, rawAmount);
        txHash = await smartWalletClient!.sendTransaction({
          calls: [{ to: withdrawalClaimAddr as `0x${string}`, data }],
          chain: arcTestnet,
          account: smartWalletClient!.account,
        } as any);
      } else {
        const netAmount = BigInt(breakdownData.netAmount);
        const protocolAmount = BigInt(breakdownData.protocolAmount);
        const referrerAmount = BigInt(breakdownData.referrerAmount || "0");
        const protocolTreasury = (breakdownData.protocolTreasury || "").toLowerCase();
        const referrerAddr = (breakdownData.referrerAddress || "").toLowerCase();

        const calls: Array<{ to: `0x${string}`; data: `0x${string}` }> = [];
        if (netAmount > 0n) {
          calls.push({ to: withdrawalClaimAddr as `0x${string}`, data: encodeWithdrawCall(dest, netAmount) });
        }
        if (protocolAmount > 0n && protocolTreasury && protocolTreasury !== "0x0000000000000000000000000000000000000000") {
          calls.push({ to: withdrawalClaimAddr as `0x${string}`, data: encodeWithdrawCall(protocolTreasury as `0x${string}`, protocolAmount) });
        }
        if (referrerAmount > 0n && referrerAddr && referrerAddr !== "0x0000000000000000000000000000000000000000") {
          calls.push({ to: withdrawalClaimAddr as `0x${string}`, data: encodeWithdrawCall(referrerAddr as `0x${string}`, referrerAmount) });
        }
        if (calls.length === 0) {
          setMsg({ text: "Nothing to transfer", ok: false });
          setSubmitting(false);
          return;
        }
        txHash = await smartWalletClient!.sendTransaction({
          calls,
          chain: arcTestnet,
          account: smartWalletClient!.account,
        } as any);
      }

      await fetch(`${API_BASE}/withdrawal/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: confirmation.requestId,
          ownerAddress: address,
          txHash,
          recordToken: confirmData.recordToken,
        }),
      }).catch(() => null);
      setMsg({ text: "Withdrawal successful!", ok: true });
      setWithdrawTo("");
      setWithdrawAmount("");
      setBreakdown(null);
      fetch(`${API_BASE}/tips/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "withdraw",
          fromAddress: address,
          toAddress: withdrawTo,
          amount: rawAmount.toString(),
          txHash,
          detail: `Cash out to ${withdrawTo.slice(0, 6)}...${withdrawTo.slice(-4)}`,
          sourceMethod: "web_dashboard",
        }),
      }).catch(() => {});
      if (!useWithdrawWithFee && breakdownData.referrerAddress && breakdownData.referrerAmount && breakdownData.referrerAddress !== "0x0000000000000000000000000000000000000000") {
        fetch(`${API_BASE}/tips/activity`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "referral_fee_received",
            fromAddress: address,
            toAddress: breakdownData.referrerAddress,
            amount: breakdownData.referrerAmount,
            txHash,
            detail: "Referral fee from withdrawal",
            sourceMethod: "web_dashboard",
          }),
        }).catch(() => {});
      }
      window.setTimeout(() => { void loadData(); }, 3000);
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      setMsg({ text: e.shortMessage || e.message || "Withdrawal failed", ok: false });
    }
    setSubmitting(false);
  };

  const setMaxAmount = () => {
    setWithdrawAmount(withdrawalSource === "tipBalance" ? formatUsd(tipBalance) : formatUsd(selectedClaimWalletBalance));
    setMsg(null);
  };

  const accountHydrating = authenticated && !address;
  const growTipsPath = pathname.startsWith("/creator") ? "/creator/grow/earn" : "/dashboard/grow-tips";

  if (!ready) {
    return <DashboardPreparingPage title="Withdraw" />;
  }

  if (!authenticated) {
    return <DashboardConnectPage title="Withdraw" />;
  }

  return (
    <DashboardShell address={address} title="Withdraw">
      <main className="dashboard-body-inner">
      <h1 className="withdraw-title" style={{ fontSize: "clamp(1.75rem, 4vw, 2.5rem)", fontWeight: 900, marginBottom: "var(--space-2)", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
        Withdraw Funds
      </h1>
      <p className="withdraw-subtitle" style={{ color: "var(--text-secondary)", marginBottom: "var(--space-8)", fontSize: "var(--text-body)", lineHeight: 1.5, maxWidth: "42rem" }}>
        Move your available Teep balance to your preferred destination. Review the source, amount, and destination before you confirm.
      </p>

      {(accountHydrating || (authenticated && loading)) && (
        <div className="withdraw-grid">
          <span className="dashboard-skeleton-card dashboard-skeleton-card--wide" />
          <span className="dashboard-skeleton-card dashboard-skeleton-card--large" />
        </div>
      )}

      {authenticated && !accountHydrating && !loading && (
        <div className="withdraw-grid">
          {/* Left column — match code.html lg:col-span-7 */}
          <div className="withdraw-left" style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: "var(--text-heading)", fontWeight: 700, display: "flex", alignItems: "center", gap: "var(--space-2)", margin: "0 0 var(--space-4) 0", color: "var(--text-primary)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 22, color: primary }}>account_balance</span>
              Select Withdrawal Method
            </h3>

            {/* Pills: Wallet Transfer | Offramp */}
            <div style={{ display: "flex", gap: 4, padding: 4, background: "var(--bg-elevated)", borderRadius: "var(--radius-md)", maxWidth: 400, marginBottom: "var(--space-6)" }}>
              <button type="button" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 12px", background: "var(--bg-card)", color: primary, border: "none", borderRadius: "var(--radius-sm)", fontSize: "var(--text-small)", fontWeight: 700, boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>account_balance_wallet</span>
                Wallet Transfer
              </button>
              <button type="button" disabled={!fundingPolicy.providers.fiatOfframp.enabled} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 12px", background: "transparent", color: "var(--text-muted)", border: "none", borderRadius: "var(--radius-sm)", fontSize: "var(--text-small)", fontWeight: 700, cursor: fundingPolicy.providers.fiatOfframp.enabled ? "pointer" : "not-allowed", opacity: fundingPolicy.providers.fiatOfframp.enabled ? 1 : 0.8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>account_balance</span>
                {fundingPolicy.providers.fiatOfframp.label}
                {!fundingPolicy.providers.fiatOfframp.enabled && <span style={{ background: "var(--text-muted)", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, marginLeft: 4, textTransform: "uppercase" }}>Soon</span>}
              </button>
            </div>

            {/* Form card — match code.html */}
            <div className="withdraw-form-card" style={{ borderRadius: "var(--radius-md)", background: "var(--bg-card)", padding: "var(--space-8)", border: "1px solid var(--border)" }}>
              <div style={{ marginBottom: "var(--space-6)" }}>
                <label style={{ display: "block", fontSize: "var(--text-small)", fontWeight: 700, color: "var(--text-secondary)", marginBottom: 4 }}>Destination Address</label>
                <span style={{ display: "block", fontSize: 10, color: primary, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Wallet Transfer Active</span>
                <input
                  type="text"
                  placeholder="0x..."
                  value={withdrawTo}
                  onChange={(e) => setWithdrawTo(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px",
                    background: "var(--bg-page)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text-primary)",
                    fontSize: "var(--text-body)",
                    fontFamily: "var(--font-mono)",
                  }}
                />
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>info</span>
                  Make sure this destination is correct before continuing.
                </p>
              </div>

              <div style={{ marginBottom: "var(--space-6)" }}>
                <label style={{ display: "block", fontSize: "var(--text-small)", fontWeight: 700, color: "var(--text-secondary)", marginBottom: 10 }}>Withdrawal Source</label>
                <div role="radiogroup" aria-label="Withdrawal source" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "var(--space-3)" }}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={withdrawalSource === "tipBalance"}
                    onClick={() => selectWithdrawalSource("tipBalance")}
                    style={{
                      textAlign: "left",
                      display: "grid",
                      gap: 8,
                      padding: "14px",
                      borderRadius: "var(--radius-md)",
                      border: withdrawalSource === "tipBalance" ? `2px solid ${primary}` : "1px solid var(--border)",
                      background: "var(--bg-page)",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <strong style={{ fontSize: "var(--text-small)" }}>Tip Balance</strong>
                      <span className="material-symbols-outlined" title="Your available Teep balance for tipping or withdrawal." aria-label="Your available Teep balance for tipping or withdrawal." style={{ fontSize: 17, color: "var(--text-muted)" }}>info</span>
                    </span>
                    <span style={{ color: "var(--text-primary)", fontSize: "1.1rem", fontWeight: 900 }}>${formatUsd(tipBalance)}</span>
                    <span style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.35 }}>Available balance, including referral rewards.</span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={withdrawalSource === "tipsEarned"}
                    disabled={!canUseTipsEarned}
                    onClick={() => canUseTipsEarned && selectWithdrawalSource("tipsEarned")}
                    style={{
                      textAlign: "left",
                      display: "grid",
                      gap: 8,
                      padding: "14px",
                      borderRadius: "var(--radius-md)",
                      border: withdrawalSource === "tipsEarned" ? `2px solid ${primary}` : "1px solid var(--border)",
                      background: "var(--bg-page)",
                      color: "var(--text-primary)",
                      cursor: canUseTipsEarned ? "pointer" : "not-allowed",
                      opacity: canUseTipsEarned ? 1 : 0.62,
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <strong style={{ fontSize: "var(--text-small)" }}>Tips Earned</strong>
                      <span className="material-symbols-outlined" title="Creator earnings from supported posts. X verification is required." aria-label="Creator earnings from supported posts. X verification is required." style={{ fontSize: 17, color: "var(--text-muted)" }}>info</span>
                    </span>
                    <span style={{ color: "var(--text-primary)", fontSize: "1.1rem", fontWeight: 900 }}>${formatUsd(tipsEarnedBalance)}</span>
                    <span style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.35 }}>
                      {canUseTipsEarned ? "Creator earnings ready to withdraw." : "Verify X to use this source."}
                    </span>
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: "var(--space-6)" }}>
                <label style={{ display: "block", fontSize: "var(--text-small)", fontWeight: 700, color: "var(--text-secondary)", marginBottom: 8 }}>Withdrawal Amount</label>
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <span style={{ position: "absolute", left: 12, fontWeight: 700, color: "var(--text-muted)" }}>$</span>
                  <input
                    type="text"
                    placeholder="0.00"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "12px 56px 12px 28px",
                      background: "var(--bg-page)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--text-primary)",
                      fontSize: "1.125rem",
                      fontWeight: 700,
                    }}
                  />
                  <button type="button" onClick={setMaxAmount} style={{ position: "absolute", right: 8, padding: "6px 12px", background: primary, color: "#fff", border: "none", borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    MAX
                  </button>
                </div>
              </div>

              {/* Fee breakdown — only for Tips Earned; no Network Gas Fee */}
              <div style={{ paddingTop: "var(--space-4)", borderTop: "1px solid var(--border)" }}>
                {withdrawalSource === "tipsEarned" && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-small)", marginBottom: "var(--space-2)" }}>
                    <span style={{ color: "var(--text-muted)" }}>Protocol Fee (5%)</span>
                    <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{breakdown ? `$${breakdown.protocolFeeUsd}` : "—"}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--text-heading)", fontWeight: 800, paddingTop: "var(--space-3)", borderTop: "1px dashed var(--border)", marginTop: "var(--space-3)" }}>
                  <span style={{ color: "var(--text-primary)" }}>Total to Wallet</span>
                  <span style={{ color: success }}>
                    {withdrawalSource === "tipBalance"
                      ? (withdrawAmount.trim() && !isNaN(parseFloat(withdrawAmount)) ? `$${parseFloat(withdrawAmount).toFixed(2)}` : "—")
                      : (breakdown ? `$${breakdown.netUsd}` : "—")}
                  </span>
                </div>
              </div>

              <div style={{ marginTop: "var(--space-4)", padding: "var(--space-4)", borderRadius: "var(--radius-md)", background: "rgba(255,255,255,0.035)", border: "1px solid var(--border)", display: "grid", gap: "var(--space-3)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", fontSize: "var(--text-small)" }}>
                  <span style={{ color: "var(--text-muted)" }}>Withdrawal source</span>
                  <strong style={{ color: "var(--text-primary)" }}>{withdrawalSource === "tipsEarned" ? "Tips Earned account" : "Tip Balance account"}</strong>
                </div>
                {withdrawalSource === "tipsEarned" && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", fontSize: "var(--text-small)" }}>
                      <span style={{ color: "var(--text-muted)" }}>Funds come from</span>
                      <strong style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{shortAddress(selectedClaimWalletAddress)}</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", fontSize: "var(--text-small)" }}>
                      <span style={{ color: "var(--text-muted)" }}>Source balance</span>
                      <strong style={{ color: "var(--text-primary)" }}>${formatUsd(selectedClaimWalletBalance)}</strong>
                    </div>
                  </>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-3)", fontSize: "var(--text-small)" }}>
                  <span style={{ color: "var(--text-muted)" }}>Signing wallet</span>
                  <strong style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>{shortAddress(address)}</strong>
                </div>
                {withdrawalSource === "tipsEarned" && (
                  <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "var(--text-caption)", lineHeight: 1.45 }}>
                    The approval dialog may show the account used to confirm this action. Your selected Tips Earned balance remains the source for this withdrawal.
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={handleWithdraw}
                disabled={submitting || !withdrawTo.trim() || !withdrawAmount.trim() || parsedWithdrawAmount === null || amountExceedsActiveBalance || (withdrawalSource === "tipsEarned" && !canUseTipsEarned)}
                style={{
                  width: "100%",
                  marginTop: "var(--space-6)",
                  padding: "16px 24px",
                  background: primary,
                  color: "#fff",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  fontSize: "var(--text-heading)",
                  fontWeight: 700,
                  cursor: submitting || !withdrawTo.trim() || !withdrawAmount.trim() || parsedWithdrawAmount === null || amountExceedsActiveBalance ? "not-allowed" : "pointer",
                  opacity: submitting || !withdrawTo.trim() || !withdrawAmount.trim() || parsedWithdrawAmount === null || amountExceedsActiveBalance ? 0.6 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>send_money</span>
                {submitting ? "Processing…" : "Confirm Withdrawal"}
              </button>

              {amountExceedsActiveBalance && (
                <p style={{ marginTop: "var(--space-3)", color: danger, fontSize: "var(--text-small)" }}>
                  Amount exceeds the selected withdrawal source.
                </p>
              )}

              {msg && (
                <p style={{ marginTop: "var(--space-4)", color: msg.ok ? success : danger, fontSize: "var(--text-small)" }}>
                  {msg.text}
                </p>
              )}
            </div>

            <p style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)", marginTop: "var(--space-4)" }}>
              Prefer bank? {fundingPolicy.providers.fiatOfframp.enabled && fundingPolicy.providers.fiatOfframp.url ? (
                <a href={fundingPolicy.providers.fiatOfframp.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>Open cash-out provider</a>
              ) : (
                <span>{fundingPolicy.providers.fiatOfframp.disabledReason}</span>
              )}
            </p>
          </div>

          {/* Right column — match code.html lg:col-span-5 */}
          <div className="withdraw-sidebar" style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
            <div style={{ borderRadius: "var(--radius-md)", background: "linear-gradient(180deg, rgba(31,28,39,0.98), rgba(16,12,24,0.98))", border: "1px solid rgba(167,139,250,0.32)", boxShadow: "0 18px 48px rgba(0,0,0,0.36)", padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(99,36,235,0.28)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "inset 0 0 0 1px rgba(167,139,250,0.18)" }}>
                <span className="material-symbols-outlined" style={{ color: primary }}>fact_check</span>
              </div>
              <h4 style={{ fontSize: "var(--text-heading)", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>Before You Confirm</h4>
              <p style={{ fontSize: "var(--text-small)", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                Review the destination and selected source before you continue. Completed withdrawals cannot be reversed.
              </p>
              <div style={{ display: "grid", gap: "var(--space-3)" }}>
                {[
                  {
                    icon: "account_balance_wallet",
                    title: withdrawalSource === "tipsEarned" ? "Funds come from Tips Earned" : "Funds come from Tip Balance",
                    body: withdrawalSource === "tipsEarned"
                      ? "Teep uses your verified creator balance for this withdrawal."
                      : "Teep uses your available Tip Balance for this withdrawal.",
                  },
                  {
                    icon: "payments",
                    title: withdrawalSource === "tipsEarned" ? "Fee is deducted before arrival" : "No Teep withdrawal fee",
                    body: withdrawalSource === "tipsEarned"
                      ? `Estimated amount to wallet: ${breakdown ? `$${breakdown.netUsd}` : "enter an amount to preview"}.`
                      : "The amount you enter is the amount sent to the destination wallet.",
                  },
                  {
                    icon: "travel_explore",
                    title: "Use a compatible destination",
                    body: "Double-check the destination. Teep cannot recover money sent to the wrong place.",
                  },
                ].map((item) => (
                  <div key={item.title} style={{ display: "grid", gridTemplateColumns: "32px minmax(0, 1fr)", gap: "var(--space-3)", alignItems: "start", padding: "var(--space-3)", borderRadius: "var(--radius-md)", background: "rgba(45,40,57,0.72)", border: "1px solid rgba(255,255,255,0.1)" }}>
                    <span className="material-symbols-outlined" style={{ width: 32, height: 32, borderRadius: "var(--radius-sm)", display: "grid", placeItems: "center", background: "rgba(99,36,235,0.16)", color: primary, fontSize: 18 }}>{item.icon}</span>
                    <span>
                      <strong style={{ display: "block", color: "var(--text-primary)", fontSize: "var(--text-small)", marginBottom: 3 }}>{item.title}</strong>
                      <span style={{ display: "block", color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.45 }}>{item.body}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ borderRadius: "var(--radius-md)", border: "1px solid rgba(255,255,255,0.12)", padding: "var(--space-6)", background: "linear-gradient(180deg, rgba(31,28,39,0.98), rgba(24,20,32,0.98))", boxShadow: "0 14px 36px rgba(0,0,0,0.28)" }}>
              <h4 style={{ fontSize: "var(--text-small)", fontWeight: 700, margin: "0 0 var(--space-3) 0", color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Frequently Asked</h4>
              <details style={{ marginBottom: "var(--space-3)" }}>
                <summary style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", listStyle: "none", fontSize: "var(--text-small)", fontWeight: 500, color: "var(--text-secondary)" }}>
                  How long does it take?
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>expand_more</span>
                </summary>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>Most withdrawals finish within a few minutes. Some destinations may take longer.</p>
              </details>
              <details>
                <summary style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", listStyle: "none", fontSize: "var(--text-small)", fontWeight: 500, color: "var(--text-secondary)" }}>
                  Can I cancel a withdrawal?
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>expand_more</span>
                </summary>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>Once confirmed, a withdrawal cannot be cancelled. Double-check your destination before continuing.</p>
              </details>
            </div>

            {/* Grow Tips — CTA, no crypto terms */}
            <div style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.13) 0%, rgba(31,28,39,0.96) 58%, rgba(10,10,10,0.98) 100%)", border: "1px solid rgba(16,185,129,0.34)", boxShadow: "0 14px 36px rgba(0,0,0,0.28)", padding: "var(--space-6)", borderRadius: "var(--radius-md)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <span className="material-symbols-outlined" style={{ color: success }}>trending_up</span>
                <span style={{ fontSize: "var(--text-small)", fontWeight: 700, color: "var(--text-primary)" }}>Grow Tips</span>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: "var(--space-3)", lineHeight: 1.5 }}>
                Grow your earnings in a later phase — invite more supporters and earn more from your content.
              </p>
              <Link to={growTipsPath} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", background: "var(--bg-elevated)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: "var(--text-small)", fontWeight: 700, textDecoration: "none" }}>
                Open preview
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
              </Link>
            </div>
          </div>
        </div>
      )}
      </main>
      {confirmationDialog && (
        <div
          className="withdraw-confirmation-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) resolveConfirmationDialog(null);
          }}
        >
          <form
            className="withdraw-confirmation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdraw-confirmation-title"
            onSubmit={(event) => {
              event.preventDefault();
              submitConfirmationDialog();
            }}
          >
            <header>
              <span className="material-symbols-outlined" aria-hidden>mark_email_read</span>
              <button type="button" aria-label="Cancel withdrawal confirmation" onClick={() => resolveConfirmationDialog(null)}>
                <span className="material-symbols-outlined" aria-hidden>close</span>
              </button>
            </header>
            <h3 id="withdraw-confirmation-title">Confirm withdrawal</h3>
            <p>Enter the code sent to {confirmationDialog.emailLabel} before Teep prepares your withdrawal.</p>
            <div className="withdraw-confirmation-summary">
              <div><span>Source</span><strong>{confirmationDialog.sourceLabel}</strong></div>
              <div><span>Amount</span><strong>{confirmationDialog.amountLabel}</strong></div>
              <div><span>Destination</span><strong>{confirmationDialog.destinationLabel}</strong></div>
            </div>
            <label className="withdraw-confirmation-code">
              <span>Confirmation code</span>
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                value={confirmationDialog.code}
                onChange={(event) => updateConfirmationCode(event.target.value)}
                placeholder="Enter code"
              />
            </label>
            {confirmationDialog.error && <div className="withdraw-confirmation-error">{confirmationDialog.error}</div>}
            <div className="withdraw-confirmation-actions">
              <button type="button" className="btn-secondary" onClick={() => resolveConfirmationDialog(null)}>Cancel</button>
              <button type="submit" className="btn-primary">Continue</button>
            </div>
          </form>
        </div>
      )}
    </DashboardShell>
  );
}
