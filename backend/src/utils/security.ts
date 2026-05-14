export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export function isBytes32(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

export function isUnsignedIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}

export function normalizeHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{1,15}$/.test(handle) ? handle : null;
}

export function normalizeTweetId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return /^[0-9]{1,30}$/.test(id) ? id : null;
}
