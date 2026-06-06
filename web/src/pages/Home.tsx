import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { getAvatarUrls } from "@teep/shared";
import { parseUnits } from "viem";
import { arcTestnet } from "../chains";
import { API_BASE, CHROME_STORE_URL, HAS_CHROME_STORE_LISTING, USDC_ADDRESS } from "../config";
import { computeContentId, encodeApproveCall, encodeTipCall, TIP_CONTRACT_ADDRESS } from "../lib/contracts";
import LoginModal from "../components/LoginModal";
import ConfirmTipModal from "../components/ConfirmTipModal";
import RechargePrompt from "../components/RechargePrompt";
import Icon from "../components/Icon";

const PENDING_TIP_KEY = "teep_pending_tip";

interface Stats {
  totalTips: number;
  totalVolumeUsd: string;
  distinctTippers: number;
  verifiedCreators: number;
}

interface RecentTip {
  amountUsd: string;
  creatorUsername: string | null;
  postAuthorHandle?: string | null;
  fromAddress: string;
  timestamp: number;
  postUrl?: string | null;
}

interface PendingTip {
  amountUsd: string;
  handle: string;
  tweetId: string;
}

function parsePostUrl(url: string): { authorHandle: string; tweetId: string } | null {
  const trimmed = url.trim();
  const match = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com|mobile\.twitter\.com)\/([^/]+)\/(?:status|article)\/(\d+)/i
  );
  if (!match) return null;
  const authorHandle = match[1].replace(/^@/, "");
  const tweetId = match[2];
  if (authorHandle.toLowerCase() === "i" || !authorHandle || !tweetId) return null;
  return { authorHandle, tweetId };
}

function truncateAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function XLogoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/* Animated dot-matrix decorations, echoing the reference hero: pixel
   "clouds" that flicker in and dissolve, plus digital-rain streaks.
   Deterministic PRNG so every render produces the same cluster. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PX_COLORS = ["#5b2ee5", "#8f6cf0", "#b9aa8f", "#c7c0b0"];

interface PxCell {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  delay: number;
  dur: number;
}

function PixelCloud({
  className,
  seed,
  variant = "cloud",
}: {
  className: string;
  seed: number;
  variant?: "cloud" | "rain";
}) {
  const cells = useMemo<PxCell[]>(() => {
    const rnd = mulberry32(seed);
    const out: PxCell[] = [];
    if (variant === "rain") {
      for (let c = 0; c < 9; c++) {
        const x = 3 + c * 9;
        let y = rnd() * 18;
        while (y < 112) {
          const h = 6 + rnd() * 16;
          if (rnd() < 0.7) {
            out.push({
              x,
              y,
              w: 2.5,
              h,
              color: PX_COLORS[Math.floor(rnd() * PX_COLORS.length)],
              delay: rnd() * 4,
              dur: 2 + rnd() * 3,
            });
          }
          y += h + 4 + rnd() * 14;
        }
      }
    } else {
      const cols = 12;
      const rows = 9;
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const dx = (i - cols / 2) / (cols / 2);
          const dy = (j - rows / 2) / (rows / 2);
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (rnd() < 0.8 - dist * 0.6) {
            out.push({
              x: i * 7 + rnd() * 2,
              y: j * 7 + rnd() * 2,
              w: 3 + rnd() * 1.5,
              h: 3.5 + rnd() * 2,
              color: PX_COLORS[Math.floor(rnd() * PX_COLORS.length)],
              delay: rnd() * 5,
              dur: 2.5 + rnd() * 3.5,
            });
          }
        }
      }
    }
    return out;
  }, [seed, variant]);

  const viewBox = variant === "rain" ? "0 0 84 118" : "0 0 90 70";
  const width = variant === "rain" ? 100 : 132;
  return (
    <svg className={`lp-px ${className}`} viewBox={viewBox} width={width} aria-hidden>
      {cells.map((c, i) => (
        <rect
          key={i}
          x={c.x}
          y={c.y}
          width={c.w}
          height={c.h}
          fill={c.color}
          className="lp-px-cell"
          style={{ animationDelay: `${c.delay}s`, animationDuration: `${c.dur}s` }}
        />
      ))}
    </svg>
  );
}

/* Thin line-art illustrations for the platform grid, echoing the reference cards */
function PlatformArt({ kind }: { kind: "instant" | "waiting" | "custody" | "native" }) {
  if (kind === "instant") {
    return (
      <svg className="lp-card-art" viewBox="0 0 220 120" aria-hidden>
        <g fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M40 96a70 70 0 0 1 140 0" opacity="0.35" />
          <path d="M58 96a52 52 0 0 1 104 0" opacity="0.6" />
          <path d="M76 96a34 34 0 0 1 68 0" />
          <circle cx="110" cy="96" r="10" />
          <path d="M110 90v8M106 94h8" strokeWidth="1.2" />
        </g>
        <g fill="currentColor">
          <rect x="30" y="30" width="3" height="3" />
          <rect x="186" y="42" width="3" height="3" />
          <rect x="170" y="22" width="3" height="3" />
        </g>
      </svg>
    );
  }
  if (kind === "waiting") {
    return (
      <svg className="lp-card-art" viewBox="0 0 220 120" aria-hidden>
        <g fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="70" y="56" width="80" height="44" rx="6" />
          <path d="M70 70h80" opacity="0.5" />
          <circle cx="110" cy="34" r="12" />
          <path d="M106 34h8M110 30v8" strokeWidth="1.2" />
          <path d="M110 46v10" strokeDasharray="3 4" />
          <circle cx="134" cy="84" r="7" opacity="0.7" />
        </g>
        <g fill="currentColor">
          <rect x="46" y="44" width="3" height="3" />
          <rect x="172" y="50" width="3" height="3" />
        </g>
      </svg>
    );
  }
  if (kind === "custody") {
    return (
      <svg className="lp-card-art" viewBox="0 0 220 120" aria-hidden>
        <g fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M110 22 144 34v26c0 20-14 33-34 40-20-7-34-20-34-40V34Z" />
          <path d="m98 60 9 9 16-18" />
          <circle cx="62" cy="86" r="5" opacity="0.5" />
          <circle cx="160" cy="78" r="5" opacity="0.5" />
        </g>
        <g fill="currentColor">
          <rect x="48" y="36" width="3" height="3" />
          <rect x="168" y="40" width="3" height="3" />
        </g>
      </svg>
    );
  }
  return (
    <svg className="lp-card-art" viewBox="0 0 220 120" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="48" y="24" width="124" height="72" rx="8" />
        <circle cx="68" cy="42" r="8" />
        <path d="M84 38h52M84 48h36" opacity="0.5" />
        <path d="M60 80h14M88 80h14" opacity="0.5" />
        <rect x="124" y="72" width="40" height="16" rx="8" />
        <path d="m136 80 3-4 1.5 4 3-4 1.5 4" strokeWidth="1.2" />
      </g>
    </svg>
  );
}

const POWERED_BY = ["Arc", "USDC", "Circle", "Privy", "viem", "Chrome", "Hardhat", "X"];

const FAQ_ITEMS: Array<{ q: string; a: ReactNode }> = [
  {
    q: "What is Teep?",
    a: "Teep lets fans tip creators directly from supported posts. Creators can claim, withdraw, or grow tips from a simple creator dashboard.",
  },
  {
    q: "Does Teep hold my funds?",
    a: "No. Teep is non-custodial, which means it never holds or controls your funds. Tips move directly between wallets on-chain, so only you control your balance.",
  },
  {
    q: "What does it cost to send a tip?",
    a: (
      <>
        Teep does not charge a fee when tipping, only on withdrawal of earned tips. See <Link to="/fees">Fees</Link> for details.
      </>
    ),
  },
  {
    q: "Can creators grow their tips?",
    a: "Grow Tips is designed to let creators put idle tip balances to work while keeping the tipping experience simple. Availability depends on the beta rollout.",
  },
  {
    q: "What happens if a creator has not set up Teep yet?",
    a: "They can still receive tips. Teep links tips to the creator's social account, and they can claim or manage their balance whenever they choose to connect.",
  },
];

export default function Home() {
  const { ready, authenticated, login, user } = usePrivy();
  const { wallets } = useWallets();
  const { client: smartWalletClient } = useSmartWallets();
  const embeddedWallet = wallets.find((w) => w.walletClientType === "privy");
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

  const [stats, setStats] = useState<Stats | null>(null);
  const [recentTips, setRecentTips] = useState<RecentTip[]>([]);
  const [contentUrl, setContentUrl] = useState("");
  const [tipAmount, setTipAmount] = useState("5.00");
  const [resolvedCreator, setResolvedCreator] = useState<string | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [rechargeModalOpen, setRechargeModalOpen] = useState(false);
  const [pendingTip, setPendingTip] = useState<PendingTip | null>(null);
  const [confirmTipData, setConfirmTipData] = useState<PendingTip | null>(null);
  const [tipSending, setTipSending] = useState(false);
  const [tipError, setTipError] = useState<string | null>(null);
  const [rechargeRetryStatus, setRechargeRetryStatus] = useState<"idle" | "checking" | "insufficient">("idle");
  const [rechargeRetryMessage, setRechargeRetryMessage] = useState<string | null>(null);
  const [howTab, setHowTab] = useState<"tippers" | "creators">("tippers");
  const [faqOpenSet, setFaqOpenSet] = useState<Set<number>>(() => new Set());
  const [createWalletLoading, setCreateWalletLoading] = useState(false);
  const [createWalletError, setCreateWalletError] = useState<string | null>(null);
  const [tipperVideoReady, setTipperVideoReady] = useState(false);
  const [tipModalOpen, setTipModalOpen] = useState(false);
  const { createWallet } = useCreateWallet({
    onSuccess: () => {
      setCreateWalletLoading(false);
      setCreateWalletError(null);
    },
    onError: (err) => {
      setCreateWalletLoading(false);
      setCreateWalletError(typeof err === "string" ? err : "Failed to create wallet");
    },
  });

  useEffect(() => {
    if (!tipModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTipModalOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [tipModalOpen]);

  useEffect(() => {
    if (!import.meta.env.DEV || !ready || !authenticated) return;
    const source = address
      ? smartWalletClient?.account?.address
        ? "smartWallet"
        : embeddedWallet?.address
          ? "embeddedWallet"
          : userWalletAddress
            ? "user.wallet"
            : addressFromLinked
              ? "linkedAccounts"
              : "unknown"
      : null;
    console.log("[Teep Tip Form] Wallet address resolution", {
      ready,
      authenticated,
      linkedAccounts: linkedAccounts.length,
      walletsCount: wallets.length,
      resolvedAddress: address ? `${address.slice(0, 10)}...` : "(empty)",
      source,
    });
  }, [
    ready,
    authenticated,
    address,
    smartWalletClient?.account?.address,
    embeddedWallet?.address,
    userWalletAddress,
    addressFromLinked,
    linkedAccounts.length,
    wallets.length,
  ]);

  useEffect(() => {
    fetch(`${API_BASE}/stats`).then((r) => r.json()).then(setStats).catch(() => {});
    const fetchRecent = () =>
      fetch(`${API_BASE}/stats/recent-tips?limit=10`)
        .then((r) => r.json())
        .then((d) => setRecentTips(d.recentTips ?? []))
        .catch(() => {});

    fetchRecent();
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") fetchRecent();
    }, 45000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchRecent();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!contentUrl.trim()) {
      setResolvedCreator(null);
      return;
    }
    const parsed = parsePostUrl(contentUrl);
    setResolvedCreator(parsed ? parsed.authorHandle : null);
  }, [contentUrl]);

  const parsed = useMemo(() => (contentUrl.trim() ? parsePostUrl(contentUrl) : null), [contentUrl]);
  const amountNum = parseFloat(tipAmount) || 0;
  const amountUsd = amountNum > 0 ? amountNum.toFixed(2) : "0.00";

  const fetchBalance = useCallback(async (): Promise<string> => {
    if (!address) return "0";
    const response = await fetch(`${API_BASE}/api/v1/wallet/${address}/usdc-balance`);
    if (!response.ok) return "0";
    const data = await response.json();
    return data.balanceRaw ?? "0";
  }, [address]);

  const handleSendTip = useCallback(async () => {
    if (!ready || !parsed || amountNum <= 0) return;
    const tip: PendingTip = { amountUsd, handle: parsed.authorHandle, tweetId: parsed.tweetId };
    setPendingTip(tip);
    if (!authenticated) {
      sessionStorage.setItem(PENDING_TIP_KEY, JSON.stringify(tip));
      setLoginModalOpen(true);
      return;
    }

    const balanceRaw = await fetchBalance();
    const balance = Number(balanceRaw) / 1e6;
    if (balance < amountNum) {
      setRechargeRetryStatus("idle");
      setRechargeRetryMessage(null);
      setRechargeModalOpen(true);
      return;
    }

    setConfirmTipData(tip);
    setConfirmModalOpen(true);
  }, [ready, parsed, amountNum, amountUsd, authenticated, fetchBalance]);

  useEffect(() => {
    const stored = sessionStorage.getItem(PENDING_TIP_KEY);
    if (stored && authenticated) {
      try {
        setPendingTip(JSON.parse(stored) as PendingTip);
        sessionStorage.removeItem(PENDING_TIP_KEY);
      } catch {
        sessionStorage.removeItem(PENDING_TIP_KEY);
      }
    }
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || !pendingTip) return;
    if (loginModalOpen) setLoginModalOpen(false);
    let cancelled = false;
    const tip = pendingTip;
    const needed = parseFloat(tip.amountUsd);

    const checkAndDecide = async () => {
      const balanceRaw = await fetchBalance();
      const balance = Number(balanceRaw) / 1e6;
      if (cancelled) return;
      if (balance >= needed) {
        setConfirmTipData(tip);
        setConfirmModalOpen(true);
        setPendingTip(null);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 1500));
      if (cancelled) return;
      const retryRaw = await fetchBalance();
      const retryBalance = Number(retryRaw) / 1e6;
      if (cancelled) return;
      if (retryBalance >= needed) {
        setConfirmTipData(tip);
        setConfirmModalOpen(true);
        setPendingTip(null);
        return;
      }

      setRechargeRetryStatus("idle");
      setRechargeRetryMessage(null);
      setRechargeModalOpen(true);
    };

    checkAndDecide();
    return () => {
      cancelled = true;
    };
  }, [authenticated, pendingTip, loginModalOpen, fetchBalance]);

  useEffect(() => {
    if (!rechargeModalOpen || !pendingTip) return;
    const timeout = setTimeout(async () => {
      const balanceRaw = await fetchBalance();
      const balance = Number(balanceRaw) / 1e6;
      const needed = parseFloat(pendingTip.amountUsd);
      if (balance >= needed) {
        setRechargeModalOpen(false);
        setRechargeRetryStatus("idle");
        setRechargeRetryMessage(null);
        setConfirmTipData(pendingTip);
        setConfirmModalOpen(true);
        setPendingTip(null);
      }
    }, 800);
    return () => clearTimeout(timeout);
  }, [rechargeModalOpen, pendingTip, fetchBalance]);

  const openConfirmFromRecharge = useCallback(async () => {
    if (!pendingTip) return;
    setRechargeRetryStatus("checking");
    setRechargeRetryMessage(null);
    const balanceRaw = await fetchBalance();
    const balance = Number(balanceRaw) / 1e6;
    const needed = parseFloat(pendingTip.amountUsd);

    if (balance >= needed) {
      setRechargeRetryStatus("idle");
      setRechargeRetryMessage(null);
      setRechargeModalOpen(false);
      setConfirmTipData(pendingTip);
      setConfirmModalOpen(true);
      return;
    }

    const shortfall = needed - balance;
    setRechargeRetryStatus("insufficient");
    setRechargeRetryMessage(
      balance > 0
        ? `Balance still below $${needed.toFixed(2)}. Add at least $${shortfall.toFixed(2)} more.`
        : `Balance still $0. Add at least $${needed.toFixed(2)} to continue.`
    );
  }, [pendingTip, fetchBalance]);

  const handleConfirmTip = useCallback(async () => {
    if (!confirmTipData || !smartWalletClient?.account || !address) return;
    setTipError(null);
    setTipSending(true);
    try {
      const contentId = computeContentId(confirmTipData.handle, confirmTipData.tweetId);
      const resolved = await fetch(`${API_BASE}/auth/x/user/${encodeURIComponent(confirmTipData.handle.replace(/^@/, ""))}`);
      if (!resolved.ok) throw new Error("Could not verify this creator. Try again in a moment.");
      const resolvedData = (await resolved.json()) as { id?: string };
      if (!resolvedData.id || !/^[0-9]+$/.test(resolvedData.id)) throw new Error("Could not verify this creator.");

      const authorId = BigInt(resolvedData.id);
      const rawAmount = parseUnits(confirmTipData.amountUsd, 6);
      const tipData = encodeTipCall(contentId, authorId, rawAmount);
      const approveData = encodeApproveCall(TIP_CONTRACT_ADDRESS, rawAmount);
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
          authorHandle: confirmTipData.handle,
          tweetId: confirmTipData.tweetId,
        }),
      }).catch(() => {});

      await fetch(`${API_BASE}/tips/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "tip_sent",
          fromAddress: address,
          amount: rawAmount.toString(),
          txHash,
          authorHandle: confirmTipData.handle,
          tweetId: confirmTipData.tweetId,
          detail: `Tipped @${confirmTipData.handle}`,
        }),
      }).catch(() => {});

      setConfirmModalOpen(false);
      setConfirmTipData(null);
      setPendingTip(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setTipError(message.includes("insufficient") || message.includes("balance") ? "Insufficient funds to tip" : message);
    } finally {
      setTipSending(false);
    }
  }, [confirmTipData, smartWalletClient, address]);

  return (
    <div className="lp">
      {/* Hero — centered statement, two CTAs, scattered glyphs */}
      <section className="lp-hero">
        <PixelCloud className="lp-px--1" seed={7} variant="cloud" />
        <PixelCloud className="lp-px--2" seed={23} variant="rain" />
        <PixelCloud className="lp-px--3" seed={41} variant="cloud" />
        <PixelCloud className="lp-px--4" seed={59} variant="rain" />
        <PixelCloud className="lp-px--5" seed={97} variant="cloud" />
        <div className="lp-hero-inner">
          <h1 className="lp-hero-title">
            The tipping layer
            <br />
            for creators.
          </h1>
          <p className="lp-hero-sub">
            Built on Arc. Teep lets fans support creators right from the post — instant, non-custodial, and in stable dollars.
          </p>
          <div className="lp-hero-ctas">
            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn--primary">
              <Icon name="puzzle" />
              {HAS_CHROME_STORE_LISTING ? "Get the Extension" : "Join the Beta"}
            </a>
            <button type="button" className="lp-btn lp-btn--secondary" onClick={() => setTipModalOpen(true)}>
              <Icon name="send" />
              Send a tip
            </button>
          </div>
        </div>
        <div className="lp-marquee" aria-label="Powered by">
          <p className="lp-marquee-caption">Powered by open, onchain infrastructure</p>
          <div className="lp-marquee-viewport">
            <div className="lp-marquee-track">
              {[...POWERED_BY, ...POWERED_BY].map((name, i) => (
                <span className="lp-marquee-item" key={`${name}-${i}`} aria-hidden={i >= POWERED_BY.length}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Three pillars */}
      <section className="lp-pillars">
        <div className="lp-pillar">
          <div className="lp-pillar-icon"><Icon name="bolt" /></div>
          <h3>Tipping</h3>
          <p>Send a tip from the post itself. The Teep button appears natively, right beside share and bookmark.</p>
        </div>
        <div className="lp-pillar">
          <div className="lp-pillar-icon"><Icon name="wallet" /></div>
          <h3>Claiming</h3>
          <p>Creators receive tips before they ever sign up, and claim or withdraw them whenever they are ready.</p>
        </div>
        <div className="lp-pillar">
          <div className="lp-pillar-icon"><Icon name="coin" /></div>
          <h3>Growing</h3>
          <p>Idle tip balances can be put to work with simple growth tools, straight from the creator dashboard.</p>
        </div>
      </section>

      {/* Stats */}
      <section className="lp-stats" id="stats">
        <h2 className="lp-section-title">Where fans support creators onchain.</h2>
        <p className="lp-section-sub">Every tip is an indexed onchain event — balances, receipts, and stats anyone can verify.</p>
        <div className="lp-stats-grid">
          <div className="lp-stat">
            <p className="lp-stat-value">{stats ? `$${stats.totalVolumeUsd}+` : "—"}</p>
            <p className="lp-stat-label">Tipped to creators</p>
          </div>
          <div className="lp-stat">
            <p className="lp-stat-value">{stats ? `${stats.totalTips.toLocaleString()}+` : "—"}</p>
            <p className="lp-stat-label">Tips sent</p>
          </div>
          <div className="lp-stat">
            <p className="lp-stat-value">{stats ? `${stats.distinctTippers.toLocaleString()}+` : "—"}</p>
            <p className="lp-stat-label">Active tippers</p>
          </div>
          <div className="lp-stat">
            <p className="lp-stat-value">{stats ? `${stats.verifiedCreators.toLocaleString()}+` : "—"}</p>
            <p className="lp-stat-label">Verified creators</p>
          </div>
        </div>
      </section>

      {/* Platform grid */}
      <section className="lp-platform">
        <div className="lp-platform-head">
          <h2 className="lp-platform-title">
            <span className="lp-platform-brand">Teep</span> is the platform for creator support at scale.
          </h2>
          <Link to="/leaderboard" className="lp-platform-link">
            Explore activity <Icon name="arrowRight" />
          </Link>
        </div>
        <div className="lp-platform-grid">
          <div className="lp-card">
            <PlatformArt kind="instant" />
            <h3>Instant, low-cost, 24/7</h3>
            <p>Tips settle onchain in seconds, in stable dollars, any hour of any day. No invoices, no payout windows.</p>
          </div>
          <div className="lp-card">
            <PlatformArt kind="waiting" />
            <h3>Tips wait for you</h3>
            <p>Fans can tip creators who have not joined yet. Funds sit in a deterministic claim wallet only the creator can unlock.</p>
          </div>
          <div className="lp-card">
            <PlatformArt kind="custody" />
            <h3>Secure &amp; non-custodial</h3>
            <p>Teep coordinates the experience but never holds funds. Your money. You control it. Always.</p>
          </div>
          <div className="lp-card">
            <PlatformArt kind="native" />
            <h3>Native, not an island</h3>
            <p>No new feed to grow. Teep lives where creator attention already lives — inside the post itself.</p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="lp-how" id="how-it-works">
        <div className="lp-how-head">
          <h2 className="lp-section-title">How it works</h2>
          <p className="lp-section-sub">Native to the platforms you already use. Start in minutes.</p>
          <div className="lp-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={howTab === "tippers"}
              className={`lp-tab ${howTab === "tippers" ? "lp-tab--active" : ""}`}
              onClick={() => setHowTab("tippers")}
            >
              For Tippers
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={howTab === "creators"}
              className={`lp-tab ${howTab === "creators" ? "lp-tab--active" : ""}`}
              onClick={() => setHowTab("creators")}
            >
              For Creators
            </button>
          </div>
        </div>
        <div className="lp-how-grid">
          <div className="lp-how-steps">
            {(howTab === "tippers"
              ? [
                  { title: "Install Extension", desc: "Add Teep to Chrome or Brave. Securely connect in seconds." },
                  { title: "Browse Normally", desc: "The Tip button appears natively beside the share and bookmark actions." },
                  { title: "Confirm & Send", desc: "Enter the amount and confirm. The creator receives the tip instantly." },
                ]
              : [
                  { title: "Connect Your Account", desc: "Link your creator identity in seconds and make your posts ready to receive tips." },
                  { title: "Claim Your Page", desc: "Get a dedicated tipping link for your bio and a custom profile page." },
                  { title: "Receive Tips", desc: "Claim, withdraw, or grow tips from your creator dashboard." },
                ]
            ).map((step, i) => (
              <div className="lp-step" key={step.title}>
                <div className="lp-step-num">{i + 1}</div>
                <div>
                  <h4 className="lp-step-title">{step.title}</h4>
                  <p className="lp-step-desc">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="lp-how-preview">
            {howTab === "tippers" ? (
              <div className="lp-how-video-wrap">
                {!tipperVideoReady && (
                  <div className="lp-how-video-fallback" aria-hidden>
                    <div className="lp-how-video-post">
                      <div className="lp-how-video-avatar" />
                      <div className="lp-how-video-lines">
                        <span />
                        <span />
                      </div>
                    </div>
                    <div className="lp-how-video-actions">
                      <span />
                      <span />
                      <strong>Tip</strong>
                    </div>
                  </div>
                )}
                <video
                  className="lp-how-video"
                  src="/Tipper.mp4"
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  onLoadedData={() => setTipperVideoReady(true)}
                  onCanPlay={() => setTipperVideoReady(true)}
                  aria-label="How tipping works"
                />
              </div>
            ) : (
              <div className="lp-how-mockup">
                <div className="lp-how-mockup-row">
                  <div className="lp-how-mockup-avatar" />
                  <div className="lp-how-mockup-line" />
                </div>
                <div className="lp-how-mockup-block" />
                <div className="lp-how-mockup-footer">
                  <div className="lp-how-mockup-btn">Claim your page</div>
                  <div className="lp-how-mockup-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Live activity */}
      <section className="lp-live">
        <div className="lp-live-head">
          <h2 className="lp-section-title">
            <span className="lp-live-dot" aria-hidden />
            Live on Teep
          </h2>
          <Link to="/leaderboard" className="lp-platform-link">
            View all activity <Icon name="arrowRight" />
          </Link>
        </div>
        <div className="lp-live-grid">
          {recentTips.length === 0 ? (
            <div className="lp-live-empty">No tips yet. Be the first!</div>
          ) : (
            recentTips.slice(0, 8).map((tip, index) => {
              const creator = tip.creatorUsername ?? tip.postAuthorHandle ?? null;
              const creatorLabel = creator ? `@${creator}` : "Unknown creator";
              const tipperAvatar = getAvatarUrls(tip.fromAddress);
              const creatorAvatar = getAvatarUrls(creator ?? "");
              return (
                <div className="lp-live-card" key={`${tip.fromAddress}-${tip.timestamp}-${index}`}>
                  <div className="lp-live-row">
                    <img
                      src={tipperAvatar.primary}
                      alt=""
                      className="lp-live-avatar"
                      onError={(e) => {
                        e.currentTarget.src = tipperAvatar.fallback;
                        e.currentTarget.onerror = null;
                      }}
                    />
                    <span className="lp-live-name">{truncateAddress(tip.fromAddress)}</span>
                    <span className="lp-live-amount">${tip.amountUsd}</span>
                  </div>
                  <div className="lp-live-connector" aria-hidden>
                    <Icon name="arrowRight" />
                  </div>
                  <div className="lp-live-row">
                    <img
                      src={creatorAvatar.primary}
                      alt=""
                      className="lp-live-avatar"
                      onError={(e) => {
                        e.currentTarget.src = creatorAvatar.fallback;
                        e.currentTarget.onerror = null;
                      }}
                    />
                    <span className="lp-live-name">{creatorLabel}</span>
                    {tip.postUrl ? (
                      <a href={tip.postUrl} target="_blank" rel="noopener noreferrer" className="lp-live-post" aria-label="View post">
                        <XLogoIcon className="lp-live-x" />
                      </a>
                    ) : (
                      <span className="lp-live-post lp-live-post--muted" aria-hidden>
                        <XLogoIcon className="lp-live-x" />
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* FAQ */}
      <section className="lp-faq" id="faq">
        <h2 className="lp-section-title">Frequently asked questions</h2>
        <div className="lp-faq-list">
          {FAQ_ITEMS.map((item, idx) => (
            <details className="lp-faq-item" open={faqOpenSet.has(idx)} key={item.q}>
              <summary
                className="lp-faq-q"
                onClick={(e) => {
                  e.preventDefault();
                  setFaqOpenSet((current) => {
                    const next = new Set(current);
                    if (next.has(idx)) next.delete(idx);
                    else next.add(idx);
                    return next;
                  });
                }}
              >
                {item.q}
                <span className="lp-faq-toggle" aria-hidden>{faqOpenSet.has(idx) ? "−" : "+"}</span>
              </summary>
              <div className="lp-faq-a">{item.a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* CTA band — leads into the purple footer */}
      <section className="lp-cta">
        <div className="lp-cta-wave" aria-hidden>
          {Array.from({ length: 36 }, (_, i) => (
            <span key={i} style={{ animationDelay: `${(i % 9) * 0.12}s` }} />
          ))}
        </div>
        <div className="lp-cta-inner">
          <h2 className="lp-cta-title">Start earning on Teep.</h2>
          <p className="lp-cta-sub">Support from your fans, in your control. Fast, stable, and always on.</p>
          <div className="lp-cta-btns">
            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn--inverse">
              <Icon name="puzzle" />
              {HAS_CHROME_STORE_LISTING ? "Get the Extension" : "Join the Beta"}
            </a>
            <Link to="/dashboard" className="lp-btn lp-btn--ghost">
              Open Dashboard
            </Link>
          </div>
        </div>
      </section>

      {tipModalOpen && (
        <div className="lp-modal-overlay" role="dialog" aria-modal="true" aria-label="Send a tip" onClick={() => setTipModalOpen(false)}>
          <div className="lp-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="lp-modal-close" onClick={() => setTipModalOpen(false)} aria-label="Close">
              ×
            </button>
            <h3 className="lp-modal-title">
              <Icon name="send" />
              Send a tip
            </h3>
            <p className="lp-modal-sub">Paste a link to a supported post, choose an amount, done. The creator gets the rest.</p>
            <div className="lp-tip-field">
              <label className="lp-tip-label" htmlFor="lp-tip-url">Content link</label>
              <div className="lp-tip-input-wrap">
                <Icon name="link" className="lp-tip-input-icon" />
                <input
                  id="lp-tip-url"
                  type="url"
                  className="lp-tip-input lp-tip-input--icon"
                  placeholder="Paste post URL"
                  value={contentUrl}
                  onChange={(e) => setContentUrl(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="lp-tip-field">
              <label className="lp-tip-label" htmlFor="lp-tip-amount">Tip amount (USD)</label>
              <input
                id="lp-tip-amount"
                type="number"
                min="0"
                step="0.01"
                className="lp-tip-input"
                placeholder="5.00"
                value={tipAmount}
                onChange={(e) => setTipAmount(e.target.value)}
              />
            </div>
            <div className="lp-tip-field">
              <span className="lp-tip-label">Creator</span>
              <div className="lp-tip-creator">
                {resolvedCreator ? (
                  <>
                    <img
                      src={getAvatarUrls(resolvedCreator).primary}
                      alt=""
                      className="lp-tip-creator-avatar"
                      onError={(e) => {
                        e.currentTarget.src = getAvatarUrls(resolvedCreator).fallback;
                        e.currentTarget.onerror = null;
                      }}
                    />
                    <span className="lp-tip-creator-name">@{resolvedCreator}</span>
                    <Icon name="checkCircle" className="lp-tip-creator-check" />
                  </>
                ) : (
                  <span className="lp-tip-creator-placeholder">Detected from the link</span>
                )}
              </div>
            </div>
            {authenticated && !address ? (
              <div className="lp-tip-create-wallet">
                <p>Create your Teep wallet to send tips. This is a one-time step.</p>
                <button
                  type="button"
                  onClick={async () => {
                    setCreateWalletError(null);
                    setCreateWalletLoading(true);
                    try {
                      await createWallet();
                    } catch (err) {
                      setCreateWalletLoading(false);
                      setCreateWalletError(err instanceof Error ? err.message : "Failed to create wallet");
                    }
                  }}
                  disabled={createWalletLoading}
                  className="lp-btn lp-btn--primary lp-btn--block"
                >
                  {createWalletLoading ? (
                    "Creating wallet..."
                  ) : (
                    <>
                      <Icon name="wallet" />
                      Create Teep wallet
                    </>
                  )}
                </button>
                {createWalletError && (
                  <p className="lp-tip-error" role="alert">{createWalletError}</p>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTipModalOpen(false);
                  handleSendTip();
                }}
                disabled={!parsed || amountNum <= 0}
                className="lp-btn lp-btn--primary lp-btn--block"
              >
                <Icon name="bolt" />
                Send tip
              </button>
            )}
            <ul className="lp-tip-points lp-tip-points--modal">
              <li><Icon name="shield" /> Non-custodial</li>
              <li><Icon name="coin" /> Stable dollars</li>
              <li><Icon name="clock" /> Claim anytime</li>
            </ul>
          </div>
        </div>
      )}

      <LoginModal
        open={loginModalOpen}
        onClose={() => {
          setLoginModalOpen(false);
          setPendingTip(null);
        }}
        onLogin={login}
        pendingTipSummary={pendingTip ? `$${pendingTip.amountUsd} to @${pendingTip.handle}` : undefined}
      />
      {confirmTipData && (
        <ConfirmTipModal
          open={confirmModalOpen}
          onClose={() => {
            setConfirmModalOpen(false);
            setConfirmTipData(null);
            setTipError(null);
          }}
          amountUsd={confirmTipData.amountUsd}
          handle={confirmTipData.handle}
          tweetId={confirmTipData.tweetId}
          onConfirm={handleConfirmTip}
          sending={tipSending}
          error={tipError}
        />
      )}
      {pendingTip && (
        <RechargePrompt
          open={rechargeModalOpen}
          onClose={() => {
            setRechargeModalOpen(false);
            setPendingTip(null);
            setRechargeRetryStatus("idle");
            setRechargeRetryMessage(null);
          }}
          onRetry={openConfirmFromRecharge}
          amountUsd={pendingTip.amountUsd}
          handle={pendingTip.handle}
          embedFunding
          walletAddress={address || null}
          retryStatus={rechargeRetryStatus}
          retryMessage={rechargeRetryMessage}
        />
      )}
    </div>
  );
}
