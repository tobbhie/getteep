import { CONFIG } from "./config";

const BASE = CONFIG.API_BASE_URL;

export interface TipData {
  contentId: string;
  totalAmount: string;
  tipCount: number;
  recentTips: Array<{
    from_address: string;
    amount: string;
    tx_hash: string;
    timestamp: number;
  }>;
}

export interface AuthorData {
  authorId: string;
  totalReceived: string;
  tipCount: number;
}

/**
 * Fetch tip data for a specific post
 */
export async function fetchTipData(contentId: string): Promise<TipData> {
  const res = await fetch(`${BASE}/tips/${contentId}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Fetch total tips for an author
 */
export async function fetchAuthorTotal(authorId: string): Promise<AuthorData> {
  const res = await fetch(`${BASE}/tips/author/${authorId}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Start X OAuth flow for claiming
 */
export async function startOAuthFlow(ownerAddress: string): Promise<{ authUrl: string; state: string }> {
  const res = await fetch(`${BASE}/auth/x/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerAddress }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/**
 * Format USD amount from raw units (6 decimals) to display string
 */
export function formatUSDC(rawAmount: string): string {
  const num = Number(rawAmount) / 1_000_000;
  if (num === 0) return "$0.00";
  if (num < 0.01) return "< $0.01";
  return `$${num.toFixed(2)}`;
}
