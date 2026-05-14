import { useEffect, useState, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { API_BASE, CHROME_STORE_URL, ONRAMP_URL } from "../config";

/** Format raw USDC (6 decimals) to USD string */
function formatUsdRaw(raw: string): string {
  const n = Number(raw) / 1e6;
  if (isNaN(n)) return "0.00";
  return n.toFixed(2);
}

interface HistoryItem {
  type: string;
  amount: string;
  tx_hash?: string;
  timestamp: number;
  author_handle?: string;
  tweet_id?: string;
  from_addr?: string;
  to_address?: string;
  detail?: string;
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
}

interface EarningsDaily {
  date: string;
  amountUsd: string;
}

export default function Dashboard() {
  const { ready, authenticated, login, logout, user } = usePrivy();
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

  const [loading, setLoading] = useState(true);
  const [isCreator, setIsCreator] = useState(false);
  const [creatorData, setCreatorData] = useState<CreatorData | null>(null);
  const [earningsDaily, setEarningsDaily] = useState<EarningsDaily[]>([]);
  const [chartDays, setChartDays] = useState<number>(30);
  const [balanceRaw, setBalanceRaw] = useState("0");
  const [mainBalanceRaw, setMainBalanceRaw] = useState("0");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  
  // Extra tipper data
  const [tipperStats, setTipperStats] = useState<{
    totalSent: string;
    tipCount: number;
    creatorsSupported: Array<{ authorId?: string; username: string | null; totalRaw?: string; total?: string; tipCount?: number }>;
  }>({ totalSent: "0", tipCount: 0, creatorsSupported: [] });
  const [discoverCreators, setDiscoverCreators] = useState<any[]>([]);
  
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);
  const [addFundsOpen, setAddFundsOpen] = useState(false);
  const [walletCopyFeedback, setWalletCopyFeedback] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const addFundsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
      if (addFundsRef.current && !addFundsRef.current.contains(e.target as Node)) {
        setAddFundsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleCopyRef = () => {
    if (address) {
      const refLink = `${window.location.origin}/?ref=${address}`;
      navigator.clipboard.writeText(refLink);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2000);
    }
  };

  const loadData = useCallback(async () => {
    if (!address) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timeoutMs = 12000;
    const timeoutPromise = new Promise<null>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs));
    try {
      const result = await Promise.race([
        Promise.all([
          fetch(`${API_BASE}/auth/claim-status/${address}`).then((r) => (r.ok ? r.json() : { verified: false, claims: [] })).catch(() => ({ verified: false, claims: [] })),
          fetch(`${API_BASE}/tips/history/${address}?limit=20`).then((r) => (r.ok ? r.json() : { history: [] })).catch(() => ({ history: [] })),
        ]),
        timeoutPromise,
      ]) as [{ verified?: boolean; claims?: unknown[] }, { history?: unknown[] }] | null;
      if (!result) return;
      const [claimRes, historyRes] = result;
      setHistory(Array.isArray(historyRes?.history) ? (historyRes.history as HistoryItem[]) : []);

      if (claimRes?.verified && Array.isArray(claimRes.claims) && claimRes.claims.length > 0) {
        const username = (claimRes.claims[0] as { username?: string }).username;
        if (username) {
          setIsCreator(true);
          const [creatorRes, earningsRes, balanceRes, mainBalanceRes] = await Promise.all([
            fetch(`${API_BASE}/api/v1/creators/${username}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
            fetch(`${API_BASE}/api/v1/creators/${username}/earnings-over-time?days=${chartDays}`).then((r) => (r.ok ? r.json() : { daily: [] })).catch(() => ({ daily: [] })),
            fetch(`${API_BASE}/api/v1/wallet/${address}/balance`).then((r) => (r.ok ? r.json() : { balanceRaw: "0" })).catch(() => ({ balanceRaw: "0" })),
            fetch(`${API_BASE}/api/v1/wallet/${address}/usdc-balance`).then((r) => (r.ok ? r.json() : { balanceRaw: "0" })).catch(() => ({ balanceRaw: "0" })),
          ]);
          if (creatorRes) setCreatorData(creatorRes);
          if (earningsRes?.daily?.length) setEarningsDaily(earningsRes.daily);
          setBalanceRaw(balanceRes?.balanceRaw ?? "0");
          setMainBalanceRaw(mainBalanceRes?.balanceRaw ?? "0");
        } else {
          setIsCreator(false);
        }
      } else {
        setIsCreator(false);
        // Load tipper specific data
        const [walletRes, usdcRes, leaderboardRes] = await Promise.all([
          fetch(`${API_BASE}/tips/wallet/${address}`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`${API_BASE}/api/v1/wallet/${address}/usdc-balance`).then((r) => (r.ok ? r.json() : { balanceRaw: "0" })).catch(() => ({ balanceRaw: "0" })),
          fetch(`${API_BASE}/leaderboard/creators?limit=4`).then(r => r.ok ? r.json() : { creators: [] }).catch(() => ({ creators: [] }))
        ]);
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
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    if (address) loadData();
  }, [address, loadData]);

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
    if (ready && authenticated && !address) setLoading(false);
  }, [ready, authenticated, address]);

  const handleFaucet = useCallback(async () => {
    if (!address) return;
    setFaucetLoading(true);
    try {
      const res = await fetch(`${API_BASE}/faucet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (data.success) {
        setTimeout(() => loadData(), 2000);
      } else {
        console.error("Faucet failed", data.error);
      }
    } catch (err: any) {
      console.error("Network error", err);
    }
    setFaucetLoading(false);
  }, [address, loadData]);

  if (!ready) {
    return (
      <div className="page-section" style={{ paddingTop: "var(--space-8)", textAlign: "center" }}>
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="dashboard-layout">
        <aside className="dashboard-sidebar" style={{ pointerEvents: "none" }}>
          <div style={{ padding: "var(--space-6) var(--space-4) var(--space-4)", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <img src="/logo.svg" alt="Teep" width={32} height={32} />
              <h1 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>Teep</h1>
            </div>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "var(--space-2)" }}>Dashboard</div>
          </div>
          <div style={{ padding: "0 var(--space-2)", flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <div className="dashboard-sidebar-btn" style={{ opacity: 0.7 }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>dashboard</span>Dashboard</div>
            <div className="dashboard-sidebar-btn" style={{ opacity: 0.7 }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>history</span>Spending History</div>
            <div className="dashboard-sidebar-btn" style={{ opacity: 0.7 }}><span className="material-symbols-outlined" style={{ fontSize: 20 }}>leaderboard</span>Creator Leaderboard</div>
          </div>
          <div style={{ padding: "var(--space-4)", borderTop: "1px solid var(--border)" }}>
            <div className="dashboard-sidebar-block" style={{ padding: "var(--space-3)" }}>
              <div style={{ fontSize: "var(--text-small)", fontWeight: 700 }}>Refer and Earn</div>
              <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 2 }}>30% of generated fees</div>
            </div>
          </div>
        </aside>
        <div className="dashboard-body" style={{ pointerEvents: "none" }}>
          <header className="dashboard-header">
            <h2 style={{ fontSize: "1.125rem", margin: 0, fontWeight: 700 }}>Overview</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
              <span className="material-symbols-outlined" style={{ color: "var(--text-muted)" }}>notifications</span>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--bg-elevated)" }} />
            </div>
          </header>
          <div className="dashboard-body-inner">
            <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 var(--space-1)", letterSpacing: "-0.02em" }}>Dashboard</h1>
            <p style={{ color: "var(--text-secondary)", margin: 0 }}>Manage your tips and support creators.</p>
            <div style={{ marginTop: "var(--space-8)", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--space-4)" }}>
              {[1, 2, 3].map((i) => <div key={i} style={{ height: 100, background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }} />)}
            </div>
          </div>
        </div>
        <div
          className="dashboard-logout-overlay"
          style={{
            position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(22, 17, 33, 0.75)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", pointerEvents: "auto",
          }}
        >
          <div
            className="dashboard-logout-modal"
            style={{
              background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)",
              padding: "var(--space-8)", maxWidth: 400, width: "100%", margin: "var(--space-4)", boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
            }}
          >
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
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page-section" style={{ paddingTop: "var(--space-8)", textAlign: "center" }}>
        <p style={{ color: "var(--text-muted)" }}>Loading dashboard…</p>
      </div>
    );
  }

  // Non-creator: minimal view — history of spendings only
  if (!isCreator) {
    const sentItems = history.filter((h) => h.type === "tip_sent" || h.type === "send");
    const addMoneyUrl = address ? ONRAMP_URL.replace("WALLET", address) : CHROME_STORE_URL;
    
    const topSupported = tipperStats.creatorsSupported
      .slice(0, 3);

    return (
      <div className="dashboard-layout">
        <aside className="dashboard-sidebar">
          <div style={{ padding: "var(--space-6) var(--space-4) var(--space-4)", display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <img src="/logo.svg" alt="Teep" width={32} height={32} />
              <h1 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>Teep</h1>
            </div>
            <div style={{ fontSize: 10, color: "var(--text-secondary)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "var(--space-2)" }}>Tipper Dashboard</div>
          </div>

          <div style={{ padding: "0 var(--space-2)", flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
            <Link to="/dashboard" className="dashboard-sidebar-btn" style={{ background: "rgba(99, 36, 235, 0.1)", color: "var(--accent)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>dashboard</span>
              Dashboard
            </Link>
            <Link to="/dashboard" className="dashboard-sidebar-btn">
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>history</span>
              Spending History
            </Link>
            <Link to="/leaderboard" className="dashboard-sidebar-btn">
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>leaderboard</span>
              Creator Leaderboard
            </Link>
          </div>

          <div style={{ padding: "var(--space-4)", borderTop: "1px solid var(--border)" }}>
            <div className="dashboard-sidebar-block" style={{ padding: "var(--space-3)" }}>
              <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(99, 36, 235, 0.2)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>card_giftcard</span>
                </div>
                <div>
                  <div style={{ fontSize: "var(--text-small)", fontWeight: 700, color: "var(--text-primary)" }}>Refer and Earn</div>
                  <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 2 }}>30% of generated fees</div>
                </div>
              </div>
              <button onClick={handleCopyRef} className="btn-secondary" style={{ width: "100%", padding: "6px", fontSize: "11px", display: "flex", gap: 6, justifyContent: "center", background: "var(--bg-card)", border: "1px solid var(--border)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{copiedRef ? "check" : "content_copy"}</span>
                {copiedRef ? "Copied!" : "Copy code"}
              </button>
            </div>
            
            <div className="dashboard-sidebar-wallet" style={{ background: "rgba(45, 40, 57, 0.5)", border: "1px solid var(--border)", padding: "var(--space-3)" }}>
              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 4 }}>Connected Wallet</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-small)", color: "var(--text-primary)", fontWeight: 600 }}>
                  {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "None"}
                </div>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success, #10B981)" }} />
              </div>
            </div>
          </div>
        </aside>
        
        <div className="dashboard-body">
          <header className="dashboard-header">
            <h2 style={{ fontSize: "1.125rem", margin: 0, fontWeight: 700 }}>Overview</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
              <button style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center" }}>
                <span className="material-symbols-outlined">notifications</span>
              </button>
              <div style={{ position: "relative" }} ref={menuRef}>
                <button 
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(99, 36, 235, 0.2)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer" }}
                >
                  {address ? address.slice(2, 4).toUpperCase() : "U"}
                </button>
                {userMenuOpen && (
                  <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "var(--space-2)", minWidth: 160, zIndex: 20 }}>
                    <button type="button" onClick={() => { logout(); setUserMenuOpen(false); }} className="dashboard-user-menu-logout">
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>logout</span>
                      Log out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="dashboard-body-inner">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "var(--space-6)" }}>
              <div>
                <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 var(--space-1)", letterSpacing: "-0.02em" }}>Dashboard</h1>
                <p style={{ color: "var(--text-secondary)", margin: 0 }}>Manage your social tips and support your favorite creators.</p>
              </div>
              <div style={{ display: "flex", gap: "var(--space-3)" }}>
                <Link to="/dashboard/withdraw" className="btn-secondary" style={{ display: "flex", gap: 6, padding: "10px 16px" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>file_download</span>
                  Withdraw
                </Link>
                <div style={{ position: "relative" }} ref={addFundsRef}>
                  <button onClick={() => setAddFundsOpen(!addFundsOpen)} className="btn-primary" style={{ display: "flex", gap: 6, padding: "10px 16px", cursor: "pointer", border: "none" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>add_circle</span>
                    Add Funds
                  </button>
                  {addFundsOpen && (
                    <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "var(--space-2)", minWidth: 200, zIndex: 20, display: "flex", flexDirection: "column", gap: 2 }}>
                      <a href={addMoneyUrl} target="_blank" rel="noopener noreferrer" style={{ display: "block", padding: "8px 12px", color: "var(--text-primary)", fontSize: "var(--text-small)", textDecoration: "none", borderRadius: "var(--radius-sm)" }} onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                        Add via card
                      </a>
                      <button onClick={() => {
                        navigator.clipboard.writeText(address);
                        setWalletCopyFeedback(true);
                        setTimeout(() => { setWalletCopyFeedback(false); setAddFundsOpen(false); }, 1500);
                      }} style={{ display: "block", padding: "8px 12px", background: "transparent", border: "none", color: walletCopyFeedback ? "var(--success)" : "var(--text-primary)", fontSize: "var(--text-small)", cursor: "pointer", width: "100%", textAlign: "left", borderRadius: "var(--radius-sm)", fontWeight: walletCopyFeedback ? 600 : "normal" }} onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                        {walletCopyFeedback ? "✓ Copied! Send USDC" : "Deposit from wallet"}
                      </button>
                      <button onClick={() => { handleFaucet(); setAddFundsOpen(false); }} disabled={faucetLoading} style={{ display: "block", padding: "8px 12px", background: "transparent", border: "none", color: "var(--text-primary)", fontSize: "var(--text-small)", cursor: "pointer", width: "100%", textAlign: "left", borderRadius: "var(--radius-sm)", opacity: faucetLoading ? 0.6 : 1 }} onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.05)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                        {faucetLoading ? "Requesting…" : "Get test funds (faucet)"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="dashboard-grid-3">
              <div className="dashboard-metric-card">
                <div className="dashboard-metric-header">
                  <div className="dashboard-metric-icon"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>payments</span></div>
                  <div className="dashboard-metric-label">Total Tips Given</div>
                </div>
                <div className="dashboard-metric-value">
                  ${(Number(tipperStats.totalSent) / 1e6).toFixed(2)}
                  <span className="dashboard-metric-value-sub">USD</span>
                </div>
              </div>
              
              <div className="dashboard-metric-card">
                <div className="dashboard-metric-header">
                  <div className="dashboard-metric-icon"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>groups</span></div>
                  <div className="dashboard-metric-label">Creators Supported</div>
                </div>
                <div className="dashboard-metric-value">
                  {tipperStats.creatorsSupported.length}
                </div>
                <div className="dashboard-metric-footer">Across Twitter</div>
              </div>

              <div className="dashboard-metric-card">
                <div className="dashboard-metric-header">
                  <div className="dashboard-metric-icon"><span className="material-symbols-outlined" style={{ fontSize: 18 }}>account_balance_wallet</span></div>
                  <div className="dashboard-metric-label">Wallet Balance</div>
                </div>
                <div className="dashboard-metric-value">
                  ${formatUsdRaw(balanceRaw)}
                  <span className="dashboard-metric-value-sub">USD</span>
                </div>
                <div className="dashboard-metric-footer">Available for immediate tipping</div>
              </div>
            </div>

            <div className="dashboard-grid-2" style={{ gridTemplateColumns: "2fr 1fr" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
                  <h3 style={{ fontSize: "1.25rem", margin: 0 }}>Spending History</h3>
                  <Link to="/dashboard" style={{ fontSize: "var(--text-small)", fontWeight: 600 }}>View All</Link>
                </div>
                <div className="dashboard-card" style={{ padding: 0 }}>
                  {sentItems.length === 0 ? (
                    <div style={{ padding: "var(--space-6)", textAlign: "center", color: "var(--text-muted)" }}>No tips given yet.</div>
                  ) : (
                    <div className="dashboard-table-container">
                      <table className="dashboard-table">
                        <thead>
                          <tr>
                            <th>Creator</th>
                            <th>Amount</th>
                            <th>Date</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sentItems.slice(0, 10).map((item, i) => (
                            <tr key={item.tx_hash || i}>
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
                                </div>
                              </td>
                              <td style={{ fontWeight: 600 }}>${formatUsdRaw(item.amount)}</td>
                              <td style={{ color: "var(--text-secondary)" }}>
                                {new Date(item.timestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                              </td>
                              <td>
                                {item.author_handle && item.tweet_id && (
                                  <a
                                    href={`https://x.com/${item.author_handle}/status/${item.tweet_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "var(--text-caption)", fontWeight: 700 }}
                                  >
                                    View Post
                                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>open_in_new</span>
                                  </a>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              <div>
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

            {discoverCreators.length > 0 && (
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
        </div>
      </div>
    );
  }

  // Creator: full dashboard
  const totalReceived = creatorData?.totalReceivedUsd || "0";
  const tipCount = creatorData?.tipCount ?? 0;
  const topPosts = (creatorData?.topPosts || []).slice(0, 5);
  const topSupporters = creatorData?.topSupporters || [];
  const maxDaily = Math.max(...earningsDaily.map((d) => parseFloat(d.amountUsd)), 0.01);
  const username = creatorData?.username || "";

  return (
    <div className="dashboard-layout">
      <aside className="dashboard-sidebar">
        <div style={{ padding: "var(--space-6) var(--space-4) var(--space-4)", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <img src="/logo.svg" alt="Teep" width={32} height={32} />
            <h1 style={{ fontSize: "1.25rem", fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>Teep</h1>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-secondary)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginTop: "var(--space-2)" }}>Creator Dashboard</div>
        </div>
        
        <div style={{ padding: "0 var(--space-2)", flex: 1, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
          <Link to="/dashboard" className="dashboard-sidebar-btn" style={{ background: "rgba(99, 36, 235, 0.1)", color: "var(--accent)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>dashboard</span>
            Overview
          </Link>
          <Link to="/dashboard" className="dashboard-sidebar-btn">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>payments</span>
            Earnings
          </Link>
          <Link to="/leaderboard" className="dashboard-sidebar-btn">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>leaderboard</span>
            Leaderboard
          </Link>
          <Link to="/dashboard/grow-tips" className="dashboard-sidebar-btn">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>trending_up</span>
            Grow Tips
          </Link>
        </div>

        <div style={{ padding: "var(--space-4)", borderTop: "1px solid var(--border)" }}>
          <div className="dashboard-sidebar-block" style={{ padding: "var(--space-3)" }}>
            <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(99, 36, 235, 0.2)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>card_giftcard</span>
              </div>
              <div>
                <div style={{ fontSize: "var(--text-small)", fontWeight: 700, color: "var(--text-primary)" }}>Refer and Earn</div>
                <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 2 }}>30% of generated fees</div>
              </div>
            </div>
            <button onClick={handleCopyRef} className="btn-secondary" style={{ width: "100%", padding: "6px", fontSize: "11px", display: "flex", gap: 6, justifyContent: "center", background: "var(--bg-card)", border: "1px solid var(--border)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{copiedRef ? "check" : "content_copy"}</span>
                {copiedRef ? "Copied!" : "Copy code"}
              </button>
            </div>
          
          <Link to={`/profile/creator/${username}`} className="dashboard-sidebar-btn" style={{ justifyContent: "center", color: "var(--accent)", background: "rgba(99, 36, 235, 0.1)", marginTop: "var(--space-4)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>visibility</span>
            Public Profile
          </Link>
        </div>
      </aside>

      <div className="dashboard-body">
        <header className="dashboard-header">
          <h2 style={{ fontSize: "1.125rem", margin: 0, fontWeight: 700 }}>Dashboard</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)" }}>
            <div style={{ display: "flex", alignItems: "center", background: "var(--bg-elevated)", borderRadius: "var(--radius-md)", padding: "var(--space-2) var(--space-3)", width: 240 }}>
              <span className="material-symbols-outlined" style={{ color: "var(--text-muted)", fontSize: 18, marginRight: 8 }}>search</span>
              <input type="text" placeholder="Search transactions..." style={{ background: "transparent", border: "none", color: "var(--text-primary)", fontSize: "var(--text-small)", width: "100%", outline: "none" }} />
            </div>
            <button style={{ background: "transparent", border: "none", color: "var(--text-secondary)", cursor: "pointer", display: "flex", alignItems: "center" }}>
              <span className="material-symbols-outlined">notifications</span>
            </button>
            <div style={{ width: 1, height: 24, background: "var(--border)" }} />
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", position: "relative" }} ref={menuRef}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "var(--text-small)", fontWeight: 700 }}>{username ? `@${username}` : "Creator"}</div>
                <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>Verified Creator</div>
              </div>
              <button 
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", display: "flex" }}
              >
                {username ? (
                  <img src={`https://unavatar.io/twitter/${username}`} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--accent-muted)" }} onError={(e) => { e.currentTarget.src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`; }} />
                ) : (
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center" }}>C</div>
                )}
              </button>
              {userMenuOpen && (
                <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 8, background: "var(--bg-elevated)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "var(--space-2)", minWidth: 160, zIndex: 20 }}>
                  <button type="button" onClick={() => { logout(); setUserMenuOpen(false); }} className="dashboard-user-menu-logout">
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>logout</span>
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="dashboard-body-inner">
          {/* Metric cards — horizontal */}
          <div className="dashboard-grid-3">
            <div className="dashboard-metric-card" style={{ position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, borderRadius: "50%", background: "var(--accent-muted)", filter: "blur(20px)" }} />
              <div className="dashboard-metric-label" style={{ marginBottom: "var(--space-2)" }}>Total tips received</div>
              <div className="dashboard-metric-value" style={{ fontWeight: 900 }}>
                ${totalReceived}
              </div>
            </div>
            
            <div className="dashboard-metric-card" style={{ position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, borderRadius: "50%", background: "var(--accent-muted)", filter: "blur(20px)" }} />
              <div className="dashboard-metric-label" style={{ marginBottom: "var(--space-2)" }}>Tip count</div>
              <div className="dashboard-metric-value" style={{ fontWeight: 900 }}>
                {tipCount}
              </div>
              <div style={{ marginTop: "var(--space-4)", display: "flex", alignItems: "center" }}>
                <div style={{ display: "flex", marginLeft: 8 }}>
                  {[1, 2, 3].map(i => (
                    <div key={i} style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--bg-elevated)", border: "2px solid var(--bg-card)", marginLeft: -8 }} />
                  ))}
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--bg-elevated)", border: "2px solid var(--bg-card)", marginLeft: -8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: "var(--text-secondary)" }}>
                    +{Math.max(0, tipCount - 3)}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="dashboard-metric-card" style={{ background: "rgba(99, 36, 235, 0.05)", borderColor: "rgba(99, 36, 235, 0.2)", justifyContent: "space-between" }}>
              <div>
                <div className="dashboard-metric-label" style={{ color: "var(--accent)", marginBottom: "var(--space-2)" }}>Available balance</div>
                <div className="dashboard-metric-value" style={{ fontWeight: 900 }}>
                  ${formatUsdRaw((Number(balanceRaw) + Number(mainBalanceRaw)).toString())}
                  <span className="dashboard-metric-value-sub">USD</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: "var(--space-2)" }}>Available Tips Earned = ${formatUsdRaw(balanceRaw)}</div>
              </div>
              <Link to="/dashboard/withdraw" className="btn-primary" style={{ width: "100%", justifyContent: "center", display: "flex", alignItems: "center", gap: 6, marginTop: "var(--space-4)", padding: "10px" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>account_balance_wallet</span>
                Cash out
              </Link>
            </div>
          </div>

          {/* Two-column: Earnings chart + Top revenue */}
          <div className="dashboard-grid-2" style={{ gridTemplateColumns: "2fr 1fr" }}>
            {earningsDaily.length > 0 && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
                  <h4 style={{ fontSize: "1.125rem", margin: 0, fontWeight: 700 }}>Earnings Over Time</h4>
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <button onClick={() => setChartDays(7)} style={{ padding: "4px 12px", fontSize: 10, fontWeight: 700, background: chartDays === 7 ? "var(--accent)" : "var(--bg-elevated)", border: "none", color: chartDays === 7 ? "var(--text-inverse)" : "var(--text-secondary)", borderRadius: 4, cursor: "pointer" }}>7D</button>
                    <button onClick={() => setChartDays(30)} style={{ padding: "4px 12px", fontSize: 10, fontWeight: 700, background: chartDays === 30 ? "var(--accent)" : "var(--bg-elevated)", border: "none", color: chartDays === 30 ? "var(--text-inverse)" : "var(--text-secondary)", borderRadius: 4, cursor: "pointer" }}>30D</button>
                    <button onClick={() => setChartDays(365)} style={{ padding: "4px 12px", fontSize: 10, fontWeight: 700, background: chartDays === 365 ? "var(--accent)" : "var(--bg-elevated)", border: "none", color: chartDays === 365 ? "var(--text-inverse)" : "var(--text-secondary)", borderRadius: 4, cursor: "pointer" }}>1Y</button>
                  </div>
                </div>
                <div className="dashboard-card" style={{ height: 360, display: "flex", flexDirection: "column", padding: "var(--space-6)" }}>
                  <div className="dashboard-chart" style={{ height: "100%", flex: 1 }}>
                    {earningsDaily.map((d) => (
                      <div key={d.date} className="dashboard-chart-bar-wrap" title={`${d.date}: $${d.amountUsd}`}>
                        <div
                          className="dashboard-chart-bar"
                          style={{ height: `${Math.max((parseFloat(d.amountUsd) / maxDaily) * 100, 2)}%`, background: "var(--accent)", opacity: 0.8, borderRadius: "2px 2px 0 0" }}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="dashboard-chart-labels" style={{ marginTop: "var(--space-4)", fontSize: 10, fontWeight: 700 }}>
                    <span>{earningsDaily[0].date}</span>
                    <span>{earningsDaily[Math.floor(earningsDaily.length / 2)]?.date}</span>
                    <span>{earningsDaily[earningsDaily.length - 1].date}</span>
                  </div>
                </div>
              </div>
            )}
            
            {topPosts.length > 0 && (
              <div>
                <h4 style={{ fontSize: "1.125rem", margin: "0 0 var(--space-4) 0", fontWeight: 700 }}>Top Revenue Sources</h4>
                <div className="dashboard-card" style={{ height: 360, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
                  {topPosts.map((p) => {
                    const handle = p.authorHandle || creatorData?.username || "";
                    const tweetUrl = handle && p.tweetId ? `https://x.com/${handle}/status/${p.tweetId}` : null;
                    return (
                      <div key={p.contentId} style={{ padding: "var(--space-4)", borderBottom: "1px solid var(--border-muted)", flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", gap: "var(--space-3)" }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(59, 130, 246, 0.1)", color: "#3b82f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path></svg>
                          </div>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 700, width: 120, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {p.tweetId ? `Post #${p.tweetId.slice(-6)}...` : `Content ${p.contentId.slice(-6)}`}
                            </div>
                            {tweetUrl && (
                              <a href={tweetUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "var(--accent)" }}>
                                View Post
                              </a>
                            )}
                          </div>
                        </div>
                        <div style={{ fontSize: "var(--text-small)", fontWeight: 700 }}>${p.totalUsd}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Top supporters */}
          {topSupporters.length > 0 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
                <h4 style={{ fontSize: "1.125rem", margin: 0, fontWeight: 700 }}>Top Supporters</h4>
                <button style={{ background: "none", border: "none", color: "var(--accent)", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>View all</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--space-4)" }}>
                {topSupporters.slice(0, 4).map((s) => (
                  <div key={s.address} className="dashboard-card" style={{ padding: "var(--space-4)", display: "flex", alignItems: "center", gap: "var(--space-4)", marginBottom: 0 }}>
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--accent-gradient)", padding: 2 }}>
                      <div style={{ width: "100%", height: "100%", borderRadius: "50%", background: "var(--bg-card)", overflow: "hidden" }}>
                        <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${s.address}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                    </div>
                    <div style={{ flex: 1 }}>
                      <Link to={`/profile/tipper/${s.address}`} style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>
                        {s.address.slice(0, 6)}…{s.address.slice(-4)}
                      </Link>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                        <span style={{ fontSize: 10, color: "var(--text-secondary)" }}>Supporter</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--success, #10B981)" }}>${s.totalUsd}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
