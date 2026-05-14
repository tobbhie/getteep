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

function HeroTweetCard({
  className,
  handle,
  body,
  amount,
}: {
  className: string;
  handle: string;
  body: string;
  amount: string;
}) {
  return (
    <div className={`landing-hero-tweet ${className}`}>
      <div className="landing-hero-tweet-header">
        <div className="landing-hero-tweet-avatar" />
        <div>
          <div className="landing-hero-tweet-name">{handle}</div>
          <div className="landing-hero-tweet-meta">@{handle.toLowerCase().replace(/\s+/g, "")} - now</div>
        </div>
      </div>
      <p>{body}</p>
      <div className="landing-hero-tweet-media" />
      <div className="landing-hero-tweet-actions">
        <span>2.4K likes</span>
        <span>640 reposts</span>
        <span className="landing-hero-tweet-tip">${amount} tip</span>
      </div>
    </div>
  );
}

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
    <div className="landing-v2">
      <section className="landing-hero-v2">
        <div className="landing-hero-mosaic" aria-hidden>
          <div className="landing-hero-mosaic-fade" />
          <div className="landing-hero-tweet-grid">
            <HeroTweetCard className="landing-hero-tweet--one" handle="Alex River" body="This essay helped me ship again. Tiny support from readers goes a long way." amount="5" />
            <HeroTweetCard className="landing-hero-tweet--two" handle="Maya Builds" body="New walkthrough is live. If it saves you time, send a small tip and keep the series going." amount="10" />
            <HeroTweetCard className="landing-hero-tweet--three" handle="Design Notes" body="Creators should own the upside from their work, not just chase algorithms." amount="3" />
            <HeroTweetCard className="landing-hero-tweet--four" handle="Indie Desk" body="Tips received today can be claimed, withdrawn, or put to work with simple growth tools." amount="12" />
            <HeroTweetCard className="landing-hero-tweet--six" handle="Open Studio" body="Reader support keeps independent work alive. Every small tip counts." amount="2" />
          </div>
        </div>
        <div className="landing-hero-inner">
          <div className="landing-hero-content">
            <div className="landing-hero-pill">
              <Icon name="bolt" />
              Built for creator support.
            </div>
            <h1 className="landing-hero-title-v2">
              Tip creators.
              <br />
              <span className="landing-hero-accent">Grow tips.</span>
            </h1>
            <p className="landing-hero-desc">
              Teep lets fans tip creators directly from supported posts, giving creators a simple way to claim, withdraw, or grow tips in an experience that feels native to everyone.
            </p>
            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="landing-hero-cta landing-hero-cta--secondary">
              <Icon name="puzzle" />
              {HAS_CHROME_STORE_LISTING ? "Tip from supported posts" : "Join extension beta"}
            </a>
            <div className="landing-hero-trust-row" aria-label="Teep benefits">
              <span className="landing-hero-trust-chip">
                <Icon name="shield" />
                Non-custodial
              </span>
              <span className="landing-hero-trust-chip">
                <Icon name="coin" />
                Stable tips
              </span>
              <span className="landing-hero-trust-chip">
                <Icon name="clock" />
                Claim anytime
              </span>
            </div>
          </div>
          <div className="landing-form-wrap">
            <div className="landing-glass-card">
              <span className="landing-form-badge" aria-hidden>LIVE</span>
              <h3 className="landing-form-title">
                <Icon name="send" className="landing-form-title-icon" />
                Send a Tip
              </h3>
              <div className="landing-form-field">
                <label className="landing-form-label">Content link</label>
                <div className="landing-form-input-wrap">
                  <Icon name="link" className="landing-form-input-icon" />
                  <input
                    type="url"
                    className="landing-form-input"
                    placeholder="Paste post URL"
                    value={contentUrl}
                    onChange={(e) => setContentUrl(e.target.value)}
                    aria-label="Content link"
                  />
                </div>
              </div>
              <div className="landing-form-field">
                <label className="landing-form-label">Tip amount (USD)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="landing-form-input"
                  placeholder="5.00"
                  value={tipAmount}
                  onChange={(e) => setTipAmount(e.target.value)}
                  aria-label="Tip amount USD"
                />
              </div>
              <div className="landing-form-field">
                <label className="landing-form-label">Creator</label>
                <div className="landing-form-creator-block">
                  {resolvedCreator ? (
                    <>
                      <div className="landing-form-creator-avatar-wrap">
                        <img
                          src={getAvatarUrls(resolvedCreator).primary}
                          alt=""
                          className="landing-form-creator-avatar-img"
                          onError={(e) => {
                            e.currentTarget.src = getAvatarUrls(resolvedCreator).fallback;
                            e.currentTarget.onerror = null;
                          }}
                        />
                        <div className="landing-form-creator-avatar" aria-hidden />
                      </div>
                      <div className="landing-form-creator-info">
                        <p className="landing-form-creator-name">@{resolvedCreator}</p>
                        <p className="landing-form-creator-meta">Creator</p>
                      </div>
                      <Icon name="checkCircle" className="landing-form-creator-verified" />
                    </>
                  ) : (
                    <span className="landing-form-creator-placeholder">-</span>
                  )}
                </div>
              </div>
              {authenticated && !address ? (
                <div className="landing-form-create-wallet">
                  <p className="landing-form-create-wallet-text">
                    Create your Teep wallet to send tips. This is a one-time step.
                  </p>
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
                    className="landing-form-submit"
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
                    <p className="landing-form-create-wallet-error" role="alert">
                      {createWalletError}
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleSendTip}
                  disabled={!parsed || amountNum <= 0}
                  className="landing-form-submit"
                >
                  <Icon name="bolt" />
                  SEND TIP
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {stats && (
        <section className="landing-stats-v2" id="stats">
          <div className="landing-stats-grid">
            <div className="landing-stat-v2">
              <p className="landing-stat-value-v2">${stats.totalVolumeUsd}+</p>
              <p className="landing-stat-label-v2">Total Tips Sent</p>
            </div>
            <div className="landing-stat-v2">
              <p className="landing-stat-value-v2 landing-stat-primary">{stats.distinctTippers.toLocaleString()}+</p>
              <p className="landing-stat-label-v2">Active Tippers</p>
            </div>
            <div className="landing-stat-v2">
              <p className="landing-stat-value-v2 landing-stat-success">{stats.verifiedCreators.toLocaleString()}+</p>
              <p className="landing-stat-label-v2">Verified Creators</p>
            </div>
          </div>
        </section>
      )}

      <section className="landing-how-v2" id="how-it-works">
        <div className="landing-how-v2-header">
          <h2 className="landing-section-title-v2">How it works</h2>
          <p className="landing-section-desc">Seamless integration across your favorite platforms. Start in minutes.</p>
          <div className="landing-tabs">
            <button
              type="button"
              className={`landing-tab ${howTab === "tippers" ? "landing-tab-active" : ""}`}
              onClick={() => setHowTab("tippers")}
            >
              For Tippers
            </button>
            <button
              type="button"
              className={`landing-tab ${howTab === "creators" ? "landing-tab-active" : ""}`}
              onClick={() => setHowTab("creators")}
            >
              For Creators
            </button>
          </div>
        </div>
        <div className="landing-how-v2-grid">
          <div className="landing-how-v2-steps">
            {howTab === "tippers" && (
              <>
                <div className="landing-step">
                  <div className="landing-step-num-v2">1</div>
                  <div>
                    <h4 className="landing-step-title">Install Extension</h4>
                    <p className="landing-step-desc">Add Teep to Chrome or Brave. Securely connect your wallet in seconds.</p>
                  </div>
                </div>
                <div className="landing-step">
                  <div className="landing-step-num-v2">2</div>
                  <div>
                    <h4 className="landing-step-title">Browse Normally</h4>
                    <p className="landing-step-desc">Browse supported platforms as usual. The Tip button appears natively beside the share and bookmark actions.</p>
                  </div>
                </div>
                <div className="landing-step">
                  <div className="landing-step-num-v2">3</div>
                  <div>
                    <h4 className="landing-step-title">Confirm & Send</h4>
                    <p className="landing-step-desc">Enter the amount and confirm. The creator receives the tip instantly.</p>
                  </div>
                </div>
              </>
            )}
            {howTab === "creators" && (
              <>
                <div className="landing-step">
                  <div className="landing-step-num-v2 landing-step-success">1</div>
                  <div>
                    <h4 className="landing-step-title">Connect Your Account</h4>
                    <p className="landing-step-desc">Link your creator identity in seconds and make your posts ready to receive tips.</p>
                  </div>
                </div>
                <div className="landing-step">
                  <div className="landing-step-num-v2 landing-step-success">2</div>
                  <div>
                    <h4 className="landing-step-title">Claim Your Page</h4>
                    <p className="landing-step-desc">Get a dedicated tipping link for your bio and a custom profile page.</p>
                  </div>
                </div>
                <div className="landing-step">
                  <div className="landing-step-num-v2 landing-step-success">3</div>
                  <div>
                    <h4 className="landing-step-title">Receive Tips</h4>
                    <p className="landing-step-desc">Claim, withdraw, or grow tips from your creator dashboard.</p>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="landing-how-v2-preview">
            {howTab === "tippers" ? (
              <div className="landing-how-v2-video-wrap">
                {!tipperVideoReady && (
                  <div className="landing-how-video-fallback" aria-hidden>
                    <div className="landing-how-video-post">
                      <div className="landing-how-video-avatar" />
                      <div className="landing-how-video-lines">
                        <span />
                        <span />
                      </div>
                    </div>
                    <div className="landing-how-video-actions">
                      <span />
                      <span />
                      <strong>Tip</strong>
                    </div>
                  </div>
                )}
                <video
                  className="landing-how-v2-video"
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
              <div className="landing-how-v2-mockup">
                <div className="landing-how-v2-mockup-inner">
                  <div className="landing-how-v2-mockup-row">
                    <div className="landing-how-v2-mockup-avatar" />
                    <div className="landing-how-v2-mockup-line" />
                  </div>
                  <div className="landing-how-v2-mockup-block" />
                  <div className="landing-how-v2-mockup-footer">
                    <div className="landing-how-v2-mockup-btn">Claim your page</div>
                    <div className="landing-how-v2-mockup-dots">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="landing-live-feed">
        <div className="landing-live-feed-inner">
          <div className="landing-live-feed-header">
            <div className="landing-live-feed-title-wrap">
              <span className="landing-live-feed-dot" aria-hidden />
              <h3 className="landing-live-feed-title">Live Tip Activity Feed</h3>
            </div>
            <Link to="/leaderboard" className="landing-live-feed-view-all">View All Activity</Link>
          </div>
          <div className="landing-live-feed-grid">
            {recentTips.length === 0 ? (
              <div className="landing-live-feed-empty">No tips yet. Be the first!</div>
            ) : (
              recentTips.slice(0, 10).map((tip, index) => {
                const creator = tip.creatorUsername ?? tip.postAuthorHandle ?? null;
                const creatorLabel = creator ? `@${creator}` : "Unknown creator";
                const tipperAvatar = getAvatarUrls(tip.fromAddress);
                const creatorAvatar = getAvatarUrls(creator ?? "");
                return (
                  <div className="landing-live-feed-card glass-panel" key={`${tip.fromAddress}-${tip.timestamp}-${index}`}>
                    <div className="landing-live-feed-card-row">
                      <div className="landing-live-feed-avatar-wrap">
                        <img
                          src={tipperAvatar.primary}
                          alt=""
                          className="landing-live-feed-avatar-img"
                          onError={(e) => {
                            e.currentTarget.src = tipperAvatar.fallback;
                            e.currentTarget.onerror = null;
                          }}
                        />
                        <div className="landing-live-feed-avatar landing-live-feed-avatar-tipper" aria-hidden />
                      </div>
                      <span className="landing-live-feed-username truncate">{truncateAddress(tip.fromAddress)}</span>
                      <div className="landing-live-feed-amount">
                        <Icon name="bolt" className="landing-live-feed-bolt" />
                        <span className="landing-live-feed-amount-value">${tip.amountUsd}</span>
                      </div>
                    </div>
                    <div className="landing-live-feed-connector">
                      <Icon name="arrowRight" className="landing-live-feed-arrow" />
                    </div>
                    <div className="landing-live-feed-card-row landing-live-feed-card-row-bottom">
                      <div className="landing-live-feed-avatar-wrap">
                        <img
                          src={creatorAvatar.primary}
                          alt=""
                          className="landing-live-feed-avatar-img"
                          onError={(e) => {
                            e.currentTarget.src = creatorAvatar.fallback;
                            e.currentTarget.onerror = null;
                          }}
                        />
                        <div className="landing-live-feed-avatar landing-live-feed-avatar-creator" aria-hidden />
                      </div>
                      <span className="landing-live-feed-username truncate">{creatorLabel}</span>
                      {tip.postUrl ? (
                        <a href={tip.postUrl} target="_blank" rel="noopener noreferrer" className="landing-live-feed-view-post" aria-label="View post">
                          <XLogoIcon className="landing-live-feed-x-icon" />
                          <span>View post</span>
                        </a>
                      ) : (
                        <span className="landing-live-feed-view-post landing-live-feed-view-post-placeholder" aria-hidden>
                          <XLogoIcon className="landing-live-feed-x-icon" />
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      <section className="landing-faq-v2" id="faq">
        <h2 className="landing-section-title-v2">Frequently Asked Questions</h2>
        <div className="landing-faq-list">
          {FAQ_ITEMS.map((item, idx) => (
            <details className="landing-faq-item" open={faqOpenSet.has(idx)} key={item.q}>
              <summary
                className="landing-faq-question"
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
              </summary>
              <div className="landing-faq-answer">{item.a}</div>
            </details>
          ))}
        </div>
      </section>

      <section className="landing-cta-v2">
        <h2 className="landing-cta-title-v2">Have a favorite creator you wanna tip?</h2>
        <p className="landing-cta-desc">Join people supporting their favorite creators directly without the middlemen.</p>
        <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer" className="landing-cta-btn-v2">
          {HAS_CHROME_STORE_LISTING ? "Get Teep Extension" : "Join Teep Beta"}
        </a>
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
