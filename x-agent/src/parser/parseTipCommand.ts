import type { ParsedCommand } from "./commandTypes";
import { config } from "../config";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeText(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

export function parseTipCommand(text: string): ParsedCommand | null {
  const normalized = normalizeText(text);
  const botMention = `@${escapeRegExp(config.botUsername)}\\b`;

  if (!new RegExp(botMention, "i").test(normalized)) return null;

  const commandText = normalized.replace(new RegExp(botMention, "gi"), " ");
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

  if (/\b(balance)\b/i.test(normalized)) {
    return { type: "BALANCE" };
  }

  if (/\b(tip|send|grow|help)\b/i.test(normalized)) {
    return { type: "HELP" };
  }

  return { type: "HELP" };
}
