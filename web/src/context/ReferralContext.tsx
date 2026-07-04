import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useLocation } from "react-router-dom";
import { API_BASE, WEB_APP_URL } from "../config";

type ReferralSummary = {
  code: string | null;
  referredCount: number;
};

type ReferralContextValue = ReferralSummary & {
  address: string;
  loading: boolean;
  status: string;
  referralUrl: string;
  setStatus: (status: string) => void;
  createCode: () => Promise<string | null>;
  applyCode: (code: string) => Promise<boolean>;
  copyLink: () => Promise<boolean>;
  refresh: () => Promise<void>;
};

const ReferralContext = createContext<ReferralContextValue | null>(null);
const summaryCache = new Map<string, { expiresAt: number; value?: ReferralSummary; request?: Promise<ReferralSummary> }>();
const SUMMARY_TTL_MS = 30_000;

async function fetchReferralSummary(address: string, force = false): Promise<ReferralSummary> {
  const cached = summaryCache.get(address);
  if (!force && cached?.value && cached.expiresAt > Date.now()) return cached.value;
  if (!force && cached?.request) return cached.request;

  const request = fetch(`${API_BASE}/referral/summary/${address}`)
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load referral details.");
      const value = {
        code: data.code ? String(data.code) : null,
        referredCount: Number(data.referredCount || 0),
      };
      summaryCache.set(address, { value, expiresAt: Date.now() + SUMMARY_TTL_MS });
      return value;
    })
    .catch((error) => {
      summaryCache.delete(address);
      throw error;
    });

  summaryCache.set(address, { request, expiresAt: Date.now() + SUMMARY_TTL_MS });
  return request;
}

export function ReferralProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const { client: smartWalletClient } = useSmartWallets();
  const { pathname } = useLocation();
  const address = (ready && authenticated ? smartWalletClient?.account?.address || "" : "").toLowerCase();
  const enabled = pathname.startsWith("/dashboard") || pathname.startsWith("/creator");
  const [summary, setSummary] = useState<ReferralSummary>({ code: null, referredCount: 0 });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const refresh = useCallback(async () => {
    if (!address) {
      setSummary({ code: null, referredCount: 0 });
      return;
    }
    setLoading(true);
    try {
      setSummary(await fetchReferralSummary(address, true));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load referral details.");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) return;
    if (!address) {
      setSummary({ code: null, referredCount: 0 });
      return;
    }
    setLoading(true);
    fetchReferralSummary(address)
      .then((value) => {
        if (!cancelled) setSummary(value);
      })
      .catch((error) => {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "Could not load referral details.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [address, enabled]);

  const requestWalletProof = useCallback(async (purpose: "referral-code" | "referral-link" = "referral-code") => {
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

  const createCode = useCallback(async () => {
    if (!address) return null;
    setLoading(true);
    setStatus("");
    try {
      const walletProof = await requestWalletProof("referral-code");
      const response = await fetch(`${API_BASE}/referral/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, walletProof }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.code) throw new Error(data.error || "Could not create referral link.");
      const code = String(data.code);
      const next = { ...summary, code };
      setSummary(next);
      summaryCache.set(address, { value: next, expiresAt: Date.now() + SUMMARY_TTL_MS });
      setStatus("Referral link ready.");
      return code;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create referral link.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [address, requestWalletProof, summary]);

  const applyCode = useCallback(async (rawCode: string) => {
    const code = rawCode.trim().toLowerCase();
    if (!address || !code) return false;
    setLoading(true);
    setStatus("");
    try {
      const walletProof = await requestWalletProof("referral-link");
      const response = await fetch(`${API_BASE}/referral/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: address, code, walletProof }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not apply referral code.");
      setStatus(data.alreadyLinked ? "Referral already linked." : "Referral code applied.");
      await refresh();
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not apply referral code.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [address, refresh, requestWalletProof]);

  const referralUrl = summary.code
    ? `${WEB_APP_URL || window.location.origin}/?ref=${encodeURIComponent(summary.code)}`
    : "";

  const copyLink = useCallback(async () => {
    const code = summary.code || await createCode();
    if (!code) return false;
    const link = `${WEB_APP_URL || window.location.origin}/?ref=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(link);
      setStatus("Referral link copied.");
      return true;
    } catch {
      setStatus("Could not copy referral link.");
      return false;
    }
  }, [createCode, summary.code]);

  const value = useMemo<ReferralContextValue>(() => ({
    address,
    code: summary.code,
    referredCount: summary.referredCount,
    loading,
    status,
    referralUrl,
    setStatus,
    createCode,
    applyCode,
    copyLink,
    refresh,
  }), [address, summary, loading, status, referralUrl, createCode, applyCode, copyLink, refresh]);

  return <ReferralContext.Provider value={value}>{children}</ReferralContext.Provider>;
}

export function useReferral() {
  const context = useContext(ReferralContext);
  if (!context) throw new Error("useReferral must be used within ReferralProvider");
  return context;
}
