import React, { useState, useEffect, useCallback } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { encodeFunctionData, parseUnits } from "viem";
import {
  buildFundingPolicy,
  getAvatarUrls,
  getTeepActivityTitle,
  getTeepActivityTypeLabel,
  isTeepActivityPositive,
} from "@teep/shared";
import { formatUSDC } from "../utils/api";
import { handleToAuthorId, parsePostUrl, computeContentId } from "../utils/contentId";
import { CONFIG, TIP_PRESETS, FACTORY_ABI, CLAIM_WALLET_ABI, REFERRAL_REGISTRY_ABI, USDC_ABI } from "../utils/config";
import { isDebug, debugLog, getDebugEntries, clearDebugEntries, addDebugListener, type DebugEntry } from "../utils/debug";
import {
  getLocalTipAggregate,
  normalizeActivityTxHash,
  sumTipSentForOwner,
} from "../utils/localTipLedger";
function buildReceiptTweetText(params: { amount: string; authorHandle: string; tweetId?: string; txHash?: string; txUrl?: string; receiptPreferences?: { shareAmountEnabled?: boolean; shareLinksEnabled?: boolean; postAwareCopyEnabled?: boolean } }): string {
  const { amount, authorHandle, tweetId, txHash, txUrl } = params;
  const handle = authorHandle.replace(/^@/, "");
  const postUrl = tweetId ? `https://x.com/${handle}/status/${tweetId}` : "";
  const receiptUrl = txUrl || (txHash ? `${CONFIG.RECEIPT_BASE_URL}/tx/${txHash}` : CONFIG.WEB_APP_URL);
  const amountPart = params.receiptPreferences?.shareAmountEnabled === false ? "" : ` $${amount}`;
  const receiptPart = `\n\nReceipt: ${receiptUrl}`;
  const line1 = postUrl
    ? `Hey @${handle}, just tipped you${amountPart} via Teep for this wonderful piece: ${postUrl}`
    : `Hey @${handle}, just tipped you${amountPart} via Teep`;
  return `${line1}${receiptPart}\nSupport creators directly.`;
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
function serializeError(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== "object") return { message: String(err) };
  const e = err as any;
  return {
    name: e.name,
    message: e.message,
    shortMessage: e.shortMessage,
    details: e.details,
    code: e.code,
    cause: e.cause
      ? {
          name: e.cause.name,
          message: e.cause.message,
          shortMessage: e.cause.shortMessage,
          details: e.cause.details,
          code: e.cause.code,
        }
      : undefined,
  };
}
function getSmartWalletInitHint(err: unknown): string {
  const raw = JSON.stringify(serializeError(err)).toLowerCase();
  if (raw.includes("getaddress") && raw.includes("returned no data")) {
    return "Privy/Alchemy is calling a smart-wallet factory that is not deployed on Arc. This is a provider chain-support issue, not a Pimlico/paymaster policy issue.";
  }
  if (raw.includes("unsupported") || raw.includes("chain")) {
    return "Privy rejected the Arc chain setup. Recheck the Arc smart-wallet chain, bundler, and paymaster settings in the Privy dashboard.";
  }
  if (raw.includes("network") || raw.includes("fetch") || raw.includes("rpc") || raw.includes("timeout")) {
    return "The Arc RPC or smart-wallet provider request failed before Pimlico saw a UserOperation.";
  }
  if (raw.includes("auth") || raw.includes("session") || raw.includes("token")) {
    return "Privy auth/session did not hydrate inside this signing window. Open the main Teep popup once, then retry the tip.";
  }
  return "The smart wallet client failed before a UserOperation was created, so this is still upstream of Pimlico.";
}
function safeAddress(address?: string): string | null {
  if (!address) return null;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
function generateReceiptImage(params: {
  amount: string;
  title: string;
  subtitle: string;
  from?: string;
  to?: string;
  txHash?: string;
  txUrl?: string;
  date: string;
  kind: string;
}): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, "#161121");
  gradient.addColorStop(0.55, "#26134b");
  gradient.addColorStop(1, "#0c1020");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1350);

  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.arc(930, 170, 260, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(34,197,94,0.12)";
  ctx.beginPath();
  ctx.arc(80, 1180, 320, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "800 58px Inter, system-ui, sans-serif";
  ctx.fillText("Teep", 80, 110);
  ctx.fillStyle = "rgba(226,232,240,0.78)";
  ctx.font = "700 28px Inter, system-ui, sans-serif";
  ctx.fillText(params.kind.toUpperCase(), 80, 155);

  ctx.fillStyle = "rgba(255,255,255,0.10)";
  roundRect(ctx, 80, 250, 920, 690, 42);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 2;
  roundRect(ctx, 80, 250, 920, 690, 42);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 104px Inter, system-ui, sans-serif";
  ctx.fillText(`$${params.amount}`, 130, 420);
  ctx.fillStyle = "#c4b5fd";
  ctx.font = "800 42px Inter, system-ui, sans-serif";
  ctx.fillText(params.title, 130, 500);
  ctx.fillStyle = "rgba(226,232,240,0.78)";
  ctx.font = "500 30px Inter, system-ui, sans-serif";
  wrapCanvasText(ctx, params.subtitle, 130, 560, 820, 42);

  const rows = [
    ["From", params.from || "Teep user"],
    ["To", params.to || "Creator"],
    ["Date", params.date],
    ["Tx", params.txHash ? `${params.txHash.slice(0, 12)}...${params.txHash.slice(-8)}` : "Pending index"],
  ];
  let y = 720;
  for (const [label, value] of rows) {
    ctx.fillStyle = "rgba(226,232,240,0.62)";
    ctx.font = "700 26px Inter, system-ui, sans-serif";
    ctx.fillText(label, 130, y);
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 30px Inter, system-ui, sans-serif";
    ctx.fillText(value, 330, y);
    y += 58;
  }

  if (params.txUrl) {
    ctx.fillStyle = "rgba(226,232,240,0.66)";
    ctx.font = "500 24px Inter, system-ui, sans-serif";
    ctx.fillText(params.txUrl.slice(0, 58), 130, 1040);
  }
  ctx.fillStyle = "#22c55e";
  ctx.font = "800 28px Inter, system-ui, sans-serif";
  ctx.fillText("Support creators directly", 80, 1220);
  ctx.fillStyle = "rgba(226,232,240,0.62)";
  ctx.font = "700 24px Inter, system-ui, sans-serif";
  ctx.fillText("Teep v0.1.0", 80, 1262);
  return canvas.toDataURL("image/png");
}

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
type Screen = "loading" | "connect" | "dashboard" | "claim" | "withdraw" | "send" | "history" | "profile" | "grow";
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
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [usdcBalance, setUsdcBalance] = useState<string>("0");
    const [totalTipped, setTotalTipped] = useState<string>("0");
    const [error, setError] = useState<string>("");
    const [copied, setCopied] = useState(false);
    const [faucetLoading, setFaucetLoading] = useState(false);
    const [faucetMsg, setFaucetMsg] = useState<string>("");
    const [claimStatus, setClaimStatus] = useState<"idle" | "pending" | "success">("idle");
    const [profileRefreshStatus, setProfileRefreshStatus] = useState<"idle" | "pending">("idle");
    const [profileRefreshMsg, setProfileRefreshMsg] = useState("");
    const [socialXHandle, setSocialXHandle] = useState("");
    const [socialXHandleSaved, setSocialXHandleSaved] = useState("");
    const [socialXHandleMsg, setSocialXHandleMsg] = useState("");
    const [socialXHandleSaving, setSocialXHandleSaving] = useState(false);
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
      type: "tip_sent" | "direct_creator_tip" | "tip_received" | "send" | "withdraw" | "withdraw_balance" | "referral_fee_received" | "deposit" | "funding";
      amount: string;
      tx_hash?: string;
      timestamp: number;
      author_handle?: string;
      tweet_id?: string;
      from_addr?: string;
      fromAddress?: string;
      to_address?: string;
      detail?: string;
      local?: boolean;
    }
    const [tipHistory, setTipHistory] = useState<HistoryItem[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [receiptMsg, setReceiptMsg] = useState<string>("");
    const [hoveredActivityAction, setHoveredActivityAction] = useState<string | null>(null);
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
    const fundingPolicy = buildFundingPolicy({
      environment: CONFIG.FUNDING_ENV,
      faucetUrl: CONFIG.FAUCET_URL,
      fiatOnrampUrl: CONFIG.ONRAMP_URL,
      fiatOfframpUrl: CONFIG.OFFRAMP_URL,
      enableFiatOnramp: CONFIG.ENABLE_FIAT_ONRAMP,
      enableFiatOfframp: CONFIG.ENABLE_FIAT_OFFRAMP,
    });
    const [arcSmartWalletClient, setArcSmartWalletClient] = useState<any>(null);
    const effectiveSmartWalletClient = arcSmartWalletClient || smartWalletClient;

    useEffect(() => {
      if (!ready || !authenticated) {
        setArcSmartWalletClient(null);
        return;
      }
      if (smartWalletClient?.account?.address) {
        setArcSmartWalletClient(smartWalletClient);
        return;
      }

      let cancelled = false;
      debugLog("SmartWallet", "Requesting Arc smart wallet client", {
        chainId: CONFIG.CHAIN_ID,
        chainName: CONFIG.CHAIN_NAME,
        walletCount: wallets.length,
        embeddedWallet: safeAddress(embeddedWallet?.address),
      });

      getClientForChain({ id: CONFIG.CHAIN_ID })
        .then((client) => {
          if (!cancelled && client?.account?.address) {
            setArcSmartWalletClient(client);
            debugLog("SmartWallet", "Arc smart wallet client ready", {
              account: safeAddress(client.account.address),
              chainId: CONFIG.CHAIN_ID,
            });
          }
        })
        .catch((err) => {
          if (cancelled) return;
          const context = {
            chainId: CONFIG.CHAIN_ID,
            chainName: CONFIG.CHAIN_NAME,
            walletCount: wallets.length,
            embeddedWallet: safeAddress(embeddedWallet?.address),
            error: serializeError(err),
            hint: getSmartWalletInitHint(err),
          };
          debugLog("SmartWallet", "getClientForChain failed", context);
        });

      return () => {
        cancelled = true;
      };
    }, [ready, authenticated, smartWalletClient, getClientForChain, wallets.length, embeddedWallet?.address]);

    // Use Privy's smart wallet address (smart contract account) for balances and sponsored transactions.
    // Falls back to embedded wallet only while the smart wallet is hydrating.
    const walletAddress = effectiveSmartWalletClient?.account?.address || embeddedWallet?.address || null;
    const createWalletProof = useCallback(async (purpose: string) => {
      if (!walletAddress || !effectiveSmartWalletClient) {
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
      const signature = await effectiveSmartWalletClient.signMessage({
        account: effectiveSmartWalletClient.account,
        message: challenge.message,
      } as any);
      return { message: challenge.message, signature };
    }, [walletAddress, effectiveSmartWalletClient]);
  // NORMAL MODE â€” Regular popup dashboard
  // ============================================================
  // React to Privy auth state â€” delay showing "connect" so returning users see loading then dashboard, not welcome flash
  useEffect(() => {
    if (!ready) return;
    const smartAddress = effectiveSmartWalletClient?.account?.address;
    if (authenticated && smartAddress) {
      chrome.runtime.sendMessage({
        type: "WALLET_CONNECTED",
        payload: { address: smartAddress },
      });
      setScreen("dashboard");
      return;
    }
    const t = setTimeout(() => {
      if (!authenticated) setScreen("connect");
    }, 450);
    return () => clearTimeout(t);
  }, [ready, authenticated, effectiveSmartWalletClient?.account?.address]);
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
        setProfileRefreshStatus("idle");
        setProfileRefreshMsg("");
        if (screen === "claim") {
          setScreen("dashboard");
        }
      }
    } catch (err) {
      debugLog("ClaimStatus", "Failed to check claim status", serializeError(err));
    }
  }, [screen]);
  // Check claim status on mount and when wallet connects
  useEffect(() => {
    if (walletAddress) {
      checkClaimStatus(walletAddress);
    }
  }, [walletAddress, checkClaimStatus]);
  useEffect(() => {
    const listener = (message: any) => {
      if (message?.type === "CLAIM_VERIFIED" && walletAddress) {
        checkClaimStatus(walletAddress);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
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

      if (CONFIG.REFERRAL_REGISTRY_ADDRESS && effectiveSmartWalletClient && data.referrer) {
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
            await effectiveSmartWalletClient.sendTransaction({
              calls: [{ to: CONFIG.REFERRAL_REGISTRY_ADDRESS, data: setReferrerData }],
              chain: CONFIG.CHAIN,
              account: effectiveSmartWalletClient.account,
            } as any);
            setReferrerStatus((prev) => (prev ? { ...prev, hasReferrerOnChain: true } : prev));
          }
        } catch (e) {
          debugLog("Referral", "setReferrer tx failed (referral still linked in DB)", serializeError(e));
          setReferralMsg("Referral linked. On-chain referral setup failed; try again later.");
          return;
        }
      }

      setReferralMsg(data.alreadyLinked ? "Already linked." : "Referral code applied.");
    } catch (err: any) {
      setReferralMsg(err?.message || "Could not apply referral code.");
    }
  }, [walletAddress, referralCode, createWalletProof, effectiveSmartWalletClient]);

  const loadBalanceForDisplay = useCallback(() => {
    const primary = effectiveSmartWalletClient?.account?.address || embeddedWallet?.address;
    debugLog("Balance", "loadBalanceForDisplay", {
      primary: primary ?? null,
      fromSmartWallet: !!effectiveSmartWalletClient?.account?.address,
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
      .then((data) => {
        const indexedTotal = BigInt(data?.totalSent || "0");
        chrome.storage.local.get(["localTipActivity"], (stored) => {
          const localActivity = Array.isArray(stored.localTipActivity) ? stored.localTipActivity : [];
          const indexedTxs = new Set<string>((data?.tips || []).map((tip: any) => normalizeActivityTxHash(tip)).filter(Boolean));
          const optimisticTotal = sumTipSentForOwner(localActivity, primary, indexedTxs);
          getLocalTipAggregate(primary).then((localAggregate) => {
            const reconstructedTotal = indexedTotal + optimisticTotal;
            setTotalTipped((localAggregate > reconstructedTotal ? localAggregate : reconstructedTotal).toString());
          });
        });
      })
      .catch(() => {
        chrome.storage.local.get(["localTipActivity"], (stored) => {
          const localActivity = Array.isArray(stored.localTipActivity) ? stored.localTipActivity : [];
          const fallbackTotal = sumTipSentForOwner(localActivity, primary);
          getLocalTipAggregate(primary).then((localAggregate) => {
            const total = localAggregate > fallbackTotal ? localAggregate : fallbackTotal;
            if (total > 0n) setTotalTipped(total.toString());
          });
        });
      });
  }, [embeddedWallet?.address, effectiveSmartWalletClient?.account?.address]);
        // On reopen, load balance only from the resolved Arc smart wallet.
        // Older extension sessions may have stored the embedded EOA or Coinbase SCA address.
        useEffect(() => {
          const addr = effectiveSmartWalletClient?.account?.address;
          if (!authenticated || !addr) return;
          debugLog("Balance", "Reopen: using resolved Arc smart wallet", { address: safeAddress(addr) });
          chrome.storage.local.set({ walletState: { address: addr, isConnected: true } });
        }, [authenticated, effectiveSmartWalletClient?.account?.address]);
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
        const calculateTotalTippedFromHistory = useCallback((history: HistoryItem[]) => {
          return history.reduce((sum, item) => {
            if (item.type !== "tip_sent" && item.type !== "direct_creator_tip") return sum;
            try {
              return sum + BigInt(item.amount || "0");
            } catch {
              return sum;
            }
          }, 0n);
        }, []);

        // Load transaction history from backend-confirmed records.
        const loadHistory = useCallback(async (address: string) => {
          setHistoryLoading(true);
          let backendHistory: HistoryItem[] = [];
          try {
            const res = await fetch(`${CONFIG.API_BASE_URL}/tips/history/${address}?limit=50`);
            const data = await res.json();
            if (data?.history) backendHistory = data.history;
          } catch {
            // silent
          }
          const timestampSeconds = (value: number) => value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value || 0);
          const normalizedHistory = backendHistory.map((item) => ({
            ...item,
            timestamp: timestampSeconds(item.timestamp),
          }));
          setTipHistory(normalizedHistory.sort((a, b) => b.timestamp - a.timestamp).slice(0, 50));
          setTotalTipped(calculateTotalTippedFromHistory(backendHistory).toString());
          setHistoryLoading(false);
        }, [calculateTotalTippedFromHistory]);
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
        // Load referral stats and referrer status (applied code) when profile is open.
        useEffect(() => {
          if (screen !== "profile" || !walletAddress) return;
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

          useEffect(() => {
            if (screen !== "profile" || !walletAddress) return;
            let cancelled = false;
            fetch(`${CONFIG.API_BASE_URL}/wallet/${walletAddress}/settings`)
              .then((r) => r.json())
              .then((data) => {
                if (cancelled) return;
                const handle = data?.socialXHandle || "";
                setSocialXHandle(handle);
                setSocialXHandleSaved(handle);
                setSocialXHandleMsg("");
              })
              .catch(() => {
                if (!cancelled) setSocialXHandleMsg("Could not load your social handle.");
              });
            return () => { cancelled = true; };
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
            if (!fundingPolicy.providers.faucet.enabled || !fundingPolicy.providers.faucet.url) {
              setFaucetMsg(fundingPolicy.providers.faucet.disabledReason || "Faucet funding is not available.");
              setTimeout(() => setFaucetMsg(""), 5000);
              return;
            }
            setFaucetLoading(true);
            setFaucetMsg("Copying wallet address...");
            try {
              await navigator.clipboard.writeText(walletAddress);
              setCopied(true);
              setFaucetMsg("Address copied. Opening Circle faucet...");
              setTimeout(() => setCopied(false), 1500);
              setTimeout(() => {
                window.open(fundingPolicy.providers.faucet.url, "_blank", "noopener,noreferrer");
              }, 450);
            } catch (err: any) {
              setFaucetMsg(err.message || "Could not copy address");
            }
            setFaucetLoading(false);
            setTimeout(() => setFaucetMsg(""), 5000);
          }, [walletAddress, fundingPolicy]);
          const handleReceiveCrypto = useCallback(async () => {
            if (!walletAddress) return;
            try {
              await navigator.clipboard.writeText(walletAddress);
              setCopied(true);
              setFaucetMsg("Wallet address copied.");
              setTimeout(() => setCopied(false), 1500);
            } catch (err: any) {
              setFaucetMsg(err.message || "Could not copy address");
            }
            setTimeout(() => setFaucetMsg(""), 4000);
          }, [walletAddress]);
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

  const handleRefreshXProfile = useCallback(async () => {
    if (!walletAddress || !claimedAuthorId) return;
    setError("");
    setProfileRefreshMsg("");
    setProfileRefreshStatus("pending");
    try {
      const res = await fetch(`${CONFIG.API_BASE_URL}/auth/x/refresh-profile/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerAddress: walletAddress, authorId: claimedAuthorId }),
      });
      const data = await res.json();
      if (!res.ok || !data.authUrl) {
        throw new Error(data.error || "Could not start X profile refresh");
      }
      setProfileRefreshMsg("Complete the X check, then return here.");
      chrome.tabs.create({ url: data.authUrl });
    } catch (err: any) {
      setError(err?.message || "Could not refresh X profile");
      setProfileRefreshStatus("idle");
    }
  }, [walletAddress, claimedAuthorId]);

  const handleSaveSocialXHandle = useCallback(async () => {
    if (!walletAddress) return;
    const normalized = socialXHandle.trim().replace(/^@/, "").toLowerCase();
    if (normalized && !/^[a-z0-9_]{1,15}$/.test(normalized)) {
      setSocialXHandleMsg("Use a valid X handle without spaces.");
      return;
    }
    setSocialXHandleSaving(true);
    setSocialXHandleMsg("");
    try {
      const walletProof = await createWalletProof("account-settings");
      const res = await fetch(`${CONFIG.API_BASE_URL}/wallet/${walletAddress}/social-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ socialXHandle: normalized, walletProof }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not save social handle");
      const saved = data?.socialXHandle || "";
      setSocialXHandle(saved);
      setSocialXHandleSaved(saved);
      setSocialXHandleMsg(saved ? "Social handle saved." : "Social handle removed.");
    } catch (err: any) {
      setSocialXHandleMsg(err?.message || "Could not save social handle.");
    } finally {
      setSocialXHandleSaving(false);
    }
  }, [walletAddress, socialXHandle, createWalletProof]);
  // Deploy claim wallet on-chain using the attestation from backend
  const handleDeployClaimWallet = useCallback(async () => {
    if (!walletAddress || !effectiveSmartWalletClient || !claimedUsername) return;
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
      // 3. Send via Privy smart wallet (gas sponsored by configured provider)
      const txHash = await effectiveSmartWalletClient.sendTransaction({
        to: CONFIG.WALLET_FACTORY_ADDRESS,
        data: calldata,
        chain: CONFIG.CHAIN,
        account: effectiveSmartWalletClient.account,
      });
      debugLog("ClaimWallet", "Claim wallet deployed", { txHash });
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
  }, [walletAddress, effectiveSmartWalletClient, claimedUsername, loadClaimWalletInfo, createWalletProof, claimedAuthorId]);
  // Withdraw USDC from claim wallet with fee split (net to user, fee to protocol + optional referrer)
  const handleWithdraw = useCallback(async () => {
    if (!walletAddress || !effectiveSmartWalletClient || !claimWalletAddress) return;
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
        `${CONFIG.API_BASE_URL}/withdrawal/breakdown?ownerAddress=${encodeURIComponent(walletAddress)}&amountRaw=${rawAmount.toString()}&source=tipsEarned`
      );
      const breakdown = await breakdownRes.json();
      if (!breakdownRes.ok) {
        setWithdrawMsg(breakdown.error || "Failed to get fee breakdown");
        setWithdrawLoading(false);
        return;
      }
      const confirmationProof = await createWalletProof("withdrawal");
      const confirmationRes = await fetch(`${CONFIG.API_BASE_URL}/withdrawal/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ownerAddress: walletAddress,
          destinationAddress: withdrawTo,
          source: "tipsEarned",
          amountRaw: rawAmount.toString(),
          email: user?.email?.address,
          walletProof: confirmationProof,
        }),
      });
      const confirmation = await confirmationRes.json();
      if (!confirmationRes.ok || !confirmation.requestId) {
        setWithdrawMsg(confirmation.error || "Could not prepare withdrawal confirmation");
        setWithdrawLoading(false);
        return;
      }
      const confirmationCode = confirmation.devCode || window.prompt("Enter the withdrawal confirmation code sent to your email.");
      if (!confirmationCode) {
        setWithdrawMsg("Withdrawal confirmation cancelled");
        setWithdrawLoading(false);
        return;
      }
      const confirmRes = await fetch(`${CONFIG.API_BASE_URL}/withdrawal/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: confirmation.requestId, code: confirmationCode, claimWalletAddress }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok || !confirmData.confirmed) {
        setWithdrawMsg(confirmData.error || "Could not confirm withdrawal");
        setWithdrawLoading(false);
        return;
      }
      // When registry is configured, contract does fee/referrer split in one tx (withdrawWithFee). Otherwise legacy multi-call.
      const useWithdrawWithFee = !!CONFIG.REFERRAL_REGISTRY_ADDRESS;
      let txHash: string;
      if (useWithdrawWithFee) {
        const auth = confirmData.withdrawalAuthorization;
        const data = encodeFunctionData({
          abi: CLAIM_WALLET_ABI,
          functionName: auth ? "withdrawWithAuthorization" : "withdrawWithFee",
          args: auth
            ? [
                CONFIG.USDC_ADDRESS,
                withdrawTo as `0x${string}`,
                rawAmount,
                BigInt(auth.expiresAt),
                auth.nonce as `0x${string}`,
                auth.signature as `0x${string}`,
              ]
            : [CONFIG.USDC_ADDRESS, withdrawTo as `0x${string}`, rawAmount],
        }) as `0x${string}`;
        txHash = await effectiveSmartWalletClient.sendTransaction({
          calls: [{ to: claimWalletAddress as `0x${string}`, data }],
          chain: CONFIG.CHAIN,
          account: effectiveSmartWalletClient.account,
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
        txHash = await effectiveSmartWalletClient.sendTransaction({
          calls,
          chain: CONFIG.CHAIN,
          account: effectiveSmartWalletClient.account,
        } as any);
      }
      debugLog("Withdraw", "Withdrawal tx sent", { txHash });
      try {
        const recordProof = await createWalletProof("withdrawal");
        await fetch(`${CONFIG.API_BASE_URL}/withdrawal/record`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: confirmation.requestId,
            ownerAddress: walletAddress,
            txHash,
            walletProof: recordProof,
          }),
        });
      } catch {}
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
    debugLog("Withdraw", "Withdraw error", serializeError(err));
    setWithdrawMsg(err.shortMessage || err.message || "Withdrawal failed");
  }
  setWithdrawLoading(false);
}, [walletAddress, effectiveSmartWalletClient, claimWalletAddress, claimWalletBalance, withdrawTo, withdrawAmount, user?.email?.address, createWalletProof, loadClaimWalletInfo, loadBalanceForDisplay]);
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
const shortWallet = walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "No wallet";
const displayName = claimedUsername ? `@${claimedUsername}` : user?.email?.address || shortWallet;
const avatarUrls = getAvatarUrls(claimedUsername ?? "", displayName);
const appTone = getTone(isLight);
const cardTheme = isLight ? { background: T.card, border: `1px solid ${T.borderCard}`, color: T.text, boxShadow: "0 2px 10px rgba(15,23,42,0.04)" } : {};
const inputTheme = isLight ? { background: "#fff", color: T.text, border: `1px solid ${T.border}` } : {};
const totalEarnedDisplay = formatUSDC(totalEarnedRaw || claimWalletBalance || "0");
const totalTippedDisplay = formatUSDC(totalTipped || "0");
const openWithdrawFlow = useCallback(() => {
  setScreen(claimedUsername ? "withdraw" : "claim");
}, [claimedUsername]);

const iconPath = {
  add: "M12 5v14M5 12h14",
  send: "M5 12h14M13 5l7 7-7 7",
  moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
  sun: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  settings: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.8a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.8a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.4.1.75.3 1 .6.3.28.46.68.46 1.1v.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.36.2z",
  wallet: "M3 7h18v12H3zM16 12h4M6 7V5h12v2",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 8v6M23 11h-6",
  leaf: "M11 20A7 7 0 0 1 4 13c0-7 7-10 16-10 0 9-3 16-10 16-2 0-4-1-5-3M4 20c4-7 9-10 16-17",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 1 1 5.8 1c0 2-3 2.5-3 4M12 17h.01",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  back: "M19 12H5M12 19l-7-7 7-7",
  share: "M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13",
  receipt: "M6 2h12v20l-3-2-3 2-3-2-3 2V2zM9 7h6M9 11h6M9 15h4",
};
const Icon = ({ name, size = 20, color = "currentColor" }: { name: keyof typeof iconPath; size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={iconPath[name]} />
  </svg>
);

const formatActivityAmount = (item: HistoryItem) => {
  const value = formatUSDC(item.amount || "0");
  const positive = isTeepActivityPositive(item.type);
  return `${positive ? "+" : "-"}${value}`;
};
const formatActivityTitle = (item: HistoryItem) => {
  return getTeepActivityTitle(item);
};
const formatActivityTime = (timestamp: number) => {
  if (!timestamp) return "Just now";
  const millis = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
  return new Date(millis).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
const getActivityTxUrl = (item: HistoryItem) => item.tx_hash ? `${CONFIG.EXPLORER_TX_URL}/${item.tx_hash}` : undefined;
const getActivityReceiptUrl = (item: HistoryItem) => item.tx_hash ? `${CONFIG.RECEIPT_BASE_URL}/tx/${item.tx_hash}` : CONFIG.WEB_APP_URL;
const getActivityCounterparty = (item: HistoryItem) => {
  if (item.author_handle) return `@${item.author_handle.replace(/^@/, "")}`;
  if (item.to_address) return safeAddress(item.to_address) || "Destination";
  if (item.from_addr || item.fromAddress) return safeAddress(item.from_addr || item.fromAddress) || "Teep user";
  return "Teep user";
};
const buildActivityTweet = (item: HistoryItem) => {
  const amount = formatUSDC(item.amount || "0").replace(/^\$/, "");
  if ((item.type === "tip_sent" || item.type === "direct_creator_tip") && item.author_handle) {
    return buildReceiptTweetText({
      amount,
      authorHandle: item.author_handle,
      tweetId: item.tweet_id,
      txHash: item.tx_hash,
      txUrl: getActivityReceiptUrl(item),
    });
  }
  const verb = item.type === "withdraw" || item.type === "withdraw_balance" ? "withdrew" : item.type === "tip_received" ? "received" : "recorded";
  return `I ${verb} ${formatUSDC(item.amount || "0")} on Teep.\n\nReceipt: ${getActivityReceiptUrl(item)}\nSupport creators directly.`;
};
const shareActivityOnX = (item: HistoryItem) => {
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(buildActivityTweet(item))}`;
  chrome.tabs?.create ? chrome.tabs.create({ url }) : window.open(url, "_blank", "noopener,noreferrer");
};
const generateActivityReceipt = (item: HistoryItem) => {
  const amount = formatUSDC(item.amount || "0").replace(/^\$/, "");
  const counterparty = getActivityCounterparty(item);
  const title = getTeepActivityTypeLabel(item.type);
  const imageUrl = generateReceiptImage({
    amount,
    title,
    subtitle: formatActivityTitle(item),
    from: safeAddress(item.from_addr || item.fromAddress) || (item.type === "tip_sent" ? "You" : "Teep user"),
    to: counterparty,
    txHash: item.tx_hash,
    txUrl: getActivityTxUrl(item),
    date: formatActivityTime(item.timestamp),
    kind: item.type.replace(/_/g, " "),
  });
  const link = document.createElement("a");
  link.href = imageUrl;
  link.download = `teep-receipt-${item.tx_hash?.slice(0, 10) || Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setReceiptMsg("Receipt card generated.");
  setTimeout(() => setReceiptMsg(""), 2400);
};
const renderActivityCard = (item: HistoryItem, index: number, compact = false) => {
  const positive = isTeepActivityPositive(item.type);
  const urls = getAvatarUrls(item.author_handle ?? "", item.author_handle || formatActivityTitle(item));
  return (
    <div key={`${item.tx_hash ?? item.timestamp}-${index}`} style={{ ...S.activityCard, ...(compact ? S.activityCardCompact : {}), background: appTone.card, borderColor: appTone.border, boxShadow: appTone.cardShadow }}>
      <div style={S.activityLeft}>
        {item.author_handle ? <img src={urls.primary} alt="" style={S.activityAvatar} onError={(e) => { e.currentTarget.src = urls.fallback; e.currentTarget.onerror = null; }} /> : <div style={S.walletAvatar}><Icon name="wallet" size={18} color={T.primary} /></div>}
        <div style={{ minWidth: 0 }}>
          <div style={{ ...S.activityTitle, color: T.text }}>{formatActivityTitle(item)}</div>
          <div style={{ ...S.activityTime, color: T.muted }}>{formatActivityTime(item.timestamp)}</div>
        </div>
      </div>
      <div style={S.activityRight}>
        <div style={{ ...S.activityAmount, color: positive ? T.success : T.text }}>{formatActivityAmount(item)}</div>
        <div style={S.activityActions}>
          <button
            type="button"
            onClick={() => shareActivityOnX(item)}
            onMouseEnter={() => setHoveredActivityAction(`share-${item.tx_hash ?? item.timestamp}-${index}`)}
            onMouseLeave={() => setHoveredActivityAction(null)}
            style={{
              ...S.activityActionBtn,
              color: hoveredActivityAction === `share-${item.tx_hash ?? item.timestamp}-${index}` ? T.primary : T.muted,
            }}
            title="Share to X"
          >
            <Icon name="share" size={12} />
            Share
          </button>
          <button
            type="button"
            onClick={() => generateActivityReceipt(item)}
            onMouseEnter={() => setHoveredActivityAction(`receipt-${item.tx_hash ?? item.timestamp}-${index}`)}
            onMouseLeave={() => setHoveredActivityAction(null)}
            style={{
              ...S.activityActionBtn,
              color: hoveredActivityAction === `receipt-${item.tx_hash ?? item.timestamp}-${index}` ? T.primary : T.muted,
            }}
            title="Generate receipt"
          >
            <Icon name="receipt" size={12} />
            Receipt
          </button>
        </div>
      </div>
    </div>
  );
};
const recentActivity = tipHistory.slice(0, 2);

if (!ready) {
  return (
    <div style={{ ...S.app, background: T.bg, color: T.text }}>
      <main style={{ ...S.main, minHeight: "520px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ ...S.centered, minHeight: "320px" }}>
          <p style={{ ...S.loadingText, color: T.text, fontSize: "15px", marginBottom: "8px" }}>Loading Teep...</p>
          <p style={{ color: T.muted, fontSize: "12px", marginBottom: "12px" }}>
            {loadTimeout ? "Taking longer than usual." : "If this takes too long, close and reopen the popup."}
          </p>
          {loadTimeout && <button onClick={() => window.location.reload()} style={S.primaryBtn}>Reload popup</button>}
        </div>
      </main>
    </div>
  );
}

if (!authenticated || screen === "connect") {
  return (
    <div style={{ ...S.app, background: T.bg, color: T.text }}>
      <main style={{ ...S.main, minHeight: "520px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ ...S.card, ...cardTheme, textAlign: "center" as const }}>
          <div style={{ fontSize: "36px", marginBottom: "8px" }}>$</div>
          <div style={{ ...S.title, color: T.text }}>Teep</div>
          <p style={{ ...S.subtitle, color: T.muted }}>Sign up with email. Tip creators without thinking about wallets.</p>
          <button onClick={() => login()} style={S.primaryBtn}>Sign up / Log in</button>
          {error && <p style={S.error}>{error}</p>}
        </div>
      </main>
    </div>
  );
}

if (!effectiveSmartWalletClient?.account?.address) {
  return (
    <div style={{ ...S.app, background: T.bg, color: T.text }}>
      <main style={{ ...S.main, minHeight: "520px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ ...S.card, ...cardTheme, textAlign: "center" as const }}>
          <p style={{ ...S.loadingText, color: T.muted }}>Getting Teep ready...</p>
        </div>
      </main>
    </div>
  );
}

return (
  <div style={{ ...S.app, background: T.bg, color: T.text }}>
    <header style={{ ...S.topBar, background: appTone.header, borderBottom: `1px solid ${appTone.border}` }}>
      <div style={S.profileCluster}>
        <div style={S.avatarRing}>
          <img src={avatarUrls.primary} alt="" style={S.profileAvatar} onError={(e) => { e.currentTarget.src = avatarUrls.fallback; e.currentTarget.onerror = null; }} />
          <span style={{ ...S.onlineDot, borderColor: appTone.header }} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ ...S.profileHandle, color: T.text }}>{displayName}</div>
          <button type="button" onClick={() => setScreen("claim")} style={S.connectedPill}>
            <span style={S.connectedDot} /> {claimedUsername ? "X connected" : "Verify X"}
          </button>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", position: "relative" }}>
        <button type="button" onClick={toggleTheme} style={{ ...S.iconButton, color: T.muted }} title={theme === "dark" ? "Switch to light" : "Switch to dark"}>
          <Icon name={theme === "dark" ? "sun" : "moon"} size={20} />
        </button>
        <button onClick={() => setSettingsOpen((open) => !open)} style={{ ...S.iconButton, color: T.muted }} title="Settings">
          <Icon name="settings" size={22} />
        </button>
        {settingsOpen && (
          <div style={{ ...S.settingsMenu, background: appTone.card, borderColor: appTone.border, boxShadow: appTone.cardShadow }}>
            <button type="button" onClick={() => { setSettingsOpen(false); setScreen("profile"); }} style={{ ...S.settingsItem, color: T.text }}>
              Profile
            </button>
            <button type="button" onClick={() => { setSettingsOpen(false); handleDisconnect(); }} style={{ ...S.settingsItem, color: T.text }}>
              Log out
            </button>
          </div>
        )}
      </div>
    </header>

    <main style={{ ...S.main, background: T.bg }}>
      {showTestnetWarning && (
        <div style={{ ...S.card, ...cardTheme, borderColor: "rgba(246,166,35,0.35)", marginBottom: "12px" }}>
          <p style={{ color: T.text, fontSize: "13px", marginBottom: "10px" }}>Teep is running on Arc testnet.</p>
          <button onClick={() => { chrome.storage.local.set({ teepTestnetWarningSeen: true }); setTestnetWarningSeen(true); setShowTestnetWarning(false); }} style={S.smallBtn}>Got it</button>
        </div>
      )}

      {screen === "dashboard" && (
        <div style={S.dashboardStack}>
          <section style={{ ...S.heroBalance, background: appTone.hero, borderColor: appTone.heroBorder, boxShadow: appTone.heroShadow }}>
            <div style={{ ...S.balanceLabel, color: isLight ? "#667085" : "rgba(148,163,184,0.72)" }}>Tip Balance</div>
            <div style={{ ...S.balanceHero, color: T.text }}>{formatUSDC(usdcBalance)}</div>
            <div style={S.heroActions}>
              <button onClick={() => setAddFundsOpen(!addFundsOpen)} style={{ ...S.moneyButton, background: T.success, boxShadow: isLight ? "0 10px 18px rgba(34,197,94,0.18)" : "none" }}>
                <Icon name="add" size={18} color="#fff" /> Add Money
              </button>
              <button onClick={() => setScreen("send")} style={{ ...S.moneyButton, background: T.primary, boxShadow: isLight ? "0 10px 18px rgba(99,36,235,0.18)" : "none" }}>
                <Icon name="send" size={18} color="#fff" /> Send Tip
              </button>
            </div>
          </section>

          {addFundsOpen && (
            <section style={{ ...S.card, ...cardTheme }}>
              <div style={{ ...S.cardLabel, color: T.muted }}>Add Money</div>
              <div style={S.fundOptionStack}>
                <button
                  type="button"
                  onClick={() => {
                    if (fundingPolicy.providers.fiatOnramp.enabled && fundingPolicy.providers.fiatOnramp.url) {
                      window.open(fundingPolicy.providers.fiatOnramp.url, "_blank", "noopener,noreferrer");
                      return;
                    }
                    setFaucetMsg(fundingPolicy.providers.fiatOnramp.disabledReason || "Card and bank funding is not available yet.");
                  }}
                  style={{ ...S.fundOption, background: appTone.input, borderColor: appTone.border, color: T.muted, opacity: fundingPolicy.providers.fiatOnramp.enabled ? 1 : 0.55, cursor: fundingPolicy.providers.fiatOnramp.enabled ? "pointer" : "not-allowed" }}
                  title={fundingPolicy.providers.fiatOnramp.enabled ? fundingPolicy.providers.fiatOnramp.description : "Coming soon"}
                >
                  <span style={S.fundOptionText}>
                    <strong style={{ color: T.text }}>{fundingPolicy.providers.fiatOnramp.label}</strong>
                    <small style={{ color: T.muted }}>{fundingPolicy.providers.fiatOnramp.description}</small>
                  </span>
                  <span style={{ color: T.muted }}>{fundingPolicy.providers.fiatOnramp.enabled ? "Open" : "Soon"}</span>
                </button>
                <button
                  type="button"
                  onClick={handleFaucet}
                  disabled={faucetLoading || !fundingPolicy.providers.faucet.enabled}
                  style={{ ...S.fundOption, background: appTone.input, borderColor: appTone.border, color: T.text, opacity: fundingPolicy.providers.faucet.enabled ? 1 : 0.55, cursor: fundingPolicy.providers.faucet.enabled ? "pointer" : "not-allowed" }}
                >
                  <span style={S.fundOptionText}>
                    <strong>{fundingPolicy.providers.faucet.label}</strong>
                    <small style={{ color: T.muted }}>{fundingPolicy.providers.faucet.description}</small>
                  </span>
                  <span style={{ color: T.primary }}>{faucetLoading ? "..." : "Open"}</span>
                </button>
                <button
                  type="button"
                  onClick={handleReceiveCrypto}
                  style={{ ...S.fundOption, background: appTone.input, borderColor: appTone.border, color: T.text }}
                >
                  <span style={S.fundOptionText}>
                    <strong>{fundingPolicy.providers.cryptoReceive.label}</strong>
                    <small style={{ color: T.muted }}>{fundingPolicy.providers.cryptoReceive.description}</small>
                  </span>
                  <span style={{ color: T.primary }}>{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>
              <p style={{ color: T.muted, fontSize: "11px", lineHeight: 1.4, margin: "10px 0 0" }}>{fundingPolicy.testnetCopy}</p>
              {faucetMsg && <p style={{ color: faucetMsg.toLowerCase().includes("could not") ? "#f4212e" : T.success, fontSize: "12px", margin: "10px 0 0" }}>{faucetMsg}</p>}
            </section>
          )}

          {!addFundsOpen && (
            <>
              <section style={S.sectionStack}>
                <h4 style={{ ...S.sectionTitle, color: isLight ? "#667085" : "rgba(148,163,184,0.70)" }}>Your Impact</h4>
                <div style={S.impactGrid}>
                  <div style={{ ...S.impactCard, background: appTone.card, borderColor: appTone.border, boxShadow: appTone.cardShadow }}>
                    <div style={{ ...S.impactLabel, color: T.muted }}>Total Earned</div>
                    <div style={{ ...S.impactValue, color: T.text }}>{totalEarnedDisplay}</div>
                  </div>
                  <div style={{ ...S.impactCard, background: appTone.card, borderColor: appTone.border, boxShadow: appTone.cardShadow }}>
                    <div style={{ ...S.impactLabel, color: T.muted }}>Total Tipped</div>
                    <div style={{ ...S.impactValue, color: T.text }}>{totalTippedDisplay}</div>
                  </div>
                </div>
              </section>

              {pendingMilestones.length > 0 && (
                <section style={{ ...S.card, ...cardTheme, borderColor: "rgba(0,186,124,0.4)", marginBottom: 0 }}>
                  <div style={{ ...S.cardLabel, color: T.success }}>Milestone reached</div>
                  {pendingMilestones.slice(0, 2).map((p) => <div key={`${p.contentId}-${p.milestone}`} style={{ fontSize: "13px", color: T.text }}>Post crossed ${p.milestone} in tips.</div>)}
                </section>
              )}

              <section style={S.sectionStack}>
                <div style={S.sectionHeader}>
                <h4 style={{ ...S.sectionTitle, color: isLight ? "#667085" : "rgba(148,163,184,0.70)" }}>Recent Activity</h4>
                  <button onClick={() => setScreen("history")} style={S.viewAllBtn}>View All</button>
                </div>
                <div style={S.activityStack}>
                  {historyLoading ? (
                    <div style={{ ...S.activityCard, background: appTone.card, borderColor: appTone.border, color: T.muted }}>Loading activity...</div>
                  ) : recentActivity.length === 0 ? (
                    <div style={{ ...S.activityCard, background: appTone.card, borderColor: appTone.border, color: T.muted }}>No transactions yet.</div>
                  ) : recentActivity.map((item, index) => renderActivityCard(item, index, true))}
                </div>
                {receiptMsg && <p style={{ color: T.success, fontSize: "11px", margin: "0" }}>{receiptMsg}</p>}
              </section>
            </>
          )}
        </div>
      )}

      {screen === "claim" && (
        <SubPage title="Verify X" onBack={() => setScreen("dashboard")} T={T} Icon={Icon}>
          <div style={{ ...S.card, ...cardTheme }}>
            {claimedUsername ? <p style={{ color: T.text, fontSize: "14px" }}>Connected as @{claimedUsername}</p> : <><p style={{ ...S.subtitle, color: T.muted }}>Verify your X account to claim all tips sent to your posts.</p><button onClick={handleClaimStart} style={S.primaryBtn}>{claimStatus === "pending" ? "Waiting for X..." : "Verify with X"}</button></>}
            {error && <p style={S.error}>{error}</p>}
          </div>
        </SubPage>
      )}

      {screen === "withdraw" && (
        <SubPage title="Withdraw" onBack={() => setScreen("dashboard")} T={T} Icon={Icon}>
          <div style={{ ...S.heroBalance, background: appTone.hero, borderColor: appTone.heroBorder, boxShadow: appTone.heroShadow }}><div style={{ ...S.balanceLabel, color: T.muted }}>Tips Received</div><div style={{ ...S.balanceHero, color: T.text }}>{formatUSDC(claimWalletBalance)}</div></div>
          {!claimedUsername ? (
            <div style={{ ...S.card, ...cardTheme, ...S.verifyNoticeCard }}>
              <div>
                <div style={{ ...S.cardLabel, color: T.muted, marginBottom: "6px" }}>Creator payouts</div>
                <p style={{ color: T.text, fontSize: "13px", lineHeight: 1.45, margin: 0 }}>Verify X to unlock withdrawals for tips sent to your posts.</p>
              </div>
              <button onClick={() => setScreen("claim")} style={{ ...S.primaryBtn, marginTop: "14px" }}>Verify X</button>
            </div>
          ) : !claimWalletDeployed ? (
            <div style={{ ...S.card, ...cardTheme, ...S.withdrawSetupCard }}>
              <div style={S.withdrawSetupIconWrap}>
                <Icon name="wallet" size={19} color={T.primary} />
              </div>
              <div style={S.withdrawSetupCopy}>
                <div style={{ ...S.cardLabel, color: T.muted }}>Payout setup</div>
                <h3 style={{ ...S.withdrawSetupTitle, color: T.text }}>Create your payout account</h3>
                <p style={{ ...S.withdrawSetupText, color: T.muted }}>
                  Set this up once to receive and withdraw tips sent to your verified creator posts.
                </p>
              </div>
              <button
                onClick={handleDeployClaimWallet}
                disabled={deployLoading}
                style={{ ...S.primaryBtn, ...S.withdrawSetupBtn, opacity: deployLoading ? 0.75 : 1 }}
              >
                {deployLoading ? "Setting up..." : "Set up payout account"}
              </button>
            </div>
          ) : (
            <div style={{ ...S.card, ...cardTheme, ...S.withdrawFormCard }}>
              <div style={S.withdrawFormHeader}>
                <div>
                  <div style={{ ...S.cardLabel, color: T.muted }}>Cash out</div>
                  <p style={{ ...S.withdrawSetupText, color: T.text, marginTop: "6px" }}>Withdraw your available creator tips.</p>
                </div>
                <button type="button" onClick={() => setWithdrawAmount(formatUSDC(claimWalletBalance).replace("$", ""))} style={{ ...S.smallBtn, ...S.withdrawMaxBtn }}>
                  Max
                </button>
              </div>
              <input value={withdrawTo} onChange={(e) => setWithdrawTo(e.target.value)} placeholder="Destination wallet" style={{ ...S.input, ...inputTheme, marginBottom: "10px" }} />
              <input value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} placeholder="Amount" style={{ ...S.input, ...inputTheme, marginBottom: "14px" }} />
              <button onClick={handleWithdraw} disabled={withdrawLoading} style={S.primaryBtn}>{withdrawLoading ? "Withdrawing..." : "Withdraw"}</button>
            </div>
          )}
          {withdrawMsg && <p style={{ color: T.muted, fontSize: "12px" }}>{withdrawMsg}</p>}
        </SubPage>
      )}

      {screen === "send" && (
        <SubPage title="Send Tip" onBack={() => setScreen("dashboard")} T={T} Icon={Icon}>
          <div style={{ ...S.card, ...cardTheme }}>
            <div style={{ ...S.cardLabel, color: T.muted }}>Post URL</div>
            <input value={postUrl} onChange={(e) => setPostUrl(e.target.value)} placeholder="https://x.com/user/status/..." style={{ ...S.input, ...inputTheme, marginBottom: "10px" }} />
            <div style={{ display: "flex", gap: "8px", marginBottom: "10px" }}>{TIP_PRESETS.map((preset) => <button key={preset} onClick={() => { setTipPreset(preset); setCustomTipAmount(""); }} style={tipPreset === preset ? S.primaryBtn : S.outlineBtn}>${preset}</button>)}</div>
            <input value={customTipAmount} onChange={(e) => { setCustomTipAmount(e.target.value); setTipPreset(null); }} placeholder="Custom amount" style={{ ...S.input, ...inputTheme, marginBottom: "10px" }} />
            <button onClick={handleSendTip} disabled={sendLoading} style={S.primaryBtn}>{sendLoading ? "Opening signer..." : "Continue"}</button>
            {sendMsg && <p style={{ color: T.muted, fontSize: "12px" }}>{sendMsg}</p>}
          </div>
        </SubPage>
      )}

      {screen === "history" && (
        <SubPage title="History" onBack={() => setScreen("dashboard")} T={T} Icon={Icon}>
          {receiptMsg && <p style={{ color: T.success, fontSize: "12px", margin: 0 }}>{receiptMsg}</p>}
          {historyLoading ? <div style={{ ...S.card, ...cardTheme }}>Loading history...</div> : tipHistory.length === 0 ? <div style={{ ...S.card, ...cardTheme }}>No transactions yet.</div> : <div style={S.historyList}>{tipHistory.map((item, i) => renderActivityCard(item, i))}</div>}
        </SubPage>
      )}

      {screen === "grow" && (
        <SubPage title="Grow Tips" onBack={() => setScreen("dashboard")} T={T} Icon={Icon}>
          <div style={{ ...S.card, ...cardTheme }}>
            <div style={{ ...S.cardLabel, color: T.muted }}>Social DeFi</div>
            <h3 style={{ color: T.text, fontSize: "18px", margin: "0 0 8px" }}>Put idle tips to work.</h3>
            <p style={{ color: T.muted, fontSize: "13px", lineHeight: 1.5, margin: 0 }}>
              Grow tips you are not using yet while keeping the tipping experience simple.
            </p>
          </div>
          <div style={{ ...S.card, ...cardTheme }}>
            <div style={{ ...S.growMetricRow }}>
              <span style={{ color: T.muted }}>Available to grow</span>
              <strong style={{ color: T.text }}>{formatUSDC(usdcBalance)}</strong>
            </div>
            <div style={{ ...S.growMetricRow }}>
              <span style={{ color: T.muted }}>Estimated yield</span>
              <strong style={{ color: T.success }}>Coming soon</strong>
            </div>
            <div style={{ ...S.growMetricRow }}>
              <span style={{ color: T.muted }}>Strategy</span>
              <strong style={{ color: T.text }}>Arc testnet vault</strong>
            </div>
            <button type="button" disabled style={{ ...S.primaryBtn, marginTop: "14px", opacity: 0.55, cursor: "not-allowed" }}>Grow Tips soon</button>
          </div>
        </SubPage>
      )}

      {screen === "profile" && (
        <SubPage title="Profile" onBack={() => setScreen("dashboard")} T={T} Icon={Icon}>
          <div style={{ ...S.card, ...cardTheme }}>
            <div style={S.profileSummary}>
              <img src={avatarUrls.primary} alt="" style={S.profileSummaryAvatar} onError={(e) => { e.currentTarget.src = avatarUrls.fallback; e.currentTarget.onerror = null; }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ color: T.text, fontSize: "15px", fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</div>
                <div style={{ color: claimedUsername ? T.success : T.muted, fontSize: "12px", marginTop: "3px" }}>{claimedUsername ? `X verified as @${claimedUsername}` : "X not verified"}</div>
              </div>
            </div>
            <div style={{ ...S.addressRow, background: appTone.input, borderColor: appTone.border, marginTop: "12px" }}>
              <span style={{ ...S.addressText, color: T.text }}>{walletAddress || "Wallet loading..."}</span>
              <button type="button" onClick={handleReceiveCrypto} style={S.copyBtn}>{walletCopyFeedback ? "Copied" : "Copy"}</button>
            </div>
            {claimedUsername ? (
              <>
                <button type="button" onClick={handleRefreshXProfile} disabled={profileRefreshStatus === "pending"} style={{ ...S.primaryBtn, marginTop: "12px" }}>
                  {profileRefreshStatus === "pending" ? "Waiting for X..." : "Refresh X profile"}
                </button>
                <p style={{ color: T.muted, fontSize: "12px", lineHeight: 1.45, margin: "8px 0 0" }}>
                  Use this after changing your X handle. Your creator account and tip wallet stay the same.
                </p>
                {profileRefreshMsg && <p style={{ color: T.success, fontSize: "12px", margin: "8px 0 0" }}>{profileRefreshMsg}</p>}
              </>
            ) : (
              <button type="button" onClick={() => setScreen("claim")} style={{ ...S.primaryBtn, marginTop: "12px" }}>Verify X</button>
            )}
            {error && <p style={S.error}>{error}</p>}
          </div>
          <div style={{ ...S.card, ...cardTheme }}>
            <div style={{ ...S.cardLabel, color: T.muted }}>Public social handle</div>
            <p style={{ color: T.muted, fontSize: "12px", lineHeight: 1.45, margin: "0 0 10px" }}>
              Used when creators thank you from their supporter list. Leave empty if you prefer wallet-only privacy.
            </p>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ color: T.muted, fontSize: "13px", fontWeight: 900 }}>@</span>
              <input
                value={socialXHandle}
                onChange={(e) => setSocialXHandle(e.target.value)}
                placeholder="x_handle"
                style={{ ...S.input, ...inputTheme, marginBottom: 0 }}
              />
            </div>
            <button
              type="button"
              onClick={handleSaveSocialXHandle}
              disabled={socialXHandleSaving || socialXHandle.trim().replace(/^@/, "").toLowerCase() === socialXHandleSaved}
              style={{ ...S.primaryBtn, marginTop: "10px", opacity: socialXHandleSaving ? 0.72 : 1 }}
            >
              {socialXHandleSaving ? "Saving..." : "Save social handle"}
            </button>
            {socialXHandleMsg && <p style={{ color: socialXHandleMsg.includes("Could not") || socialXHandleMsg.includes("valid") ? "#f4212e" : T.success, fontSize: "12px", margin: "8px 0 0" }}>{socialXHandleMsg}</p>}
          </div>
          <div style={{ ...S.card, ...cardTheme }}>
            <button type="button" onClick={() => setReferralExpanded((open) => !open)} style={{ ...S.submenuHeader, color: T.text }}>
              <span>Referral</span>
              <span style={{ color: T.muted }}>{referralExpanded ? "Hide" : "Open"}</span>
            </button>
            {referralExpanded && (
              <div style={{ marginTop: "12px" }}>
                <div style={{ ...S.cardLabel, color: T.muted }}>Your referral code</div>
                <div style={{ ...S.addressRow, background: appTone.input, borderColor: appTone.border }}>
                  <span style={{ ...S.addressText, color: T.text }}>{myReferralCode || "Loading..."}</span>
                </div>
                <p style={{ color: T.muted, fontSize: "12px", margin: "8px 0 12px" }}>Users referred: {referralStats?.referredCount ?? 0}</p>
                <div style={{ ...S.cardLabel, color: T.muted }}>Have a referral code?</div>
                <input value={referralCode} onChange={(e) => setReferralCode(e.target.value)} placeholder="Enter code" style={{ ...S.input, ...inputTheme, marginBottom: "8px" }} />
                <button onClick={handleReferralSubmit} style={S.primaryBtn}>Apply</button>
                {referrerStatus?.hasReferrer && <p style={{ color: T.muted, fontSize: "12px", margin: "8px 0 0" }}>Bound to {referrerStatus.referralCode || "a referral code"}.</p>}
                {referralMsg && <p style={{ color: T.success, fontSize: "12px", margin: "8px 0 0" }}>{referralMsg}</p>}
              </div>
            )}
          </div>
        </SubPage>
      )}

      {isDebug() && (
        <div style={{ marginTop: "12px" }}>
          <button type="button" onClick={() => setDebugOpen(!debugOpen)} style={S.ghostBtn}>{debugOpen ? "Hide" : "Show"} debug ({debugEntries.length})</button>
          {debugOpen && <div style={{ marginTop: "8px", maxHeight: "180px", overflow: "auto", background: "#111", borderRadius: "8px", padding: "8px", fontSize: "10px", fontFamily: "monospace", color: "#8b949e" }}>{debugEntries.map((e, i) => <div key={i}>[{e.tag}] {e.message}</div>)}</div>}
        </div>
      )}
    </main>

    {screen === "dashboard" && (
      <footer style={{ ...S.popupFooter, background: appTone.footer, borderTop: `1px solid ${appTone.border}` }}>
        <div style={S.footerGrid}>
          <FooterButton label="Dashboard" icon="grid" href={`${CONFIG.WEB_APP_URL}/dashboard`} T={T} Icon={Icon} dark={!isLight} />
          <FooterButton label="Withdraw" icon="wallet" onClick={openWithdrawFlow} T={T} Icon={Icon} dark={!isLight} />
          <FooterButton label="Grow Tips" icon="leaf" onClick={() => setScreen("grow")} T={T} Icon={Icon} accent dark={!isLight} />
          <FooterButton label="Support" icon="help" href={`${CONFIG.WEB_APP_URL}/support`} T={T} Icon={Icon} dark={!isLight} />
        </div>
        <p style={{ ...S.protocolText, color: T.muted }}>Teep v0.1.0</p>
      </footer>
    )}
  </div>
);
};

type Tone = ReturnType<typeof getTone>;
function getTone(isLight: boolean) {
  return isLight
    ? { header: "#ffffff", footer: "#ffffff", card: "#ffffff", input: "#f8fafc", border: "#e7edf5", hero: "#ffffff", heroBorder: "#eef2f7", heroShadow: "0 6px 18px rgba(15,23,42,0.07)", cardShadow: "0 1px 5px rgba(15,23,42,0.035)" }
    : { header: "#161121", footer: "rgba(15,13,28,0.88)", card: "rgba(12,16,31,0.66)", input: "rgba(10,10,10,0.72)", border: "rgba(67,86,121,0.50)", hero: "rgba(99,36,235,0.16)", heroBorder: "rgba(99,36,235,0.30)", heroShadow: "none", cardShadow: "none" };
}

function SubPage({ title, onBack, children, T, Icon }: { title: string; onBack: () => void; children: React.ReactNode; T: typeof LIGHT_THEME; Icon: React.FC<{ name: any; size?: number; color?: string }> }) {
  return <div style={S.dashboardStack}><div style={S.pageHeader}><button onClick={onBack} style={{ ...S.backBtn, color: T.text, borderColor: T.border }}><Icon name="back" size={18} /></button><span style={{ ...S.pageTitle, color: T.text }}>{title}</span></div>{children}</div>;
}

function FooterButton({ label, icon, onClick, href, T, Icon, accent = false, dark = false }: { label: string; icon: any; onClick?: () => void; href?: string; T: typeof LIGHT_THEME; Icon: React.FC<{ name: any; size?: number; color?: string }>; accent?: boolean; dark?: boolean }) {
  const color = accent ? (dark ? "#ffffff" : T.primary) : T.muted;
  const content = <><Icon name={icon} size={23} color={color} /><span style={{ ...S.footerLabel, color }}>{label}</span></>;
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" style={S.footerBtn}>{content}</a>;
  return <button type="button" onClick={onClick} style={S.footerBtn}>{content}</button>;
}

/* Styles */
const font = 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const S: Record<string, React.CSSProperties> = {
  app: { display: "flex", flexDirection: "column", height: "600px", maxHeight: "600px", background: "#161121", color: "#e5e5e5", fontFamily: font, width: "100%", minWidth: "360px", maxWidth: "380px", overflow: "hidden", boxSizing: "border-box" },
  topBar: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", flexShrink: 0, zIndex: 5, backdropFilter: "blur(10px)", boxSizing: "border-box" },
  profileCluster: { display: "flex", alignItems: "center", gap: "12px", minWidth: 0 },
  avatarRing: { width: "38px", height: "38px", borderRadius: "50%", padding: "2px", background: "rgba(99,36,235,0.22)", position: "relative", flexShrink: 0 },
  profileAvatar: { width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%", display: "block" },
  onlineDot: { position: "absolute", right: "0px", bottom: "0px", width: "10px", height: "10px", borderRadius: "50%", background: "#22c55e", border: "2px solid" },
  profileHandle: { fontSize: "15px", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "188px", lineHeight: 1.1 },
  connectedPill: { display: "flex", alignItems: "center", gap: "5px", border: "none", background: "transparent", color: "#8b97aa", cursor: "pointer", padding: "2px 0 0", fontSize: "10px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: font },
  connectedDot: { width: "7px", height: "7px", borderRadius: "50%", background: "#22c55e", display: "inline-block", flexShrink: 0 },
  iconButton: { width: "31px", height: "31px", borderRadius: "10px", border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0, opacity: 0.72 },
  settingsMenu: { position: "absolute", top: "36px", right: "0", zIndex: 20, width: "138px", border: "1px solid", borderRadius: "12px", padding: "6px", boxSizing: "border-box" },
  settingsItem: { width: "100%", border: "none", background: "transparent", borderRadius: "8px", padding: "9px 10px", textAlign: "left", fontSize: "13px", fontWeight: 800, cursor: "pointer", fontFamily: font },
  main: { flex: 1, padding: "14px 18px 10px", overflowX: "hidden", overflowY: "auto", boxSizing: "border-box" },
  centered: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "380px" },
  loadingText: { color: "#71767b", fontSize: "14px" },
  dashboardStack: { display: "flex", flexDirection: "column", gap: "10px" },
  sectionStack: { display: "flex", flexDirection: "column", gap: "7px" },
  sectionHeader: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { margin: 0, fontSize: "11px", fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" },
  viewAllBtn: { border: "none", background: "transparent", color: "#6324eb", cursor: "pointer", fontSize: "11px", fontWeight: 800, padding: 0, fontFamily: font },
  heroBalance: { display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "17px 16px 14px", borderRadius: "16px", border: "1px solid", width: "100%", boxSizing: "border-box" },
  balanceLabel: { fontSize: "10px", color: "#71767b", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: "6px" },
  balanceHero: { fontSize: "34px", fontWeight: 850, color: "#fff", lineHeight: 0.96, letterSpacing: 0 },
  heroActions: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", width: "100%", marginTop: "16px" },
  moneyButton: { minWidth: 0, height: "40px", border: "none", borderRadius: "12px", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: "7px", fontSize: "13px", fontWeight: 800, cursor: "pointer", fontFamily: font, whiteSpace: "nowrap" },
  impactGrid: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "12px", width: "100%" },
  impactCard: { padding: "11px 15px", borderRadius: "12px", border: "1px solid", minHeight: "52px", boxSizing: "border-box" },
  impactLabel: { fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" },
  impactValue: { fontSize: "18px", fontWeight: 800, lineHeight: 1 },
  activityStack: { display: "flex", flexDirection: "column", gap: "8px" },
  activityCard: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "9px", padding: "10px 13px", borderRadius: "12px", border: "1px solid", minHeight: "64px", boxSizing: "border-box" },
  activityCardCompact: { minHeight: "58px", padding: "9px 12px" },
  activityLeft: { display: "flex", alignItems: "center", gap: "10px", minWidth: 0 },
  activityAvatar: { width: "36px", height: "36px", borderRadius: "50%", objectFit: "cover", flexShrink: 0 },
  walletAvatar: { width: "36px", height: "36px", borderRadius: "50%", background: "rgba(99,36,235,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  activityTitle: { fontSize: "13px", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "158px" },
  activityTime: { fontSize: "11px", marginTop: "2px" },
  activityRight: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "3px", flexShrink: 0 },
  activityAmount: { fontSize: "13px", fontWeight: 800, flexShrink: 0 },
  activityActions: { display: "flex", alignItems: "center", gap: "5px" },
  activityActionBtn: { border: "none", background: "transparent", padding: "0", display: "flex", alignItems: "center", gap: "2px", fontSize: "9px", fontWeight: 800, cursor: "pointer", fontFamily: font, opacity: 0.9, transition: "color 140ms ease, opacity 140ms ease" },
  historyList: { display: "flex", flexDirection: "column", gap: "8px" },
  card: { padding: "16px", background: "#111", borderRadius: "14px", border: "1px solid #1a1a2e", marginBottom: "0" },
  withdrawSetupCard: { display: "flex", flexDirection: "column" as const, gap: "16px", padding: "18px 16px 16px" },
  withdrawSetupIconWrap: { width: "42px", height: "42px", borderRadius: "14px", display: "grid", placeItems: "center", background: "rgba(99,36,235,0.16)", border: "1px solid rgba(99,36,235,0.30)" },
  withdrawSetupCopy: { display: "flex", flexDirection: "column" as const, gap: "7px" },
  withdrawSetupTitle: { margin: 0, fontSize: "17px", lineHeight: 1.15, fontWeight: 850, letterSpacing: 0 },
  withdrawSetupText: { margin: 0, fontSize: "13px", lineHeight: 1.5 },
  withdrawSetupBtn: { marginTop: "2px" },
  withdrawFormCard: { padding: "18px 16px 16px" },
  withdrawFormHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "14px" },
  withdrawMaxBtn: { width: "auto", minWidth: "54px", padding: "7px 10px", borderRadius: "10px" },
  title: { fontSize: "20px", fontWeight: 800, color: "#fff", marginBottom: "6px", textAlign: "center" },
  subtitle: { fontSize: "13px", color: "#71767b", lineHeight: 1.5, marginBottom: "18px", textAlign: "center" },
  primaryBtn: { width: "100%", padding: "12px", border: "none", borderRadius: "12px", background: "#6324eb", color: "#fff", fontSize: "15px", fontWeight: 800, cursor: "pointer", fontFamily: font },
  outlineBtn: { width: "100%", padding: "11px", border: "1px solid #6324eb", borderRadius: "12px", background: "transparent", color: "#6324eb", fontSize: "14px", fontWeight: 700, cursor: "pointer", fontFamily: font },
  ghostBtn: { width: "100%", padding: "9px", border: "1px solid #2f3336", borderRadius: "12px", background: "transparent", color: "#71767b", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: font },
  smallBtn: { padding: "6px 10px", border: "1px solid #6324eb", borderRadius: "8px", background: "transparent", color: "#6324eb", fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: font },
  input: { width: "100%", padding: "10px 12px", border: "1px solid #2f3336", borderRadius: "10px", background: "#0a0a0a", color: "#e5e5e5", fontSize: "14px", fontFamily: font, outline: "none", boxSizing: "border-box" },
  error: { color: "#f4212e", fontSize: "12px", marginTop: "10px", textAlign: "center" },
  cardLabel: { fontSize: "11px", fontWeight: 800, color: "#71767b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" },
  fundOptionStack: { display: "flex", flexDirection: "column", gap: "8px" },
  fundOption: { width: "100%", minHeight: "48px", border: "1px solid", borderRadius: "12px", padding: "9px 11px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", cursor: "pointer", fontFamily: font, textAlign: "left", boxSizing: "border-box" },
  fundOptionText: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, fontSize: "13px" },
  copyBtn: { flexShrink: 0, minWidth: "42px", height: "30px", display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid #2f3336", borderRadius: "8px", background: "transparent", color: "#71767b", cursor: "pointer", padding: "0 8px", fontSize: "11px" },
  addressRow: { display: "flex", alignItems: "center", gap: "8px", background: "#0a0a0a", borderRadius: "8px", padding: "8px 10px", border: "1px solid #1a1a2e" },
  addressText: { flex: 1, fontSize: "12px", fontFamily: "monospace", color: "#e5e5e5", wordBreak: "break-all", userSelect: "all", lineHeight: 1.4 },
  profileSummary: { display: "flex", alignItems: "center", gap: "12px", minWidth: 0 },
  profileSummaryAvatar: { width: "46px", height: "46px", borderRadius: "50%", objectFit: "cover", flexShrink: 0 },
  submenuHeader: { width: "100%", border: "none", background: "transparent", display: "flex", justifyContent: "space-between", alignItems: "center", padding: 0, fontSize: "14px", fontWeight: 900, cursor: "pointer", fontFamily: font },
  growMetricRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px 0", borderBottom: "1px solid rgba(148,163,184,0.16)", fontSize: "13px" },
  pageHeader: { display: "flex", alignItems: "center", gap: "10px" },
  backBtn: { width: "34px", height: "34px", border: "1px solid #2f3336", borderRadius: "10px", background: "transparent", color: "#e5e5e5", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 },
  pageTitle: { fontSize: "18px", fontWeight: 800, color: "#fff" },
  verifyNoticeCard: { padding: "20px 16px", display: "flex", flexDirection: "column", gap: "0" },
  popupFooter: { padding: "8px 18px 9px", borderTop: "1px solid #1a1a2e", flexShrink: 0, boxSizing: "border-box" },
  footerGrid: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "4px", alignItems: "center", width: "100%" },
  footerBtn: { border: "none", background: "transparent", color: "#71767b", cursor: "pointer", fontSize: "10px", fontWeight: 800, padding: "4px 0", textDecoration: "none", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "4px", minWidth: 0, maxWidth: "100%", fontFamily: font, overflow: "hidden", opacity: 0.78 },
  footerLabel: { fontSize: "8px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0", whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "clip" },
  protocolText: { textAlign: "center", fontSize: "8px", margin: "7px 0 0", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.70 },
};
