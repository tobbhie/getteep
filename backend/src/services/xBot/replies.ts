import { formatUsdcRaw } from "./parseTipCommand";

const WEB_APP_URL = (process.env.WEB_APP_URL || "https://getteep.xyz").replace(/\/$/, "");
const RECEIPT_BASE_URL = (process.env.RECEIPT_BASE_URL || WEB_APP_URL).replace(/\/$/, "");
const BOT_HANDLE = (process.env.X_BOT_USERNAME || "teepagent").replace(/^@/, "");

export type IntentReplyContext = {
  tweetId?: string;
  recipientHandle?: string;
  amount?: string;
  receiptId?: string;
  intent?: "x-tip" | "x-balance";
};

export type TipReplyItem = {
  recipientHandle: string;
  amountRaw: bigint;
  receiptId?: string;
  claimUrl?: string;
};

function buildAppUrl(path: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return `${WEB_APP_URL}${path}${query ? `?${query}` : ""}`;
}

export function buildIntentUrl(context?: IntentReplyContext) {
  return buildAppUrl("/register", {
    intent: context?.intent || "x-tip",
    tweetId: context?.tweetId,
    recipient: context?.recipientHandle?.replace(/^@/, ""),
    amount: context?.amount,
    receipt: context?.receiptId,
  });
}

export function buildConnectReply(handle?: string, context?: IntentReplyContext) {
  const who = handle ? `@${handle.replace(/^@/, "")}` : "You";
  const intentLine =
    context?.recipientHandle && context.amount
      ? `You tried to tip @${context.recipientHandle.replace(/^@/, "")} ${context.amount} USD.`
      : undefined;
  return [
    "Almost there.",
    "",
    intentLine,
    intentLine ? "" : undefined,
    `${who} needs to connect X on Teep and fund a Teep balance first.`,
    "",
    `Connect: ${buildIntentUrl(context)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildInsufficientBalanceReply(handle?: string, context?: IntentReplyContext) {
  const who = handle ? `@${handle.replace(/^@/, "")}, your` : "Your";
  return [
    "Couldn't send this tip yet.",
    "",
    `Reason: ${who} Teep balance is lower than the requested amount.`,
    "",
    `Add funds: ${buildAppUrl("/fund", {
      intent: "x-tip",
      tweetId: context?.tweetId,
      recipient: context?.recipientHandle?.replace(/^@/, ""),
      amount: context?.amount,
    })}`,
  ].join("\n");
}

export function buildFailureReply(reason: string) {
  const lines = ["Couldn't send this tip yet.", "", `Reason: ${reason}`];
  if (/settings/i.test(reason)) {
    lines.push("");
    lines.push(`Settings: ${buildAppUrl("/dashboard/settings", { tab: "tipping" })}`);
  }
  return lines.join("\n");
}

export function buildInvalidCommandReply(reason: "MISSING_AMOUNT" | "MISSING_RECIPIENT" | "UNSUPPORTED_ASSET" | "MALFORMED") {
  const reasonText =
    reason === "MISSING_AMOUNT"
      ? "Add the amount you want to tip."
      : reason === "MISSING_RECIPIENT"
        ? "Add the creator handle, or reply to a post with \"tip this post\"."
        : reason === "UNSUPPORTED_ASSET"
          ? "Teep X tips currently support USD amounts only."
          : "Use a simple Teep tip command.";

  return [
    "Command needs one more detail.",
    "",
    `Reason: ${reasonText}`,
    "",
    "Try:",
    `@${BOT_HANDLE} tip @creator 5`,
    `@${BOT_HANDLE} tip this post 5`,
  ].join("\n");
}

export function buildSuccessReply(params: {
  senderHandle?: string;
  recipientHandle: string;
  amountRaw: bigint;
  receiptId: string;
}) {
  const sender = params.senderHandle ? `@${params.senderHandle.replace(/^@/, "")}` : "Someone";
  const recipient = `@${params.recipientHandle.replace(/^@/, "")}`;
  const amount = formatUsdcRaw(params.amountRaw);
  return [
    "Tip sent",
    "",
    `${sender} tipped ${recipient} ${amount} USD through Teep.`,
    "",
    `Receipt: ${RECEIPT_BASE_URL}/x/${params.receiptId}`,
  ].join("\n");
}

export function buildClaimableReply(params: {
  senderHandle?: string;
  recipientHandle: string;
  amountRaw: bigint;
  receiptId: string;
}) {
  const sender = params.senderHandle ? `@${params.senderHandle.replace(/^@/, "")}` : "Someone";
  const recipient = `@${params.recipientHandle.replace(/^@/, "")}`;
  const amount = formatUsdcRaw(params.amountRaw);
  const claimUrl = buildIntentUrl({
    intent: "x-tip",
    recipientHandle: params.recipientHandle,
    amount,
    receiptId: params.receiptId,
  });
  return [
    "Tip reserved",
    "",
    `${sender} tipped ${recipient} ${amount} USD through Teep.`,
    "",
    `Claim: ${claimUrl}`,
    "",
    `Receipt: ${RECEIPT_BASE_URL}/x/${params.receiptId}`,
  ].join("\n");
}

export function buildBatchSuccessReply(params: {
  senderHandle?: string;
  completed: TipReplyItem[];
  reserved: TipReplyItem[];
}) {
  const sender = params.senderHandle ? `@${params.senderHandle.replace(/^@/, "")}` : "Someone";
  const items = [...params.completed, ...params.reserved];
  const previewItems = items.slice(0, 3);
  const lines = previewItems.map((item) => {
    const reserved = params.reserved.includes(item) ? " reserved" : "";
    return `@${item.recipientHandle.replace(/^@/, "")} ${formatUsdcRaw(item.amountRaw)} USD${reserved}`;
  });
  const firstReceipt = items.find((item) => item.receiptId)?.receiptId;
  const moreCount = items.length - previewItems.length;

  return [
    params.reserved.length > 0 ? "Tips processed" : "Tips sent",
    "",
    `${sender} tipped:`,
    ...lines,
    moreCount > 0 ? `+${moreCount} more` : undefined,
    params.reserved.length > 0 ? "" : undefined,
    params.reserved.length > 0 ? "Reserved tips can be claimed on Teep." : undefined,
    firstReceipt ? "" : undefined,
    firstReceipt ? `Receipt: ${RECEIPT_BASE_URL}/x/${firstReceipt}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildBalanceReply(handle: string | undefined, amountRaw: bigint) {
  const amount = formatUsdcRaw(amountRaw);
  const who = handle ? `@${handle.replace(/^@/, "")}` : "You";
  return [`${who}'s Teep balance`, "", `${amount} USD`, "", `Add funds: ${buildAppUrl("/fund", { intent: "x-balance" })}`].join(
    "\n"
  );
}

export function buildHelpReply() {
  return [
    "Teep X commands:",
    "",
    `@${BOT_HANDLE} tip @creator 5`,
    `@${BOT_HANDLE} tip this post 5`,
    `@${BOT_HANDLE} balance`,
  ].join("\n");
}
