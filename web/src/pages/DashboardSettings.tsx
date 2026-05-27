import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { getTeepActivityTitle } from "@teep/shared";
import { API_BASE } from "../config";
import DashboardShell from "../components/DashboardShell";

const PAGE_SIZE = 7;

type SettingsTab = "identity" | "tipping" | "receipts" | "funding" | "notifications" | "privacy" | "support";

type TipperSettings = {
  username: string;
  defaultTipAmount: string;
  receipts: {
    shareLinksEnabled: boolean;
    shareAmountEnabled: boolean;
    postAwareCopyEnabled: boolean;
  };
  notifications: {
    creatorClaimed: boolean;
    lowBalance: boolean;
    receiptReady: boolean;
  };
  privacy: {
    hideAddress: boolean;
    privateActivity: boolean;
    requireVerification: boolean;
  };
};

type FundingRecord = {
  id: string;
  provider: string;
  providerSessionId?: string;
  kind: string;
  status: string;
  createdAt: number;
  metadata?: {
    amount?: string;
    amountRaw?: string;
    asset?: string;
    txHash?: string;
  } | null;
};

type WithdrawalRecord = {
  destinationAddress: string;
  source: string;
  amountRaw: string;
  txHash: string;
  createdAt: number;
};

function shortAddress(address: string) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "None";
}

function usernameFallback(email: string) {
  const local = email.includes("@") ? email.split("@")[0] : "";
  const cleaned = local
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  return cleaned.length >= 3 ? cleaned : "teep_user";
}

function normalizeUsernameInput(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function defaultSettings(username: string): TipperSettings {
  return {
    username,
    defaultTipAmount: "5.00",
    receipts: {
      shareLinksEnabled: true,
      shareAmountEnabled: true,
      postAwareCopyEnabled: true,
    },
    notifications: {
      creatorClaimed: true,
      lowBalance: true,
      receiptReady: false,
    },
    privacy: {
      hideAddress: true,
      privateActivity: true,
      requireVerification: true,
    },
  };
}

function settingsEqual(a: TipperSettings, b: TipperSettings) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function formatUsdRaw(raw?: string) {
  if (!raw) return "$0.00";
  const value = Number(BigInt(raw)) / 1e6;
  return `$${value.toFixed(2)}`;
}

function formatDate(value?: number) {
  if (!value) return "-";
  const ms = value > 10_000_000_000 ? value : value * 1000;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatFundingAmount(record: FundingRecord) {
  if (record.metadata?.amountRaw) return formatUsdRaw(record.metadata.amountRaw);
  if (record.metadata?.amount) {
    const amount = String(record.metadata.amount).trim();
    const numeric = Number(amount);
    if (Number.isFinite(numeric)) {
      const normalized = numeric >= 1_000_000_000_000
        ? numeric / 1_000_000_000_000
        : numeric >= 1_000_000
          ? numeric / 1_000_000
          : numeric;
      return `$${normalized.toFixed(2)}`;
    }
    return record.metadata.amount;
  }
  return "-";
}

function fundingActivityLabel(record: FundingRecord) {
  const detail = [record.provider, record.kind].filter(Boolean).join(" ");
  return getTeepActivityTitle({
    type: record.kind === "faucet" ? "funding" : "deposit",
    detail,
  });
}

function withdrawalActivityLabel(record: WithdrawalRecord) {
  if (record.source === "tipsEarned") return "Creator Earnings Withdrawal";
  if (record.source === "tipBalance") return "Balance Withdrawal";
  return "Withdrawal";
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (["completed", "confirmed", "success", "succeeded", "sent", "synced", "used"].includes(normalized)) return "is-success";
  if (["pending", "created", "processing"].includes(normalized)) return "is-pending";
  if (["failed", "cancelled", "expired", "rejected"].includes(normalized)) return "is-danger";
  return "is-neutral";
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      className={`dashboard-settings-toggle ${checked ? "is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="dashboard-settings-switch-handle" aria-hidden>
        <span className="dashboard-settings-switch-check material-symbols-outlined">check</span>
      </span>
    </button>
  );
}

function Pagination({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);
  return (
    <div className="dashboard-settings-pagination">
      <span>Showing {start}-{end} of {total}</span>
      <div>
        <button type="button" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}>Prev</button>
        <strong>{page} / {pages}</strong>
        <button type="button" onClick={() => onPage(Math.min(pages, page + 1))} disabled={page >= pages}>Next</button>
      </div>
    </div>
  );
}

export default function DashboardSettings() {
  const privy = usePrivy();
  const { ready, authenticated, login, user, logout } = privy;
  const { client: smartWalletClient } = useSmartWallets();
  const address = (ready && authenticated ? smartWalletClient?.account?.address || "" : "").toLowerCase();
  const email = user?.email?.address || "Not connected";
  const fallbackUsername = useMemo(() => usernameFallback(email), [email]);

  const [activeTab, setActiveTab] = useState<SettingsTab>("identity");
  const [settings, setSettings] = useState<TipperSettings>(() => defaultSettings(fallbackUsername));
  const [savedSettings, setSavedSettings] = useState<TipperSettings>(() => defaultSettings(fallbackUsername));
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [toast, setToast] = useState("");
  const [usernameEditing, setUsernameEditing] = useState(false);
  const [defaultTipEditing, setDefaultTipEditing] = useState(false);
  const [accountHelpOpen, setAccountHelpOpen] = useState(false);
  const [deactivateConfirmOpen, setDeactivateConfirmOpen] = useState(false);
  const [deactivateText, setDeactivateText] = useState("");
  const [deactivateMsg, setDeactivateMsg] = useState("");

  const [fundingRecords, setFundingRecords] = useState<FundingRecord[]>([]);
  const [fundingTotal, setFundingTotal] = useState(0);
  const [fundingSync, setFundingSync] = useState<{ status: "synced" | "delayed"; message: string } | null>(null);
  const [fundingLoading, setFundingLoading] = useState(false);
  const [fundingPage, setFundingPage] = useState(1);
  const [fundingDay, setFundingDay] = useState("");
  const [withdrawalRecords, setWithdrawalRecords] = useState<WithdrawalRecord[]>([]);
  const [withdrawalTotal, setWithdrawalTotal] = useState(0);
  const [withdrawalLoading, setWithdrawalLoading] = useState(false);
  const [withdrawalPage, setWithdrawalPage] = useState(1);
  const [withdrawalDay, setWithdrawalDay] = useState("");
  const accountHelpRef = useRef<HTMLSpanElement>(null);

  const hasUnsavedChanges = !settingsEqual(settings, savedSettings);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  useEffect(() => {
    if (!address) {
      const fallback = defaultSettings(fallbackUsername);
      setSettings(fallback);
      setSavedSettings(fallback);
      return;
    }

    let cancelled = false;
    setLoadingSettings(true);
    fetch(`${API_BASE}/api/v1/wallet/${address}/settings`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        const next = defaultSettings(data?.username || fallbackUsername);
        const hydrated: TipperSettings = {
          ...next,
          username: data?.username || fallbackUsername,
          defaultTipAmount: data?.defaultTipAmount || next.defaultTipAmount,
          receipts: { ...next.receipts, ...(data?.receipts || {}) },
          notifications: { ...next.notifications, ...(data?.notifications || {}) },
          privacy: { ...next.privacy, ...(data?.privacy || {}) },
        };
        setSettings(hydrated);
        setSavedSettings(hydrated);
      })
      .catch(() => showToast("Could not load settings. Using defaults for now."))
      .finally(() => {
        if (!cancelled) setLoadingSettings(false);
      });

    return () => {
      cancelled = true;
    };
  }, [address, fallbackUsername, showToast]);

  useEffect(() => {
    if (!address) return;
    const params = new URLSearchParams({ page: String(fundingPage), limit: String(PAGE_SIZE) });
    if (fundingDay) params.set("day", fundingDay);
    setFundingLoading(true);
    setFundingSync({ status: "synced", message: "Syncing latest funding activity..." });
    fetch(`${API_BASE}/api/v1/wallet/${address}/funding-history?${params}`)
      .then((res) => (res.ok ? res.json() : { records: [], total: 0 }))
      .then((data) => {
        setFundingRecords(Array.isArray(data.records) ? data.records : []);
        setFundingTotal(Number(data.total || 0));
        setFundingSync(data.sync || null);
      })
      .catch(() => {
        setFundingRecords([]);
        setFundingTotal(0);
        setFundingSync({ status: "delayed", message: "Could not check the latest funding activity right now." });
      })
      .finally(() => setFundingLoading(false));
  }, [address, fundingDay, fundingPage]);

  useEffect(() => {
    if (!address) return;
    const params = new URLSearchParams({ page: String(withdrawalPage), limit: String(PAGE_SIZE) });
    if (withdrawalDay) params.set("day", withdrawalDay);
    setWithdrawalLoading(true);
    fetch(`${API_BASE}/api/v1/wallet/${address}/withdrawal-history?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : { records: [], total: 0 }))
      .then((data) => {
        setWithdrawalRecords(Array.isArray(data.records) ? data.records : []);
        setWithdrawalTotal(Number(data.total || 0));
      })
      .catch(() => {
        setWithdrawalRecords([]);
        setWithdrawalTotal(0);
      })
      .finally(() => setWithdrawalLoading(false));
  }, [address, withdrawalDay, withdrawalPage]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!accountHelpOpen) return;
    function handleOutsideClick(event: MouseEvent) {
      if (accountHelpRef.current && !accountHelpRef.current.contains(event.target as Node)) {
        setAccountHelpOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [accountHelpOpen]);

  const updateSettings = useCallback((patch: Partial<TipperSettings>) => {
    setSettings((current) => ({
      ...current,
      ...patch,
      receipts: { ...current.receipts, ...(patch.receipts || {}) },
      notifications: { ...current.notifications, ...(patch.notifications || {}) },
      privacy: { ...current.privacy, ...(patch.privacy || {}) },
    }));
  }, []);

  const switchTab = useCallback((tab: SettingsTab) => {
    if (tab === activeTab) return;
    if (hasUnsavedChanges) {
      showToast("Save your changes before leaving this settings page.");
      return;
    }
    setActiveTab(tab);
  }, [activeTab, hasUnsavedChanges, showToast]);

  const saveSettings = useCallback(async () => {
    const username = normalizeUsernameInput(settings.username);
    if (!/^[a-z0-9_]{3,24}$/.test(username) || /^_+$/.test(username)) {
      showToast("Username must be 3-24 letters, numbers, or underscores.");
      return;
    }
    const amount = Number(String(settings.defaultTipAmount).replace(/^\$/, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast("Default tip amount must be greater than zero.");
      return;
    }

    setSavingSettings(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/wallet/${address}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          username,
          defaultTipAmount: amount.toFixed(2),
          receipts: {
            shareLinksEnabled: true,
            shareAmountEnabled: settings.receipts.shareAmountEnabled,
            postAwareCopyEnabled: true,
          },
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not save settings.");
      const next: TipperSettings = {
        username: payload.username || username,
        defaultTipAmount: payload.defaultTipAmount || amount.toFixed(2),
        receipts: { shareLinksEnabled: true, shareAmountEnabled: payload.receipts?.shareAmountEnabled !== false, postAwareCopyEnabled: true },
        notifications: payload.notifications || settings.notifications,
        privacy: payload.privacy || settings.privacy,
      };
      setSettings(next);
      setSavedSettings(next);
      showToast("Settings saved.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not save settings.");
    } finally {
      setSavingSettings(false);
    }
  }, [address, settings, showToast]);

  const copyAddress = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      showToast("Account address copied.");
    } catch {
      showToast("Could not copy account address.");
    }
  }, [address, showToast]);

  const requestWalletProof = useCallback(async () => {
    if (!address || !smartWalletClient?.account) throw new Error("Connect your account first.");
    const challengeRes = await fetch(`${API_BASE}/auth/wallet/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, purpose: "account-settings" }),
    });
    const challenge = await challengeRes.json().catch(() => ({}));
    if (!challengeRes.ok || !challenge.message) throw new Error(challenge.error || "Could not verify account.");
    const signature = await smartWalletClient.signMessage({
      account: smartWalletClient.account,
      message: challenge.message,
    } as Parameters<typeof smartWalletClient.signMessage>[0]);
    return { message: challenge.message, signature };
  }, [address, smartWalletClient]);

  const downloadCsv = useCallback((kind: "funding" | "withdrawals") => {
    const rows = kind === "funding"
      ? [["date", "type", "amount", "status"], ...fundingRecords.map((r) => [formatDate(r.createdAt), fundingActivityLabel(r), formatFundingAmount(r), statusLabel(r.status)])]
      : [["date", "type", "amount", "status"], ...withdrawalRecords.map((r) => [formatDate(r.createdAt), withdrawalActivityLabel(r), formatUsdRaw(r.amountRaw), "Completed"])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `teep-${kind}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [fundingRecords, withdrawalRecords]);

  const exportMyData = useCallback(async () => {
    if (!address) return;
    if (settings.privacy.requireVerification && !window.confirm("Export your Teep account data?")) return;
    try {
      const walletProof = await requestWalletProof();
      const response = await fetch(`${API_BASE}/api/v1/wallet/${address}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletProof }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) throw new Error(payload?.error || "Could not export account data.");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `teep-account-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast("Account export downloaded.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not export account data.");
    }
  }, [address, requestWalletProof, settings.privacy.requireVerification, showToast]);

  const deactivateAccount = useCallback(async () => {
    if (deactivateText !== "DELETE") {
      setDeactivateMsg("Type DELETE to confirm account deletion.");
      return;
    }
    setDeactivateMsg("Checking account balance...");
    const readinessResponse = await fetch(`${API_BASE}/api/v1/wallet/${address}/delete-readiness`);
    const readiness = await readinessResponse.json().catch(() => null);
    if (!readinessResponse.ok || !readiness) {
      setDeactivateMsg(readiness?.error || "Could not verify account balance before deletion.");
      return;
    }
    if (!readiness.canDelete) {
      const balanceText = Array.isArray(readiness.blockingBalances)
        ? readiness.blockingBalances.map((balance: { display: string }) => balance.display).join(", ")
        : "remaining balance";
      setDeactivateMsg(`Transfer or withdraw your funds first. Remaining balance: ${balanceText}.`);
      return;
    }
    if (settings.privacy.requireVerification && !window.confirm("Permanently delete your Teep account?")) {
      setDeactivateMsg("");
      return;
    }
    let walletProof: { message: string; signature: string };
    try {
      walletProof = await requestWalletProof();
    } catch (error) {
      setDeactivateMsg(error instanceof Error ? error.message : "Could not verify account.");
      return;
    }
    const privyUserId = user?.id || "";
    if (!privyUserId) {
      setDeactivateMsg("Could not find the connected Privy user id.");
      return;
    }
    try {
      setDeactivateMsg("Deleting account...");
      const response = await fetch(`${API_BASE}/api/v1/wallet/${address}/delete-local-data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE", walletProof, privyUserId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Could not delete account.");
      await logout();
    } catch (error) {
      setDeactivateMsg(error instanceof Error ? error.message : "Could not delete account.");
    }
  }, [address, deactivateText, logout, requestWalletProof, settings.privacy.requireVerification, user?.id]);

  if (!ready) {
    return (
      <DashboardShell title="Settings">
        <main className="dashboard-body-inner">
          <div className="dashboard-empty-auth"><h1>Settings</h1><p>Preparing your dashboard.</p></div>
        </main>
      </DashboardShell>
    );
  }
  if (!authenticated) {
    return (
      <DashboardShell title="Settings">
        <main className="dashboard-body-inner">
          <div className="dashboard-empty-auth">
            <h1>Connect your account</h1>
            <p>Sign in to manage your Teep settings.</p>
            <button type="button" className="btn-primary" onClick={login}>Connect</button>
          </div>
        </main>
      </DashboardShell>
    );
  }

  const tabs: Array<{ id: SettingsTab; icon: string; label: string; detail: string; ready?: boolean }> = [
    { id: "identity", icon: "badge", label: "Identity", detail: "Username and account" },
    { id: "tipping", icon: "payments", label: "Tipping", detail: "Extension default" },
    { id: "receipts", icon: "receipt_long", label: "Receipts", detail: "Sharing and exports" },
    { id: "funding", icon: "account_balance_wallet", label: "Funding", detail: "Funding and withdrawals" },
    { id: "notifications", icon: "notifications", label: "Notifications", detail: "Account alerts" },
    { id: "privacy", icon: "shield", label: "Privacy", detail: "Visibility and safety" },
    { id: "support", icon: "help", label: "Support", detail: "Help and policies" },
  ];

  return (
    <DashboardShell
      address={address}
      title="Settings"
    >
        <main className="dashboard-body-inner dashboard-settings-page">
          <div className="dashboard-page-heading">
            <div>
              <h1>Settings</h1>
              <p>Manage the account details and product preferences that shape your Teep experience across the dashboard and extension.</p>
            </div>
            <button type="button" className={hasUnsavedChanges ? "btn-primary" : "btn-secondary"} onClick={saveSettings} disabled={savingSettings || loadingSettings || !hasUnsavedChanges}>
              {savingSettings ? "Saving..." : hasUnsavedChanges ? "Save Changes" : "Saved"}
            </button>
          </div>

          <div className="dashboard-settings-workspace">
            <nav className="dashboard-settings-menu" aria-label="Settings sections">
              {tabs.map((tab) => (
                <button key={tab.id} type="button" className={activeTab === tab.id ? "is-active" : ""} onClick={() => switchTab(tab.id)}>
                  <span className="material-symbols-outlined" aria-hidden>{tab.icon}</span>
                  <span><strong>{tab.label}</strong><small>{tab.detail}</small></span>
                </button>
              ))}
            </nav>

            <section className="dashboard-settings-panel">
              {activeTab === "identity" && (
                <>
                  <div className="dashboard-settings-panel-head">
                    <div><h3>Identity</h3><p>Choose the public username Teep uses on receipts, direct tips, referral records, and account-facing surfaces.</p></div>
                  </div>
                  <div className="dashboard-settings-panel-body">
                    <div className="dashboard-settings-identity-grid">
                      <div className="dashboard-settings-subcard dashboard-settings-identity-card">
                        <div className="dashboard-settings-field">
                          <label htmlFor="teep-username">Display username</label>
                          <div className={`dashboard-settings-input-row ${usernameEditing ? "is-editing" : "is-readonly"}`}>
                            <span aria-hidden>@</span>
                            <input id="teep-username" value={settings.username} onChange={(event) => updateSettings({ username: normalizeUsernameInput(event.target.value) })} maxLength={24} disabled={loadingSettings || !usernameEditing} />
                            <button type="button" onClick={() => setUsernameEditing((editing) => !editing)} aria-label={usernameEditing ? "Finish editing username" : "Edit username"}>
                              <span className="material-symbols-outlined" aria-hidden>{usernameEditing ? "check" : "edit"}</span>
                            </button>
                          </div>
                          <p>This is your identifier across Teep.</p>
                        </div>
                      </div>
                      <div className="dashboard-settings-subcard">
                        <h4>Connected account</h4>
                        <div className="dashboard-settings-row"><span>Email</span><strong>{email}</strong></div>
                        <div className="dashboard-settings-row">
                          <span className="dashboard-settings-label-with-help">
                            Account Address
                            <span className="dashboard-settings-help-wrap" ref={accountHelpRef}>
                              <button
                                type="button"
                                className="dashboard-settings-help-btn"
                                aria-label="Explain account address"
                                aria-expanded={accountHelpOpen}
                                onClick={() => setAccountHelpOpen((open) => !open)}
                              >
                                <span className="material-symbols-outlined" aria-hidden>help</span>
                              </button>
                              {accountHelpOpen && (
                                <span className="dashboard-settings-help-popover" role="tooltip">
                                  This is the account Teep uses under the hood for balances, tips, and withdrawals.
                                </span>
                              )}
                            </span>
                          </span>
                          <div className="dashboard-settings-copy-value">
                            <strong>{address ? shortAddress(address) : <span className="dashboard-inline-skeleton dashboard-inline-skeleton--address" />}</strong>
                            <button type="button" onClick={copyAddress} disabled={!address} aria-label="Copy account address">
                              <span className="material-symbols-outlined" aria-hidden>content_copy</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === "tipping" && (
                <>
                  <div className="dashboard-settings-panel-head">
                    <div><h3>Tipping preferences</h3><p>Set the default amount the Teep extension pre-fills when you tip from supported social posts.</p></div>
                  </div>
                  <div className="dashboard-settings-panel-body">
                    <div className="dashboard-settings-subcard">
                      <h4>Extension default</h4>
                      <p>This value is saved to the account settings API and read by the extension when an account is connected.</p>
                      <div className="dashboard-settings-two-col">
                        <div className="dashboard-settings-field">
                          <label htmlFor="default-tip">Default tip amount</label>
                          <div className={`dashboard-settings-input-row ${defaultTipEditing ? "is-editing" : "is-readonly"}`}>
                            <span aria-hidden>$</span>
                            <input id="default-tip" value={settings.defaultTipAmount} onChange={(event) => updateSettings({ defaultTipAmount: event.target.value.replace(/^\$/, "") })} inputMode="decimal" disabled={loadingSettings || !defaultTipEditing} />
                            <button type="button" onClick={() => setDefaultTipEditing((editing) => !editing)} aria-label={defaultTipEditing ? "Finish editing default tip amount" : "Edit default tip amount"}>
                              <span className="material-symbols-outlined" aria-hidden>{defaultTipEditing ? "check" : "edit"}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === "receipts" && (
                <>
                  <div className="dashboard-settings-panel-head">
                    <div><h3>Receipts and sharing</h3><p>Every tip gets an in-house Teep receipt. These controls are persisted for receipt/share surfaces.</p></div>
                  </div>
                  <div className="dashboard-settings-panel-body">
                    <div className="dashboard-settings-list">
                      <div className="dashboard-settings-list-row"><div><strong>Include amount in shared copy</strong><span>Controls whether Teep-generated share text includes the tip amount.</span></div><Toggle checked={settings.receipts.shareAmountEnabled} onChange={(next) => updateSettings({ receipts: { ...settings.receipts, shareAmountEnabled: next } })} /></div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === "funding" && (
                <>
                  <div className="dashboard-settings-panel-head">
                    <div><h3>Funding and withdrawals</h3><p>Review money added to and withdrawn from your Teep account.</p></div>
                  </div>
                  <div className="dashboard-settings-panel-body">
                    <div className="dashboard-settings-history-card">
                      <div className="dashboard-settings-history-card-head">
                        <div>
                          <h4>Funding history</h4>
                          <p>Funds added to your Teep account.</p>
                          {fundingSync && <span className={`dashboard-settings-sync-note ${fundingSync.status === "delayed" ? "is-delayed" : ""}`}>{fundingSync.message}</span>}
                        </div>
                        <div className="dashboard-settings-history-tools">
                          <label>
                            <span>Go to:</span>
                            <input type="date" value={fundingDay} onChange={(event) => { setFundingPage(1); setFundingDay(event.target.value); }} />
                          </label>
                          {fundingDay && <button type="button" className="dashboard-settings-clear-date" onClick={() => { setFundingDay(""); setFundingPage(1); }}>Clear</button>}
                          <button type="button" className="dashboard-settings-download-btn" onClick={() => downloadCsv("funding")} aria-label="Download funding history">
                            <span className="material-symbols-outlined" aria-hidden>download</span>
                            <span className="dashboard-settings-download-text">Download</span>
                          </button>
                        </div>
                      </div>
                      <div className="dashboard-settings-table">
                        <div className="dashboard-settings-table-row dashboard-settings-table-row--funding is-head"><div>Type</div><div>Amount</div><div>Date</div><div>Status</div></div>
                        {fundingLoading && fundingRecords.length === 0 ? <div className="dashboard-settings-table-empty dashboard-settings-table-empty--syncing">Syncing latest funding activity...</div> : fundingRecords.length === 0 ? <div className="dashboard-settings-table-empty">No funding records yet.</div> : fundingRecords.map((record) => (
                          <div className="dashboard-settings-table-row dashboard-settings-table-row--funding" key={record.id}><div data-label="Type">{fundingActivityLabel(record)}</div><div data-label="Amount">{formatFundingAmount(record)}</div><div data-label="Date">{formatDate(record.createdAt)}</div><div data-label="Status"><span className={`dashboard-settings-status-pill ${statusClass(record.status)}`}>{statusLabel(record.status)}</span></div></div>
                        ))}
                      </div>
                      <Pagination page={fundingPage} total={fundingTotal} onPage={setFundingPage} />
                    </div>

                    <div className="dashboard-settings-history-card">
                      <div className="dashboard-settings-history-card-head">
                        <div>
                          <h4>Withdrawal history</h4>
                          <p>Funds withdrawn from your Teep account.</p>
                        </div>
                        <div className="dashboard-settings-history-tools">
                          <label>
                            <span>Go to:</span>
                            <input type="date" value={withdrawalDay} onChange={(event) => { setWithdrawalPage(1); setWithdrawalDay(event.target.value); }} />
                          </label>
                          {withdrawalDay && <button type="button" className="dashboard-settings-clear-date" onClick={() => { setWithdrawalDay(""); setWithdrawalPage(1); }}>Clear</button>}
                          <button type="button" className="dashboard-settings-download-btn" onClick={() => downloadCsv("withdrawals")} aria-label="Download withdrawal history">
                            <span className="material-symbols-outlined" aria-hidden>download</span>
                            <span className="dashboard-settings-download-text">Download</span>
                          </button>
                        </div>
                      </div>
                      <div className="dashboard-settings-table">
                        <div className="dashboard-settings-table-row dashboard-settings-table-row--withdrawal is-head"><div>Type</div><div>Amount</div><div>Date</div><div>Status</div></div>
                        {withdrawalLoading && withdrawalRecords.length === 0 ? <div className="dashboard-settings-table-empty dashboard-settings-table-empty--syncing">Syncing latest withdrawal activity...</div> : withdrawalRecords.length === 0 ? <div className="dashboard-settings-table-empty">No withdrawals yet.</div> : withdrawalRecords.map((record) => (
                          <div className="dashboard-settings-table-row dashboard-settings-table-row--withdrawal" key={record.txHash}><div data-label="Type">{withdrawalActivityLabel(record)}</div><div data-label="Amount">{formatUsdRaw(record.amountRaw)}</div><div data-label="Date">{formatDate(record.createdAt)}</div><div data-label="Status"><span className="dashboard-settings-status-pill is-success">Completed</span></div></div>
                        ))}
                      </div>
                      <Pagination page={withdrawalPage} total={withdrawalTotal} onPage={setWithdrawalPage} />
                    </div>
                  </div>
                </>
              )}

              {activeTab === "notifications" && (
                <>
                  <div className="dashboard-settings-panel-head">
                    <div><h3>Notifications</h3><p>Choose which account alerts Teep should send when activity changes.</p></div>
                  </div>
                  <div className="dashboard-settings-panel-body">
                    <div className="dashboard-settings-list">
                      <div className="dashboard-settings-list-row"><div><strong>Creator claimed funds</strong><span>Notify me when a creator claims tips I sent.</span></div><Toggle checked={settings.notifications.creatorClaimed} onChange={(next) => updateSettings({ notifications: { ...settings.notifications, creatorClaimed: next } })} /></div>
                      <div className="dashboard-settings-list-row"><div><strong>Low balance</strong><span>Warn me when my balance drops below my default tip amount.</span></div><Toggle checked={settings.notifications.lowBalance} onChange={(next) => updateSettings({ notifications: { ...settings.notifications, lowBalance: next } })} /></div>
                      <div className="dashboard-settings-list-row"><div><strong>Receipt ready</strong><span>Notify me when a Teep receipt is ready to view or share.</span></div><Toggle checked={settings.notifications.receiptReady} onChange={(next) => updateSettings({ notifications: { ...settings.notifications, receiptReady: next } })} /></div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === "privacy" && (
                <>
                  <div className="dashboard-settings-panel-head">
                    <div><h3>Privacy and safety</h3><p>These controls are persisted and should be enforced across public receipts, profiles, activity, and sharing.</p></div>
                  </div>
                  <div className="dashboard-settings-panel-body">
                    <div className="dashboard-settings-list">
                      <div className="dashboard-settings-list-row"><div><strong>Hide account address publicly</strong><span>Use username and receipt identity instead across public Teep pages.</span></div><Toggle checked={settings.privacy.hideAddress} onChange={(next) => updateSettings({ privacy: { ...settings.privacy, hideAddress: next } })} /></div>
                      <div className="dashboard-settings-list-row"><div><strong>Private activity by default</strong><span>Dashboard activity is private unless you explicitly share a receipt.</span></div><Toggle checked={settings.privacy.privateActivity} onChange={(next) => updateSettings({ privacy: { ...settings.privacy, privateActivity: next } })} /></div>
                      <div className="dashboard-settings-list-row"><div><strong>Require confirmation for sensitive changes</strong><span>Ask for an extra confirmation before privacy, export, or account deletion actions.</span></div><Toggle checked={settings.privacy.requireVerification} onChange={(next) => updateSettings({ privacy: { ...settings.privacy, requireVerification: next } })} /></div>
                    </div>
                    <div className="dashboard-settings-actions"><button type="button" className="btn-secondary" onClick={exportMyData}>Export My Data</button><button type="button" className="dashboard-danger-btn" onClick={() => { setDeactivateConfirmOpen(true); setDeactivateMsg(""); setDeactivateText(""); }}>Delete Account</button></div>
                  </div>
                </>
              )}

              {activeTab === "support" && (
                <>
                  <div className="dashboard-settings-panel-head">
                    <div><h3>Support and policies</h3><p>Operational links stay separate from core product settings.</p></div>
                  </div>
                  <div className="dashboard-settings-panel-body">
                    <div className="dashboard-settings-links">
                      <Link to="/support">Support</Link>
                      <Link to="/fees">Fees</Link>
                      <Link to="/privacy">Privacy</Link>
                      <Link to="/terms">Terms</Link>
                    </div>
                  </div>
                </>
              )}
            </section>
          </div>
        </main>
      {toast && <div className="dashboard-settings-toast" role="status">{toast}</div>}
      {deactivateConfirmOpen && (
        <div className="dashboard-settings-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="deactivate-title">
          <div className="dashboard-settings-modal">
            <h3 id="deactivate-title">Delete Teep account</h3>
            <p>This permanently deletes your Teep account and removes local account settings. If your account has any remaining balance, transfer or withdraw it first. Type <strong>DELETE</strong> to confirm.</p>
            <div className="dashboard-settings-input-row is-editing">
              <span className="material-symbols-outlined" aria-hidden>lock</span>
              <input value={deactivateText} onChange={(event) => setDeactivateText(event.target.value)} placeholder="DELETE" />
            </div>
            {deactivateMsg && <div className="dashboard-settings-modal-message">{deactivateMsg}</div>}
            <div className="dashboard-settings-modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setDeactivateConfirmOpen(false)}>Cancel</button>
              <button type="button" className="dashboard-danger-btn" onClick={deactivateAccount}>Delete Account</button>
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
