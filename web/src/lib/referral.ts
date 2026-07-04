export const PENDING_REFERRAL_CODE_KEY = "teep_pending_referral_code";

export function normalizeReferralCode(value: string | null | undefined): string {
  const code = String(value || "").trim().toLowerCase();
  return /^[a-z0-9]{4,64}$/.test(code) ? code : "";
}

export function extractReferralCodeInput(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const currentHost = window.location.hostname.toLowerCase();
    const allowedHosts = new Set(["getteep.xyz", "www.getteep.xyz", "localhost", "127.0.0.1", currentHost]);
    if (!["http:", "https:"].includes(parsed.protocol) || !allowedHosts.has(host)) return "";
    return normalizeReferralCode(parsed.searchParams.get("ref"));
  } catch {
    return normalizeReferralCode(raw);
  }
}

export function referralAppliedKey(code: string, address: string): string {
  return `teep_ref_applied_${code}_${address.toLowerCase()}`;
}

export function referralAttemptKey(code: string, address: string): string {
  return `teep_ref_attempt_${code}_${address.toLowerCase()}`;
}

export function storePendingReferralCode(code: string): void {
  if (!code) return;
  window.localStorage.setItem(PENDING_REFERRAL_CODE_KEY, code);
  window.sessionStorage.setItem(PENDING_REFERRAL_CODE_KEY, code);
}

export function readPendingReferralCode(): string {
  return normalizeReferralCode(
    window.sessionStorage.getItem(PENDING_REFERRAL_CODE_KEY) ||
      window.localStorage.getItem(PENDING_REFERRAL_CODE_KEY),
  );
}

export function clearPendingReferralCode(code?: string): void {
  const pending = readPendingReferralCode();
  if (code && pending && pending !== code) return;
  window.localStorage.removeItem(PENDING_REFERRAL_CODE_KEY);
  window.sessionStorage.removeItem(PENDING_REFERRAL_CODE_KEY);
}
