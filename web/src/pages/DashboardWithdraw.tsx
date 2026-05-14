import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { parseUnits } from "viem";
import { buildFundingPolicy } from "@teep/shared";
import { arcTestnet } from "../chains";
import { API_BASE, ENABLE_FIAT_OFFRAMP, ENABLE_FIAT_ONRAMP, FAUCET_URL, FUNDING_ENV, OFFRAMP_URL, ONRAMP_URL, REFERRAL_REGISTRY_ADDRESS, USDC_ADDRESS } from "../config";
import { encodeWithdrawCall, encodeWithdrawWithAuthorizationCall, encodeWithdrawWithFeeCall, encodeTransferCall } from "../lib/contracts";

function formatUsd(raw: string): string {
  const n = Number(raw);
  if (n === 0) return "0.00";
  return (n / 1e6).toFixed(2);
}

const primary = "#6324eb";
const success = "var(--success, #10B981)";

export default function DashboardWithdraw() {
  const { ready, authenticated, login, user } = usePrivy();
  const { wallets } = useWallets();
  const { client: smartWalletClient } = useSmartWallets();
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
  const linkedAccounts = (user as { linkedAccounts?: Array<{ type?: string; address?: string }> } | null)?.linkedAccounts ?? [];
  const addressFromLinked =
    linkedAccounts.find((a) => a?.type === "smart_wallet" && a?.address)?.address ||
    linkedAccounts.find((a) => a?.type === "wallet" && a?.address)?.address ||
    (linkedAccounts.find((a) => a?.address?.startsWith?.("0x"))?.address ?? "");
  const address = (
    smartWalletClient?.account?.address ||
    embeddedWallet?.address ||
    (user?.wallet as { address?: string } | undefined)?.address ||
    addressFromLinked ||
    ""
  ).toLowerCase();

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
  const claimAddr = walletStatus?.claimWalletAddress;
  const canUseTipsEarned = hasClaim && isDeployed && claimAddr;
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

      const tipsEarnedRes = await fetch(`${API_BASE}/api/v1/wallet/${address}/balance`).catch(() => null);
      if (tipsEarnedRes?.ok) {
        const data = await tipsEarnedRes.json();
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

  const activeBalance = withdrawalSource === "tipBalance" ? tipBalance : tipsEarnedBalance;
  const activeBalanceUsd = formatUsd(activeBalance);

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
        const data = await res.json();
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
    const rawAmount = parseUnits(withdrawAmount, 6);
    const dest = withdrawTo.trim() as `0x${string}`;

    if (withdrawalSource === "tipBalance") {
      if (!address || !smartWalletClient) {
        setMsg({ text: "Connect your wallet to withdraw", ok: false });
        return;
      }
      if (rawAmount > BigInt(tipBalance)) {
        setMsg({ text: "Amount exceeds your tip balance", ok: false });
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
      const confirmation = await confirmationRes.json();
      if (!confirmationRes.ok || !confirmation.requestId) {
        setMsg({ text: confirmation.error || "Could not prepare withdrawal confirmation", ok: false });
        setSubmitting(false);
        return;
      }
      const confirmationCode = confirmation.devCode || window.prompt("Enter the withdrawal confirmation code sent to your email.");
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
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok || !confirmData.confirmed) {
        setMsg({ text: confirmData.error || "Could not confirm withdrawal", ok: false });
        setSubmitting(false);
        return;
      }

      await smartWalletClient.sendTransaction({
        to: USDC_ADDRESS,
        data: encodeTransferCall(dest, rawAmount),
        chain: arcTestnet,
        account: smartWalletClient.account,
      } as any).then(async (txHash: string) => {
        try {
          const recordProof = await createWalletProof("withdrawal");
          await fetch(`${API_BASE}/withdrawal/record`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              requestId: confirmation.requestId,
              ownerAddress: address,
              txHash,
              walletProof: recordProof,
            }),
          });
        } catch {}
      });
      setMsg({ text: "Withdrawal successful!", ok: true });
        setWithdrawTo("");
        setWithdrawAmount("");
        setBreakdown(null);
        setTimeout(loadData, 3000);
      } catch (err: unknown) {
        const e = err as { shortMessage?: string; message?: string };
        setMsg({ text: e.shortMessage || e.message || "Withdrawal failed", ok: false });
      }
      setSubmitting(false);
      return;
    }

    if (withdrawalSource === "tipsEarned") {
      if (!address || !smartWalletClient || !claimAddr) {
        setMsg({ text: "Verify your account to withdraw tips earned", ok: false });
        return;
      }
      if (rawAmount > BigInt(tipsEarnedBalance)) {
        setMsg({ text: "Amount exceeds your tips earned balance", ok: false });
        return;
      }
    }

    setSubmitting(true);
    setMsg(null);
    try {
      const breakdownRes = await fetch(
        `${API_BASE}/withdrawal/breakdown?ownerAddress=${encodeURIComponent(address)}&amountRaw=${rawAmount.toString()}&source=tipsEarned`
      );
      const breakdownData = await breakdownRes.json();
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
      const confirmation = await confirmationRes.json();
      if (!confirmationRes.ok || !confirmation.requestId) {
        setMsg({ text: confirmation.error || "Could not prepare withdrawal confirmation", ok: false });
        setSubmitting(false);
        return;
      }
      const confirmationCode = confirmation.devCode || window.prompt("Enter the withdrawal confirmation code sent to your email.");
      if (!confirmationCode) {
        setMsg({ text: "Withdrawal confirmation cancelled", ok: false });
        setSubmitting(false);
        return;
      }
      const confirmRes = await fetch(`${API_BASE}/withdrawal/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: confirmation.requestId, code: confirmationCode }),
      });
      const confirmData = await confirmRes.json();
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
          calls: [{ to: claimAddr as `0x${string}`, data }],
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
          calls.push({ to: claimAddr as `0x${string}`, data: encodeWithdrawCall(dest, netAmount) });
        }
        if (protocolAmount > 0n && protocolTreasury && protocolTreasury !== "0x0000000000000000000000000000000000000000") {
          calls.push({ to: claimAddr as `0x${string}`, data: encodeWithdrawCall(protocolTreasury as `0x${string}`, protocolAmount) });
        }
        if (referrerAmount > 0n && referrerAddr && referrerAddr !== "0x0000000000000000000000000000000000000000") {
          calls.push({ to: claimAddr as `0x${string}`, data: encodeWithdrawCall(referrerAddr as `0x${string}`, referrerAmount) });
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

      try {
        const recordProof = await createWalletProof("withdrawal");
        await fetch(`${API_BASE}/withdrawal/record`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: confirmation.requestId,
            ownerAddress: address,
            txHash,
            walletProof: recordProof,
          }),
        });
      } catch {}
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
          }),
        }).catch(() => {});
      }
      setTimeout(loadData, 3000);
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string };
      setMsg({ text: e.shortMessage || e.message || "Withdrawal failed", ok: false });
    }
    setSubmitting(false);
  };

  const setMaxAmount = () => setWithdrawAmount(withdrawalSource === "tipBalance" ? formatUsd(tipBalance) : formatUsd(tipsEarnedBalance));

  if (!ready) {
    return (
      <div className="page-section" style={{ paddingTop: "var(--space-8)", textAlign: "center" }}>
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="page-section" style={{ paddingTop: "var(--space-4)", maxWidth: 1000, margin: "0 auto" }}>
      <Link to="/dashboard" style={{ fontSize: "var(--text-small)", color: "var(--text-muted)", marginBottom: "var(--space-4)", display: "inline-block" }}>
        ← Back to dashboard
      </Link>

      <h1 className="withdraw-title" style={{ fontSize: "clamp(1.75rem, 4vw, 2.5rem)", fontWeight: 900, marginBottom: "var(--space-2)", letterSpacing: "-0.02em", color: "var(--text-primary)" }}>
        Withdraw Funds
      </h1>
      <p className="withdraw-subtitle" style={{ color: "var(--text-secondary)", marginBottom: "var(--space-8)", fontSize: "var(--text-body)", lineHeight: 1.5, maxWidth: "42rem" }}>
        Transfer your accumulated earnings securely to your self-custodial wallet. Funds are routed through the Teep smart protocol.
      </p>

      {!authenticated && (
        <div className="withdraw-card card" style={{ marginTop: "var(--space-4)", padding: "var(--space-6)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", background: "var(--bg-card)" }}>
          <p style={{ margin: 0, color: "var(--text-secondary)", marginBottom: "var(--space-4)" }}>Connect your account to view balances and withdraw.</p>
          <button type="button" onClick={login} className="btn-primary">
            Connect
          </button>
        </div>
      )}

      {authenticated && loading && (
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      )}

      {authenticated && !loading && (
        <div className="withdraw-grid">
          {/* Left column — match code.html lg:col-span-7 */}
          <div className="withdraw-left" style={{ minWidth: 0 }}>
            <h3 className="withdraw-section-title" style={{ fontSize: "var(--text-heading)", fontWeight: 700, display: "flex", alignItems: "center", gap: "var(--space-2)", margin: "0 0 var(--space-6) 0", color: "var(--text-primary)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 22, color: primary }}>account_balance</span>
              Select Withdrawal Source
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", marginBottom: "var(--space-6)" }}>
              {/* Tip Balance card — active when selected */}
              <div
                className="withdraw-source-card"
                role="button"
                tabIndex={0}
                onClick={() => setWithdrawalSource("tipBalance")}
                onKeyDown={(e) => e.key === "Enter" && setWithdrawalSource("tipBalance")}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "stretch",
                  justifyContent: "space-between",
                  gap: "var(--space-4)",
                  padding: "var(--space-6)",
                  borderRadius: "var(--radius-md)",
                  background: "var(--bg-card)",
                  border: withdrawalSource === "tipBalance" ? `2px solid ${primary}` : "1px solid var(--border)",
                  boxShadow: withdrawalSource === "tipBalance" ? `0 4px 24px ${primary}20` : "none",
                  cursor: "pointer",
                }}
              >
                {withdrawalSource === "tipBalance" && (
                  <span style={{ position: "absolute", top: -10, right: 24, background: primary, color: "#fff", fontSize: 10, fontWeight: 700, padding: "4px 8px", borderRadius: "var(--radius-full)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Active Selection
                  </span>
                )}
                <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "var(--space-4)" }}>
                  <div>
                    <p style={{ fontSize: "1.75rem", fontWeight: 900, margin: "0 0 4px 0", color: withdrawalSource === "tipBalance" ? primary : "var(--text-muted)" }}>${formatUsd(tipBalance)}</p>
                    <p style={{ fontSize: "var(--text-heading)", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Tip Balance</p>
                    <p style={{ fontSize: "var(--text-small)", color: "var(--text-secondary)", margin: "4px 0 0 0" }}>
                      Available to tip creators (plus your referral bonus)
                    </p>
                    <button type="button" style={{ marginTop: "var(--space-4)", display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: "var(--radius-sm)", fontSize: "var(--text-small)", fontWeight: 700, border: "none", cursor: "pointer", background: withdrawalSource === "tipBalance" ? primary : "var(--bg-elevated)", color: withdrawalSource === "tipBalance" ? "#fff" : "var(--text-primary)" }}>
                      {withdrawalSource === "tipBalance" ? <>Selected <span className="material-symbols-outlined" style={{ fontSize: 18 }}>check_circle</span></> : "Switch Source"}
                    </button>
                  </div>
                </div>
                <div style={{ width: 160, minHeight: 80, background: `linear-gradient(135deg, ${primary}20, ${primary}40)`, border: `1px solid ${primary}30`, borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 40, color: `${primary}80` }}>payments</span>
                </div>
              </div>

              {/* Tips Earned card */}
              <div
                className="withdraw-source-card"
                role="button"
                tabIndex={0}
                onClick={() => canUseTipsEarned && setWithdrawalSource("tipsEarned")}
                onKeyDown={(e) => canUseTipsEarned && e.key === "Enter" && setWithdrawalSource("tipsEarned")}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "stretch",
                  justifyContent: "space-between",
                  gap: "var(--space-4)",
                  padding: "var(--space-6)",
                  borderRadius: "var(--radius-md)",
                  background: "var(--bg-card)",
                  border: withdrawalSource === "tipsEarned" ? `2px solid ${primary}` : "1px solid var(--border)",
                  boxShadow: withdrawalSource === "tipsEarned" ? `0 4px 24px ${primary}20` : "none",
                  cursor: canUseTipsEarned ? "pointer" : "not-allowed",
                  opacity: canUseTipsEarned ? 1 : 0.7,
                }}
              >
                {withdrawalSource === "tipsEarned" && (
                  <span style={{ position: "absolute", top: -10, right: 24, background: primary, color: "#fff", fontSize: 10, fontWeight: 700, padding: "4px 8px", borderRadius: "var(--radius-full)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Active Selection
                  </span>
                )}
                <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "var(--space-4)" }}>
                  <div>
                    <p style={{ fontSize: "1.75rem", fontWeight: 900, margin: "0 0 4px 0", color: withdrawalSource === "tipsEarned" ? primary : "var(--text-muted)" }}>${formatUsd(tipsEarnedBalance)}</p>
                    <p style={{ fontSize: "var(--text-heading)", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Tips Earned</p>
                    <p style={{ fontSize: "var(--text-small)", color: "var(--text-secondary)", margin: "4px 0 0 0" }}>
                      Available balance of money earned from tips
                    </p>
                    {!canUseTipsEarned && <p style={{ fontSize: "var(--text-caption)", color: "var(--text-muted)", marginTop: 4 }}>Verify your X account in the extension to withdraw tips earned.</p>}
                    <button type="button" style={{ marginTop: "var(--space-4)", display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: "var(--radius-sm)", fontSize: "var(--text-small)", fontWeight: 700, border: "none", cursor: canUseTipsEarned ? "pointer" : "default", background: withdrawalSource === "tipsEarned" ? primary : "var(--bg-elevated)", color: withdrawalSource === "tipsEarned" ? "#fff" : "var(--text-primary)" }}>
                      {withdrawalSource === "tipsEarned" ? <>Selected <span className="material-symbols-outlined" style={{ fontSize: 18 }}>check_circle</span></> : "Switch Source"}
                    </button>
                  </div>
                </div>
                <div style={{ width: 160, minHeight: 80, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 40, color: "var(--text-muted)" }}>pending_actions</span>
                </div>
              </div>
            </div>

            {/* Select Withdrawal Method — sub-heading above pills (match "Select Withdrawal Source" style) */}
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
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={withdrawTo}
                    onChange={(e) => setWithdrawTo(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "12px 100px 12px 12px",
                      background: "var(--bg-page)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      color: "var(--text-primary)",
                      fontSize: "var(--text-body)",
                      fontFamily: "var(--font-mono)",
                    }}
                  />
                  <button type="button" style={{ position: "absolute", right: 8, padding: "6px 12px", background: `${primary}20`, color: primary, border: "none", borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                    Change Wallet
                  </button>
                </div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>info</span>
                  Make sure this address is correct. ERC-20 Network only.
                </p>
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

              <button
                type="button"
                onClick={handleWithdraw}
                disabled={submitting || !withdrawTo.trim() || !withdrawAmount.trim() || (withdrawalSource === "tipsEarned" && !canUseTipsEarned)}
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
                  cursor: submitting || !withdrawTo.trim() || !withdrawAmount.trim() ? "not-allowed" : "pointer",
                  opacity: submitting || !withdrawTo.trim() || !withdrawAmount.trim() ? 0.6 : 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 22 }}>send_money</span>
                {submitting ? "Processing…" : "Confirm Withdrawal"}
              </button>

              {msg && (
                <p style={{ marginTop: "var(--space-4)", color: msg.ok ? success : "#f4212e", fontSize: "var(--text-small)" }}>
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
            <div style={{ borderRadius: "var(--radius-md)", background: "rgba(99,36,235,0.05)", border: "1px solid rgba(99,36,235,0.2)", padding: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(99,36,235,0.2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="material-symbols-outlined" style={{ color: primary }}>security</span>
              </div>
              <h4 style={{ fontSize: "var(--text-heading)", fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>Non-Custodial Security</h4>
              <p style={{ fontSize: "var(--text-small)", color: "var(--text-secondary)", lineHeight: 1.6, margin: 0 }}>
                Teep doesn't hold your funds. All assets are stored in your own secure smart wallet, and you maintain full control at all times.
                <br /><br />
                <strong style={{ color: primary }}>Non-custodial by design.</strong> You always maintain full ownership and can withdraw via the contract directly if the UI is ever unavailable.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "var(--space-2)", fontSize: 12, fontWeight: 700, color: primary, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>verified_user</span>
                Audited by Quantstamp
              </div>
            </div>

            <div style={{ borderRadius: "var(--radius-md)", border: "1px solid var(--border)", padding: "var(--space-6)", background: "var(--bg-card)" }}>
              <h4 style={{ fontSize: "var(--text-small)", fontWeight: 700, margin: "0 0 var(--space-3) 0", color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Frequently Asked</h4>
              <details style={{ marginBottom: "var(--space-3)" }}>
                <summary style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", listStyle: "none", fontSize: "var(--text-small)", fontWeight: 500, color: "var(--text-secondary)" }}>
                  How long does it take?
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>expand_more</span>
                </summary>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>Withdrawals are typically processed within 15–30 minutes, depending on network congestion.</p>
              </details>
              <details>
                <summary style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", listStyle: "none", fontSize: "var(--text-small)", fontWeight: 500, color: "var(--text-secondary)" }}>
                  Can I cancel a withdrawal?
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>expand_more</span>
                </summary>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>Once confirmed, transactions are irreversible. Double check your destination address.</p>
              </details>
            </div>

            {/* Grow Tips — CTA, no crypto terms */}
            <div style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.1) 0%, transparent 100%)", border: "1px solid rgba(16,185,129,0.25)", padding: "var(--space-6)", borderRadius: "var(--radius-md)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <span className="material-symbols-outlined" style={{ color: success }}>trending_up</span>
                <span style={{ fontSize: "var(--text-small)", fontWeight: 700, color: "var(--text-primary)" }}>Grow Tips</span>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: "var(--space-3)", lineHeight: 1.5 }}>
                Grow your earnings in a later phase — invite more supporters and earn more from your content.
              </p>
              <button type="button" disabled style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: "var(--text-small)", fontWeight: 700, cursor: "not-allowed" }}>
                Coming soon
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
