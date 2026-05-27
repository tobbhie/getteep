import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { API_BASE } from "../config";

export type AccountRole = "tipper" | "creator";
export type AccountRoleStatus = "idle" | "loading" | "ready";

type AccountRoleContextValue = {
  address: string;
  role: AccountRole | null;
  status: AccountRoleStatus;
  isCreator: boolean;
  refreshRole: () => Promise<void>;
};

const AccountRoleContext = createContext<AccountRoleContextValue | null>(null);

function roleCacheKey(address: string) {
  return `teep_account_role_${address.toLowerCase()}`;
}

const LAST_ROLE_KEY = "teep_last_account_role";

function readStoredValue(key: string) {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
}

function readCachedRole(address: string): AccountRole | null {
  if (!address || typeof window === "undefined") return null;
  const value = readStoredValue(roleCacheKey(address));
  return value === "creator" || value === "tipper" ? value : null;
}

function readLastKnownRole(): AccountRole | null {
  const value = readStoredValue(LAST_ROLE_KEY);
  return value === "creator" || value === "tipper" ? value : null;
}

function writeCachedRole(address: string, role: AccountRole) {
  if (!address || typeof window === "undefined") return;
  window.localStorage.setItem(roleCacheKey(address), role);
  window.localStorage.setItem(LAST_ROLE_KEY, role);
  window.sessionStorage.setItem(roleCacheKey(address), role);
  window.sessionStorage.setItem(LAST_ROLE_KEY, role);
  const legacyCreatorKey = `teep_creator_role_${address.toLowerCase()}`;
  if (role === "creator") {
    window.localStorage.setItem(legacyCreatorKey, "creator");
    window.sessionStorage.setItem(legacyCreatorKey, "creator");
  } else {
    window.localStorage.removeItem(legacyCreatorKey);
    window.sessionStorage.removeItem(legacyCreatorKey);
  }
}

async function fetchAccountRole(address: string): Promise<AccountRole> {
  const response = await fetch(`${API_BASE}/auth/claim-status/${address}`);
  const data = response.ok ? await response.json() : null;
  return data?.verified && Array.isArray(data?.claims) && data.claims.length > 0 ? "creator" : "tipper";
}

export function AccountRoleProvider({ children }: { children: ReactNode }) {
  const { ready, authenticated } = usePrivy();
  const { client: smartWalletClient } = useSmartWallets();
  const address = (ready && authenticated ? smartWalletClient?.account?.address || "" : "").toLowerCase();
  const cachedRole = useMemo(() => {
    if (!ready || !authenticated) return null;
    return readCachedRole(address) || readLastKnownRole();
  }, [address, authenticated, ready]);
  const [role, setRole] = useState<AccountRole | null>(cachedRole);
  const [status, setStatus] = useState<AccountRoleStatus>(address ? (cachedRole ? "ready" : "loading") : "idle");

  const refreshRole = useCallback(async () => {
    if (!address) {
      setRole(null);
      setStatus("idle");
      return;
    }
    const cached = readCachedRole(address);
    if (cached) {
      setRole(cached);
      setStatus("ready");
    } else {
      setStatus("loading");
    }
    try {
      const nextRole = await fetchAccountRole(address);
      setRole(nextRole);
      setStatus("ready");
      writeCachedRole(address, nextRole);
    } catch {
      setRole(cached || "tipper");
      setStatus("ready");
    }
  }, [address]);

  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setRole(null);
      setStatus("idle");
      return;
    }
    const cached = readCachedRole(address);
    if (cached) {
      setRole(cached);
      setStatus("ready");
    } else {
      setRole(null);
      setStatus("loading");
    }

    fetchAccountRole(address)
      .then((nextRole) => {
        if (cancelled) return;
        setRole(nextRole);
        setStatus("ready");
        writeCachedRole(address, nextRole);
      })
      .catch(() => {
        if (cancelled) return;
        setRole(cached || "tipper");
        setStatus("ready");
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  const value = useMemo<AccountRoleContextValue>(() => {
    const effectiveRole = role || cachedRole;
    return {
      address,
      role: effectiveRole,
      status,
      isCreator: effectiveRole === "creator",
      refreshRole,
    };
  }, [address, cachedRole, refreshRole, role, status]);

  return <AccountRoleContext.Provider value={value}>{children}</AccountRoleContext.Provider>;
}

export function useAccountRole() {
  const context = useContext(AccountRoleContext);
  if (!context) throw new Error("useAccountRole must be used inside AccountRoleProvider");
  return context;
}
