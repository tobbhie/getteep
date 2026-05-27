export type TeepActivityType =
  | "tip_sent"
  | "direct_creator_tip"
  | "tip_received"
  | "deposit"
  | "funding"
  | "withdraw"
  | "withdraw_balance"
  | "referral_fee_received"
  | "send"
  | (string & {});

export type TeepActivityLike = {
  type: TeepActivityType;
  author_handle?: string | null;
  detail?: string | null;
};

export function getTeepActivityTypeLabel(type: TeepActivityType): string {
  if (type === "tip_sent") return "Post tip";
  if (type === "direct_creator_tip") return "Direct creator tip";
  if (type === "tip_received") return "Tip received";
  if (type === "deposit" || type === "funding") return "Deposit";
  if (type === "withdraw" || type === "withdraw_balance") return "Withdrawal";
  if (type === "referral_fee_received") return "Referral earned";
  if (type === "send") return "Transfer";
  return String(type).replace(/_/g, " ");
}

export function getTeepActivityTitle(item: TeepActivityLike): string {
  const handle = item.author_handle?.replace(/^@/, "");
  if (item.type === "tip_sent") return handle ? `Post tip to @${handle}` : "Post tip";
  if (item.type === "direct_creator_tip") return handle ? `Direct creator tip to @${handle}` : "Direct creator tip";
  if (item.type === "tip_received") return handle ? `Tip received from @${handle}` : "Tip received";
  if (item.type === "deposit" || item.type === "funding") {
    const detail = String(item.detail || "").toLowerCase();
    if (detail.includes("faucet")) return "Faucet Funding";
    if (detail.includes("inbound") || detail.includes("crypto_receive") || detail.includes("arc usdc")) return "Inbound Transfer";
    return item.detail || "Account Funding";
  }
  if (item.type === "withdraw" || item.type === "withdraw_balance") return "Withdrawal";
  if (item.type === "referral_fee_received") return "Referral earned";
  return item.detail || getTeepActivityTypeLabel(item.type);
}

export function isTeepActivityPositive(type: TeepActivityType): boolean {
  return type === "tip_received" || type === "referral_fee_received" || type === "deposit" || type === "funding";
}
