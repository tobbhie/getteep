/**
 * Background service worker for Teep extension.
 * Handles wallet operations, transaction construction, signing window management,
 * and OAuth callback tab management.
 *
 * IMPORTANT: This service worker CANNOT sign transactions — it has no DOM/Privy.
 * All signing goes through a popup window where Privy's embedded wallet lives.
 */

import "../utils/process-polyfill";

import { createPublicClient, http, encodeFunctionData, parseUnits } from "viem";
import { CONFIG, TIP_CONTRACT_ABI, USDC_ABI, FACTORY_ABI } from "../utils/config";

const DEBUG = typeof process !== "undefined" && (process.env?.DEBUG_TEEP === "true" || process.env?.DEBUG_TIPCOIN === "true");
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

type ActiveTipRequest = {
  requestId: string;
  windowId?: number;
  startedAt: number;
};

const activeTipRequests = new Map<string, ActiveTipRequest>();
const TIP_REQUEST_TTL_MS = 2 * 60 * 1000;

function newRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function tipInstanceKey(params: { from: string; contentId: string; amount: number }) {
  return `${params.from.toLowerCase()}:${params.contentId.toLowerCase()}:${params.amount}`;
}

function pruneActiveTipRequests() {
  const cutoff = Date.now() - TIP_REQUEST_TTL_MS;
  for (const [key, active] of activeTipRequests.entries()) {
    if (active.startedAt < cutoff) activeTipRequests.delete(key);
  }
}

chrome.storage.local.get(["walletState"], (result) => {
  if (result.walletState) {
    walletState = result.walletState;
    bgLog("Wallet", "Wallet loaded", { address: walletState.address });
  }
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TIP_REQUEST") {
    bgLog("Tip", "TIP_REQUEST received", { payload: message.payload, walletState });
    handleTipRequest(message.payload, { signerPage: "popup.html?sign=tip", source: "popup-signer" })
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

  if (message.type === "TIP_REQUEST_LAB") {
    bgLog("TipLab", "TIP_REQUEST_LAB received", { payload: message.payload, walletState });
    handleTipRequest(message.payload, { signerPage: "wallet-lab-sign.html", source: "wallet-lab-signer" })
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
    // Signing window reports completion — relay to content scripts via storage
    // (already stored by the signing window itself)
    const requestKey = message.payload?.requestKey as string | undefined;
    if (requestKey) activeTipRequests.delete(requestKey);
    bgLog("Tip", "TIP_TX_COMPLETE received", { success: message.payload?.success, requestKey });
    sendResponse({ ok: true });
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
  amount: number;
  tweetId: string;
  authorHandle: string;
}, options: {
  signerPage: string;
  source: "popup-signer" | "wallet-lab-signer";
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
    amount: number;
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
  let verifiedAuthorId: string;
  try {
    verifiedAuthorId = await resolveXAuthorId(authorHandle);
  } catch (err: any) {
    return {
      pending: false,
      error: err?.message || "Could not verify this X creator.",
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
  const rawAmount = parseUnits(amount.toString(), CONFIG.USDC_DECIMALS);
  pruneActiveTipRequests();
  const requestKey = tipInstanceKey({ from: walletState.address, contentId, amount });
  const active = activeTipRequests.get(requestKey);
  if (active) {
    if (active.windowId) {
      chrome.windows.update(active.windowId, { focused: true }).catch(() => {});
    }
    return {
      pending: true,
      duplicate: true,
      requestId: active.requestId,
      signerPage: options.signerPage,
      diagnostic: {
        contentId,
        authorHandle,
        legacyProvidedAuthorId: authorId,
        verifiedAuthorId,
        amount,
        rawAmount: rawAmount.toString(),
        from: walletState.address,
        signerSource: options.source,
      },
    };
  }
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
      return { pending: false, error: "Insufficient funds to tip", diagnostic: diagnosticBase };
    }
  } catch (e) {
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
    return { pending: false, error: "Failed to check allowance: " + err.message, diagnostic: diagnosticBase };
  }

  // Store pending tip for the signing window to pick up
  const requestId = newRequestId();
  const pendingKey = `pendingTip:${requestId}`;
  const resultKey = `tipResult:${requestId}`;
  const pendingTip = {
    requestId,
    requestKey,
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
    signerSource: options.source,
    timestamp: Date.now(),
  };

  // Clear any stale result and store the new pending tip
  await chrome.storage.local.remove([resultKey, "tipResult"]);
  await chrome.storage.local.set({ [pendingKey]: pendingTip, pendingTip });
  activeTipRequests.set(requestKey, { requestId, startedAt: Date.now() });

  // Open signing popup window
  try {
    const separator = options.signerPage.includes("?") ? "&" : "?";
    const signerUrl = `${options.signerPage}${separator}requestId=${encodeURIComponent(requestId)}`;
    const signingWindow = await chrome.windows.create({
      url: chrome.runtime.getURL(signerUrl),
      type: "popup",
      width: options.source === "wallet-lab-signer" ? 980 : 380,
      height: options.source === "wallet-lab-signer" ? 760 : 480,
      focused: true,
    });

    // If the user closes the window without completing, store a cancellation
    if (signingWindow.id) {
      const windowId = signingWindow.id;
      activeTipRequests.set(requestKey, { requestId, windowId, startedAt: Date.now() });
      const closeListener = (closedId: number) => {
        if (closedId !== windowId) return;
        chrome.windows.onRemoved.removeListener(closeListener);
        // Check if a result was stored (success or explicit failure)
        chrome.storage.local.get([resultKey], (result) => {
          if (!result[resultKey]) {
            const cancellation = {
              requestId,
              contentId,
              success: false,
              error: "Cancelled",
              timestamp: Date.now(),
            };
            chrome.storage.local.set({
              [resultKey]: cancellation,
              tipResult: cancellation,
            });
            chrome.storage.local.get(["pendingTip"], (stored) => {
              const legacy = stored.pendingTip as { requestId?: string } | undefined;
              const keys = [pendingKey];
              if (legacy?.requestId === requestId) keys.push("pendingTip");
              chrome.storage.local.remove(keys);
            });
          }
          activeTipRequests.delete(requestKey);
        });
      };
      chrome.windows.onRemoved.addListener(closeListener);
    }
  } catch (err: any) {
    bgLog("Tip", "Failed to open signing window", err?.message ?? err);
    activeTipRequests.delete(requestKey);
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
