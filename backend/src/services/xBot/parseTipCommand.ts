import type { ParsedCommand } from "./types";

const BOT_HANDLE = (process.env.X_BOT_USERNAME || "teepagent").replace(/^@/, "");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function removeBotMention(text: string) {
  const botMention = `@${escapeRegExp(BOT_HANDLE)}\\b`;
  return normalizeText(text.replace(new RegExp(botMention, "gi"), " "));
}

export function classifyIgnoredMention(text: string): string | null {
  const cleaned = removeBotMention(text);
  if (!cleaned) return "EMPTY_MENTION";

  if (/^[\p{Emoji_Presentation}\p{Emoji}\s!?.,'"-]+$/u.test(cleaned)) {
    return "REACTION_ONLY";
  }

  if (/^(l+o+l+|lmao+|lmfao+|haha+|hehe+|thanks?|thank you|nice|cool|ok(?:ay)?|alright|word|bet|done|great|gm|gn)$/i.test(cleaned)) {
    return "ACKNOWLEDGEMENT";
  }

  return null;
}

export function parseTipCommand(text: string): ParsedCommand | null {
  const normalized = normalizeText(text);
  const botMention = `@${escapeRegExp(BOT_HANDLE)}\\b`;

  if (!new RegExp(botMention, "i").test(normalized)) return null;

  const ignoredReason = classifyIgnoredMention(normalized);
  if (ignoredReason) return null;

  const commandText = removeBotMention(normalized);
  if (/\b(?:tip|send)\b/i.test(commandText) && /\b(?:eth|btc|sol|arc|matic|ngn)\b/i.test(commandText)) {
    return { type: "INVALID_COMMAND", reason: "UNSUPPORTED_ASSET" };
  }

  const tipPattern =
    /\b(?:tip|send)\s+((?:@[A-Za-z0-9_]{1,15})|(?:this\s+post))\s+\$?([0-9]+(?:\.[0-9]+)?)\s*(?:USDC|usdc|dollars?)?/gi;
  const tips = Array.from(commandText.matchAll(tipPattern)).map((match) => {
    const target = String(match[1] || "").trim();
    const recipientXHandle = target.startsWith("@") ? target.slice(1).toLowerCase() : undefined;
    return {
      targetType: recipientXHandle ? "creator" as const : "post" as const,
      recipientXHandle,
      amount: match[2],
      tokenSymbol: "USDC" as const,
    };
  });

  if (tips.length > 0) {
    return { type: "TIP_BATCH", tips };
  }

  if (/\b(balance|bal)\b/i.test(commandText)) {
    return { type: "BALANCE" };
  }

  if (/\b(help|commands?)\b/i.test(commandText)) {
    return { type: "HELP" };
  }

  if (/\b(?:tip|send)\b/i.test(commandText)) {
    if (!/@[A-Za-z0-9_]{1,15}\b/i.test(commandText) && !/\bthis\s+post\b/i.test(commandText)) {
      return { type: "INVALID_COMMAND", reason: "MISSING_RECIPIENT" };
    }
    if (!/\$?[0-9]+(?:\.[0-9]+)?\b/i.test(commandText)) {
      return { type: "INVALID_COMMAND", reason: "MISSING_AMOUNT" };
    }
    return { type: "INVALID_COMMAND", reason: "MALFORMED" };
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
