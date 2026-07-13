import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { parseUnits } from "viem";
import { arcTestnet } from "../chains";
import { API_BASE, USDC_ADDRESS } from "../config";
import { computeContentId, encodeApproveCall, encodeTipCall, TIP_CONTRACT_ADDRESS } from "../lib/contracts";
import LoginModal from "../components/LoginModal";
import ConfirmTipModal from "../components/ConfirmTipModal";
import RechargePrompt from "../components/RechargePrompt";
import Icon from "../components/Icon";
import { avatarErrorFallback, localInitialsAvatar, xAvatarUrl } from "../lib/avatar";

const PENDING_TIP_KEY = "teep_pending_tip";
const STATIC_HERO_POST = {
  handle: "pipsandbills",
  tweetId: "1969711154847977844",
  url: "https://x.com/pipsandbills/status/1969711154847977844",
};

const HERO_DECLARATIONS = [
  "Tip creators directly from social posts.",
  "Claim tips in one Teep account.",
  "Let idle tips keep working.",
];

interface Stats {
  totalTips: number;
  totalVolumeUsd: string;
  distinctTippers: number;
  verifiedCreators: number;
}

interface AnimatedStats {
  totalTips: number;
  totalVolumeUsd: number;
  distinctTippers: number;
  verifiedCreators: number;
}

interface RecentTip {
  amountUsd: string;
  creatorUsername: string | null;
  postAuthorHandle?: string | null;
  fromAddress: string;
  fromIdentity?: {
    displayName?: string | null;
    teepUsername?: string | null;
    socialXHandle?: string | null;
    creatorUsername?: string | null;
    creatorDisplayName?: string | null;
    profileImageUrl?: string | null;
  } | null;
  timestamp: number;
  postUrl?: string | null;
}

interface PendingTip {
  amountUsd: string;
  handle: string;
  tweetId: string;
}

function XLogoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const GROW_TIPS_PREVIEW_YIELD = "$14.27+";

function usernameFallback(email?: string | null) {
  const local = email?.includes("@") ? email.split("@")[0] : "";
  const cleaned = local
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return cleaned.length >= 3 ? cleaned : "";
}

const FAQ_ITEMS: Array<{ q: string; a: ReactNode }> = [
  {
    q: "What is Teep?",
    a: "Teep is a social finance platform where people support creators and communities, while creators receive, withdraw, or grow what they earn. It works through the web app and connected X tip commands.",
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
    q: "What does Grow Tips do?",
    a: "Grow Tips gives creators optional ways to put idle tip balances to work. Strategy, risk, estimated return, and exit details remain available before any action.",
  },
  {
    q: "What happens if a creator has not set up Teep yet?",
    a: "They can still receive tips. Teep links tips to the creator's social account, and they can claim or manage their balance whenever they choose to connect.",
  },
  {
    q: "Is Teep live?",
    a: "Teep is currently available as a beta on Arc testnet. Beta access lets users explore the product while the wider production release is being prepared.",
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
  const [animatedStats, setAnimatedStats] = useState<AnimatedStats | null>(null);
  const [proofInView, setProofInView] = useState(false);
  const [recentTips, setRecentTips] = useState<RecentTip[]>([]);
  const [tipAmount, setTipAmount] = useState("5.00");
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
  const tipAmountInputRef = useRef<HTMLInputElement>(null);
  const heroStageRef = useRef<HTMLDivElement>(null);
  const heroStoryLabelRef = useRef<HTMLSpanElement>(null);
  const proofRef = useRef<HTMLElement>(null);
  const howTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
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
    if (!ready || !authenticated || !address) return;
    const preferredUsername = usernameFallback(user?.email?.address);
    if (!preferredUsername) return;
    fetch(`${API_BASE}/api/v1/wallet/${address}/settings?preferredUsername=${encodeURIComponent(preferredUsername)}`, {
      cache: "no-store",
    }).catch(() => {});
  }, [ready, authenticated, address, user?.email?.address]);

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
    const proof = proofRef.current;
    if (!proof) return;
    if (!("IntersectionObserver" in window)) {
      setProofInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setProofInView(entry.intersectionRatio >= 0.25),
      { threshold: 0.25 },
    );
    observer.observe(proof);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!stats || !proofInView) return;

    const finalStats: AnimatedStats = {
      totalTips: stats.totalTips,
      totalVolumeUsd: Number.parseFloat(stats.totalVolumeUsd) || 0,
      distinctTippers: stats.distinctTippers,
      verifiedCreators: stats.verifiedCreators,
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setAnimatedStats(finalStats);
      return;
    }

    let frame = 0;
    const duration = 1200;
    const startedAt = performance.now();
    setAnimatedStats({
      totalTips: 0,
      totalVolumeUsd: 0,
      distinctTippers: 0,
      verifiedCreators: 0,
    });

    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedStats({
        totalTips: Math.round(finalStats.totalTips * eased),
        totalVolumeUsd: finalStats.totalVolumeUsd * eased,
        distinctTippers: Math.round(finalStats.distinctTippers * eased),
        verifiedCreators: Math.round(finalStats.verifiedCreators * eased),
      });
      if (progress < 1) frame = window.requestAnimationFrame(animate);
    };

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [proofInView, stats]);

  useEffect(() => {
    const stage = heroStageRef.current;
    if (!stage) return;

    const runway = stage.closest<HTMLElement>(".lp-hero-shell");
    const post = stage.querySelector<HTMLElement>(".lp-stage-post");
    const tip = stage.querySelector<HTMLElement>(".lp-stage-tip");
    if (!runway || !post || !tip) return;

    document.documentElement.classList.add("lp-scroll-demo-active");

    let frame = 0;
    let scrollStart = 0;
    let scrollDistance = 1;

    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    const shouldAnimate = () =>
      window.matchMedia("(max-width: 767px)").matches &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const setGroup = (selector: string, groupProgress: number) => {
      stage.querySelectorAll<HTMLElement>(selector).forEach((element) => {
        element.style.opacity = String(groupProgress);
        element.style.transform = `translateY(${14 * (1 - groupProgress)}px)`;
      });
    };

    const clearPresentation = () => {
      stage.style.removeProperty("--lp-reveal-progress");
      runway.style.removeProperty("--lp-focus-opacity");
      post.style.removeProperty("transform");
      post.style.removeProperty("opacity");
      tip.style.removeProperty("transform");
      stage.querySelectorAll<HTMLElement>(".lp-stage-tip > *").forEach((element) => {
        element.style.removeProperty("opacity");
        element.style.removeProperty("transform");
      });
    };

    const measure = () => {
      const stageDocumentTop = stage.getBoundingClientRect().top + window.scrollY;
      const runwayDocumentTop = runway.getBoundingClientRect().top + window.scrollY;
      scrollStart = stageDocumentTop - 82;
      const scrollEnd = runwayDocumentTop + runway.offsetHeight - window.innerHeight;
      scrollDistance = Math.max(1, scrollEnd - scrollStart);
    };

    const render = () => {
      frame = 0;
      if (!shouldAnimate()) {
        clearPresentation();
        return;
      }

      const progress = clamp((window.scrollY - scrollStart) / scrollDistance);
      const drawerProgress = clamp((progress - 0.12) / 0.4);
      const drawerEase = 1 - Math.pow(1 - drawerProgress, 3);
      const postProgress = clamp((progress - 0.08) / 0.46);
      const creatorProgress = clamp((progress - 0.24) / 0.14);
      const amountProgress = clamp((progress - 0.42) / 0.14);
      const reviewProgress = clamp((progress - 0.6) / 0.14);
      const focusIn = clamp(progress / 0.06);
      const focusOut = clamp((1 - progress) / 0.06);
      const focusOpacity = Math.min(focusIn, focusOut) * 0.92;

      stage.style.setProperty("--lp-reveal-progress", progress.toFixed(3));
      runway.style.setProperty("--lp-focus-opacity", focusOpacity.toFixed(3));
      post.style.transform = `translateY(${-88 * postProgress}px) scale(${1 - 0.08 * postProgress})`;
      post.style.opacity = String(1 - 0.72 * postProgress);
      tip.style.transform = `translateY(${tip.offsetHeight * (1 - drawerEase)}px)`;
      setGroup(".lp-stage-label, .lp-stage-tip > h2, #lp-stage-tip-help, .lp-stage-recipient", creatorProgress);
      setGroup(".lp-stage-field, .lp-amount-chips", amountProgress);
      setGroup(".lp-stage-tip > .lp-btn--block, .lp-create-wallet, .lp-stage-note", reviewProgress);

      if (heroStoryLabelRef.current) {
        heroStoryLabelRef.current.textContent =
          progress < 0.25
            ? "01 - Post highlighted"
            : progress < 0.5
              ? "02 - Creator detected"
              : progress < 0.75
                ? "03 - Amount selected"
                : "04 - Review tip";
      }
    };

    const queueRender = () => {
      if (!frame) frame = window.requestAnimationFrame(render);
    };

    const handleResize = () => {
      measure();
      queueRender();
    };

    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(handleResize)
      : null;
    resizeObserver?.observe(runway);
    resizeObserver?.observe(stage);

    measure();
    render();
    window.addEventListener("scroll", queueRender, { passive: true });
    window.addEventListener("resize", handleResize);
    window.addEventListener("load", handleResize);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      document.documentElement.classList.remove("lp-scroll-demo-active");
      clearPresentation();
      window.removeEventListener("scroll", queueRender);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("load", handleResize);
      resizeObserver?.disconnect();
    };
  }, []);

  const revealHeroTipForm = useCallback(() => {
    const stage = heroStageRef.current;
    const runway = stage?.closest<HTMLElement>(".lp-hero-shell");
    const isMobileDemo = window.matchMedia("(max-width: 767px)").matches &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (stage && runway && isMobileDemo) {
      const stageDocumentTop = stage.getBoundingClientRect().top + window.scrollY;
      const runwayDocumentTop = runway.getBoundingClientRect().top + window.scrollY;
      const scrollStart = stageDocumentTop - 82;
      const scrollEnd = runwayDocumentTop + runway.offsetHeight - window.innerHeight;
      const scrollDistance = Math.max(1, scrollEnd - scrollStart);
      window.scrollTo({
        top: scrollStart + scrollDistance * 0.78,
        behavior: "smooth",
      });
      return;
    }

    tipAmountInputRef.current?.focus();
  }, []);

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
    if (!ready || amountNum <= 0) return;
    const tip: PendingTip = { amountUsd, handle: STATIC_HERO_POST.handle, tweetId: STATIC_HERO_POST.tweetId };
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
  }, [ready, amountNum, amountUsd, authenticated, fetchBalance]);

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
          sourceMethod: "web_landing",
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

  const handleHowTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const lastIndex = howTabRefs.current.length - 1;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? lastIndex
          : event.key === "ArrowRight"
            ? (index + 1) % (lastIndex + 1)
            : (index - 1 + lastIndex + 1) % (lastIndex + 1);
    const nextTab = nextIndex === 0 ? "tippers" : "creators";
    setHowTab(nextTab);
    howTabRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="lp">
      <section className="lp-hero" id="top">
        <div className="lp-hero-art" aria-hidden="true">
          <span className="lp-hero-glyph lp-hero-glyph--1"><Icon name="shield" /></span>
          <span className="lp-hero-glyph lp-hero-glyph--2"><Icon name="send" /></span>
          <span className="lp-hero-glyph lp-hero-glyph--3"><Icon name="coin" /></span>
          <span className="lp-hero-glyph lp-hero-glyph--4"><Icon name="wallet" /></span>
          <span className="lp-hero-glyph lp-hero-glyph--5"><Icon name="bolt" /></span>
        </div>
        <div className="lp-hero-shell">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow"><Icon name="coin" /> Social finance for creators and communities</p>
            <h1>Tip creators anywhere on the internet.</h1>
            <div className="lp-hero-loop" aria-label="Tip from posts. Claim in Teep. Grow idle tips.">
              <Icon name="bolt" />
              <span className="lp-hero-loop-copy" aria-hidden="true">
                {HERO_DECLARATIONS.map((text, index) => (
                  <span key={text} style={{ "--loop-index": index } as CSSProperties}>{text}</span>
                ))}
              </span>
              <span className="lp-hero-loop-fallback">Tip from posts. Claim in Teep. Grow idle tips.</span>
            </div>
            <div className="lp-hero-actions">
              <a href="/dashboard" target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn--primary"><Icon name="wallet" /> Launch App</a>
              <a href="#how-it-works" className="lp-btn lp-btn--secondary lp-hero-how-cta">
                <Icon name="checkCircle" /> How it Works
              </a>
            </div>
          </div>

          <div className="lp-scroll-focus-backdrop" aria-hidden="true" />
          <div ref={heroStageRef} className="lp-product-stage" aria-label="Teep tipping experience">
            <div className="lp-scroll-story-status" aria-live="polite">
              <span className="lp-scroll-story-copy">
                <span className="lp-scroll-story-stamp">Tip demo</span>
                <span ref={heroStoryLabelRef}>01 - Post highlighted</span>
              </span>
              <span className="lp-scroll-story-track" aria-hidden="true" />
            </div>
            <div className="lp-stage-toolbar" aria-hidden="true"><span /><span /><span /><small>Connected social post · Teep active</small></div>
            <div className="lp-stage-post">
              <article className="lp-social-post" aria-label="X post preview by @pipsandbills">
                <div className="lp-post-preview-label"><XLogoIcon /> X post preview</div>
                <div className="lp-post-author">
                  <span className="lp-post-avatar">PB</span>
                  <div><strong>Alter Ego</strong><small>@pipsandbills · Sep 21, 2025</small></div>
                  <a
                    className="lp-post-more"
                    href={STATIC_HERO_POST.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open original post on X"
                  >
                    <XLogoIcon />
                  </a>
                </div>
                <p className="lp-post-copy">
                  I had a discussion with @mztacat recently where I had told him Aztec CM called out "airdrop farmers" but he jokingly replied and said he is a project contributor. That made me think: what does it really mean to be a contributor? What separates those who get four figures from those who...
                </p>
                <a
                  className="lp-post-read-more"
                  href={STATIC_HERO_POST.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Read full post on X
                </a>
                <div className="lp-post-media" aria-label="Post theme preview">
                  <div className="lp-post-media-copy">
                    <span>Community contribution</span>
                    <strong>What separates participation from real contribution?</strong>
                  </div>
                  <div className="lp-post-media-icon"><Icon name="coin" /></div>
                </div>
                <div className="lp-post-actions">
                  <span aria-hidden>Reply</span><span aria-hidden>Repost</span>
                  <button type="button" className="lp-post-action-icon" aria-label="Like preview"><Icon name="heart" /></button>
                  <button type="button" onClick={revealHeroTipForm}><Icon name="send" /> Tip</button>
                  <a className="lp-post-action-icon" href={STATIC_HERO_POST.url} target="_blank" rel="noopener noreferrer" aria-label="Open original post on X"><Icon name="externalLink" /></a>
                </div>
              </article>
            </div>

            <form className="lp-stage-tip" aria-labelledby="lp-stage-tip-title" onSubmit={(event) => { event.preventDefault(); handleSendTip(); }}>
              <p className="lp-stage-label"><Icon name="send" /> Teep tip</p>
              <h2 id="lp-stage-tip-title">Support this post</h2>
              <p id="lp-stage-tip-help">Choose an amount to support the highlighted post.</p>
              <div className="lp-stage-recipient" aria-live="polite">
                <span className="lp-post-avatar">PB</span>
                <div><strong>@{STATIC_HERO_POST.handle}</strong><small>Author of the highlighted post</small></div>
                <Icon name="checkCircle" />
              </div>
              <label className="lp-stage-field" htmlFor="lp-hero-tip-amount">
                <span>Tip amount</span>
                <div className="lp-stage-amount"><span aria-hidden>$</span><input ref={tipAmountInputRef} id="lp-hero-tip-amount" type="number" min="0.01" step="0.01" value={tipAmount} onChange={(event) => setTipAmount(event.target.value)} /><small>USD</small></div>
              </label>
              <div className="lp-amount-chips" aria-label="Suggested tip amounts">
                {["1.00", "5.00", "10.00", "25.00"].map((amount) => (
                  <button key={amount} type="button" className={tipAmount === amount ? "is-active" : ""} aria-pressed={tipAmount === amount} onClick={() => setTipAmount(amount)}>${Number(amount)}</button>
                ))}
              </div>
              {authenticated && !address ? (
                <div className="lp-create-wallet">
                  <p>Create your Teep wallet once to send tips.</p>
                  <button type="button" className="lp-btn lp-btn--primary lp-btn--block" disabled={createWalletLoading} onClick={async () => {
                    setCreateWalletError(null);
                    setCreateWalletLoading(true);
                    try { await createWallet(); } catch (error) {
                      setCreateWalletLoading(false);
                      setCreateWalletError(error instanceof Error ? error.message : "Failed to create wallet");
                    }
                  }}>
                    <Icon name="wallet" /> {createWalletLoading ? "Creating wallet..." : "Create Teep wallet"}
                  </button>
                  {createWalletError && <p className="lp-inline-error" role="alert">{createWalletError}</p>}
                </div>
              ) : (
                <button type="submit" className="lp-btn lp-btn--primary lp-btn--block" disabled={amountNum <= 0}>Review ${amountUsd} tip <Icon name="arrowRight" /></button>
              )}
              <p className="lp-stage-note"><Icon name="shield" /> Creator-controlled and recorded for your receipt.</p>
            </form>
          </div>
        </div>
      </section>

      <section ref={proofRef} className="lp-proof" id="stats" aria-labelledby="lp-proof-title">
        <div className="lp-container">
          <div className="lp-proof-head">
            <h2 id="lp-proof-title">Teep in motion.</h2>
            <p>A live snapshot of support moving through the beta, including what creators have earned by choosing to grow idle tips.</p>
          </div>
          <div className="lp-proof-grid">
            <div className="lp-proof-primary">
              <span>Support delivered</span>
              <strong aria-label={stats ? `$${stats.totalVolumeUsd} plus` : "Loading support delivered"}>
                {animatedStats ? `$${animatedStats.totalVolumeUsd.toFixed(2)}+` : "—"}
              </strong>
              <p>Stable-value tips sent directly to creators through the Teep beta.</p>
            </div>
            <div className="lp-proof-stats">
              <div>
                <strong aria-label={stats ? `${stats.totalTips.toLocaleString()} plus tips completed` : "Loading tips completed"}>
                  {animatedStats ? `${animatedStats.totalTips.toLocaleString()}+` : "—"}
                </strong>
                <span>Tips completed</span>
              </div>
              <div>
                <strong aria-label={stats ? `${stats.distinctTippers.toLocaleString()} plus active supporters` : "Loading active supporters"}>
                  {animatedStats ? `${animatedStats.distinctTippers.toLocaleString()}+` : "—"}
                </strong>
                <span>Active supporters</span>
              </div>
              <div>
                <strong aria-label={stats ? `${stats.verifiedCreators.toLocaleString()} plus verified creators` : "Loading verified creators"}>
                  {animatedStats ? `${animatedStats.verifiedCreators.toLocaleString()}+` : "—"}
                </strong>
                <span>Verified creators</span>
              </div>
              <div className="is-growth">
                <strong>{GROW_TIPS_PREVIEW_YIELD}</strong>
                <span>Extra earned from Grow Tips</span>
                <small>Grow Tips planning figure</small>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section" id="product" aria-labelledby="lp-product-title">
        <div className="lp-container">
          <p className="lp-kicker">One support flow</p>
          <h2 className="lp-section-title" id="lp-product-title">A tip does more than move money.</h2>
          <p className="lp-section-intro">Support can begin from a post or the web, wait safely for a creator, and become available to withdraw or grow.</p>
          <div className="lp-flow">
            <article className="lp-flow-step">
              <div className="lp-flow-head">
                <span className="lp-flow-number">01</span>
                <div className="lp-flow-icon"><Icon name="send" /></div>
                <h3>Support where attention is</h3>
              </div>
              <p>Use the web app or a connected X tip command without sending people to a new feed.</p>
              <button type="button" className="lp-flow-action" onClick={revealHeroTipForm}>
                Try the web tip flow <Icon name="arrowRight" />
              </button>
            </article>
            <article className="lp-flow-step">
              <div className="lp-flow-head">
                <span className="lp-flow-number">02</span>
                <div className="lp-flow-icon"><Icon name="wallet" /></div>
                <h3>Receive and claim simply</h3>
              </div>
              <p>Support can wait for a creator who has not joined yet, then becomes available from one creator dashboard.</p>
              <div className="lp-flow-balance"><small>Available tips</small><strong>$37.38</strong></div>
            </article>
            <article className="lp-flow-step">
              <div className="lp-flow-head">
                <span className="lp-flow-number">03</span>
                <div className="lp-flow-icon"><Icon name="coin" /></div>
                <h3>Withdraw or keep growing</h3>
              </div>
              <p>Creators decide what to take out and what to place into a clearly explained growth option.</p>
              <div className="lp-flow-growth">
                <span><small>Growing</small><strong>$540.25</strong></span>
                <span><small>Extra earned</small><strong>+$12.45</strong></span>
              </div>
              <small className="lp-preview-label">Planning estimate</small>
            </article>
          </div>
        </div>
      </section>

      <section className="lp-defi" id="grow" aria-labelledby="lp-defi-title">
        <div className="lp-container">
          <div className="lp-defi-head">
            <div>
              <p className="lp-kicker">The DeFi part, made understandable</p>
              <h2 className="lp-section-title" id="lp-defi-title">Your tips can keep working. You stay in control.</h2>
              <p className="lp-section-intro">
                Grow Tips turns an optional onchain strategy into a simple choice: keep funds available, or put a chosen amount to work. Teep shows where it goes, what the risks are, and how exiting works before you confirm.
              </p>
            </div>

            <div className="lp-defi-principles" aria-label="Grow Tips principles">
              <article>
                <Icon name="checkCircle" />
                <strong>Always opt-in</strong>
                <span>Nothing moves into a growth option automatically.</span>
              </article>
              <article>
                <Icon name="link" />
                <strong>Choose the amount</strong>
                <span>Keep some available and grow only what you select.</span>
              </article>
              <article>
                <Icon name="shield" />
                <strong>See the route</strong>
                <span>Strategy, risk, return estimate, and exit terms stay visible.</span>
              </article>
            </div>
          </div>

          <div className="lp-defi-map" aria-label="Example showing how creator tips move through Grow Tips">
            <svg className="lp-defi-lines" viewBox="0 0 1000 360" preserveAspectRatio="none" aria-hidden="true">
              <path d="M235 73 C340 73 350 158 455 158" />
              <path d="M235 73 C340 73 350 270 455 270" />
              <path d="M560 158 C675 158 665 73 770 73" />
              <path d="M560 270 C675 270 665 222 770 222" />
            </svg>

            <div className="lp-defi-map-grid">
              <div className="lp-defi-column">
                <h3>Your tip balance</h3>
                <div className="lp-defi-node-stack">
                  <div className="lp-defi-node is-primary">
                    <span className="lp-defi-node-icon"><Icon name="wallet" /></span>
                    <span className="lp-defi-node-copy">
                      <small>Creator-controlled balance</small>
                      <strong>$100.00 in tips</strong>
                      <span>Stable-value support received from your audience.</span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="lp-defi-column">
                <h3>You decide</h3>
                <div className="lp-defi-node-stack">
                  <div className="lp-defi-node">
                    <span className="lp-defi-node-icon"><Icon name="wallet" /></span>
                    <span className="lp-defi-node-copy">
                      <small>Available balance</small>
                      <strong>Keep $40 ready</strong>
                      <span>Available for withdrawal or tipping.</span>
                    </span>
                  </div>
                  <div className="lp-defi-node">
                    <span className="lp-defi-node-icon"><Icon name="coin" /></span>
                    <span className="lp-defi-node-copy">
                      <small>Optional allocation</small>
                      <strong>Grow $60</strong>
                      <span>You review the strategy before signing.</span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="lp-defi-column">
                <h3>What happens next</h3>
                <div className="lp-defi-node-stack">
                  <div className="lp-defi-node">
                    <span className="lp-defi-node-icon"><Icon name="checkCircle" /></span>
                    <span className="lp-defi-node-copy">
                      <small>Ready when needed</small>
                      <strong>$40 stays available</strong>
                      <span>No growth strategy is applied to this amount.</span>
                    </span>
                  </div>
                  <div className="lp-defi-node is-growth">
                    <span className="lp-defi-node-icon"><Icon name="bolt" /></span>
                    <span className="lp-defi-node-copy">
                      <small>Onchain growth route</small>
                      <strong>$60 + variable earnings</strong>
                      <span>Track value, activity, and exit terms from Teep.</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <p className="lp-defi-note">
              <Icon name="shield" />
              Example flow only. Returns are variable and growth strategies carry risk.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="lp-how" id="how-it-works" aria-labelledby="lp-how-title">
        <div className="lp-container lp-how-layout">
          <div className="lp-how-copy">
            <p className="lp-kicker">How it works</p>
            <h2 className="lp-section-title" id="lp-how-title">Simple for fans. Useful for creators.</h2>
            <p className="lp-section-intro">The interface changes with the person using it. The underlying mechanics do not need to lead the experience.</p>
            <div className="lp-tabs" role="tablist" aria-label="How Teep works">
              {(["tippers", "creators"] as const).map((tab, index) => (
                <button
                  key={tab}
                  ref={(element) => { howTabRefs.current[index] = element; }}
                  id={`lp-how-tab-${tab}`}
                  type="button"
                  role="tab"
                  aria-selected={howTab === tab}
                  aria-controls="lp-how-panel"
                  tabIndex={howTab === tab ? 0 : -1}
                  className={`lp-tab ${howTab === tab ? "lp-tab--active" : ""}`}
                  onClick={() => setHowTab(tab)}
                  onKeyDown={(event) => handleHowTabKeyDown(event, index)}
                >
                  For {tab === "tippers" ? "Tippers" : "Creators"}
                </button>
              ))}
            </div>
            <div
              className="lp-how-steps"
              id="lp-how-panel"
              role="tabpanel"
              aria-labelledby={`lp-how-tab-${howTab}`}
              tabIndex={0}
            >
              {(howTab === "tippers"
                ? [
                    { label: "1a", title: "Use the web app", desc: "Tip from creator pages, discovery, or a direct Teep link.", ctaHref: "/creator/pipsandbills", ctaText: "Try it now" },
                    { label: "1b", title: "Tag the X bot", desc: "Reply with a tip command and Teep returns the next step.", ctaHref: "https://twitter.com/intent/tweet?text=%40teepagent%20tip%20%40pipsandbills%20%241", ctaText: "Try it now", ctaExternal: true },
                    { label: "02", title: "Choose an amount", desc: "Pick a stable-value amount and review who receives it." },
                    { label: "03", title: "Confirm and get a receipt", desc: "Send once, then track the receipt from the same account." },
                  ]
                : [
                    { label: "01", title: "Connect your creator account", desc: "Verify the social identity your audience already knows." },
                    { label: "02", title: "Receive support", desc: "Tips appear in one clear creator balance and activity history." },
                    { label: "03", title: "Withdraw or grow", desc: "Choose what to take out and what to keep working over time." },
                  ]
              ).map((step) => (
                <div className="lp-step" key={step.title}>
                  <div className="lp-step-num">{step.label}</div>
                  <div>
                    <h3 className="lp-step-title">{step.title}</h3>
                    <p className="lp-step-desc">{step.desc}</p>
                    {"ctaHref" in step && step.ctaHref ? (
                      step.ctaExternal ? (
                        <a
                          className="lp-step-action"
                          href={step.ctaHref}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {step.ctaText}
                          <Icon name="arrowRight" />
                        </a>
                      ) : (
                        <Link className="lp-step-action" to={step.ctaHref}>
                          {step.ctaText}
                          <Icon name="arrowRight" />
                        </Link>
                      )
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
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
              <div className="lp-creator-preview" aria-label="Creator dashboard preview">
                <div className="lp-creator-preview-head">
                  <strong>Creator overview</strong>
                  <span>Connected</span>
                </div>
                <div className="lp-creator-preview-balance">
                  <div>
                    <small>Tips earned</small>
                    <h3>$37.38</h3>
                    <div className="lp-creator-preview-actions">
                      <span>Withdraw</span>
                      <span>Grow tips</span>
                    </div>
                  </div>
                  <div className="lp-creator-preview-chart" aria-hidden="true">
                    <span />
                  </div>
                </div>
                <div className="lp-creator-preview-list">
                  <div><span>@alterego supported your post</span><strong>+$6.00</strong></div>
                  <div><span>@junio supported your post</span><strong>+$2.50</strong></div>
                  <div><span>Tips available to withdraw</span><strong>$37.38</strong></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Live activity */}
      <section className="lp-live" id="activity" aria-labelledby="lp-live-title">
        <div className="lp-live-head">
          <h2 className="lp-section-title" id="lp-live-title">
            <span className="lp-live-dot" aria-hidden />
            Live on Teep
          </h2>
        </div>
        <div className="lp-live-grid">
          {recentTips.length === 0 ? (
            <div className="lp-live-empty">No tips yet. Be the first!</div>
          ) : (
            recentTips.slice(0, 8).map((tip, index) => {
              const creator = tip.creatorUsername ?? tip.postAuthorHandle ?? null;
              const creatorLabel = creator ? `@${creator}` : "Unknown creator";
              const tipperName = tip.fromIdentity?.displayName?.trim() || "Teep supporter";
              const tipperAvatar = localInitialsAvatar(tipperName);
              const creatorAvatar = xAvatarUrl(creator) || localInitialsAvatar(creator ?? "creator");
              return (
                <div className="lp-live-card" key={`${tip.fromAddress}-${tip.timestamp}-${index}`}>
                  <div className="lp-live-row">
                    <img
                      src={tipperAvatar}
                      alt=""
                      className="lp-live-avatar"
                      onError={(e) => {
                        avatarErrorFallback(e, tipperName);
                      }}
                    />
                    <span className="lp-live-name">{tipperName}</span>
                    <span className="lp-live-amount">${tip.amountUsd}</span>
                  </div>
                  <div className="lp-live-connector" aria-hidden>
                    <Icon name="arrowRight" />
                  </div>
                  <div className="lp-live-row">
                    <img
                      src={creatorAvatar}
                      alt=""
                      className="lp-live-avatar"
                      onError={(e) => {
                        avatarErrorFallback(e, creator);
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

      <section className="lp-trust" aria-labelledby="lp-trust-title">
        <div className="lp-container lp-trust-grid">
          <div>
            <p className="lp-kicker">Trust, without the homework</p>
            <h2 className="lp-section-title" id="lp-trust-title">The infrastructure stays out of the way.</h2>
            <p className="lp-section-intro">Teep abstracts the crypto workflow while keeping controls and verifiable records available when people need them.</p>
            <div className="lp-infra" aria-label="Teep infrastructure">
              <span>Arc testnet</span>
              <span>USDC</span>
              <span>Circle</span>
              <span>Privy</span>
            </div>
          </div>
          <div className="lp-trust-list">
            <article>
              <Icon name="shield" />
              <strong>Creator-controlled</strong>
              <span>Teep coordinates the experience without becoming the destination for user funds.</span>
            </article>
            <article>
              <Icon name="coin" />
              <strong>Stable-value support</strong>
              <span>Amounts remain understandable for supporters and creators instead of moving with token prices.</span>
            </article>
            <article>
              <Icon name="link" />
              <strong>Meaningful receipts</strong>
              <span>Each tip stays connected to the creator or post it supported.</span>
            </article>
            <article>
              <Icon name="checkCircle" />
              <strong>Details on demand</strong>
              <span>Transaction and strategy details are available without dominating the main workflow.</span>
            </article>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="lp-faq" id="faq" aria-labelledby="lp-faq-title">
        <div className="lp-faq-intro">
          <p className="lp-kicker">Questions</p>
          <h2 className="lp-section-title" id="lp-faq-title">Clear before you connect.</h2>
          <p>Straight answers about support, control, and Grow Tips.</p>
        </div>
        <div className="lp-faq-list">
          {FAQ_ITEMS.map((item, idx) => (
            <div className="lp-faq-item" key={item.q}>
              <button
                type="button"
                className="lp-faq-q"
                id={`lp-faq-button-${idx}`}
                aria-expanded={faqOpenSet.has(idx)}
                aria-controls={`lp-faq-panel-${idx}`}
                onClick={() => {
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
              </button>
              <div
                className="lp-faq-a"
                id={`lp-faq-panel-${idx}`}
                role="region"
                aria-labelledby={`lp-faq-button-${idx}`}
                hidden={!faqOpenSet.has(idx)}
              >
                {item.a}
              </div>
            </div>
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
          <p className="lp-kicker">Social finance for creators and communities</p>
          <h2 className="lp-cta-title">Support and grow with Teep.</h2>
          <p className="lp-cta-sub">One place for supporters to send and creators to receive, withdraw, or grow what they earn.</p>
          <div className="lp-cta-btns">
            <a href="/dashboard" target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn--inverse lp-btn--large">
              <Icon name="wallet" />
              Launch App
            </a>
          </div>
        </div>
      </section>

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
