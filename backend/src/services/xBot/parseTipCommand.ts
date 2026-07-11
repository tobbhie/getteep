import type { ParsedCommand } from "./types";

const BOT_HANDLE = (process.env.X_BOT_USERNAME || "teep_app").replace(/^@/, "");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

export function parseTipCommand(text: string): ParsedCommand | null {
  const normalized = normalizeText(text);
  const botMention = `@${escapeRegExp(BOT_HANDLE)}\\b`;

  if (!new RegExp(botMention, "i").test(normalized)) return null;

  const commandText = normalized.replace(new RegExp(botMention, "gi"), " ");
  const tipPattern =
    /\b(?:tip|send)\s+(?:(?:@([A-Za-z0-9_]{1,15})|this\s+post)\s+)?\$?([0-9]+(?:\.[0-9]+)?)\s*(?:USDC|usdc|dollars?)?/gi;
  const tips = Array.from(commandText.matchAll(tipPattern)).map((match) => ({
    recipientXHandle: match[1]?.toLowerCase(),
    amount: match[2],
    tokenSymbol: "USDC" as const,
  }));

  if (tips.length > 0) {
    return { type: "TIP_BATCH", tips };
  }

  if (/\b(balance)\b/i.test(normalized)) {
    return { type: "BALANCE" };
  }

  if (/\b(help)\b/i.test(normalized)) {
    return { type: "HELP" };
  }

  return null;
}

export function amountToRaw(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^[0-9]+(?:\.[0-9]{1,6})?$/.test(trimmed)) {
    throw new Error("INVALID_AMOUNT");
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const fractionPadded = `${fraction}000000`.slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fractionPadded || "0");
}

export function formatUsdcRaw(amountRaw: bigint): string {
  const whole = amountRaw / 1_000_000n;
  const fraction = (amountRaw % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
