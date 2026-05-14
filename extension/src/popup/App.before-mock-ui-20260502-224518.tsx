import React, { useState, useEffect, useCallback } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { encodeFunctionData, parseUnits } from "viem";
import { getAvatarUrls } from "@teep/shared";
import { formatUSDC } from "../utils/api";
import { handleToAuthorId, parsePostUrl, computeContentId } from "../utils/contentId";
import { CONFIG, TIP_PRESETS, FACTORY_ABI, CLAIM_WALLET_ABI, REFERRAL_REGISTRY_ABI, USDC_ABI } from "../utils/config";
import { isDebug, debugLog, getDebugEntries, clearDebugEntries, addDebugListener, type DebugEntry } from "../utils/debug";
function buildReceiptTweetText(params: { amount: string; authorHandle: string; tweetId?: string; txHash?: string; txUrl?: string }): string {
  const { amount, authorHandle, tweetId, txHash, txUrl } = params;
  const handle = authorHandle.replace(/^@/, "");
  const postUrl = tweetId ? `https://x.com/${handle}/status/${tweetId}` : "";
  const receiptUrl = txUrl || (txHash ? `${CONFIG.RECEIPT_BASE_URL}/tx/${txHash}` : CONFIG.WEB_APP_URL);
  const line1 = postUrl
    ? `Hey @${handle}, just tipped you $${amount} via Teep for this wonderful piece: ${postUrl}`
    : `Hey @${handle}, just tipped you $${amount} via Teep`;
  return `${line1}\n\nReceipt: ${receiptUrl}\nSupport creators directly.`;
}
/** Map contract/viem revert errors to user-friendly tip failure message (e.g. insufficient funds). */
function getTipErrorMessage(err: unknown): string {
  const msg = String(
    (err as any)?.shortMessage ?? (err as any)?.message ?? (err as any)?.details ?? ""
  ).toLowerCase();
  if (
    msg.includes("insufficient") ||
    msg.includes("exceeds balance") ||
    msg.includes("transfer amount") ||
    msg.includes("execution reverted") ||
    msg.includes("unknown reason") ||
    msg.includes("revert")
  ) {
    return "Insufficient funds to tip";
  }
  return (err as any)?.shortMessage ?? (err as any)?.message ?? "Transaction failed";
}
function generateReceiptImage(params: { amount: string; to: string; txHash?: string; date: string }): string {
  const canvas = document.createElement("canvas");
  canvas.width = 340;
  canvas.height = 220;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, 340, 220);
  ctx.strokeStyle = "#00ba7c";
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, 324, 204);
  ctx.fillStyle = "#00ba7c";
  ctx.font = "bold 20px system-ui";
  ctx.fillText("Teep", 20, 36);
  ctx.fillStyle = "#71767b";
  ctx.font = "11px system-ui";
  ctx.fillText("Receipt", 20, 52);
  ctx.fillStyle = "#e5e5e5";
  ctx.font = "14px system-ui";
  ctx.fillText(`Amount: $${params.amount}`, 20, 88);
  ctx.fillText(`To: ${params.to}`, 20, 108);
  ctx.fillText(`Date: ${params.date}`, 20, 128);
  if (params.txHash) {
    ctx.fillStyle = "#536471";
    ctx.font = "10px monospace";
    ctx.fillText(params.txHash.slice(0, 18) + "â€¦", 20, 152);
  }
  ctx.fillStyle = "#00ba7c";
  ctx.font = "10px system-ui";
  ctx.fillText("teep.xyz", 20, 200);
  return canvas.toDataURL("image/png");
}
// Detect if opened as signing window (?sign=tip)
const urlParams = new URLSearchParams(window.location.search);
const SIGNING_MODE = urlParams.get("sign") === "tip";
type Screen = "loading" | "connect" | "dashboard" | "claim" | "withdraw" | "send" | "history" | "referral";
type Theme = "dark" | "light";
const LIGHT_THEME = {
  bg: "#f6f6f8",
  card: "#ffffff",
  text: "#0f172a",
  textSecondary: "#64748b",
  border: "#e2e8f0",
  borderCard: "#f1f5f9",
  primary: "#6324eb",
  success: "#22c55e",
  muted: "#64748b",
};
const DARK_THEME = {
  bg: "#161121",
  card: "#111",
  text: "#e5e5e5",
  textSecondary: "#71767b",
  border: "#2d2839",
  borderCard: "#1a1a2e",
  primary: "#6324eb",
  success: "#22c55e",
  muted: "#71767b",
};

export const App: React.FC = () => {
    const { ready, authenticated, login, logout, user } = usePrivy();
    const { wallets } = useWallets();
    const { client: smartWalletClient, getClientForChain } = useSmartWallets();
    const [theme, setTheme] = useState<Theme>("dark");
    const [screen, setScreen] = useState<Screen>("loading");
    const [usdcBalance, setUsdcBalance] = useState<string>("0");
    const [totalTipped, setTotalTipped] = useState<string>("0");
    const [error, setError] = useState<string>("");
    const [copied, setCopied] = useState(false);
    const [faucetLoading, setFaucetLoading] = useState(false);
    const [faucetMsg, setFaucetMsg] = useState<string>("");
    const [claimStatus, setClaimStatus] = useState<"idle" | "pending" | "success">("idle");
    const [claimedUsername, setClaimedUsername] = useState<string>("");
    const [claimedAuthorId, setClaimedAuthorId] = useState<string>("");
    const [referralCode, setReferralCode] = useState("");
    const [referralMsg, setReferralMsg] = useState("");
    const [referralExpanded, setReferralExpanded] = useState(false);
    const [myReferralCode, setMyReferralCode] = useState<string | null>(null);
    const [pendingMilestones, setPendingMilestones] = useState<Array<{ contentId: string; totalUsd: number; milestone: number }>>([]);
    const [loadTimeout, setLoadTimeout] = useState(false);
    // Persist theme
    useEffect(() => {
      chrome.storage.local.get(["teepTheme"], (r) => {
        if (r.teepTheme === "light" || r.teepTheme === "dark") setTheme(r.teepTheme);
      });
    }, []);
    // Whether user has acknowledged testnet warning (persisted)
    useEffect(() => {
      chrome.storage.local.get(["teepTestnetWarningSeen"], (r) => {
        setTestnetWarningSeen(r.teepTestnetWarningSeen === true);
      });
    }, []);
    const toggleTheme = useCallback(() => {
      const next: Theme = theme === "dark" ? "light" : "dark";
      setTheme(next);
      chrome.storage.local.set({ teepTheme: next });
    }, [theme]);
    // If Privy doesn't become ready within 8s (e.g. in extension popup), show retry option
    useEffect(() => {
      const t = setTimeout(() => setLoadTimeout(true), 8000);
      return () => clearTimeout(t);
    }, []);
    // Withdraw screen state
    const [claimWalletAddress, setClaimWalletAddress] = useState<string>("");
    const [claimWalletBalance, setClaimWalletBalance] = useState<string>("0");
    const [totalEarnedRaw, setTotalEarnedRaw] = useState<string>("0");
    const [claimWalletDeployed, setClaimWalletDeployed] = useState<boolean>(false);
    const [withdrawTo, setWithdrawTo] = useState<string>("");
    const [withdrawAmount, setWithdrawAmount] = useState<string>("");
    const [withdrawLoading, setWithdrawLoading] = useState(false);
    const [withdrawMsg, setWithdrawMsg] = useState<string>("");
    const [deployLoading, setDeployLoading] = useState(false);
    // Send Tips screen state (post URL form)
    const [postUrl, setPostUrl] = useState<string>("");
    const [tipPreset, setTipPreset] = useState<number | null>(1);
    const [customTipAmount, setCustomTipAmount] = useState<string>("");
    const [sendLoading, setSendLoading] = useState(false);
    const [sendMsg, setSendMsg] = useState<string>("");
    // History screen state
    interface HistoryItem {
      type: "tip_sent" | "tip_received" | "send" | "withdraw" | "withdraw_balance" | "referral_fee_received";
      amount: string;
      tx_hash?: string;
      timestamp: number;
      author_handle?: string;
      tweet_id?: string;
      from_addr?: string;
      to_address?: string;
      detail?: string;
    }
    const [tipHistory, setTipHistory] = useState<HistoryItem[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [balanceRefreshing, setBalanceRefreshing] = useState(false);
    const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
    const [debugOpen, setDebugOpen] = useState(false);
    const [addFundsOpen, setAddFundsOpen] = useState(false);
    const [showTestnetWarning, setShowTestnetWarning] = useState(false);
    const [testnetWarningSeen, setTestnetWarningSeen] = useState<boolean | null>(null);
    const [walletCopyFeedback, setWalletCopyFeedback] = useState(false);
    const [referralStats, setReferralStats] = useState<{ referredCount: number } | null>(null);
    const [referrerStatus, setReferrerStatus] = useState<{ hasReferrer: boolean; referralCode?: string; hasReferrerOnChain?: boolean } | null>(null);
    const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
    // Use smart wallet address (smart contract account) â€” this is where USDC lives
    // and where gas-sponsored transactions originate from.
    // Falls back to embedded wallet (EOA) if smart wallet isn't ready yet.
    const walletAddress = smartWalletClient?.account?.address || embeddedWallet?.address || null;
    const createWalletProof = useCallback(async (purpose: string) => {
      if (!walletAddress || !smartWalletClient) {
        throw new Error("Wallet not ready");
      }
      const challengeRes = await fetch(`${CONFIG.API_BASE_URL}/auth/wallet/challenge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: walletAddress, purpose }),
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
    }, [walletAddress, smartWalletClient]);
    // ============================================================
    // SIGNING MODE â€” Opened by background to sign a tip transaction
    // ============================================================
    const [pendingTip, setPendingTip] = useState<any>(null);
    const [signStatus, setSignStatus] = useState<"loading" | "ready" | "approving" | "sending" | "success" | "error">("loading");
    const [signError, setSignError] = useState<string>("");
    const [lastTipTxHash, setLastTipTxHash] = useState<string>("");
    const [signingClient, setSigningClient] = useState<any>(null);
    const effectiveSmartWalletClient = signingClient || smartWalletClient;
    // Load pending tip in signing mode
    useEffect(() => {
      if (!SIGNING_MODE) return;
      debugLog("SignTip", "Signing window: loading pendingTip from storage");
      chrome.storage.local.get(["pendingTip"], (result) => {
        if (result.pendingTip) {
          debugLog("SignTip", "Signing window: pendingTip found", { contentId: result.pendingTip.contentId });
          setPendingTip(result.pendingTip);
          setSignStatus("ready");
        } else {
          debugLog("SignTip", "Signing window: no pendingTip in storage â€” user may have closed background or storage was cleared");
          setSignStatus("error");
          setSignError("No pending transaction found");
        }
      });
    }, []);
    useEffect(() => {
      if (!SIGNING_MODE || !ready || !authenticated) return;
      if (smartWalletClient) {
        setSigningClient(smartWalletClient);
        return;
      }

      let cancelled = false;
      const timeout = window.setTimeout(() => {
        if (cancelled || signingClient || smartWalletClient) return;
        debugLog("SignTip", "Timed out waiting for Arc smart wallet client");
        setSignError("Smart wallet is not available for Arc in this window. Open the Teep popup once, wait for the dashboard, then try again.");
        setSignStatus("error");
      }, 15000);

      getClientForChain({ id: CONFIG.CHAIN_ID })
        .then((client) => {
          if (!cancelled && client) setSigningClient(client);
        })
        .catch((err) => {
          if (cancelled) return;
          debugLog("SignTip", "getClientForChain failed", err);
          setSignError("Smart wallet could not initialize for Arc. Check Privy smart wallet network settings.");
          setSignStatus("error");
        })
        .finally(() => window.clearTimeout(timeout));

      return () => {
        cancelled = true;
        window.clearTimeout(timeout);
      };
    }, [ready, authenticated, smartWalletClient, signingClient, getClientForChain]);

    // Execute the tip transaction via smart wallet (gas sponsored)
    const executeSignedTip = useCallback(async () => {
      debugLog("SignTip", "executeSignedTip called", { hasPendingTip: !!pendingTip, hasSmartWalletClient: !!effectiveSmartWalletClient });
      if (!pendingTip) {
        setSignError("No pending tip. Close and try again from the tweet.");
        setSignStatus("error");
        return;
      }
      if (!effectiveSmartWalletClient) {
        debugLog("SignTip", "Blocked: smart wallet client is null");
        setSignError("Wallet not ready in this window. Wait a moment and try again, or open the main Teep popup first.");
        setSignStatus("error");
        return;
      }
      try {
        setSignStatus("sending");
        const calls: Array<{ to: `0x${string}`; data: `0x${string}`; value?: bigint }> = [];
        if (pendingTip.needsApproval && pendingTip.approveData) {
          calls.push({
            to: pendingTip.approveData.to as `0x${string}`,
            data: pendingTip.approveData.data as `0x${string}`,
          });
        }
        calls.push({
          to: pendingTip.tipData.to as `0x${string}`,
          data: pendingTip.tipData.data as `0x${string}`,
        });

        const txHash = await effectiveSmartWalletClient.sendTransaction({
          calls,
          account: effectiveSmartWalletClient.account,
        } as any);
        console.log("[Teep] Tip tx sent:", txHash);
        setLastTipTxHash(txHash);
        setSignStatus("success");

        await chrome.storage.local.set({
          tipResult: {
            contentId: pendingTip.contentId,
            success: true,
            txHash,
            amount: pendingTip.amount,
            timestamp: Date.now(),
          },
        });
        await chrome.storage.local.remove("pendingTip");
        chrome.runtime.sendMessage({ type: "TIP_TX_COMPLETE", payload: { success: true, txHash } }).catch(() => {});

        const rawAmount = (Number(pendingTip.amount) * 1_000_000).toString();
        const fromAddr = (effectiveSmartWalletClient.account?.address ?? "").toLowerCase();
        await Promise.allSettled([
          fetch(`${CONFIG.API_BASE_URL}/tips/metadata`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contentId: pendingTip.contentId,
              authorHandle: pendingTip.authorHandle,
              tweetId: pendingTip.tweetId,
            }),
          }),
          fetch(`${CONFIG.API_BASE_URL}/tips/activity`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "tip_sent",
              fromAddress: fromAddr,
              amount: rawAmount,
              txHash,
              authorHandle: pendingTip.authorHandle,
              tweetId: pendingTip.tweetId,
              detail: pendingTip.authorHandle ? `Tipped @${pendingTip.authorHandle}` : "Tip sent",
            }),
          }),
        ]);
      } catch (err: any) {
        console.error("[Teep] Tip tx error:", err);
        setSignStatus("error");
        const userMessage = getTipErrorMessage(err);
        setSignError(userMessage);
        await chrome.storage.local.set({
          tipResult: {
            contentId: pendingTip.contentId,
            success: false,
            error: userMessage,
            timestamp: Date.now(),
          },
        });
        await chrome.storage.local.remove("pendingTip");
      }
    }, [pendingTip, effectiveSmartWalletClient]);

    // Render signing mode UI
    if (SIGNING_MODE) {
      return (
        <div style={S.app}>
          <header style={S.header}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "20px" }}>&#128176;</span>
              <span style={{ fontSize: "18px", fontWeight: 700, color: "#fff" }}>Confirm Tip</span>
            </div>
          </header>
          <main style={{ ...S.main, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "400px" }}>
            {!ready ? (
              <p style={S.loadingText}>Initializing wallet...</p>
            ) : !authenticated || (!effectiveSmartWalletClient && signStatus !== "error") ? (
              <div style={S.card}>
                <p style={{ color: "#71767b", fontSize: "14px", textAlign: "center" as const }}>
                  {!authenticated ? "Wallet not connected. Please open the Teep popup first." : "Loading smart wallet..."}
                </p>
              </div>
            ) : signStatus === "loading" ? (
              <p style={S.loadingText}>Loading transaction...</p>
            ) : signStatus === "error" ? (
              <div style={{ ...S.card, borderColor: "rgba(244,33,46,0.3)" }}>
                <div style={{ ...S.cardLabel, color: "#f4212e" }}>Transaction Failed</div>
                <p style={{ color: "#e5e5e5", fontSize: "14px", lineHeight: 1.5 }}>{signError}</p>
                <button onClick={() => window.close()} style={{ ...S.ghostBtn, marginTop: "12px" }}>Close</button>
              </div>
            ) : signStatus === "success" ? (
              <div style={{ ...S.card, borderColor: "rgba(0,186,124,0.3)" }}>
                <div style={{ textAlign: "center" as const }}>
                  <div style={{ fontSize: "40px", marginBottom: "8px" }}>&#9989;</div>
                  <div style={{ ...S.title, color: "#00ba7c" }}>Tip Sent!</div>
                  <p style={{ color: "#71767b", fontSize: "13px" }}>
                    ${pendingTip?.amount} USD to @{pendingTip?.authorHandle}
                  </p>
                  <a
                    href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                      buildReceiptTweetText({
                        amount: pendingTip?.amount || "0",
                        authorHandle: pendingTip?.authorHandle || "",
                        tweetId: pendingTip?.tweetId,
                        txHash: lastTipTxHash || undefined,
                        txUrl: lastTipTxHash ? `${CONFIG.RECEIPT_BASE_URL}/tx/${lastTipTxHash}` : undefined,
                      })
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "inline-block",
                      marginTop: "12px",
                      padding: "10px 16px",
                      background: "#1d9bf0",
                      color: "#fff",
                      borderRadius: "10px",
                      fontSize: "13px",
                      fontWeight: 600,
                      textDecoration: "none",
                    }}
                  >
                    Share on X
                  </a>
                  <p style={{ color: "#536471", fontSize: "11px", marginTop: "8px" }}>This window will close in 10 seconds.</p>
                </div>
              </div>
            ) : signStatus === "approving" ? (
              <div style={S.card}>
                <div style={{ textAlign: "center" as const }}>
                  <p style={{ color: "#f6a623", fontSize: "15px", fontWeight: 700 }}>Approving USD...</p>
                  <p style={{ color: "#71767b", fontSize: "13px", marginTop: "8px" }}>Please confirm in your wallet</p>
                </div>
              </div>
            ) : signStatus === "sending" ? (
              <div style={S.card}>
                <div style={{ textAlign: "center" as const }}>
                  <p style={{ color: "#1d9bf0", fontSize: "15px", fontWeight: 700 }}>Sending Tip...</p>
                  <p style={{ color: "#71767b", fontSize: "13px", marginTop: "8px" }}>Transaction in progress</p>
                </div>
              </div>
            ) : pendingTip ? (
              <div style={{ width: "100%", maxWidth: "320px" }}>
                <div style={{ ...S.card, marginBottom: "12px" }}>
                  <div style={S.cardLabel}>Send Tip</div>
                  <div style={{ fontSize: "32px", fontWeight: 700, color: "#fff", textAlign: "center" as const, margin: "12px 0" }}>
                    ${pendingTip.amount} <span style={{ fontSize: "16px", color: "#71767b" }}>USD</span>
                  </div>
                  <div style={{ textAlign: "center" as const, color: "#71767b", fontSize: "14px" }}>
                    to <span style={{ color: "#1d9bf0", fontWeight: 600 }}>@{pendingTip.authorHandle}</span>
                  </div>
                  {pendingTip.needsApproval && (
                    <div style={{ textAlign: "center" as const, color: "#f6a623", fontSize: "11px", marginTop: "8px" }}>
                      USD approval will be requested first
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column" as const, gap: "8px" }}>
                  <button onClick={executeSignedTip} style={S.primaryBtn}>
                    Confirm &amp; Send
                  </button>
                  <button onClick={() => window.close()} style={S.ghostBtn}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {isDebug() && (
              <div style={{ marginTop: "12px", width: "100%", maxWidth: "320px" }}>
                <button
                  type="button"
                  onClick={() => setDebugOpen(!debugOpen)}
                  style={{ background: "transparent", border: "1px solid #2f3336", borderRadius: "8px", color: "#71767b", fontSize: "11px", padding: "6px 10px", cursor: "pointer", width: "100%", textAlign: "left" }}
                >
                  {debugOpen ? "v" : ">"} Debug ({debugEntries.length})
                </button>
                {debugOpen && (
                  <div style={{ marginTop: "8px", maxHeight: "120px", overflow: "auto", background: "#111", borderRadius: "8px", padding: "8px", fontSize: "10px", fontFamily: "monospace", color: "#8b949e", whiteSpace: "pre-wrap" }}>
                    {debugEntries.map((e, i) => (
                      <div key={i} style={{ marginBottom: "4px" }}><span style={{ color: "#58a6ff" }}>[{e.tag}]</span> {e.message} {e.data != null ? JSON.stringify(e.data) : ""}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </main>
        </div>
      );
    }
  // NORMAL MODE â€” Regular popup dashboard
  // ============================================================
  // React to Privy auth state â€” delay showing "connect" so returning users see loading then dashboard, not welcome flash
  useEffect(() => {
    if (!ready) return;
    if (authenticated && walletAddress) {
      chrome.runtime.sendMessage({
        type: "WALLET_CONNECTED",
        payload: { address: walletAddress },
      });
      setScreen("dashboard");
      return;
    }
    const t = setTimeout(() => {
      if (!authenticated) setScreen("connect");
    }, 450);
    return () => clearTimeout(t);
  }, [ready, authenticated, walletAddress]);
  // Show testnet warning once when landing on dashboard if not yet acknowledged
  useEffect(() => {
    if (screen === "dashboard" && testnetWarningSeen === false && authenticated) {
      setShowTestnetWarning(true);
    }
  }, [screen, testnetWarningSeen, authenticated]);
  // Fetch claim status from backend DB (source of truth)
  const checkClaimStatus = useCallback(async (address: string) => {
    try {
      const res = await fetch(`${CONFIG.API_BASE_URL}/auth/claim-status/${address}`);
      const data = await res.json();
      if (data.verified && data.claims?.length > 0) {
        setClaimStatus("success");
        setClaimedUsername(data.claims[0].username);
        setClaimedAuthorId(data.claims[0].author_id || "");
        if (screen === "claim") {
          setScreen("dashboard");
        }
      }
    } catch (err) {
      console.error("[Teep] Failed to check claim status:", err);
    }
  }, [screen]);
  // Check claim status on mount and when wallet connects
  useEffect(() => {
    if (walletAddress) {
      checkClaimStatus(walletAddress);
    }
  }, [walletAddress, checkClaimStatus]);
  // Load pending milestones for creator (so we can show "Your post crossed $X!")
  const loadPendingMilestones = useCallback(async (authorId: string) => {
    if (!authorId) return;
    try {
      const res = await fetch(`${CONFIG.API_BASE_URL}/milestones/pending/${authorId}`);
      const data = await res.json();
      if (data?.pending?.length) setPendingMilestones(data.pending);
    } catch {
      setPendingMilestones([]);
    }
  }, []);
  useEffect(() => {
    if (claimStatus === "success" && claimedAuthorId) {
      loadPendingMilestones(claimedAuthorId);
    } else {
      setPendingMilestones([]);
    }
  }, [claimStatus, claimedAuthorId, loadPendingMilestones]);
  const handleReferralSubmit = useCallback(async () => {
    if (!walletAddress || !referralCode.trim()) return;
    setReferralMsg("");
    try {
      const code = referralCode.trim();
      const walletProof = await createWalletProof("referral-link");
      const res = await fetch(`${CONFIG.API_BASE_URL}/referral/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: walletAddress, code, walletProof }),
      });
      const data = await res.json();
      if (!res.ok) {
        setReferralMsg(data?.error || "Could not apply referral code.");
        return;
      }

      setReferrerStatus({ hasReferrer: true, referralCode: data.referralCode ?? code });
      setReferralCode("");

      if (CONFIG.REFERRAL_REGISTRY_ADDRESS && smartWalletClient && data.referrer) {
        try {
          const setReferrerProof = await createWalletProof("referral-set-referrer");
          const signRes = await fetch(`${CONFIG.API_BASE_URL}/referral/sign-set-referrer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userAddress: walletAddress, walletProof: setReferrerProof }),
          });
          const signData = await signRes.json();
          if (signRes.ok && signData.setReferrerExpiresAt && signData.setReferrerNonce && signData.setReferrerSignature) {
            const setReferrerData = encodeFunctionData({
              abi: REFERRAL_REGISTRY_ABI,
              functionName: "setReferrer",
              args: [
                walletAddress as `0x${string}`,
                signData.referrer as `0x${string}`,
                BigInt(signData.setReferrerExpiresAt),
                signData.setReferrerNonce as `0x${string}`,
                signData.setReferrerSignature as `0x${string}`,
              ],
            }) as `0x${string}`;
            await smartWalletClient.sendTransaction({
              calls: [{ to: CONFIG.REFERRAL_REGISTRY_ADDRESS, data: setReferrerData }],
              chain: CONFIG.CHAIN,
              account: smartWalletClient.account,
            } as any);
            setReferrerStatus((prev) => (prev ? { ...prev, hasReferrerOnChain: true } : prev));
          }
        } catch (e) {
          console.warn("[Teep] setReferrer tx failed (referral still linked in DB):", e);
          setReferralMsg("Referral linked. On-chain referral setup failed; try again later.");
          return;
        }
      }

      setReferralMsg(data.alreadyLinked ? "Already linked." : "Referral code applied.");
    } catch (err: any) {
      setReferralMsg(err?.message || "Could not apply referral code.");
    }
  }, [walletAddress, referralCode, createWalletProof, smartWalletClient]);

  const loadBalanceForDisplay = useCallback(() => {
    const primary = smartWalletClient?.account?.address || embeddedWallet?.address;
    debugLog("Balance", "loadBalanceForDisplay", {
      primary: primary ?? null,
      fromSmartWallet: !!smartWalletClient?.account?.address,
    });
    if (!primary) {
      debugLog("Balance", "No primary address; hooks may not be ready yet");
      return;
    }
    chrome.runtime.sendMessage(
      { type: "GET_USDC_BALANCE", payload: { address: primary } },
      (response) => {
        if (response?.balance !== undefined) {
          setUsdcBalance(response.balance);
          debugLog("Balance", "GET_USDC_BALANCE response", { balance: response.balance });
        } else {
          debugLog("Balance", "GET_USDC_BALANCE error or no balance", response);
        }
      }
    );
    fetch(`${CONFIG.API_BASE_URL}/tips/wallet/${primary}`)
      .then((r) => r.json())
      .then((data) => { if (data?.totalSent) setTotalTipped(data.totalSent); })
      .catch(() => {});
  }, [embeddedWallet?.address, smartWalletClient?.account?.address]);
        // On reopen, load balance from stored address immediately (Privy hooks may not be ready yet)
        useEffect(() => {
          if (!authenticated) return;
          debugLog("Balance", "Reopen: reading walletState from storage");
          chrome.storage.local.get(["walletState"], (r) => {
            const addr = r?.walletState?.address;
            debugLog("Balance", "Reopen: storage walletState", { hasAddress: !!addr, address: addr ? addr.slice(0, 10) + "â€¦" : null });
            if (addr) {
              chrome.runtime.sendMessage(
                { type: "GET_USDC_BALANCE", payload: { address: addr } },
                (res) => {
                  debugLog("Balance", "Reopen: GET_USDC_BALANCE for stored address", { balance: res?.balance, error: res?.error });
                  if (res?.balance !== undefined) setUsdcBalance(res.balance);
                }
              );
            }
          });
        }, [authenticated]);
        // Use combined balance when we have addresses from hooks
        useEffect(() => {
          if (!ready || !authenticated || !walletAddress) return;
          loadBalanceForDisplay();
        }, [ready, authenticated, walletAddress, loadBalanceForDisplay]);
        // Retries: smart wallet / wallets often load after popup opens
        useEffect(() => {
          if (!authenticated || !loadBalanceForDisplay) return;
          const t1 = setTimeout(loadBalanceForDisplay, 600);
          const t2 = setTimeout(loadBalanceForDisplay, 2000);
          return () => { clearTimeout(t1); clearTimeout(t2); };
        }, [authenticated, loadBalanceForDisplay]);
        // Debug panel: subscribe to log entries when debug mode is on
        useEffect(() => {
          if (!isDebug()) return;
          return addDebugListener(setDebugEntries);
        }, []);
        // Load tip history from backend
        const loadHistory = useCallback(async (address: string) => {
          setHistoryLoading(true);
          try {
            const res = await fetch(`${CONFIG.API_BASE_URL}/tips/history/${address}?limit=50`);
            const data = await res.json();
            if (data?.history) setTipHistory(data.history);
          } catch {
            // silent
          }
          setHistoryLoading(false);
        }, []);
        // Load tip history when dashboard is shown (for Tipping History section)
        useEffect(() => {
          if (screen === "dashboard" && walletAddress) {
            loadHistory(walletAddress);
          }
        }, [screen, walletAddress, loadHistory]);
        // Load user's referral code (get or create) for sharing
        useEffect(() => {
          if (!walletAddress) return;
          let cancelled = false;
          const loadCode = async () => {
            try {
              const readRes = await fetch(`${CONFIG.API_BASE_URL}/referral/code/${walletAddress}`);
              const readData = await readRes.json();
              if (readData?.code) {
                if (!cancelled) setMyReferralCode(readData.code);
                return;
              }
              const walletProof = await createWalletProof("referral-code");
              const createRes = await fetch(`${CONFIG.API_BASE_URL}/referral/code`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address: walletAddress, walletProof }),
              });
              const createData = await createRes.json();
              if (!cancelled && createData?.code) setMyReferralCode(createData.code);
            } catch {
              if (!cancelled) setMyReferralCode(null);
            }
          };
          loadCode();
          return () => { cancelled = true; };
        }, [walletAddress, createWalletProof]);
        // Load referral stats and referrer status (applied code) when on referral screen
        useEffect(() => {
          if (screen !== "referral" || !walletAddress) return;
          fetch(`${CONFIG.API_BASE_URL}/referral/stats/${walletAddress}`)
            .then((r) => r.json())
            .then((data) => setReferralStats({ referredCount: data?.referredCount ?? 0 }))
            .catch(() => setReferralStats({ referredCount: 0 }));
          fetch(`${CONFIG.API_BASE_URL}/referral/status/${walletAddress}`)
            .then((r) => r.json())
            .then((data) => {
              if (data?.hasReferrer && data?.referralCode) {
                setReferrerStatus({
                    hasReferrer: true,
                    referralCode: data.referralCode,
                    hasReferrerOnChain: data.hasReferrerOnChain,
                  });
                  setReferralExpanded(true);
                } else if (!data?.hasReferrer) {
                  setReferrerStatus({ hasReferrer: false });
                }
              })
              .catch(() => setReferrerStatus(null));
          }, [screen, walletAddress]);
          // Load claim wallet info when entering withdraw screen (backend is source of truth for deployed + address)
          const loadClaimWalletInfo = useCallback(async () => {
            if (!claimedUsername || !walletAddress) {
              debugLog("ClaimWallet", "loadClaimWalletInfo skipped", { claimedUsername: !!claimedUsername, walletAddress: !!walletAddress });
              return;
            }
            const authorIdHash = claimedAuthorId || "";
            debugLog("ClaimWallet", "Requesting claim-wallet-status from backend", { walletAddress: walletAddress.slice(0, 10) + "â€¦" });
            try {
              const statusRes = await fetch(`${CONFIG.API_BASE_URL}/auth/claim-wallet-status/${walletAddress}`);
              const status = await statusRes.json();
              debugLog("ClaimWallet", "Backend claim-wallet-status response", status);
              if (status.totalEarnedRaw !== undefined) setTotalEarnedRaw(String(status.totalEarnedRaw));
              if (status.claimWalletAddress) {
                setClaimWalletDeployed(!!status.deployed);
                setClaimWalletAddress(status.claimWalletAddress);
                // Sum USDC balance at current + any legacy addresses (e.g. old factory's claim wallet after redeploy)
                const addressesToSum: string[] = [status.claimWalletAddress];
                if (Array.isArray(status.legacyClaimWalletAddresses)) addressesToSum.push(...status.legacyClaimWalletAddresses);
                const fetchOne = (addr: string): Promise<string> =>
                  new Promise((resolve) => {
                    chrome.runtime.sendMessage({ type: "GET_CLAIM_WALLET_BALANCE", payload: { address: addr } }, (r: any) => {
                      resolve(r?.balance !== undefined ? String(r.balance) : "0");
                    });
                  });
                Promise.all(addressesToSum.map(fetchOne))
                  .then((balances) => {
                    const total = balances.reduce((sum, b) => sum + BigInt(b), 0n);
                    setClaimWalletBalance(total.toString());
                  })
                  .catch(() => {});
                return;
              }
            } catch (e) {
              debugLog("ClaimWallet", "Backend claim-wallet-status failed", e);
            }
            if (!authorIdHash) {
              debugLog("ClaimWallet", "Fallback skipped: no stable author ID available");
              return;
            }
            debugLog("ClaimWallet", "Fallback: IS_CLAIM_WALLET_DEPLOYED + COMPUTE_CLAIM_WALLET");
            chrome.runtime.sendMessage(
              { type: "IS_CLAIM_WALLET_DEPLOYED", payload: { authorIdHash } },
              (res) => {
                debugLog("ClaimWallet", "IS_CLAIM_WALLET_DEPLOYED response", res);
                if (res && typeof res.deployed === "boolean") setClaimWalletDeployed(res.deployed);
              }
            );
            chrome.runtime.sendMessage(
              { type: "COMPUTE_CLAIM_WALLET", payload: { authorIdHash } },
              (res) => {
                debugLog("ClaimWallet", "COMPUTE_CLAIM_WALLET response", res);
                if (res?.address) {
                  setClaimWalletAddress(res.address);
                  chrome.runtime.sendMessage(
                    { type: "GET_CLAIM_WALLET_BALANCE", payload: { address: res.address } },
                    (balRes) => {
                      debugLog("ClaimWallet", "Fallback GET_CLAIM_WALLET_BALANCE response", balRes);
                      if (balRes?.balance !== undefined) setClaimWalletBalance(balRes.balance);
                    }
                  );
                }
              }
            );
          }, [claimedUsername, walletAddress]);
          useEffect(() => {
            if (claimedUsername && walletAddress) {
              loadClaimWalletInfo();
            }
          }, [claimedUsername, walletAddress, loadClaimWalletInfo]);
          const handleConnect = useCallback(async () => {
            setError("");
            if (testnetWarningSeen !== true) {
              setShowTestnetWarning(true);
              return;
            }
            try { login(); } catch (err: any) { setError(err.message || "Connection failed"); }
          }, [login, testnetWarningSeen]);
          const acknowledgeTestnetWarning = useCallback(() => {
            chrome.storage.local.set({ teepTestnetWarningSeen: true });
            setTestnetWarningSeen(true);
            setShowTestnetWarning(false);
            if (screen === "connect") {
              try { login(); } catch (err: any) { setError(err.message || "Connection failed"); }
            }
          }, [screen, login]);
          const handleDisconnect = useCallback(async () => {
            try {
              await logout();
              chrome.runtime.sendMessage({ type: "WALLET_DISCONNECTED" });
              setUsdcBalance("0");
              setScreen("connect");
            } catch (err: any) { setError(err.message || "Disconnect failed"); }
          }, [logout]);
          const handleCopyAddress = useCallback((addr?: string) => {
            const target = addr || walletAddress;
            if (!target) return;
            navigator.clipboard.writeText(target).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }, [walletAddress]);
          const handleFaucet = useCallback(async () => {
            if (!walletAddress) return;
            setFaucetLoading(true);
            setFaucetMsg("");
            try {
              const res = await fetch(`${CONFIG.API_BASE_URL}/faucet`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ address: walletAddress }),
              });
              const data = await res.json();
              if (data.success) {
                setFaucetMsg("100 USD received!");
                setTimeout(() => loadBalanceForDisplay(), 2000);
              } else {
                setFaucetMsg(data.error || "Faucet failed");
              }
            } catch (err: any) {
              setFaucetMsg(err.message || "Network error");
            }
            setFaucetLoading(false);
    setTimeout(() => setFaucetMsg(""), 5000);
  }, [walletAddress, loadBalanceForDisplay]);
  const handleClaimStart = useCallback(async () => {
    if (!walletAddress) return;
    setError("");
    setClaimStatus("pending");
    try {
      const res = await fetch(`${CONFIG.API_BASE_URL}/auth/x/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerAddress: walletAddress }),
      });
      const data = await res.json();
      if (data.authUrl) {
        chrome.tabs.create({ url: data.authUrl });
      } else {
        setError("Failed to start verification");
        setClaimStatus("idle");
      }
    } catch (err: any) {
      setError(err.message);
      setClaimStatus("idle");
    }
  }, [walletAddress]);
  // Deploy claim wallet on-chain using the attestation from backend
  const handleDeployClaimWallet = useCallback(async () => {
    if (!walletAddress || !smartWalletClient || !claimedUsername) return;
    setDeployLoading(true);
    setError("");
    try {
      // 1. Fetch attestation from backend
      const walletProof = await createWalletProof("claim-attestation");
      const attRes = await fetch(`${CONFIG.API_BASE_URL}/auth/attestation/${walletAddress}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletProof }),
      });
      const attData = await attRes.json();
      if (!attData.success || !attData.attestation) {
        throw new Error(attData.error || "No attestation found. Please re-verify with X.");
      }
      const att = attData.attestation;
      // 2. Build deployClaimWallet calldata
      const authorIdHash = String(att.authorId || claimedAuthorId);
      const calldata = encodeFunctionData({
        abi: FACTORY_ABI,
        functionName: "deployClaimWallet",
        args: [
          BigInt(authorIdHash),
          att.owner as `0x${string}`,
          BigInt(att.timestamp),
          att.nonce as `0x${string}`,
          att.signature as `0x${string}`,
        ],
      });
      // 3. Send via smart wallet (gas sponsored)
      const txHash = await smartWalletClient.sendTransaction({
        to: CONFIG.WALLET_FACTORY_ADDRESS,
        data: calldata,
        chain: CONFIG.CHAIN,
        account: smartWalletClient.account,
      });
      console.log("[Teep] Claim wallet deployed, tx:", txHash);
      setClaimWalletDeployed(true);
      setTimeout(() => loadClaimWalletInfo(), 3000);
    } catch (err: any) {
      const msg = err.shortMessage || err.message || "";
      if (/already deployed|Factory: already deployed/i.test(msg)) {
        setClaimWalletDeployed(true);
        setError("");
        loadClaimWalletInfo();
      } else {
        setError(msg || "Deployment failed");
      }
    }
    setDeployLoading(false);
  }, [walletAddress, smartWalletClient, claimedUsername, loadClaimWalletInfo, createWalletProof, claimedAuthorId]);
  // Withdraw USDC from claim wallet with fee split (net to user, fee to protocol + optional referrer)
  const handleWithdraw = useCallback(async () => {
    if (!walletAddress || !smartWalletClient || !claimWalletAddress) return;
    if (!withdrawTo || !withdrawAmount) return;
    if (!/^0x[a-fA-F0-9]{40}$/.test(withdrawTo)) {
      setWithdrawMsg("Invalid destination address");
      return;
    }
    const amountNum = parseFloat(withdrawAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setWithdrawMsg("Invalid amount");
      return;
    }
    const rawAmount = parseUnits(withdrawAmount, CONFIG.USDC_DECIMALS);
    const balanceBigInt = BigInt(claimWalletBalance);
    if (rawAmount > balanceBigInt) {
      setWithdrawMsg("Insufficient balance");
      return;
    }
    setWithdrawLoading(true);
    setWithdrawMsg("");
    try {
      const breakdownRes = await fetch(
        `${CONFIG.API_BASE_URL}/withdrawal/breakdown?ownerAddress=${encodeURIComponent(walletAddress)}&amountRaw=${rawAmount.toString()}`
      );
      const breakdown = await breakdownRes.json();
      if (!breakdownRes.ok) {
        setWithdrawMsg(breakdown.error || "Failed to get fee breakdown");
        setWithdrawLoading(false);
        return;
      }
      // When registry is configured, contract does fee/referrer split in one tx (withdrawWithFee). Otherwise legacy multi-call.
      const useWithdrawWithFee = !!CONFIG.REFERRAL_REGISTRY_ADDRESS;
      let txHash: string;
      if (useWithdrawWithFee) {
        const data = encodeFunctionData({
          abi: CLAIM_WALLET_ABI,
          functionName: "withdrawWithFee",
          args: [CONFIG.USDC_ADDRESS, withdrawTo as `0x${string}`, rawAmount],
        }) as `0x${string}`;
        txHash = await smartWalletClient.sendTransaction({
          calls: [{ to: claimWalletAddress as `0x${string}`, data }],
          chain: CONFIG.CHAIN,
          account: smartWalletClient.account,
        } as any);
      } else {
        const netAmount = BigInt(breakdown.netAmount);
        const protocolAmount = BigInt(breakdown.protocolAmount);
        const referrerAmount = BigInt(breakdown.referrerAmount || "0");
        const protocolTreasury = (breakdown.protocolTreasury || "").toLowerCase();
        const referrerAddress = (breakdown.referrerAddress || "").toLowerCase();
        const calls: Array<{ to: `0x${string}`; data: `0x${string}` }> = [];
        if (netAmount > 0n) {
          calls.push({
            to: claimWalletAddress as `0x${string}`,
            data: encodeFunctionData({
              abi: CLAIM_WALLET_ABI,
              functionName: "withdraw",
              args: [CONFIG.USDC_ADDRESS, withdrawTo as `0x${string}`, netAmount],
            }) as `0x${string}`,
          });
        }
        if (protocolAmount > 0n && protocolTreasury && protocolTreasury !== "0x0000000000000000000000000000000000000000") {
          calls.push({
            to: claimWalletAddress as `0x${string}`,
            data: encodeFunctionData({
              abi: CLAIM_WALLET_ABI,
              functionName: "withdraw",
              args: [CONFIG.USDC_ADDRESS, protocolTreasury as `0x${string}`, protocolAmount],
            }) as `0x${string}`,
          });
        }
        if (referrerAmount > 0n && referrerAddress && referrerAddress !== "0x0000000000000000000000000000000000000000") {
          calls.push({
            to: claimWalletAddress as `0x${string}`,
            data: encodeFunctionData({
              abi: CLAIM_WALLET_ABI,
              functionName: "withdraw",
              args: [CONFIG.USDC_ADDRESS, referrerAddress as `0x${string}`, referrerAmount],
            }) as `0x${string}`,
          });
        }
        if (calls.length === 0) {
          setWithdrawMsg("No transfer to execute");
          setWithdrawLoading(false);
          return;
        }
        txHash = await smartWalletClient.sendTransaction({
          calls,
          chain: CONFIG.CHAIN,
          account: smartWalletClient.account,
        } as any);
      }
      console.log("[Teep] Withdrawal tx:", txHash);
      setWithdrawMsg("Withdrawal successful!");
      try {
        await fetch(`${CONFIG.API_BASE_URL}/tips/activity`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "withdraw",
            fromAddress: walletAddress,
            toAddress: withdrawTo,
            amount: rawAmount.toString(),
            txHash,
            detail: `Withdraw tips to ${withdrawTo.slice(0, 6)}...${withdrawTo.slice(-4)}`,
          }),
        });
        // Only record referral_fee_received when we used legacy multi-call path; with withdrawWithFee the contract decides on-chain and we don't know if referrer got it.
        if (!useWithdrawWithFee && breakdown.referrerAddress && breakdown.referrerAmount && breakdown.referrerAddress !== "0x0000000000000000000000000000000000000000") {
          await fetch(`${CONFIG.API_BASE_URL}/tips/activity`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "referral_fee_received",
              fromAddress: walletAddress,
              toAddress: breakdown.referrerAddress,
              amount: breakdown.referrerAmount,
              txHash,
              detail: "Referral fee from withdrawal",
            }),
          });
        }
    } catch {}
    setWithdrawTo("");
    setWithdrawAmount("");
    setTimeout(() => {
      loadClaimWalletInfo();
      loadBalanceForDisplay();
    }, 3000);
  } catch (err: any) {
    console.error("[Teep] Withdraw error:", err);
    setWithdrawMsg(err.shortMessage || err.message || "Withdrawal failed");
  }
  setWithdrawLoading(false);
}, [walletAddress, smartWalletClient, claimWalletAddress, claimWalletBalance, withdrawTo, withdrawAmount, loadClaimWalletInfo, loadBalanceForDisplay]);
// Send Tips: parse post URL, then trigger normal tipping flow (background opens signing window; success shows Share on X).
const handleSendTip = useCallback(async () => {
  setSendMsg("");
  const parsed = parsePostUrl(postUrl);
  if (!parsed) {
    setSendMsg(
      "URL not recognised. Use: x.com/username/status/123 or twitter.com/username/status/123 (mobile and fxtwitter.com also work)."
    );
    return;
  }
  const { authorHandle, tweetId } = parsed;
  const amount = tipPreset != null ? tipPreset : parseFloat(customTipAmount);
  if (isNaN(amount) || amount <= 0) {
    setSendMsg("Choose or enter a valid tip amount");
    return;
  }
  const contentId = computeContentId(authorHandle, tweetId);
  const authorId = handleToAuthorId(authorHandle);
  setSendLoading(true);
  try {
    const res = await new Promise<{ pending?: boolean; error?: string }>((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: "TIP_REQUEST",
          payload: { contentId, authorId, amount, tweetId, authorHandle },
        },
        resolve
      );
    });
    if (res?.error) {
      setSendMsg(res.error);
      setSendLoading(false);
      return;
    }
    if (res?.pending) {
      setSendMsg("Signing window opened â€” confirm there to send. After success you can share on X.");
      setPostUrl("");
      setCustomTipAmount("");
      setTipPreset(1);
      loadBalanceForDisplay();
    }
  } catch (err: any) {
    setSendMsg(err?.message || "Failed to start tip");
  }
  setSendLoading(false);
}, [postUrl, tipPreset, customTipAmount, loadBalanceForDisplay]);
const isLight = theme === "light";
const T = isLight ? LIGHT_THEME : DARK_THEME;
const cardTheme = isLight ? { background: T.card, border: `1px solid ${T.borderCard}`, color: T.text } : {};
const pageHeaderTheme = isLight ? { color: T.text } : {};
const balanceCardTheme = isLight ? { background: T.card, border: `1px solid ${T.borderCard}`, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" } : {};
const labelTheme = isLight ? { color: T.muted } : {};
const inputTheme = isLight ? { background: "#fff", color: T.text, border: `1px solid ${T.border}` } : {};

if (!ready) {
  return (
    <div style={{ ...S.app, background: T.bg, color: T.text }}>
      <main style={{ ...S.main, minHeight: "360px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ ...S.centered, minHeight: "320px" }}>
          <p style={{ ...S.loadingText, color: T.text, fontSize: "15px", marginBottom: "8px" }}>Loading Teep...</p>
          <p style={{ color: T.muted, fontSize: "12px", marginBottom: "12px" }}>
            {loadTimeout ? "Taking longer than usual." : "If this takes too long, close and reopen the popup."}
          </p>
          {loadTimeout && (
            <button onClick={() => window.location.reload()} style={S.primaryBtn}>Reload popup</button>
          )}
        </div>
      </main>
    </div>
  );
}

if (!authenticated || screen === "connect") {
  return (
    <div style={{ ...S.app, background: T.bg, color: T.text }}>
      <main style={{ ...S.main, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ ...S.card, ...cardTheme, textAlign: "center" as const }}>
          <div style={{ fontSize: "36px", marginBottom: "8px" }}>&#128176;</div>
          <div style={{ ...S.title, color: T.text }}>Teep</div>
          <p style={{ ...S.subtitle, color: T.muted }}>Sign up with email. Tip creators without thinking about wallets.</p>
          <button onClick={() => login()} style={S.primaryBtn}>Sign up / Log in</button>
          {error && <p style={S.error}>{error}</p>}
        </div>
      </main>
    </div>
  );
}

const shortWallet = walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "No wallet";

return (
  <div style={{ ...S.app, background: T.bg, color: T.text }}>
    <main style={{ ...S.main, background: T.bg }}>
      <div style={{ ...S.profileRow, ...(isLight ? { background: T.card, borderBottom: `1px solid ${T.border}`, padding: "14px 16px" } : {}) }}>
        <div style={S.profileAvatarWrap}>
          {(() => {
            const displayName = claimedUsername || user?.email?.address || shortWallet;
            const urls = getAvatarUrls(claimedUsername ?? "", displayName);
            return <img src={urls.primary} alt="" style={S.profileAvatar} onError={(e) => { e.currentTarget.src = urls.fallback; e.currentTarget.onerror = null; }} />;
          })()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...S.profileHandle, color: T.text }}>{claimedUsername ? `@${claimedUsername}` : user?.email?.address || shortWallet}</div>
          <button type="button" onClick={() => setScreen("claim")} style={{ ...S.profileVerifyPrompt, marginTop: "2px" }}>
            {claimedUsername ? "X connected" : "Verify X to receive tips"}
          </button>
        </div>
        <button type="button" onClick={toggleTheme} style={S.copyBtn} title={theme === "dark" ? "Switch to light" : "Switch to dark"}>{theme === "dark" ? "L" : "D"}</button>
        <button onClick={handleDisconnect} style={{ ...S.logoutBtn, color: isLight ? "#64748b" : "#f4212e" }} title="Log out">Log out</button>
      </div>

      {showTestnetWarning && (
        <div style={{ ...S.card, ...cardTheme, borderColor: "rgba(246,166,35,0.35)", marginBottom: "12px" }}>
          <p style={{ color: T.text, fontSize: "13px", marginBottom: "10px" }}>Teep is running on Arc testnet.</p>
          <button onClick={() => { chrome.storage.local.set({ teepTestnetWarningSeen: true }); setTestnetWarningSeen(true); setShowTestnetWarning(false); }} style={S.smallBtn}>Got it</button>
        </div>
      )}

      {screen === "dashboard" && walletAddress && (
        <div style={S.stack}>
          <div style={{ ...S.balanceCard, ...balanceCardTheme }}>
            <div style={{ ...S.balanceLabel, ...labelTheme }}>Tip balance</div>
            <div style={{ ...S.balanceHero, color: T.text }}>{formatUSDC(usdcBalance)}</div>
            <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
              <button onClick={() => setAddFundsOpen(!addFundsOpen)} style={S.balanceActionBtn}>Add funds</button>
              <button onClick={() => { setBalanceRefreshing(true); loadBalanceForDisplay(); setTimeout(() => setBalanceRefreshing(false), 800); }} style={S.balanceActionBtn}>{balanceRefreshing ? "Refreshing..." : "Refresh"}</button>
            </div>
          </div>
          {addFundsOpen && (
            <div style={{ ...S.card, ...cardTheme }}>
              <div style={{ ...S.cardLabel, ...labelTheme }}>Wallet address</div>
              <div style={S.addressRow}><span style={S.addressText}>{walletAddress}</span><button onClick={() => handleCopyAddress()} style={S.copyBtn}>{copied || walletCopyFeedback ? "OK" : "Copy"}</button></div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <button onClick={() => setScreen("send")} style={S.primaryBtn}>Send tip</button>
            <button onClick={() => setScreen("withdraw")} style={S.outlineBtn}>Withdraw</button>
            <button onClick={() => setScreen("history")} style={S.outlineBtn}>History</button>
            <button onClick={() => setScreen("referral")} style={S.outlineBtn}>Referral</button>
          </div>
          {pendingMilestones.length > 0 && (
            <div style={{ ...S.card, ...cardTheme, borderColor: "rgba(0,186,124,0.4)" }}>
              <div style={{ ...S.cardLabel, color: "#00ba7c" }}>Milestone reached</div>
              {pendingMilestones.slice(0, 2).map((p) => <div key={`${p.contentId}-${p.milestone}`} style={{ fontSize: "13px", color: T.text }}>Post crossed ${p.milestone} in tips.</div>)}
            </div>
          )}
        </div>
      )}

      {screen === "claim" && walletAddress && (
        <div style={S.stack}>
          <div style={{ ...S.pageHeader, ...pageHeaderTheme }}><button onClick={() => setScreen("dashboard")} style={S.backBtn}>Back</button><span style={S.pageTitle}>Verify X</span></div>
          <div style={{ ...S.card, ...cardTheme }}>
            {claimedUsername ? (
              <p style={{ color: T.text, fontSize: "14px" }}>Connected as @{claimedUsername}</p>
            ) : (
              <>
                <p style={{ ...S.subtitle, color: T.muted }}>Verify your X account to claim all tips sent to your posts.</p>
                <button onClick={handleClaimStart} style={S.primaryBtn}>{claimStatus === "pending" ? "Waiting for X..." : "Verify with X"}</button>
              </>
            )}
            {error && <p style={S.error}>{error}</p>}
          </div>
        </div>
      )}

      {screen === "withdraw" && walletAddress && (
        <div style={S.stack}>
          <div style={{ ...S.pageHeader, ...pageHeaderTheme }}><button onClick={() => setScreen("dashboard")} style={S.backBtn}>Back</button><span style={S.pageTitle}>Withdraw</span></div>
          <div style={{ ...S.balanceCard, ...balanceCardTheme }}><div style={{ ...S.balanceLabel, ...labelTheme }}>Tips received</div><div style={{ ...S.balanceHero, color: T.text }}>{formatUSDC(claimWalletBalance)}</div></div>
          {!claimedUsername ? (
            <div style={{ ...S.card, ...cardTheme }}><p style={{ color: T.muted, fontSize: "13px" }}>Verify X before withdrawing creator tips.</p><button onClick={() => setScreen("claim")} style={S.primaryBtn}>Verify X</button></div>
          ) : !claimWalletDeployed ? (
            <div style={{ ...S.card, ...cardTheme }}><p style={{ color: T.muted, fontSize: "13px" }}>Set up your payout account once.</p><button onClick={handleDeployClaimWallet} disabled={deployLoading} style={S.primaryBtn}>{deployLoading ? "Setting up..." : "Set up payout account"}</button></div>
          ) : (
            <div style={{ ...S.card, ...cardTheme }}><p style={{ color: T.text, fontSize: "13px" }}>Cash out your tips.</p><input value={withdrawTo} onChange={(e) => setWithdrawTo(e.target.value)} placeholder="Destination wallet" style={{ ...S.input, ...inputTheme, marginBottom: "8px" }} /><input value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} placeholder="Amount" style={{ ...S.input, ...inputTheme, marginBottom: "8px" }} /><button onClick={handleWithdraw} disabled={withdrawLoading} style={S.primaryBtn}>{withdrawLoading ? "Withdrawing..." : "Withdraw"}</button></div>
          )}
          {withdrawMsg && <p style={{ color: T.muted, fontSize: "12px" }}>{withdrawMsg}</p>}
        </div>
      )}

      {screen === "send" && walletAddress && (
        <div style={S.stack}>
          <div style={{ ...S.pageHeader, ...pageHeaderTheme }}><button onClick={() => setScreen("dashboard")} style={S.backBtn}>Back</button><span style={S.pageTitle}>Send Tip</span></div>
          <div style={{ ...S.card, ...cardTheme }}>
            <div style={{ ...S.cardLabel, ...labelTheme }}>Post URL</div>
            <input value={postUrl} onChange={(e) => setPostUrl(e.target.value)} placeholder="https://x.com/user/status/..." style={{ ...S.input, ...inputTheme, marginBottom: "10px" }} />
            <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>
              {TIP_PRESETS.map((preset) => <button key={preset} onClick={() => { setTipPreset(preset); setCustomTipAmount(""); }} style={tipPreset === preset ? S.primaryBtn : S.outlineBtn}>${preset}</button>)}
            </div>
            <input value={customTipAmount} onChange={(e) => { setCustomTipAmount(e.target.value); setTipPreset(null); }} placeholder="Custom amount" style={{ ...S.input, ...inputTheme, marginBottom: "10px" }} />
            <button onClick={handleSendTip} disabled={sendLoading} style={S.primaryBtn}>{sendLoading ? "Opening signer..." : "Continue"}</button>
            {sendMsg && <p style={{ color: T.muted, fontSize: "12px" }}>{sendMsg}</p>}
          </div>
        </div>
      )}

      {screen === "history" && walletAddress && (
        <div style={S.stack}>
          <div style={{ ...S.pageHeader, ...pageHeaderTheme }}><button onClick={() => setScreen("dashboard")} style={S.backBtn}>Back</button><span style={S.pageTitle}>History</span></div>
          {historyLoading ? <div style={{ ...S.card, ...cardTheme }}>Loading history...</div> : tipHistory.length === 0 ? <div style={{ ...S.card, ...cardTheme }}>No transactions yet.</div> : tipHistory.map((item, i) => <div key={`${item.tx_hash ?? item.timestamp}-${i}`} style={{ ...S.historyItem, ...cardTheme }}><div style={S.historyTop}><div style={{ flex: 1 }}><div style={{ ...S.historyHandle, color: T.text }}>{item.detail || item.type}</div><div style={S.historyTime}>{new Date(item.timestamp * 1000).toLocaleString()}</div></div><div style={S.historyAmount}>{formatUSDC(item.amount)}</div></div></div>)}
        </div>
      )}

      {screen === "referral" && walletAddress && (
        <div style={S.stack}>
          <div style={{ ...S.pageHeader, ...pageHeaderTheme }}><button onClick={() => setScreen("dashboard")} style={S.backBtn}>Back</button><span style={S.pageTitle}>Referral</span></div>
          <div style={{ ...S.card, ...cardTheme }}><div style={{ ...S.cardLabel, ...labelTheme }}>Your referral code</div><div style={S.addressRow}><span style={S.addressText}>{myReferralCode || "Loading..."}</span></div><p style={{ color: T.muted, fontSize: "12px" }}>Users referred: {referralStats?.referredCount ?? 0}</p></div>
          <div style={{ ...S.card, ...cardTheme }}><div style={{ ...S.cardLabel, ...labelTheme }}>Have a referral code?</div><input value={referralCode} onChange={(e) => setReferralCode(e.target.value)} placeholder="Enter code" style={{ ...S.input, ...inputTheme, marginBottom: "8px" }} /><button onClick={handleReferralSubmit} style={S.primaryBtn}>Apply</button>{referralMsg && <p style={{ color: "#00ba7c", fontSize: "12px" }}>{referralMsg}</p>}</div>
        </div>
      )}

      {isDebug() && (
        <div style={{ marginTop: "12px" }}>
          <button type="button" onClick={() => setDebugOpen(!debugOpen)} style={S.ghostBtn}>{debugOpen ? "Hide" : "Show"} debug ({debugEntries.length})</button>
          {debugOpen && <div style={{ marginTop: "8px", maxHeight: "180px", overflow: "auto", background: "#111", borderRadius: "8px", padding: "8px", fontSize: "10px", fontFamily: "monospace", color: "#8b949e" }}>{debugEntries.map((e, i) => <div key={i}>[{e.tag}] {e.message}</div>)}</div>}
        </div>
      )}
    </main>
    {screen === "dashboard" && walletAddress && (
      <footer style={{ ...S.popupFooter, background: isLight ? T.card : undefined, borderTop: `1px solid ${T.border}` }}>
        <button type="button" onClick={() => setScreen("send")} style={{ ...S.footerBtn, color: T.muted } as React.CSSProperties}>Send</button>
        <button type="button" onClick={() => setScreen("withdraw")} style={{ ...S.footerBtn, color: T.muted } as React.CSSProperties}>Withdraw</button>
        <button type="button" onClick={() => setScreen("referral")} style={{ ...S.footerBtn, color: T.muted } as React.CSSProperties}>Referral</button>
      </footer>
    )}
  </div>
);
};
/* Styles */
const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const S: Record<string, React.CSSProperties> = {
  app: { display: "flex", flexDirection: "column", minHeight: "520px", background: "#161121", color: "#e5e5e5", fontFamily: font, width: "360px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", minHeight: "40px", borderBottom: "1px solid #2d2839", background: "#161121" },
  main: { flex: 1, padding: "16px", overflowY: "auto" },
  centered: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "380px" },
  loadingText: { color: "#71767b", fontSize: "14px" },
  card: { padding: "16px", background: "#111", borderRadius: "12px", border: "1px solid #1a1a2e", marginBottom: "12px" },
  title: { fontSize: "20px", fontWeight: 700, color: "#fff", marginBottom: "6px", textAlign: "center" },
  subtitle: { fontSize: "13px", color: "#71767b", lineHeight: 1.5, marginBottom: "18px", textAlign: "center" },
  stack: { display: "flex", flexDirection: "column", gap: "12px" },
  primaryBtn: { width: "100%", padding: "12px", border: "none", borderRadius: "12px", background: "linear-gradient(135deg, #6324eb, #2563eb)", color: "#fff", fontSize: "15px", fontWeight: 700, cursor: "pointer", fontFamily: font },
  outlineBtn: { width: "100%", padding: "11px", border: "1px solid #6324eb", borderRadius: "12px", background: "transparent", color: "#8b5cf6", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: font },
  ghostBtn: { width: "100%", padding: "9px", border: "1px solid #2f3336", borderRadius: "12px", background: "transparent", color: "#71767b", fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: font },
  smallBtn: { padding: "6px 10px", border: "1px solid #6324eb", borderRadius: "8px", background: "transparent", color: "#8b5cf6", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: font },
  input: { width: "100%", padding: "10px 12px", border: "1px solid #2f3336", borderRadius: "10px", background: "#0a0a0a", color: "#e5e5e5", fontSize: "14px", fontFamily: font, outline: "none", boxSizing: "border-box" },
  error: { color: "#f4212e", fontSize: "12px", marginTop: "10px", textAlign: "center" },
  cardLabel: { fontSize: "11px", fontWeight: 700, color: "#71767b", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "8px" },
  profileRow: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" },
  profileAvatarWrap: { width: "40px", height: "40px", borderRadius: "50%", overflow: "hidden", flexShrink: 0, background: "#222" },
  profileAvatar: { width: "100%", height: "100%", objectFit: "cover" },
  profileHandle: { fontSize: "14px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  profileVerifyPrompt: { border: "none", background: "transparent", color: "#22c55e", cursor: "pointer", padding: 0, fontSize: "11px", textAlign: "left" },
  logoutBtn: { border: "none", background: "transparent", cursor: "pointer", padding: "6px", fontSize: "12px" },
  copyBtn: { flexShrink: 0, minWidth: "34px", height: "30px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #2f3336", borderRadius: "8px", background: "transparent", color: "#71767b", cursor: "pointer", padding: "0 8px", fontSize: "11px" },
  addressRow: { display: "flex", alignItems: "center", gap: "8px", background: "#0a0a0a", borderRadius: "8px", padding: "8px 10px", border: "1px solid #1a1a2e" },
  addressText: { flex: 1, fontSize: "12px", fontFamily: "monospace", color: "#e5e5e5", wordBreak: "break-all", userSelect: "all", lineHeight: 1.4 },
  balanceCard: { padding: "20px 18px", background: "linear-gradient(145deg, rgba(99,36,235,0.18), rgba(34,197,94,0.06))", borderRadius: "16px", border: "1px solid rgba(99,36,235,0.15)", width: "100%", boxSizing: "border-box" },
  balanceLabel: { fontSize: "10px", color: "#71767b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "4px" },
  balanceHero: { fontSize: "28px", fontWeight: 700, color: "#fff", lineHeight: 1.1 },
  balanceActionBtn: { flex: 1, padding: "10px", border: "1px solid #2f3336", borderRadius: "10px", background: "#0a0a0a", color: "#e5e5e5", cursor: "pointer", fontSize: "13px", fontWeight: 600 },
  balanceActions: { display: "flex", gap: "8px", marginTop: "12px" },
  pageHeader: { display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" },
  backBtn: { border: "1px solid #2f3336", borderRadius: "8px", background: "transparent", color: "#e5e5e5", padding: "6px 10px", cursor: "pointer" },
  pageTitle: { fontSize: "18px", fontWeight: 700, color: "#fff" },
  historyItem: { padding: "12px 14px", background: "#111", borderRadius: "12px", border: "1px solid #1a1a2e" },
  historyTop: { display: "flex", alignItems: "center", gap: "10px" },
  historyHandle: { fontSize: "14px", fontWeight: 600, color: "#1d9bf0" },
  historyTime: { fontSize: "11px", color: "#536471", marginTop: "2px" },
  historyAmount: { fontSize: "17px", fontWeight: 700, color: "#00ba7c", flexShrink: 0 },
  popupFooter: { display: "flex", justifyContent: "space-around", padding: "10px 12px", borderTop: "1px solid #1a1a2e", background: "#161121" },
  footerBtn: { border: "none", background: "transparent", color: "#71767b", cursor: "pointer", fontSize: "12px", fontWeight: 600, padding: "6px 8px" },
};
