/**
 * Background service worker for Teep extension.
 * Handles wallet operations, transaction construction, signing window management,
 * and OAuth callback tab management.
 *
 * IMPORTANT: This service worker CANNOT sign transactions — it has no DOM/Privy.
 * All signing goes through a popup window where Privy's embedded wallet lives.
 */

import "../utils/process-polyfill";

import { createPublicClient, http, encodeFunctionData, isAddress } from "viem";
import { CONFIG, TIP_CONTRACT_ABI, USDC_ABI, FACTORY_ABI } from "../utils/config";
import { parseTipAmount } from "../utils/tipAmount";
import {
  createTipIntentKey,
  getTipIntent,
  listTipIntents,
  pruneTipIntents,
  saveTipIntent,
  tipIntentComposite,
  TipIntentRecord,
  updateTipIntent,
} from "../utils/tipIntent";

const DEBUG =
  typeof process !== "undefined" &&
  (process.env?.DEBUG_TEEP === "true" || process.env?.DEBUG_TIPCOIN === "true");
const WALLET_LAB_ENABLED = process.env.ENABLE_WALLET_LAB === "true";
function bgLog(tag: string, msg: string, data?: unknown) {
  if (DEBUG) console.log(`[Teep:BG:${tag}]`, msg, data ?? "");
}

bgLog("Init", "Background service worker started");

const publicClient = createPublicClient({
  chain: CONFIG.CHAIN,
  transport: http(CONFIG.RPC_URL),
});

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let data: any = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      throw new Error(data?.error || `Request failed with status ${response.status}`);
    }
    return data as T;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Teep server took too long to respond. url=${url}`);
    }
    if (err instanceof TypeError || /failed to fetch/i.test(String(err?.message || ""))) {
      throw new Error(`Could not reach Teep server. url=${url}; cause=${err?.message || "fetch failed"}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// --- Wallet state ---
interface WalletState {
  address: string | null;
  isConnected: boolean;
}

let walletState: WalletState = { address: null, isConnected: false };

async function getCurrentTipperSettings() {
  if (!walletState.address) return { defaultTipAmount: 5, receipts: { shareAmountEnabled: true, shareLinksEnabled: true, postAwareCopyEnabled: true } };
  try {
    const res = await fetch(`${CONFIG.API_BASE_URL}/api/v1/wallet/${walletState.address}/tipper-settings-public`);
    if (!res.ok) throw new Error("settings unavailable");
    const data = await res.json();
    const amount = Number(data.defaultTipAmount || 5);
    return {
      defaultTipAmount: Number.isFinite(amount) && amount > 0 ? amount : 5,
      receipts: data.receipts || { shareAmountEnabled: true, shareLinksEnabled: true, postAwareCopyEnabled: true },
    };
  } catch {
    return { defaultTipAmount: 5, receipts: { shareAmountEnabled: true, shareLinksEnabled: true, postAwareCopyEnabled: true } };
  }
}

type ActiveTipRequest = {
  requestId: string;
  windowId?: number;
  startedAt: number;
};

const activeTipRequests = new Map<string, ActiveTipRequest>();
const ACTIVE_TIP_TTL_MS = 30 * 60 * 1000;

function newRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function reconcileSubmittedTipIntent(record: TipIntentRecord) {
  if (record.status !== "submitted" || !record.txHash) return record;
  try {
    const receipt = await publicClient.getTransactionReceipt({
      hash: record.txHash as `0x${string}`,
    });
    const updated = await updateTipIntent(record.intentKey, record.attemptId, {
      status: receipt.status === "success" ? "confirmed" : "failed",
      error: receipt.status === "success" ? undefined : "Transaction reverted",
    }) || record;
    if (updated.originTabId) {
      await chrome.tabs.sendMessage(updated.originTabId, {
        type: "TIP_TX_RESULT",
        payload: {
          requestId: updated.attemptId,
          contentId: updated.contentId,
          success: updated.status === "confirmed",
          pending: false,
          txHash: updated.txHash,
          amount: updated.rawAmount,
          amountIsRaw: true,
          error: updated.status === "failed" ? updated.error : undefined,
        },
      }).catch(() => {});
    }
    return updated;
  } catch (err: any) {
    const message = String(err?.shortMessage || err?.message || "").toLowerCase();
    if (!message.includes("not found") && !message.includes("could not be found")) {
      bgLog("TipIntent", "Receipt reconciliation deferred", {
        intentKey: record.intentKey,
        txHash: record.txHash,
        error: err?.message,
      });
    }
    return record;
  }
}

async function maintainTipIntents() {
  await pruneTipIntents();
  const submitted = (await listTipIntents()).filter(
    (record) => record.status === "submitted" && record.txHash
  );
  await Promise.allSettled(submitted.map(reconcileSubmittedTipIntent));
}

let lastIntentMaintenanceAt = 0;
function maintainTipIntentsSoon() {
  if (Date.now() - lastIntentMaintenanceAt < 15_000) return;
  lastIntentMaintenanceAt = Date.now();
  void maintainTipIntents().catch((err) => {
    bgLog("TipIntent", "Deferred maintenance failed", err?.message ?? err);
  });
}

chrome.storage.local.get(["walletState"], (result) => {
  if (result.walletState) {
    walletState = result.walletState;
    bgLog("Wallet", "Wallet loaded", { address: walletState.address });
  }
});
void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch((err) => {
  bgLog("Storage", "Could not restrict local storage access", err?.message ?? err);
});
void maintainTipIntents().catch((err) => {
  bgLog("TipIntent", "Startup maintenance failed", err?.message ?? err);
});

// --- OAuth callback watcher ---
const CALLBACK_URL_PATTERN = `${CONFIG.API_BASE_URL}/auth/x/callback`;

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url || !tab.url.startsWith(CALLBACK_URL_PATTERN)) return;

  bgLog("OAuth", "Callback detected", { tabId });

  if (tab.title && tab.title.includes("Verified")) {
    chrome.runtime.sendMessage({ type: "CLAIM_VERIFIED" }).catch(() => {});
    setTimeout(() => {
      chrome.tabs.remove(tabId).catch(() => {});
    }, 2000);
  }
});

// --- Message handler ---
type RuntimeMessage = {
  type?: unknown;
  payload?: unknown;
};

const CONTENT_MESSAGE_TYPES = new Set([
  "GET_CURRENT_USER_USDC_BALANCE",
  "GET_CURRENT_USER_TIPPER_SETTINGS",
]);

const EXTENSION_MESSAGE_TYPES = new Set([
  ...(WALLET_LAB_ENABLED ? ["TIP_REQUEST_LAB"] : []),
  "TIP_TX_COMPLETE",
  "WALLET_CONNECTED",
  "WALLET_DISCONNECTED",
  "GET_WALLET_STATE",
  "GET_USDC_BALANCE",
  "COMPUTE_CLAIM_WALLET",
  "IS_CLAIM_WALLET_DEPLOYED",
  "GET_CLAIM_WALLET_BALANCE",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isExtensionPageSender(sender: chrome.runtime.MessageSender) {
  return sender.id === chrome.runtime.id &&
    typeof sender.url === "string" &&
    sender.url.startsWith(chrome.runtime.getURL(""));
}

function isSupportedContentSender(sender: chrome.runtime.MessageSender) {
  if (sender.id !== chrome.runtime.id || !sender.tab?.id || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === "https:" && (url.hostname === "x.com" || url.hostname === "twitter.com");
  } catch {
    return false;
  }
}

function isHex32(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isXHandle(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_]{1,15}$/.test(value.replace(/^@/, ""));
}

function isTipRequestPayload(value: unknown): value is {
  contentId: string;
  authorId?: string;
  amount: string;
  tweetId: string;
  authorHandle: string;
} {
  if (!isRecord(value)) return false;
  if (
    !isHex32(value.contentId) ||
    typeof value.amount !== "string" ||
    !/^\d{1,24}$/.test(String(value.tweetId || "")) ||
    !isXHandle(value.authorHandle)
  ) {
    return false;
  }
  if (value.authorId !== undefined && !/^\d+$/.test(String(value.authorId))) return false;
  try {
    parseTipAmount(value.amount);
    return true;
  } catch {
    return false;
  }
}

function isTipCompletionPayload(value: unknown): value is {
  success: boolean;
  pending?: boolean;
  intentStatus: "submitted" | "confirmed" | "failed" | "cancelled";
  txHash?: string;
  requestId: string;
  intentKey: string;
  error?: string;
} {
  if (!isRecord(value)) return false;
  const statuses = new Set(["submitted", "confirmed", "failed", "cancelled"]);
  return typeof value.success === "boolean" &&
    (value.pending === undefined || typeof value.pending === "boolean") &&
    typeof value.intentStatus === "string" &&
    statuses.has(value.intentStatus) &&
    typeof value.requestId === "string" &&
    /^[a-zA-Z0-9-]{8,128}$/.test(value.requestId) &&
    typeof value.intentKey === "string" &&
    /^[0-9a-f]{64}$/.test(value.intentKey) &&
    (value.txHash === undefined || (typeof value.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(value.txHash))) &&
    (value.error === undefined || (typeof value.error === "string" && value.error.length <= 300));
}

function validateRuntimeMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): string | null {
  if (!message || typeof message.type !== "string") return "Invalid extension request";
  if (message.type === "TIP_REQUEST") {
    if (!isSupportedContentSender(sender) && !isExtensionPageSender(sender)) {
      return "Untrusted tip request";
    }
  } else if (CONTENT_MESSAGE_TYPES.has(message.type)) {
    if (!isSupportedContentSender(sender)) return "Untrusted page request";
  } else if (EXTENSION_MESSAGE_TYPES.has(message.type)) {
    if (!isExtensionPageSender(sender)) return "Untrusted extension request";
  } else {
    return "Unsupported extension request";
  }

  if (message.type === "TIP_REQUEST" || (WALLET_LAB_ENABLED && message.type === "TIP_REQUEST_LAB")) {
    return isTipRequestPayload(message.payload) ? null : "Invalid tip details";
  }
  if (message.type === "TIP_TX_COMPLETE") {
    return isTipCompletionPayload(message.payload) ? null : "Invalid transaction result";
  }
  if (message.type === "WALLET_CONNECTED") {
    return isRecord(message.payload) && typeof message.payload.address === "string" && isAddress(message.payload.address)
      ? null
      : "Invalid wallet address";
  }
  if (message.type === "GET_USDC_BALANCE" || message.type === "GET_CLAIM_WALLET_BALANCE") {
    return isRecord(message.payload) && typeof message.payload.address === "string" && isAddress(message.payload.address)
      ? null
      : "Invalid wallet address";
  }
  if (message.type === "COMPUTE_CLAIM_WALLET" || message.type === "IS_CLAIM_WALLET_DEPLOYED") {
    return isRecord(message.payload) && /^\d+$/.test(String(message.payload.authorIdHash || ""))
      ? null
      : "Invalid creator identity";
  }
  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const validationError = validateRuntimeMessage(message, sender);
  if (validationError) {
    bgLog("Message", validationError, { type: message?.type, senderUrl: sender.url });
    sendResponse({ pending: false, success: false, error: validationError });
    return false;
  }
  maintainTipIntentsSoon();

  if (message.type === "TIP_REQUEST") {
    bgLog("Tip", "TIP_REQUEST received", { payload: message.payload, walletState });
    handleTipRequest(message.payload, {
      signerPage: "popup.html?sign=tip",
      source: "popup-signer",
      originTabId: sender.tab?.id,
    })
      .then((result) => {
        bgLog("Tip", "handleTipRequest result", result);
        sendResponse(result);
      })
      .catch((err) => {
        bgLog("Tip", "handleTipRequest error", err?.message ?? err);
        sendResponse({ pending: false, error: err.message });
      });
    return true;
  }

  if (WALLET_LAB_ENABLED && message.type === "TIP_REQUEST_LAB") {
    bgLog("TipLab", "TIP_REQUEST_LAB received", { payload: message.payload, walletState });
    handleTipRequest(message.payload, { signerPage: "wallet-lab-sign.html", source: "diagnostic-signer" })
      .then((result) => {
        bgLog("Tip", "handleTipRequest result", result);
        sendResponse(result);
      })
      .catch((err) => {
        bgLog("Tip", "handleTipRequest error", err?.message ?? err);
        sendResponse({ pending: false, error: err.message });
      });
    return true;
  }

  if (message.type === "TIP_TX_COMPLETE") {
    const intentKey = message.payload?.intentKey as string | undefined;
    const attemptId = message.payload?.requestId as string | undefined;
    const txHash = message.payload?.txHash as string | undefined;
    if (!intentKey || !attemptId) {
      sendResponse({ ok: false, error: "Missing tip intent identity" });
      return false;
    }

    const status = message.payload.intentStatus;
    updateTipIntent(intentKey, attemptId, {
      status,
      txHash,
      error: status === "failed" || status === "cancelled"
        ? message.payload?.error || "Tip failed"
        : undefined,
    })
      .then(async (record) => {
        activeTipRequests.delete(intentKey);
        if (record?.originTabId) {
          await chrome.tabs.sendMessage(record.originTabId, {
            type: "TIP_TX_RESULT",
            payload: {
              requestId: attemptId,
              contentId: record.contentId,
              success: Boolean(message.payload?.success),
              pending: Boolean(message.payload?.pending),
              txHash,
              amount: record.rawAmount,
              amountIsRaw: true,
              error: message.payload?.error,
            },
          }).catch(() => {});
        }
        bgLog("Tip", "TIP_TX_COMPLETE received", { status, intentKey, attemptId, txHash });
        sendResponse({ ok: true });
      })
      .catch((err) => sendResponse({ ok: false, error: err?.message || "Could not update tip intent" }));
    return true;
  }

  if (message.type === "WALLET_CONNECTED") {
    walletState = { address: message.payload.address, isConnected: true };
    chrome.storage.local.set({ walletState });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "WALLET_DISCONNECTED") {
    walletState = { address: null, isConnected: false };
    chrome.storage.local.set({ walletState });
    sendResponse({ success: true });
    return true;
  }

  if (message.type === "GET_WALLET_STATE") {
    sendResponse(walletState);
    return true;
  }

  if (message.type === "GET_USDC_BALANCE") {
    getUSDCBalance(message.payload.address)
      .then((balance) => sendResponse({ balance }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "GET_CURRENT_USER_USDC_BALANCE") {
    if (!walletState.isConnected || !walletState.address) {
      sendResponse({ error: "Not connected" });
      return false;
    }
    getUSDCBalance(walletState.address)
      .then((balance) => sendResponse({ balance }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "GET_CURRENT_USER_TIPPER_SETTINGS") {
    if (!walletState.isConnected || !walletState.address) {
      sendResponse({ error: "Not connected", defaultTipAmount: 5 });
      return false;
    }
    getCurrentTipperSettings()
      .then((settings) => sendResponse(settings))
      .catch((err) => sendResponse({ error: err?.message || "Could not load settings", defaultTipAmount: 5 }));
    return true;
  }

  if (message.type === "COMPUTE_CLAIM_WALLET") {
    computeClaimWallet(message.payload.authorIdHash)
      .then((address) => sendResponse({ address }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "IS_CLAIM_WALLET_DEPLOYED") {
    isClaimWalletDeployed(message.payload.authorIdHash)
      .then((deployed) => sendResponse({ deployed }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === "GET_CLAIM_WALLET_BALANCE") {
    getUSDCBalance(message.payload.address)
      .then((balance) => sendResponse({ balance }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

// --- Tip handler ---
// Constructs the transaction, stores it, and opens a signing window.
// The actual signing happens in the popup window via Privy.
async function handleTipRequest(payload: {
  contentId: string;
  authorId?: string;
  amount: string;
  tweetId: string;
  authorHandle: string;
}, options: {
  signerPage: string;
  source: "popup-signer" | "diagnostic-signer";
  originTabId?: number;
}): Promise<{
  pending: boolean;
  error?: string;
  signerPage?: string;
  requestId?: string;
  duplicate?: boolean;
  diagnostic?: {
    contentId: string;
    authorHandle: string;
    legacyProvidedAuthorId?: string;
    verifiedAuthorId?: string;
    amount: string;
    rawAmount?: string;
    from?: string;
    needsApproval?: boolean;
    signerSource?: string;
  };
}> {
  if (!walletState.isConnected || !walletState.address) {
    bgLog("Tip", "Reject: wallet not connected", walletState);
    return { pending: false, error: "Wallet not connected. Open the Teep popup to connect." };
  }

  const { contentId, authorId, amount, tweetId, authorHandle } = payload;
  let rawAmount: bigint;
  try {
    rawAmount = parseTipAmount(amount).raw;
  } catch {
    return { pending: false, error: "Enter a valid tip amount." };
  }

  const from = walletState.address;
  const composite = tipIntentComposite({
    chainId: CONFIG.CHAIN_ID,
    from,
    contentId,
    authorHandle,
    rawAmount: rawAmount.toString(),
  });
  const inProcess = activeTipRequests.get(composite);
  if (inProcess && Date.now() - inProcess.startedAt <= ACTIVE_TIP_TTL_MS) {
    return {
      pending: false,
      duplicate: true,
      requestId: inProcess.requestId,
      error: "This tip is already being prepared.",
    };
  }
  if (inProcess) activeTipRequests.delete(composite);

  const requestId = newRequestId();
  activeTipRequests.set(composite, { requestId, startedAt: Date.now() });

  let intentKey: string;
  try {
    intentKey = await createTipIntentKey(composite);
  } catch {
    activeTipRequests.delete(composite);
    return { pending: false, error: "Could not prepare this tip. Please try again." };
  }

  let existing = await getTipIntent(intentKey);
  if (existing?.status === "submitted") {
    existing = await reconcileSubmittedTipIntent(existing);
  }

  if (existing?.status === "submitted") {
    activeTipRequests.delete(composite);
    return {
      pending: false,
      duplicate: true,
      requestId: existing.attemptId,
      error: "This tip was already submitted and is awaiting confirmation.",
    };
  }

  if (existing?.status === "signing" && existing.windowId) {
    try {
      await chrome.windows.get(existing.windowId);
      activeTipRequests.delete(composite);
      activeTipRequests.set(intentKey, {
        requestId: existing.attemptId,
        windowId: existing.windowId,
        startedAt: existing.updatedAt,
      });
      await chrome.windows.update(existing.windowId, { focused: true });
      return {
        pending: true,
        duplicate: true,
        requestId: existing.attemptId,
        signerPage: options.signerPage,
      };
    } catch {
      await updateTipIntent(intentKey, existing.attemptId, {
        status: "cancelled",
        error: "Signing window is no longer open",
        windowId: undefined,
      });
    }
  } else if (existing?.status === "created" || existing?.status === "signing") {
    await updateTipIntent(intentKey, existing.attemptId, {
      status: "failed",
      error: "Tip preparation was interrupted",
      windowId: undefined,
    });
  }

  const now = Date.now();
  await saveTipIntent({
    intentKey,
    attemptId: requestId,
    status: "created",
    chainId: CONFIG.CHAIN_ID,
    from: from.toLowerCase(),
    contentId: contentId.toLowerCase(),
    authorHandle: authorHandle.replace(/^@/, "").toLowerCase(),
    rawAmount: rawAmount.toString(),
    originTabId: options.originTabId,
    createdAt: now,
    updatedAt: now,
  });
  activeTipRequests.delete(composite);
  activeTipRequests.set(intentKey, { requestId, startedAt: now });

  const failIntent = async (error: string) => {
    activeTipRequests.delete(intentKey);
    await updateTipIntent(intentKey, requestId, { status: "failed", error });
  };

  let verifiedAuthorId: string;
  try {
    verifiedAuthorId = await resolveXAuthorId(authorHandle);
  } catch (err: any) {
    const error = err?.message || "Could not verify this X creator.";
    await failIntent(error);
    return {
      pending: false,
      error,
      diagnostic: {
        contentId,
        authorHandle,
        legacyProvidedAuthorId: authorId,
        amount,
        from: walletState.address,
        signerSource: options.source,
      },
    };
  }
  await updateTipIntent(intentKey, requestId, { authorId: verifiedAuthorId });

  const diagnosticBase = {
    contentId,
    authorHandle,
    legacyProvidedAuthorId: authorId,
    verifiedAuthorId,
    amount,
    rawAmount: rawAmount.toString(),
    from: walletState.address,
    signerSource: options.source,
  };

  // Block before opening signing window if balance is insufficient
  try {
    const balance = await getUSDCBalance(walletState.address);
    if (BigInt(balance) < rawAmount) {
      await failIntent("Insufficient funds to tip");
      return { pending: false, error: "Insufficient funds to tip", diagnostic: diagnosticBase };
    }
  } catch (e) {
    await failIntent("Could not check balance");
    return { pending: false, error: "Could not check balance. Try again.", diagnostic: diagnosticBase };
  }

  bgLog("Tip", "Building tip tx and opening signing window");

  // Encode tip calldata
  const tipCalldata = encodeFunctionData({
    abi: TIP_CONTRACT_ABI,
    functionName: "tip",
    args: [contentId as `0x${string}`, BigInt(verifiedAuthorId), rawAmount],
  });

  // Check if USDC approval is needed
  let needsApproval = false;
  let approveData: { to: string; data: string } | null = null;

  try {
    const allowance = await publicClient.readContract({
      address: CONFIG.USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: "allowance",
      args: [walletState.address as `0x${string}`, CONFIG.TIP_CONTRACT_ADDRESS],
    });
    needsApproval = (allowance as bigint) < rawAmount;
    if (needsApproval) {
      approveData = {
        to: CONFIG.USDC_ADDRESS as string,
        data: encodeFunctionData({
          abi: USDC_ABI,
          functionName: "approve",
          args: [CONFIG.TIP_CONTRACT_ADDRESS, rawAmount],
        }),
      };
    }
  } catch (err: any) {
    await failIntent("Failed to check allowance");
    return { pending: false, error: "Failed to check allowance: " + err.message, diagnostic: diagnosticBase };
  }
  await updateTipIntent(intentKey, requestId, { needsApproval });

  // Store pending tip for the signing window to pick up
  const pendingKey = `pendingTip:${requestId}`;
  const resultKey = `tipResult:${requestId}`;
  const pendingTip = {
    requestId,
    intentKey,
    requestKey: intentKey,
    contentId,
    authorId: verifiedAuthorId,
    authorHandle,
    tweetId,
    amount,
    rawAmount: rawAmount.toString(),
    needsApproval,
    approveData,
    tipData: {
      to: CONFIG.TIP_CONTRACT_ADDRESS as string,
      data: tipCalldata,
    },
    from: walletState.address,
    receiptPreferences: (await getCurrentTipperSettings()).receipts,
    signerSource: options.source,
    timestamp: Date.now(),
  };

  // Clear any stale result and store the new pending tip
  await chrome.storage.local.remove([resultKey, "tipResult"]);
  await chrome.storage.local.set({ [pendingKey]: pendingTip, pendingTip });
  await updateTipIntent(intentKey, requestId, { status: "signing" });

  // Open signing popup window
  try {
    const separator = options.signerPage.includes("?") ? "&" : "?";
    const signerUrl = `${options.signerPage}${separator}requestId=${encodeURIComponent(requestId)}`;
    const signingWindow = await chrome.windows.create({
      url: chrome.runtime.getURL(signerUrl),
      type: "popup",
      width: options.source === "diagnostic-signer" ? 980 : 380,
      height: options.source === "diagnostic-signer" ? 760 : 480,
      focused: true,
    });

    // If the user closes the window without completing, store a cancellation
    if (signingWindow.id) {
      const windowId = signingWindow.id;
      activeTipRequests.set(intentKey, { requestId, windowId, startedAt: Date.now() });
      await updateTipIntent(intentKey, requestId, { status: "signing", windowId });
      const closeListener = (closedId: number) => {
        if (closedId !== windowId) return;
        chrome.windows.onRemoved.removeListener(closeListener);
        void (async () => {
          const current = await getTipIntent(intentKey);
          if (!current || current.attemptId !== requestId) return;
          if (current.status === "created" || current.status === "signing") {
            const cancellation = {
              requestId,
              contentId,
              success: false,
              error: "Cancelled",
              timestamp: Date.now(),
            };
            await chrome.storage.local.set({
              [resultKey]: cancellation,
              tipResult: cancellation,
            });
            await updateTipIntent(intentKey, requestId, {
              status: "cancelled",
              error: "Cancelled",
              windowId: undefined,
            });
            const stored = await chrome.storage.local.get(["pendingTip"]);
            const legacy = stored.pendingTip as { requestId?: string } | undefined;
            const keys = [pendingKey];
            if (legacy?.requestId === requestId) keys.push("pendingTip");
            await chrome.storage.local.remove(keys);
          }
          activeTipRequests.delete(intentKey);
        })().catch((err) => bgLog("TipIntent", "Window close handling failed", err?.message ?? err));
      };
      chrome.windows.onRemoved.addListener(closeListener);
    }
  } catch (err: any) {
    bgLog("Tip", "Failed to open signing window", err?.message ?? err);
    await failIntent("Failed to open signing window");
    await chrome.storage.local.remove([pendingKey, "pendingTip"]);
    return {
      pending: false,
      error: "Failed to open signing window: " + (err?.message ?? "unknown"),
      diagnostic: { ...diagnosticBase, needsApproval },
    };
  }

    return {
      pending: true,
      requestId,
      signerPage: options.signerPage,
      diagnostic: { ...diagnosticBase, needsApproval },
    };
}

async function resolveXAuthorId(authorHandle: string): Promise<string> {
  const handle = authorHandle.replace(/^@/, "").toLowerCase();
  if (!CONFIG.API_BASE_URL) {
    throw new Error("Extension API_BASE_URL is empty. Rebuild with API_BASE_URL set and reload the extension.");
  }
  const url = `${CONFIG.API_BASE_URL}/auth/x/user/${encodeURIComponent(handle)}`;
  const data = await fetchJson<{ id?: string }>(url);
  if (!data.id || !/^[0-9]+$/.test(data.id)) {
    throw new Error("Could not verify this X creator.");
  }
  return data.id;
}

// --- Claim wallet helpers ---
async function computeClaimWallet(authorIdHash: string): Promise<string> {
  const address = await publicClient.readContract({
    address: CONFIG.WALLET_FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "computeClaimWallet",
    args: [BigInt(authorIdHash)],
  });
  return address as string;
}

async function isClaimWalletDeployed(authorIdHash: string): Promise<boolean> {
  const deployed = await publicClient.readContract({
    address: CONFIG.WALLET_FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "isDeployed",
    args: [BigInt(authorIdHash)],
  });
  return deployed as boolean;
}

// --- Balance helper ---
async function getUSDCBalance(address: string): Promise<string> {
  const balance = await publicClient.readContract({
    address: CONFIG.USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });
  return (balance as bigint).toString();
}
