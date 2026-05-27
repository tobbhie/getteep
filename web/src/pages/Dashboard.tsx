import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { buildFundingPolicy, getTeepActivityTypeLabel } from "@teep/shared";
import { parseUnits } from "viem";
import { arcTestnet } from "../chains";
import { computeDirectCreatorContentId, encodeApproveCall, encodeTipCall, TIP_CONTRACT_ADDRESS } from "../lib/contracts";
import DashboardShell from "../components/DashboardShell";
import TeepTipModal from "../components/TeepTipModal";
import {
  API_BASE,
  CHROME_STORE_URL,
  ENABLE_FIAT_OFFRAMP,
  ENABLE_FIAT_ONRAMP,
  EXPLORER_TX_URL,
  FAUCET_URL,
  FUNDING_ENV,
  OFFRAMP_URL,
  ONRAMP_URL,
  RECEIPT_BASE_URL,
  USDC_ADDRESS,
  WEB_APP_URL,
} from "../config";

/** Format raw USDC (6 decimals) to USD string */
function formatUsdRaw(raw: string): string {
  const n = Number(raw) / 1e6;
  if (isNaN(n)) return "0.00";
  return n.toFixed(2);
}

const HISTORY_PAGE_SIZE = 7;

function buildReceiptTweetText(params: { amount: string; authorHandle?: string; tweetId?: string; txHash?: string; shareAmount?: boolean }): string {
  const amount = params.amount.replace(/^\$/, "");
  const handle = params.authorHandle?.replace(/^@/, "");
  const postUrl = handle && params.tweetId ? `https://x.com/${handle}/status/${params.tweetId}` : "";
  const receiptUrl = params.txHash ? `${RECEIPT_BASE_URL}/tx/${params.txHash}` : WEB_APP_URL;
  const amountPart = params.shareAmount === false ? "" : ` $${amount}`;
  const receiptPart = `\n\nReceipt: ${receiptUrl}`;
  if (handle) {
    const line1 = postUrl
      ? `Hey @${handle}, just tipped you${amountPart} via Teep for this wonderful piece: ${postUrl}`
      : `Hey @${handle}, just tipped you${amountPart} via Teep`;
    return `${line1}${receiptPart}\nSupport creators directly.`;
  }
  return `I just tipped${amountPart} via Teep.${receiptPart}\nSupport creators directly.`;
}

function safeAddress(address?: string): string | null {
  if (!address) return null;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatHistoryTime(timestamp: number) {
  if (!timestamp) return "Just now";
  const millis = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
  return new Date(millis).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
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

function generateReceiptImage(params: { amount: string; title: string; subtitle: string; from?: string; to?: string; txHash?: string; txUrl?: string; date: string; kind: string }): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
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
    ["From", params.from || "You"],
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
  ctx.fillText("Teep receipt", 80, 1262);
  return canvas.toDataURL("image/png");
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadActivityCsv(items: HistoryItem[]) {
  const rows = [
    ["date", "type", "creator_handle", "amount_usd", "status", "post_url", "receipt_url", "tx_hash"],
    ...items.map((item) => {
      const handle = item.author_handle?.replace(/^@/, "") || "";
      const postUrl = handle && item.tweet_id ? `https://x.com/${handle}/status/${item.tweet_id}` : "";
      const receiptUrl = item.tx_hash ? `${RECEIPT_BASE_URL}/tx/${item.tx_hash}` : "";
      return [
        formatHistoryTime(item.timestamp),
        getTeepActivityTypeLabel(item.type),
        handle ? `@${handle}` : item.detail || "",
        formatUsdRaw(item.amount),
        item.tx_hash ? "teep_receipt_ready" : "sent",
        postUrl,
        receiptUrl,
        item.tx_hash || "",
      ];
    }),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `teep-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

interface HistoryItem {
  type: string;
  amount: string;
  tx_hash?: string;
  timestamp: number;
  author_handle?: string;
  tweet_id?: string;
  from_addr?: string;
  from_address?: string;
  to_address?: string;
  detail?: string;
}

interface TipperCreator {
  authorId?: string;
  username: string | null;
  profileImageUrl?: string | null;
  totalRaw?: string;
  total?: string;
  tipCount?: number;
  isVerified?: boolean;
  claimWalletDeployed?: boolean;
  claimStatus?: "unclaimed" | "verified" | "claim_wallet_active";
}

interface DiscoverCreator {
  authorId: string;
  username: string | null;
  displayName?: string | null;
  profileImageUrl?: string | null;
  totalReceivedUsd?: string;
  tipCount?: number;
  rank?: number;
}

interface CreatorData {
  username: string;
  totalReceivedUsd: string;
  tipCount: number;
  topPosts: Array<{
    contentId: string;
    totalUsd: string;
    count: number;
    tweetId: string | null;
    authorHandle: string | null;
  }>;
  topSupporters: Array<{ address: string; totalUsd: string }>;
  recentTips?: HistoryItem[];
}

interface EarningsDaily {
  date: string;
  amountUsd: string;
}

type PostPreview = {
  excerpt: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
  unavailable?: boolean;
};

function normalizeRawUsd(raw: string | number | undefined | null) {
  return formatUsdRaw(String(raw ?? "0"));
}

function postDisplayLabel(post: CreatorData["topPosts"][number]) {
  if (post.tweetId) return `Post #${post.tweetId.slice(-6)}...`;
  return `Content ${post.contentId.slice(-6)}`;
}

function DashboardDataSkeleton({ mode = "tipper" }: { mode?: DashboardMode }) {
  const isCreatorView = mode === "creator";
  return (
    <DashboardShell title={isCreatorView ? "Creator Dashboard" : "Overview"}>
      <div className="dashboard-body-inner" aria-busy="true">
        <div className="dashboard-page-heading">
          <div>
            <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 var(--space-1)" }}>
              {isCreatorView ? "Creator Dashboard" : "Your creator support"}
            </h1>
            <p style={{ color: "var(--text-secondary)", margin: 0 }}>
              {isCreatorView
                ? "Track received tips, post performance, payout readiness, and your next best action."
                : "Tip again, track receipts, and see when creators can claim what you sent."}
            </p>
          </div>
        </div>
        <div className="dashboard-skeleton-overview">
          <span className="dashboard-skeleton-card dashboard-skeleton-card--large" />
          <span className="dashboard-skeleton-card dashboard-skeleton-card--large" />
        </div>
        <h3 style={{ fontSize: "1.25rem", margin: "0 0 var(--space-3)" }}>
          {isCreatorView ? "Creator performance" : "Creators to tip again"}
        </h3>
        <div className="dashboard-skeleton-repeat-grid">
          <span className="dashboard-skeleton-card dashboard-skeleton-card--creator" />
          <span className="dashboard-skeleton-card dashboard-skeleton-card--creator" />
        </div>
        <div className="dashboard-activity-section">
          <div className="dashboard-history-header dashboard-history-header--table">
            <div>
              <div className="dashboard-metric-label">Activity</div>
              <h3 style={{ fontSize: "1.25rem", margin: 0 }}>
                {isCreatorView ? "Received tips and payouts" : "Tip activity and receipts"}
              </h3>
            </div>
          </div>
          <span className="dashboard-skeleton-table" />
        </div>
      </div>
    </DashboardShell>
  );
}

type DashboardMode = "auto" | "tipper" | "creator";

export default function Dashboard({ mode = "auto" }: { mode?: DashboardMode }) {
  const { ready, authenticated, login } = usePrivy();
  const { client: smartWalletClient } = useSmartWallets();
  const address = (ready && authenticated ? smartWalletClient?.account?.address || "" : "").toLowerCase();

  const [loading, setLoading] = useState(true);
  const [isCreator, setIsCreator] = useState(false);
  const [creatorData, setCreatorData] = useState<CreatorData | null>(null);
  const [earningsDaily, setEarningsDaily] = useState<EarningsDaily[]>([]);
  const [chartDays, setChartDays] = useState<number>(30);
  const [balanceRaw, setBalanceRaw] = useState("0");
  const [mainBalanceRaw, setMainBalanceRaw] = useState("0");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [postPreviews, setPostPreviews] = useState<Record<string, PostPreview>>({});
  
  // Extra tipper data
  const [tipperStats, setTipperStats] = useState<{
    totalSent: string;
    tipCount: number;
    creatorsSupported: TipperCreator[];
  }>({ totalSent: "0", tipCount: 0, creatorsSupported: [] });
  const [discoverCreators, setDiscoverCreators] = useState<DiscoverCreator[]>([]);
  
  const [addFundsOpen, setAddFundsOpen] = useState(false);
  const [addFundsPanelRect, setAddFundsPanelRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const [walletCopyFeedback, setWalletCopyFeedback] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [fundingMsg, setFundingMsg] = useState("");
  const [receiptPrefs, setReceiptPrefs] = useState({ shareAmountEnabled: true });
  const [tipperIdentity, setTipperIdentity] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyFiltersOpen, setHistoryFiltersOpen] = useState(false);
  const [historyActionsOpen, setHistoryActionsOpen] = useState<string | null>(null);
  const [directTipTarget, setDirectTipTarget] = useState<TipperCreator | null>(null);
  const [directTipAmount, setDirectTipAmount] = useState("5.00");
  const [directTipSending, setDirectTipSending] = useState(false);
  const [directTipError, setDirectTipError] = useState("");
  const [inviteIndex, setInviteIndex] = useState(0);
  const addFundsRef = useRef<HTMLDivElement>(null);
  const addFundsButtonRef = useRef<HTMLButtonElement>(null);
  const activeAddressRef = useRef(address);

  useEffect(() => {
    activeAddressRef.current = address;
  }, [address]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (addFundsRef.current && !addFundsRef.current.contains(target) && !(target instanceof Element && target.closest(".dashboard-funding-panel--floating"))) {
        setAddFundsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!addFundsOpen || !addFundsButtonRef.current) return;
    const updatePosition = () => {
      const rect = addFundsButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAddFundsPanelRect({
        left: Math.max(16, Math.min(rect.left, window.innerWidth - 340)),
        top: rect.bottom + 8,
        width: Math.max(320, rect.width + 220),
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [addFundsOpen]);

  useEffect(() => {
    if (!creatorData?.topPosts?.length) {
      setPostPreviews({});
      return;
    }
    let cancelled = false;
    const previewTargets = creatorData.topPosts
      .filter((post) => post.tweetId && (post.authorHandle || creatorData.username))
      .slice(0, 5);
    if (previewTargets.length === 0) {
      setPostPreviews({});
      return;
    }
    Promise.all(previewTargets.map(async (post) => {
      const handle = post.authorHandle || creatorData.username;
      const tweetUrl = `https://x.com/${handle}/status/${post.tweetId}`;
      try {
        const response = await fetch(`${API_BASE}/api/v1/oembed?url=${encodeURIComponent(tweetUrl)}`);
        const data = response.ok ? await response.json() : null;
        return {
          contentId: post.contentId,
          preview: {
            excerpt: data?.excerpt || null,
            authorName: data?.author_name || null,
            thumbnailUrl: data?.thumbnail_url || null,
            unavailable: Boolean(data?.unavailable),
          } satisfies PostPreview,
        };
      } catch {
        return {
          contentId: post.contentId,
          preview: { excerpt: null, authorName: null, thumbnailUrl: null, unavailable: true } satisfies PostPreview,
        };
      }
    })).then((items) => {
      if (cancelled) return;
      setPostPreviews(Object.fromEntries(items.map((item) => [item.contentId, item.preview])));
    });
    return () => {
      cancelled = true;
    };
  }, [creatorData]);

  const requestWalletProof = useCallback(async (purpose: "referral-code" | "referral-link" | "activity-write") => {
    if (!address || !smartWalletClient?.account) throw new Error("Connect your account first.");
    const challengeRes = await fetch(`${API_BASE}/auth/wallet/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, purpose }),
    });
    const challenge = await challengeRes.json();
    if (!challengeRes.ok || !challenge.message) throw new Error(challenge.error || "Could not verify account.");
    const signature = await smartWalletClient.signMessage({
      account: smartWalletClient.account,
      message: challenge.message,
    } as Parameters<typeof smartWalletClient.signMessage>[0]);
    return { message: challenge.message, signature };
  }, [address, smartWalletClient]);

  const loadData = useCallback(async () => {
    const targetAddress = address;
    if (!targetAddress) {
      setLoading(true);
      return;
    }
    setLoading(true);
    const timeoutMs = 12000;
    const timeoutPromise = new Promise<null>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs));
    try {
      const result = await Promise.race([
        Promise.all([
          fetch(`${API_BASE}/auth/claim-status/${targetAddress}`).then((r) => (r.ok ? r.json() : { verified: false, claims: [] })).catch(() => ({ verified: false, claims: [] })),
          fetch(`${API_BASE}/tips/history/${targetAddress}?limit=100`).then((r) => (r.ok ? r.json() : { history: [] })).catch(() => ({ history: [] })),
        ]),
        timeoutPromise,
      ]) as [{ verified?: boolean; claims?: unknown[] }, { history?: unknown[] }] | null;
      if (activeAddressRef.current !== targetAddress) return;
      if (!result) return;
      const [claimRes, historyRes] = result;
      setHistory(Array.isArray(historyRes?.history) ? (historyRes.history as HistoryItem[]) : []);

      const claimedUsername = claimRes?.verified && Array.isArray(claimRes.claims) && claimRes.claims.length > 0
        ? (claimRes.claims[0] as { username?: string }).username
        : undefined;
      const shouldShowCreatorDashboard = mode === "creator" || (mode === "auto" && Boolean(claimedUsername));

      if (shouldShowCreatorDashboard) {
        const username = claimedUsername;
        setIsCreator(true);
        const [creatorRes, earningsRes, balanceRes, mainBalanceRes] = await Promise.all([
          username ? fetch(`${API_BASE}/api/v1/creators/${username}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null),
          username ? fetch(`${API_BASE}/api/v1/creators/${username}/earnings-over-time?days=30`).then((r) => (r.ok ? r.json() : { daily: [] })).catch(() => ({ daily: [] })) : Promise.resolve({ daily: [] }),
          fetch(`${API_BASE}/api/v1/wallet/${targetAddress}/balance`).then((r) => (r.ok ? r.json() : { balanceRaw: "0" })).catch(() => ({ balanceRaw: "0" })),
          fetch(`${API_BASE}/api/v1/wallet/${targetAddress}/usdc-balance`).then((r) => (r.ok ? r.json() : { balanceRaw: "0" })).catch(() => ({ balanceRaw: "0" })),
        ]);
        if (activeAddressRef.current !== targetAddress) return;
        if (creatorRes) setCreatorData(creatorRes);
        if (earningsRes?.daily?.length) setEarningsDaily(earningsRes.daily);
        setBalanceRaw(balanceRes?.balanceRaw ?? "0");
        setMainBalanceRaw(mainBalanceRes?.balanceRaw ?? "0");
      } else {
        setIsCreator(false);
        // Load tipper specific data
        const [walletRes, usdcRes, leaderboardRes] = await Promise.all([
          fetch(`${API_BASE}/tips/wallet/${targetAddress}`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`${API_BASE}/api/v1/wallet/${targetAddress}/usdc-balance`).then((r) => (r.ok ? r.json() : { balanceRaw: "0" })).catch(() => ({ balanceRaw: "0" })),
          fetch(`${API_BASE}/leaderboard/creators?limit=12&period=7d`)
            .then(async (r) => {
              const data = r.ok ? await r.json() : { creators: [] };
              if (Array.isArray(data.creators) && data.creators.length > 0) return data;
              const fallback = await fetch(`${API_BASE}/leaderboard/creators?limit=12`);
              return fallback.ok ? fallback.json() : { creators: [] };
            })
            .catch(() => ({ creators: [] }))
        ]);
        if (activeAddressRef.current !== targetAddress) return;
        if (walletRes) {
          setTipperStats({
            totalSent: walletRes.totalSent || "0",
            tipCount: walletRes.tipCount || 0,
            creatorsSupported: Array.isArray(walletRes.creatorsSupported) ? walletRes.creatorsSupported : [],
          });
        }
        setBalanceRaw(usdcRes?.balanceRaw ?? "0");
        if (leaderboardRes?.creators) setDiscoverCreators(leaderboardRes.creators);
      }
    } catch {
      setIsCreator(false);
      setHistory([]);
    } finally {
      if (activeAddressRef.current === targetAddress) setLoading(false);
    }
  }, [address, mode]);

  useEffect(() => {
    if (address) loadData();
  }, [address, loadData]);

  useEffect(() => {
    if (!address || !smartWalletClient?.account) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("ref")?.trim().toLowerCase();
    if (!code || sessionStorage.getItem(`teep_ref_applied_${code}_${address}`)) return;

    let cancelled = false;
    const applyReferral = async () => {
      try {
        const walletProof = await requestWalletProof("referral-link");
        if (cancelled) return;
        const response = await fetch(`${API_BASE}/referral/link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userAddress: address, code, walletProof }),
        });
        const data = await response.json();
        if (response.ok) {
          sessionStorage.setItem(`teep_ref_applied_${code}_${address}`, "1");
        } else if (data?.error) {
          console.info("[Referral] Could not apply referral link:", data.error);
        }
      } catch {
        // Keep this quiet; referral links should never block dashboard use.
      }
    };
    applyReferral();
    return () => {
      cancelled = true;
    };
  }, [address, smartWalletClient?.account, requestWalletProof]);

  useEffect(() => {
    if (ready && authenticated && isCreator && creatorData?.username) {
      fetch(`${API_BASE}/api/v1/creators/${creatorData.username}/earnings-over-time?days=${chartDays}`)
        .then(r => r.ok ? r.json() : { daily: [] })
        .then(data => {
          if (data?.daily?.length) setEarningsDaily(data.daily);
        })
        .catch(() => {});
    }
  }, [chartDays, ready, authenticated, isCreator, creatorData?.username]);

  useEffect(() => {
    if (ready && authenticated && !address) setLoading(true);
  }, [ready, authenticated, address]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historySearch, history.length]);

  useEffect(() => {
    setInviteIndex(0);
  }, [tipperStats.creatorsSupported.length]);

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

  const copyDepositAddress = useCallback(() => {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setWalletCopyFeedback(true);
      setFundingMsg("Address copied. Paste it in your wallet to send funds.");
      setTimeout(() => setWalletCopyFeedback(false), 1500);
      setTimeout(() => setFundingMsg(""), 5000);
    }).catch(() => {
      setFundingMsg("Could not copy address.");
      setTimeout(() => setFundingMsg(""), 5000);
    });
  }, [address]);

  const handleFaucet = useCallback(async () => {
    if (!address) return;
    if (!fundingPolicy.providers.faucet.enabled || !fundingPolicy.providers.faucet.url) {
      setFundingMsg(fundingPolicy.providers.faucet.disabledReason || "Faucet funding is not available.");
      setTimeout(() => setFundingMsg(""), 5000);
      return;
    }
    setFaucetLoading(true);
    setFundingMsg("Copying wallet address...");
    try {
      await navigator.clipboard.writeText(address);
      setWalletCopyFeedback(true);
      setFundingMsg("Address copied. Opening faucet...");
      window.open(fundingPolicy.providers.faucet.url, "_blank", "noopener,noreferrer");
      setTimeout(() => setWalletCopyFeedback(false), 1500);
    } catch (err: unknown) {
      setFundingMsg(err instanceof Error ? err.message : "Could not open faucet.");
    }
    setFaucetLoading(false);
    setTimeout(() => setFundingMsg(""), 5000);
  }, [address, fundingPolicy]);

  useEffect(() => {
    if (!address) return;
    fetch(`${API_BASE}/api/v1/wallet/${address}/tipper-settings-public`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.receipts) {
          setReceiptPrefs({
            shareAmountEnabled: data.receipts.shareAmountEnabled !== false,
          });
        }
        if (data?.publicIdentity?.label) setTipperIdentity(data.publicIdentity.label);
      })
      .catch(() => {});
  }, [address]);

  const shareHistoryOnX = useCallback((item: HistoryItem) => {
    const text = buildReceiptTweetText({
      amount: formatUsdRaw(item.amount),
      authorHandle: item.author_handle,
      tweetId: item.tweet_id,
      txHash: item.tx_hash,
      shareAmount: receiptPrefs.shareAmountEnabled,
    });
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }, [receiptPrefs.shareAmountEnabled]);

  const downloadHistoryReceipt = useCallback((item: HistoryItem) => {
    const handle = item.author_handle ? `@${item.author_handle.replace(/^@/, "")}` : "Creator";
    const kind = getTeepActivityTypeLabel(item.type);
    const imageUrl = generateReceiptImage({
      amount: formatUsdRaw(item.amount),
      title: kind,
      subtitle: item.detail || (item.type === "direct_creator_tip" ? `You sent a direct creator tip to ${handle}.` : item.author_handle ? `You sent a post tip to ${handle}.` : "You tipped a creator via Teep."),
      from: tipperIdentity || safeAddress(address) || "You",
      to: handle,
      txHash: item.tx_hash,
      txUrl: item.tx_hash ? `${EXPLORER_TX_URL}/${item.tx_hash}` : undefined,
      date: formatHistoryTime(item.timestamp),
      kind,
    });
    if (!imageUrl) return;
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = `teep-receipt-${item.tx_hash?.slice(0, 10) || item.timestamp}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [address, tipperIdentity]);

  const openDirectTip = useCallback((creator: TipperCreator) => {
    setDirectTipTarget(creator);
    setDirectTipAmount("5.00");
    setDirectTipError("");
  }, []);

  const sendDirectTip = useCallback(async () => {
    if (!directTipTarget || !smartWalletClient?.account || !address) return;
    const handle = directTipTarget.username?.replace(/^@/, "");
    let authorId = directTipTarget.authorId;
    const amount = Number(directTipAmount);
    if (!handle) {
      setDirectTipError("This creator needs a handle before direct tipping.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setDirectTipError("Enter a valid tip amount.");
      return;
    }

    setDirectTipSending(true);
    setDirectTipError("");
    try {
      if (!authorId) {
        const resolved = await fetch(`${API_BASE}/auth/x/user/${encodeURIComponent(handle)}`);
        if (!resolved.ok) throw new Error("Could not verify this creator. Try again in a moment.");
        const resolvedData = (await resolved.json()) as { id?: string };
        if (!resolvedData.id || !/^[0-9]+$/.test(resolvedData.id)) throw new Error("Could not verify this creator.");
        authorId = resolvedData.id;
      }

      const rawAmount = parseUnits(directTipAmount, 6);
      const contentId = computeDirectCreatorContentId(authorId);
      const approveData = encodeApproveCall(TIP_CONTRACT_ADDRESS, rawAmount);
      const tipData = encodeTipCall(contentId, BigInt(authorId), rawAmount);
      const txHash = await smartWalletClient.sendTransaction({
        calls: [
          { to: USDC_ADDRESS, data: approveData },
          { to: TIP_CONTRACT_ADDRESS, data: tipData },
        ],
        chain: arcTestnet,
        account: smartWalletClient.account,
      } as Parameters<typeof smartWalletClient.sendTransaction>[0]);

      await fetch(`${API_BASE}/tips/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentId,
          authorHandle: handle,
          authorId,
          kind: "direct_creator_tip",
        }),
      }).catch(() => {});

      await fetch(`${API_BASE}/tips/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "direct_creator_tip",
          fromAddress: address,
          amount: rawAmount.toString(),
          txHash,
          authorHandle: handle,
          detail: `Direct tip to @${handle}`,
          walletProof: await requestWalletProof("activity-write"),
        }),
      }).catch(() => {});

      setDirectTipTarget(null);
      setDirectTipAmount("5.00");
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setDirectTipError(message.includes("insufficient") || message.includes("balance") ? "Insufficient funds to send this tip." : message);
    } finally {
      setDirectTipSending(false);
    }
  }, [directTipTarget, smartWalletClient, address, directTipAmount, loadData, requestWalletProof]);

  const directTipModal = directTipTarget ? (
    <TeepTipModal
      open
      title="Send direct tip"
      modeLabel="Direct tip"
      recipientLabel={`@${(directTipTarget.username || "creator").replace(/^@/, "")}`}
      context="This supports the creator directly without attaching the tip to a specific post."
      amount={directTipAmount}
      onAmountChange={setDirectTipAmount}
      confirmLabel="Send Direct Tip"
      sending={directTipSending}
      error={directTipError}
      onConfirm={sendDirectTip}
      onClose={() => setDirectTipTarget(null)}
    />
  ) : null;

  if (!ready) {
    return <DashboardDataSkeleton mode={mode} />;
  }

  if (!authenticated) {
    return (
      <DashboardShell title="Overview">
        <div className="dashboard-logout-overlay">
          <div className="dashboard-logout-modal">
            <h2 style={{ fontSize: "1.5rem", fontWeight: 800, margin: "0 0 var(--space-2)" }}>Connect your account</h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-6)", fontSize: "var(--text-small)" }}>
              Sign in to view your dashboard, balance, and tipping history.
            </p>
            <button type="button" onClick={login} className="btn-primary" style={{ width: "100%", padding: "12px 16px", marginBottom: "var(--space-4)" }}>
              Connect
            </button>
            <p style={{ fontSize: "var(--text-small)", color: "var(--text-muted)", marginBottom: "var(--space-2)" }}>
              New here? Install the Teep extension to tip on X, then return here to manage your funds.
            </p>
            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize: "var(--text-small)", color: "var(--link)", display: "block", marginBottom: "var(--space-4)" }}>
              Get Teep extension →
            </a>
            <Link to="/" style={{ fontSize: "var(--text-small)", fontWeight: 600, color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>home</span>
              Back to home
            </Link>
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (loading) {
    return <DashboardDataSkeleton mode={mode} />;
  }

  // Non-creator: minimal view — history of spendings only
  if (mode !== "creator" && !isCreator) {
    const sentItems = history.filter((h) => h.type === "tip_sent" || h.type === "direct_creator_tip" || h.type === "send");
    const normalizedHistorySearch = historySearch.trim().replace(/^@/, "").toLowerCase();
    const filteredSentItems = normalizedHistorySearch
      ? sentItems.filter((item) => {
          const handle = (item.author_handle || "").replace(/^@/, "").toLowerCase();
          const detail = (item.detail || "").replace(/^@/, "").toLowerCase();
          return handle.includes(normalizedHistorySearch) || detail.includes(normalizedHistorySearch);
        })
      : sentItems;
    const historyPageCount = Math.max(1, Math.ceil(filteredSentItems.length / HISTORY_PAGE_SIZE));
    const safeHistoryPage = Math.min(historyPage, historyPageCount);
    const pagedSentItems = filteredSentItems.slice((safeHistoryPage - 1) * HISTORY_PAGE_SIZE, safeHistoryPage * HISTORY_PAGE_SIZE);
    const totalSentUsd = Number(tipperStats.totalSent) / 1e6;
    const averageTipUsd = tipperStats.tipCount > 0 ? totalSentUsd / tipperStats.tipCount : 0;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const referralEarnedThisMonthRaw = history.reduce((sum, item) => {
      if (item.type !== "referral_fee_received" || item.timestamp * 1000 < monthStart.getTime()) return sum;
      try {
        return sum + BigInt(item.amount || "0");
      } catch {
        return sum;
      }
    }, 0n);
    const referralEarnedThisMonth = (Number(referralEarnedThisMonthRaw) / 1e6).toFixed(2);
    const topSupported = tipperStats.creatorsSupported.slice(0, 2);
    const mostSupported = topSupported[0];
    const mostSupportedHandle = mostSupported?.username || mostSupported?.authorId || "";
    const inviteTargets = tipperStats.creatorsSupported.filter((creator) => creator.claimStatus === "unclaimed").slice(0, 3);
    const safeInviteIndex = inviteTargets.length ? inviteIndex % inviteTargets.length : 0;
    const inviteTarget = inviteTargets[safeInviteIndex];
    const inviteHandle = inviteTarget?.username || inviteTarget?.authorId || "";
    const inviteTotal = inviteTarget?.totalRaw ? Number(inviteTarget.totalRaw) / 1e6 : Number(inviteTarget?.total || 0);
    const inviteCopy = inviteHandle
      ? `Hey @${inviteHandle.replace(/^@/, "")}, I sent you support through Teep. Your tips are waiting to be claimed when you connect your account.\n\n${WEB_APP_URL}`
      : "Creators can claim support sent through Teep when their account is connected.";
    const shareInviteUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(inviteCopy)}`;
    const supportedHandles = new Set(
      tipperStats.creatorsSupported
        .map((creator) => (creator.username || creator.authorId || "").replace(/^@/, "").toLowerCase())
        .filter(Boolean)
    );
    const discoverCreator = discoverCreators.find((c) => c?.username && !supportedHandles.has(String(c.username).replace(/^@/, "").toLowerCase()));
    const discoverHandle = discoverCreator?.username || "";
    const showNextBestAction = Boolean(inviteTarget);

    return (
      <DashboardShell address={address} title="Overview">
          <div className="dashboard-body-inner">
            <div className="dashboard-page-heading">
              <div>
                <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 var(--space-1)", letterSpacing: "-0.02em" }}>Your creator support</h1>
                <p style={{ color: "var(--text-secondary)", margin: 0 }}>Tip again, track receipts, and see when creators can claim what you sent.</p>
              </div>
            </div>

            <div className="dashboard-tipper-overview">
              <div className="dashboard-metric-card dashboard-balance-readiness">
                <div className="dashboard-metric-label">Balance Readiness</div>
                <div className="dashboard-metric-value">
                  ${formatUsdRaw(balanceRaw)}
                  <span className="dashboard-metric-value-sub">USD</span>
                </div>
                <div className="dashboard-ready-state">
                  <span aria-hidden />
                  Ready to tip
                </div>
                <div className="dashboard-balance-actions-wrap" ref={addFundsRef}>
                  <div className="dashboard-balance-actions">
                    <button type="button" ref={addFundsButtonRef} onClick={() => setAddFundsOpen((open) => !open)} className="btn-primary">
                      <span className="material-symbols-outlined" aria-hidden>add_circle</span>
                      Add Funds
                    </button>
                    <Link to="/dashboard/withdraw" className="dashboard-balance-withdraw">
                      <span className="material-symbols-outlined" aria-hidden>arrow_downward</span>
                      Withdraw
                    </Link>
                  </div>
                  {addFundsOpen && addFundsPanelRect && createPortal(
                    <div
                      className="dashboard-funding-panel dashboard-funding-panel--balance dashboard-funding-panel--floating"
                      style={{
                        left: addFundsPanelRect.left,
                        top: addFundsPanelRect.top,
                        width: addFundsPanelRect.width,
                      }}
                    >
                      <div className="dashboard-funding-title">Add Funds</div>
                      <div className="dashboard-funding-options">
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
                              <small>{fundingPolicy.providers.fiatOnramp.disabledReason || "Card and bank funding is not available yet."}</small>
                            </span>
                            <span>Soon</span>
                          </button>
                        )}
                        <button type="button" onClick={handleFaucet} disabled={faucetLoading || !fundingPolicy.providers.faucet.enabled} className="dashboard-funding-option">
                          <span>
                            <strong>{fundingPolicy.providers.faucet.label}</strong>
                            <small>{fundingPolicy.providers.faucet.description}</small>
                          </span>
                          <span>{faucetLoading ? "..." : "Open"}</span>
                        </button>
                        <button type="button" onClick={copyDepositAddress} className="dashboard-funding-option">
                          <span>
                            <strong>{fundingPolicy.providers.cryptoReceive.label}</strong>
                            <small>{fundingPolicy.providers.cryptoReceive.description}</small>
                          </span>
                          <span>{walletCopyFeedback ? "Copied" : "Copy"}</span>
                        </button>
                      </div>
                      <p className="dashboard-funding-note">{fundingPolicy.testnetCopy}</p>
                      {fundingMsg && <p className="dashboard-funding-note dashboard-funding-note--status">{fundingMsg}</p>}
                    </div>,
                    document.body
                  )}
                </div>
                <div className="dashboard-balance-watermark" aria-hidden>$</div>
              </div>

              <div className="dashboard-metric-card dashboard-tip-impact">
                <div className="dashboard-impact-main">
                  <div className="dashboard-impact-icon">
                    <span className="material-symbols-outlined" aria-hidden>volunteer_activism</span>
                  </div>
                  <div>
                    <div className="dashboard-impact-title">
                      You supported {tipperStats.creatorsSupported.length} creator{tipperStats.creatorsSupported.length === 1 ? "" : "s"}
                    </div>
                    <div className="dashboard-metric-footer">Across {tipperStats.tipCount} tips this month</div>
                  </div>
                </div>
                <div className="dashboard-impact-stats">
                  <div>
                    <div className="dashboard-metric-label">Most Supported</div>
                    {mostSupportedHandle ? (
                      <div className="dashboard-most-supported">
                        <img
                          src={mostSupported?.profileImageUrl || `https://unavatar.io/twitter/${mostSupportedHandle}`}
                          alt=""
                          onError={(e) => { e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${mostSupportedHandle}`; }}
                        />
                        <span>@{mostSupportedHandle.replace(/^@/, "")}</span>
                      </div>
                    ) : (
                      <div className="dashboard-impact-stat">None yet</div>
                    )}
                  </div>
                  <div>
                    <div className="dashboard-metric-label">Average Tip</div>
                    <div className="dashboard-impact-stat">${averageTipUsd.toFixed(2)}</div>
                  </div>
                </div>
              </div>

              <div className="dashboard-metric-card dashboard-referral-impact-card">
                <div className="dashboard-referral-impact-watermark" aria-hidden>
                  <span className="material-symbols-outlined">rocket_launch</span>
                </div>
                <div className="dashboard-metric-label">Referral Impact</div>
                <h3>{Number(referralEarnedThisMonth) > 0 ? "Network fees earned" : "Invite users to Teep"}</h3>
                <p>
                  {Number(referralEarnedThisMonth) > 0 ? (
                    <>You've earned <strong>${referralEarnedThisMonth}</strong> this month from eligible referral activity.</>
                  ) : (
                    <>Invite users and earn when eligible referred withdrawals happen.</>
                  )}
                </p>
                <Link to="/dashboard/referrals" className="dashboard-referral-impact-action">
                  Share Invite Link
                </Link>
              </div>

              {showNextBestAction && inviteTarget && (
                <div className="dashboard-metric-card dashboard-next-action">
                  <div className="dashboard-next-action-main">
                    <div className="dashboard-metric-label">Next Best Action</div>
                    <h3>Invite @{inviteHandle.replace(/^@/, "")} to claim</h3>
                    <p>Your tips are sent. Help this creator discover Teep and activate their receiving account.</p>
                    <div className="dashboard-next-target">
                      <img
                        src={inviteTarget.profileImageUrl || `https://unavatar.io/twitter/${inviteHandle}`}
                        alt=""
                        className="dashboard-next-target-avatar"
                        onError={(e) => { e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${inviteHandle}`; }}
                      />
                      <div>
                        <strong>@{inviteHandle.replace(/^@/, "")}</strong>
                        <span>${inviteTotal.toFixed(2)} sent across {inviteTarget.tipCount || 0} tips</span>
                      </div>
                      <span>Awaiting claim</span>
                    </div>
                  </div>
                  <div className="dashboard-next-action-side">
                    <div>
                      <div className="dashboard-metric-label">Invite {safeInviteIndex + 1} of {inviteTargets.length}</div>
                      <p>Share a ready-made X post that points the creator back to Teep.</p>
                    </div>
                    <a href={shareInviteUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
                      Share Invite to X
                    </a>
                    {inviteTargets.length > 1 && (
                      <div className="dashboard-next-carousel" aria-label="Unclaimed creator invites">
                        <button
                          type="button"
                          className="btn-secondary"
                          aria-label="Previous invite"
                          onClick={() => setInviteIndex((current) => (current - 1 + inviteTargets.length) % inviteTargets.length)}
                        >
                          <span className="material-symbols-outlined" aria-hidden>chevron_left</span>
                        </button>
                        <div className="dashboard-next-dots" aria-hidden>
                          {inviteTargets.map((target, idx) => (
                            <span key={target.authorId || target.username || idx} className={idx === safeInviteIndex ? "is-active" : ""} />
                          ))}
                        </div>
                        <button
                          type="button"
                          className="btn-secondary"
                          aria-label="Next invite"
                          onClick={() => setInviteIndex((current) => (current + 1) % inviteTargets.length)}
                        >
                          <span className="material-symbols-outlined" aria-hidden>chevron_right</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="dashboard-section-heading">
              <h3>Creators to tip again</h3>
            </div>
            <div className="dashboard-creator-repeat-grid">
              {topSupported.map((creator, idx) => {
                const handle = creator.username || creator.authorId || "creator";
                const total = creator.totalRaw ? Number(creator.totalRaw) / 1e6 : Number(creator.total || 0);
                return (
                  <div key={handle} className="dashboard-repeat-card">
                    <div className="dashboard-repeat-cover" />
                    <div className="dashboard-repeat-body">
                      <img
                        src={creator.profileImageUrl || `https://unavatar.io/twitter/${handle}`}
                        alt=""
                        className="dashboard-repeat-avatar"
                        onError={(e) => { e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${handle}`; }}
                      />
                      <h4>
                        @{handle}
                        {idx === 0 && <span>Top Supported</span>}
                      </h4>
                      <p>Creator you support on Teep</p>
                      <div className="dashboard-repeat-stats">
                        <div><span>Total Tipped</span><strong>${total.toFixed(2)}</strong></div>
                        <div><span>Tips Given</span><strong>{creator.tipCount || 0}</strong></div>
                      </div>
                      <button type="button" className="btn-primary" onClick={() => openDirectTip(creator)} disabled={!creator.authorId && !creator.username}>
                        Send Direct Tip
                      </button>
                    </div>
                  </div>
                );
              })}
              {discoverHandle && (
                <div className="dashboard-repeat-card">
                  <div className="dashboard-repeat-cover" />
                  <div className="dashboard-repeat-body">
                    <img
                      src={discoverCreator?.profileImageUrl || `https://unavatar.io/twitter/${discoverHandle}`}
                      alt=""
                      className="dashboard-repeat-avatar"
                      onError={(e) => { e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${discoverHandle}`; }}
                    />
                    <h4>
                      @{discoverHandle}
                      <span>Trending</span>
                    </h4>
                    <p>{discoverCreator?.displayName || "Trending creator on Teep"}</p>
                    <div className="dashboard-repeat-stats">
                      <div><span>Total Tipped</span><strong>$0.00</strong></div>
                      <div><span>7d Signal</span><strong>{discoverCreator?.tipCount || 0} tips</strong></div>
                    </div>
                    <div className="dashboard-repeat-actions">
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => openDirectTip({
                          authorId: discoverCreator?.authorId,
                          username: discoverCreator?.username || null,
                          profileImageUrl: discoverCreator?.profileImageUrl || null,
                          totalRaw: "0",
                          total: "0",
                          tipCount: 0,
                          isVerified: true,
                          claimStatus: "verified",
                        })}
                        disabled={!discoverCreator?.authorId && !discoverCreator?.username}
                      >
                        Send Direct Tip
                      </button>
                      <a href={`https://x.com/${discoverHandle}`} target="_blank" rel="noopener noreferrer" className="btn-secondary" aria-label={`Open @${discoverHandle} on X`}>
                        <span className="material-symbols-outlined" aria-hidden>open_in_new</span>
                      </a>
                    </div>
                  </div>
                </div>
              )}
              <Link to="/dashboard/discover" className="dashboard-repeat-card dashboard-repeat-discover">
                <div>
                  <div className="dashboard-impact-icon">
                    <span className="material-symbols-outlined" aria-hidden>person_add</span>
                  </div>
                  <h4>Discover creators on Teep</h4>
                  <p>Creators receiving support across Teep.</p>
                </div>
              </Link>
            </div>

            <div className="dashboard-activity-section">
              <div>
                <div className="dashboard-history-header dashboard-history-header--table">
                  <div>
                    <div className="dashboard-metric-label">Activity</div>
                    <h3 style={{ fontSize: "1.25rem", margin: 0 }}>Tip activity and receipts</h3>
                  </div>
                  <div className="dashboard-history-tools">
                    <button type="button" className="btn-secondary" onClick={() => downloadActivityCsv(filteredSentItems)}>
                      Download CSV
                    </button>
                    <button type="button" className="dashboard-filter-icon-btn" aria-label="Filter activity" onClick={() => setHistoryFiltersOpen((open) => !open)}>
                      <span className="material-symbols-outlined" aria-hidden>tune</span>
                    </button>
                  </div>
                </div>
                {historyFiltersOpen && (
                  <div className="dashboard-history-filter-row">
                    <label className="dashboard-history-search">
                      <span className="material-symbols-outlined" aria-hidden>search</span>
                      <input
                        type="search"
                        value={historySearch}
                        onChange={(e) => setHistorySearch(e.target.value)}
                        placeholder="Search creator or @handle"
                        aria-label="Search spending history by creator"
                      />
                    </label>
                  </div>
                )}
                <div className="dashboard-card" style={{ padding: 0 }}>
                  {filteredSentItems.length === 0 ? (
                    <div style={{ padding: "var(--space-6)", textAlign: "center", color: "var(--text-muted)" }}>
                      {sentItems.length === 0 ? "No tips given yet." : "No tips match that search."}
                    </div>
                  ) : (
                    <>
                      <div className="dashboard-table-container">
                        <table className="dashboard-table">
                          <thead>
                            <tr>
                              <th>Creator</th>
                              <th>Amount</th>
                              <th>Date</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pagedSentItems.map((item, i) => {
                              const actionKey = item.tx_hash || `${item.timestamp}-${i}`;
                              const isActionMenuOpen = historyActionsOpen === actionKey;

                              return (
                              <tr key={actionKey}>
                                <td>
                                  <div className="dashboard-table-cell-content" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}>
                                    {item.author_handle && (
                                      <img
                                        src={`https://unavatar.io/twitter/${item.author_handle}`}
                                        alt=""
                                        style={{ width: 32, height: 32, flexShrink: 0, borderRadius: "50%", background: "var(--bg-elevated)", objectFit: "cover" }}
                                        onError={(e) => { e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${item.author_handle}`; }}
                                      />
                                    )}
                                    <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {item.author_handle ? `@${item.author_handle}` : (item.detail || "Unknown")}
                                    </span>
                                    <span className={`dashboard-history-type-pill ${item.type === "direct_creator_tip" ? "is-direct" : "is-post"}`}>
                                      {getTeepActivityTypeLabel(item.type)}
                                    </span>
                                  </div>
                                </td>
                                <td style={{ fontWeight: 600 }}>${formatUsdRaw(item.amount)}</td>
                                <td style={{ color: "var(--text-secondary)" }}>
                                  {new Date(item.timestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                </td>
                                <td>
                                  <div className="dashboard-history-menu-wrap">
                                    <button
                                      type="button"
                                      className="dashboard-history-menu-trigger"
                                      aria-label="Activity actions"
                                      aria-expanded={isActionMenuOpen}
                                      onClick={() => setHistoryActionsOpen((open) => open === actionKey ? null : actionKey)}
                                    >
                                      <span className="material-symbols-outlined" aria-hidden>more_horiz</span>
                                    </button>
                                    {isActionMenuOpen && (
                                      <div className="dashboard-history-actions-menu">
                                        {item.author_handle && item.tweet_id && (
                                          <a
                                            href={`https://x.com/${item.author_handle.replace(/^@/, "")}/status/${item.tweet_id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="dashboard-history-action"
                                            onClick={() => setHistoryActionsOpen(null)}
                                          >
                                            <span className="material-symbols-outlined" aria-hidden>open_in_new</span>
                                            Post
                                          </a>
                                        )}
                                        <button type="button" onClick={() => { shareHistoryOnX(item); setHistoryActionsOpen(null); }} className="dashboard-history-action">
                                          <span className="material-symbols-outlined" aria-hidden>ios_share</span>
                                          Share to X
                                        </button>
                                        <button type="button" onClick={() => { downloadHistoryReceipt(item); setHistoryActionsOpen(null); }} className="dashboard-history-action">
                                          <span className="material-symbols-outlined" aria-hidden>receipt_long</span>
                                          Download Receipt
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="dashboard-pagination">
                        <span>
                          Showing {(safeHistoryPage - 1) * HISTORY_PAGE_SIZE + 1}-{Math.min(safeHistoryPage * HISTORY_PAGE_SIZE, filteredSentItems.length)} of {filteredSentItems.length}
                        </span>
                        <div className="dashboard-pagination-actions">
                          <button type="button" onClick={() => setHistoryPage((p) => Math.max(1, p - 1))} disabled={safeHistoryPage <= 1}>
                            Previous
                          </button>
                          <span>{safeHistoryPage} / {historyPageCount}</span>
                          <button type="button" onClick={() => setHistoryPage((p) => Math.min(historyPageCount, p + 1))} disabled={safeHistoryPage >= historyPageCount}>
                            Next
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div style={{ display: "none" }}>
                <h3 style={{ fontSize: "1.25rem", margin: "0 0 var(--space-4) 0" }}>Top Supported</h3>
                <div className="dashboard-card" style={{ padding: "var(--space-4) var(--space-5)" }}>
                  {topSupported.length === 0 ? (
                    <div style={{ padding: "var(--space-4) 0", color: "var(--text-muted)", textAlign: "center" }}>No supported creators yet</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                      {topSupported.map((creator, idx) => {
                        const handle = creator.username || creator.authorId || "creator";
                        const total = creator.totalRaw ? Number(creator.totalRaw) / 1e6 : Number(creator.total || 0);
                        return (
                        <div key={handle} className="dashboard-top-supported-item">
                          <div className="dashboard-top-supported-left">
                            <div className="dashboard-top-supported-avatar">
                              <img 
                                src={`https://unavatar.io/twitter/${handle}`} 
                                alt=""
                                onError={(e) => { e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${handle}`; }}
                              />
                              <div className="dashboard-top-supported-rank" style={idx === 0 ? { background: "var(--accent)", color: "#fff" } : idx === 1 ? { background: "#9ca3af", color: "#fff" } : idx === 2 ? { background: "#b45309", color: "#fff" } : {}}>
                                {idx + 1}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: "var(--text-small)", fontWeight: 700 }}>{creator.username ? `@${handle}` : handle}</div>
                              <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{creator.tipCount || 0} Tips given</div>
                            </div>
                          </div>
                          <div style={{ fontSize: "var(--text-small)", fontWeight: 800 }}>
                            ${total.toFixed(2)}
                          </div>
                        </div>
                      )})}
                      <Link to="/leaderboard" className="btn-secondary" style={{ width: "100%", justifyContent: "center", marginTop: "var(--space-2)", padding: "10px" }}>
                        View Leaderboard
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {false && discoverCreators.length > 0 && (
              <div style={{ marginTop: "var(--space-4)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
                  <h3 style={{ fontSize: "1.25rem", margin: 0 }}>Discover Creators</h3>
                </div>
                <div className="dashboard-discover-grid">
                  {discoverCreators.slice(0, 4).map((c: any) => (
                    <div key={c.authorId || c.username} className="dashboard-discover-card">
                      <div className="dashboard-discover-cover">
                        <img src={`https://api.dicebear.com/7.x/shapes/svg?seed=${c.username}&backgroundColor=161121,2d2839`} alt="" />
                      </div>
                      <div className="dashboard-discover-avatar">
                        <img 
                          src={`https://unavatar.io/twitter/${c.username}`} 
                          alt="" 
                          onError={(e) => { e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${c.username}`; }}
                        />
                      </div>
                      <div className="dashboard-discover-info">
                        <h4>@{c.username}</h4>
                        <p>Web3 Creator</p>
                        <Link to={`/profile/creator/${c.username}`} className="dashboard-discover-btn" style={{ display: "block", textAlign: "center" }}>
                          Send Tip
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {directTipModal}
      </DashboardShell>
    );
  }

  // Creator: full dashboard
  const totalReceived = creatorData?.totalReceivedUsd || "0.00";
  const tipCount = creatorData?.tipCount ?? 0;
  const topPosts = (creatorData?.topPosts || []).slice(0, 5);
  const topSupporters = creatorData?.topSupporters || [];
  const receivedTips = (creatorData?.recentTips?.length ? creatorData.recentTips : history.filter((item) => item.type === "tip_received")).slice(0, 7);
  const maxDaily = Math.max(...earningsDaily.map((d) => parseFloat(d.amountUsd)), 0.01);
  const chartLabels = earningsDaily.length > 0
    ? [
        earningsDaily[0]?.date,
        earningsDaily[Math.floor(earningsDaily.length / 2)]?.date,
        earningsDaily[earningsDaily.length - 1]?.date,
      ].filter(Boolean)
    : [];
  return (
    <DashboardShell address={address} title="Creator Dashboard">
      <div className="dashboard-body-inner creator-overview">
        <section className="creator-overview-hero-grid">
          <div className="creator-overview-hero dashboard-card">
            <div>
              <div className="dashboard-metric-label">Available to withdraw</div>
              <div className="creator-overview-balance">${normalizeRawUsd(balanceRaw)}</div>
              <p>Creator tips earned from your verified X identity and ready for the cash-out flow.</p>
              <div className="creator-overview-actions">
                <Link to="/creator/withdraw" className="btn-primary">Cash out</Link>
                <Link to="/creator/settings" className="btn-secondary">View receipts</Link>
                <a href={`${WEB_APP_URL}/${creatorData?.username || ""}`} target="_blank" rel="noopener noreferrer" className="creator-overview-icon-btn" aria-label="Open public profile">
                  <span className="material-symbols-outlined" aria-hidden>ios_share</span>
                </a>
              </div>
            </div>
            <div className="creator-overview-balance-split">
              <div className="creator-overview-balance-tile creator-overview-balance-tile--primary">
                <div className="dashboard-metric-label">Total support received</div>
                <strong>${totalReceived}</strong>
                <span>All creator support recorded for your claimed X identity.</span>
              </div>
              <div className="creator-overview-balance-tile">
                <div className="dashboard-metric-label">Main Teep balance</div>
                <strong>${normalizeRawUsd(mainBalanceRaw)}</strong>
                <span>Balance available for tipping, Grow Tips, and other account actions.</span>
              </div>
            </div>
          </div>

          <aside className="creator-readiness-card dashboard-card">
            <div className="creator-section-head">
              <h3>Next steps</h3>
            </div>
            <div className="creator-readiness-list">
              <div className="creator-readiness-row">
                <span className="creator-readiness-icon is-complete"><span className="material-symbols-outlined" aria-hidden>check</span></span>
                <div>
                  <strong>X account verified</strong>
                  <p>Your creator tips are linked to your verified X identity.</p>
                </div>
                <span className="creator-status is-complete">Done</span>
              </div>
              <div className="creator-readiness-row is-open">
                <span className="creator-readiness-icon" aria-hidden />
                <div>
                  <strong>Review receipt sharing</strong>
                  <p>Choose whether shared tip receipts include amounts.</p>
                </div>
                <Link to="/creator/settings" className="creator-status">Review</Link>
              </div>
              <div className="creator-readiness-row is-open">
                <span className="creator-readiness-icon" aria-hidden />
                <div>
                  <strong>Explore Grow Tips</strong>
                  <p>See the beta growth option before strategy settings are enabled.</p>
                </div>
                <Link to="/creator/grow/earn" className="creator-status">Open</Link>
              </div>
            </div>
          </aside>
        </section>

        <section className="creator-overview-stats">
          <div className="dashboard-metric-card">
            <div className="dashboard-metric-label">Total received</div>
            <div className="dashboard-metric-value">${totalReceived}</div>
          </div>
          <div className="dashboard-metric-card">
            <div className="dashboard-metric-label">Tips received</div>
            <div className="dashboard-metric-value">{tipCount}</div>
          </div>
          <div className="dashboard-metric-card">
            <div className="dashboard-metric-label">Supporters</div>
            <div className="dashboard-metric-value">{topSupporters.length}</div>
          </div>
          <div className="dashboard-metric-card">
            <div className="dashboard-metric-label">Supported posts</div>
            <div className="dashboard-metric-value">{topPosts.length}</div>
          </div>
        </section>

        <section className="creator-overview-main-grid">
          <div className="dashboard-card creator-latest-card">
            <div className="creator-section-head">
              <h3>Latest tips</h3>
              <Link to="/creator/performance">See all</Link>
            </div>
            {receivedTips.length === 0 ? (
              <div className="dashboard-empty-state">New creator tips will appear here after they are indexed.</div>
            ) : (
              <div className="creator-tip-list">
                {receivedTips.slice(0, 3).map((item) => {
                  const handle = item.author_handle?.replace(/^@/, "");
                  const postUrl = handle && item.tweet_id ? `https://x.com/${handle}/status/${item.tweet_id}` : "";
                  const supporter = item.from_addr || item.from_address || "";
                  return (
                    <article className="creator-tip-row" key={`${item.tx_hash || item.timestamp}-${item.amount}`}>
                      <div className="creator-supporter-avatar">{safeAddress(supporter) || "T"}</div>
                      <div>
                        <div className="creator-tip-title">
                          {safeAddress(supporter) || "Teep supporter"} tipped you <span>${formatUsdRaw(item.amount)}</span>
                        </div>
                        <p>{handle ? `For a verified X post by @${handle}` : "For creator support on Teep"}</p>
                        <div className="creator-row-actions">
                          {postUrl && <a href={postUrl} target="_blank" rel="noopener noreferrer">View post</a>}
                          <button type="button" onClick={() => shareHistoryOnX(item)}>Share</button>
                          <button type="button" onClick={() => downloadHistoryReceipt(item)}>Receipt</button>
                        </div>
                      </div>
                      <time>{formatHistoryTime(item.timestamp)}</time>
                    </article>
                  );
                })}
              </div>
            )}
          </div>

          <div className="dashboard-card creator-top-posts-card">
            <div className="creator-section-head">
              <h3>Top tipped posts</h3>
              <Link to="/creator/performance">30D</Link>
            </div>
            {topPosts.length === 0 ? (
              <div className="dashboard-empty-state">Posts that receive tips will appear here.</div>
            ) : (
              <div className="creator-top-post-list">
                {topPosts.slice(0, 4).map((post) => {
                  const handle = post.authorHandle || creatorData?.username || "";
                  const tweetUrl = handle && post.tweetId ? `https://x.com/${handle}/status/${post.tweetId}` : "";
                  const preview = postPreviews[post.contentId];
                  return (
                    <article className="creator-top-post-row" key={post.contentId}>
                      <div className="creator-post-thumb">
                        {preview?.thumbnailUrl ? <img src={preview.thumbnailUrl} alt="" /> : <span>X</span>}
                      </div>
                      <div>
                        <strong>{preview?.excerpt || postDisplayLabel(post)}</strong>
                        <span><b>${post.totalUsd} earned</b> - {post.count} tips</span>
                      </div>
                      {tweetUrl && (
                        <a href={tweetUrl} target="_blank" rel="noopener noreferrer" aria-label="Open post on X">
                          <span className="material-symbols-outlined" aria-hidden>open_in_new</span>
                        </a>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="creator-overview-main-grid creator-overview-main-grid--lower">
          <div className="dashboard-card creator-supporters-card">
            <div className="creator-section-head">
              <h3>Supporters</h3>
              <div className="creator-tabs" aria-label="Supporter view">
                <button type="button" className="is-active">Top</button>
                <button type="button">Recent</button>
                <button type="button">Repeat</button>
              </div>
            </div>
            {topSupporters.length === 0 ? (
              <div className="dashboard-empty-state">Supporter totals will appear once tips are indexed.</div>
            ) : (
              <div className="creator-supporter-grid">
                {topSupporters.slice(0, 4).map((supporter) => (
                  <Link to={`/profile/tipper/${supporter.address}`} key={supporter.address} className="creator-supporter-tile">
                    <div className="creator-supporter-avatar">{supporter.address.slice(2, 4).toUpperCase()}</div>
                    <div>
                      <strong>{safeAddress(supporter.address)}</strong>
                      <span><b>${supporter.totalUsd}</b> supported</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="creator-side-stack">
            <div className="dashboard-card creator-grow-card">
              <span className="material-symbols-outlined" aria-hidden>eco</span>
              <h3>Grow Tips</h3>
              <p>Move available tip balance into Grow Tips when the beta strategy is enabled.</p>
              <div className="creator-grow-amount">
                <div className="dashboard-metric-label">Available to grow</div>
                <strong>${normalizeRawUsd(mainBalanceRaw)}</strong>
              </div>
              <Link to="/creator/grow/earn" className="btn-secondary">Explore Grow Tips</Link>
            </div>
          </div>
        </section>

        <section className="dashboard-card creator-trend-card">
          <div className="creator-section-head">
            <div>
              <h3>Earnings trend</h3>
              <p>Creator support over time.</p>
            </div>
            <div className="creator-tabs" aria-label="Earnings period">
              {[7, 30, 90].map((days) => (
                <button key={days} type="button" className={chartDays === days ? "is-active" : ""} onClick={() => setChartDays(days)}>
                  {days}D
                </button>
              ))}
            </div>
          </div>
          {earningsDaily.length === 0 ? (
            <div className="dashboard-empty-state">Earnings trend appears after creator tips are indexed.</div>
          ) : (
            <>
              <div
                className={`creator-trend-chart ${chartDays >= 90 ? "creator-trend-chart--dense" : ""}`}
                style={{ gridTemplateColumns: `repeat(${earningsDaily.length}, minmax(0, 1fr))` }}
                aria-label="Earnings trend"
              >
                {earningsDaily.map((day) => {
                  const amount = parseFloat(day.amountUsd);
                  const height = Math.max((amount / maxDaily) * 100, amount > 0 ? 5 : 2);
                  return (
                    <div key={day.date} className="creator-trend-bar-wrap" title={`${day.date}: $${day.amountUsd}`}>
                      <div className="creator-trend-bar" style={{ height: `${height}%` }} />
                    </div>
                  );
                })}
              </div>
              <div className="creator-trend-labels">
                {chartLabels.map((label) => <span key={label}>{label}</span>)}
              </div>
            </>
          )}
        </section>
      </div>
      {directTipModal}
    </DashboardShell>
  );

}
