import React, { useCallback, useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { CONFIG } from "../utils/config";
import { debugLog } from "../utils/debug";
import { rememberLocalTipSent } from "../utils/localTipLedger";

type PendingTip = {
  requestId?: string;
  requestKey?: string;
  contentId: string;
  authorHandle: string;
  tweetId?: string;
  amount: number | string;
  rawAmount?: string;
  receiptPreferences?: {
    shareAmountEnabled?: boolean;
    shareLinksEnabled?: boolean;
    postAwareCopyEnabled?: boolean;
  };
  needsApproval?: boolean;
  approveData?: { to: string; data: string } | null;
  tipData: { to: string; data: string };
};

type SignStatus = "loading" | "ready" | "resolving" | "sending" | "success" | "error";

function compactError(err: unknown) {
  const e = err as any;
  return {
    name: e?.name,
    message: e?.message ?? String(err),
    shortMessage: e?.shortMessage,
    details: e?.details,
    code: e?.code,
    cause: e?.cause
      ? {
          name: e.cause?.name,
          message: e.cause?.message,
          shortMessage: e.cause?.shortMessage,
          details: e.cause?.details,
          code: e.cause?.code,
        }
      : undefined,
  };
}

function getTipErrorMessage(err: unknown): string {
  const e = err as any;
  const msg = String(e?.shortMessage ?? e?.message ?? e?.details ?? "").toLowerCase();
  if (
    msg.includes("insufficient") ||
    msg.includes("exceeds balance") ||
    msg.includes("transfer amount") ||
    msg.includes("execution reverted") ||
    msg.includes("unknown reason") ||
    msg.includes("revert")
  ) {
    return "Insufficient funds to tip";
  }
  return e?.shortMessage ?? e?.message ?? "Transaction failed";
}

function receiptTweet(params: { amount: string; authorHandle: string; tweetId?: string; txHash?: string; receiptPreferences?: { shareAmountEnabled?: boolean; shareLinksEnabled?: boolean; postAwareCopyEnabled?: boolean } }) {
  const handle = params.authorHandle.replace(/^@/, "");
  const postUrl = params.tweetId ? `https://x.com/${handle}/status/${params.tweetId}` : "";
  const receiptUrl = params.txHash ? `${CONFIG.RECEIPT_BASE_URL}/tx/${params.txHash}` : CONFIG.WEB_APP_URL;
  const amountPart = params.receiptPreferences?.shareAmountEnabled === false ? "" : ` $${params.amount}`;
  const receiptPart = `\n\nReceipt: ${receiptUrl}`;
  const firstLine = postUrl
    ? `Hey @${handle}, just tipped you${amountPart} via Teep for this wonderful piece: ${postUrl}`
    : `Hey @${handle}, just tipped you${amountPart} via Teep`;
  return `${firstLine}${receiptPart}\nSupport creators directly.`;
}

function formatTipAmount(amount: number | string | undefined) {
  const numeric = Number(amount ?? 0);
  if (!Number.isFinite(numeric)) return `$${amount ?? "0"}`;
  return `$${numeric.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRequestIdFromUrl() {
  return new URLSearchParams(window.location.search).get("requestId") || "";
}

function storageKeys(requestId?: string) {
  return {
    pendingKey: requestId ? `pendingTip:${requestId}` : "pendingTip",
    resultKey: requestId ? `tipResult:${requestId}` : "tipResult",
  };
}

const S = {
  app: {
    width: "360px",
    height: "440px",
    minHeight: "0",
    overflow: "hidden",
    background: "#161121",
    color: "#fff",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    display: "flex",
    flexDirection: "column" as const,
  },
  header: {
    height: "54px",
    padding: "0 16px",
    borderBottom: "1px solid #2d2839",
    display: "flex",
    alignItems: "center",
    gap: "9px",
    flexShrink: 0,
  },
  main: {
    padding: "14px 16px 16px",
    flex: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  card: {
    width: "100%",
    maxWidth: "328px",
    border: "1px solid #2d2839",
    borderRadius: "16px",
    background: "#11121a",
    padding: "16px",
  },
  label: {
    color: "#8b97aa",
    fontSize: "12px",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  primaryBtn: {
    width: "100%",
    border: "none",
    borderRadius: "10px",
    minHeight: "42px",
    background: "#6d28d9",
    color: "#fff",
    fontSize: "14px",
    fontWeight: 800,
    cursor: "pointer",
  },
  ghostBtn: {
    width: "100%",
    border: "1px solid #2d2839",
    borderRadius: "10px",
    minHeight: "40px",
    background: "transparent",
    color: "#8b97aa",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
  },
  amount: {
    fontSize: "40px",
    lineHeight: 1,
    fontWeight: 900,
    textAlign: "center" as const,
    margin: "12px 0 8px",
  },
  helper: {
    color: "#8b97aa",
    fontSize: "12px",
    lineHeight: 1.45,
    textAlign: "center" as const,
    margin: "0",
  },
  summaryBox: {
    border: "1px solid #252b3a",
    borderRadius: "12px",
    padding: "11px 12px",
    background: "#0d111a",
    marginBottom: "10px",
  },
  summaryRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    minHeight: "22px",
  },
};

export function SignTipApp() {
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { client, getClientForChain } = useSmartWallets();
  const [pendingTip, setPendingTip] = useState<PendingTip | null>(null);
  const [status, setStatus] = useState<SignStatus>("loading");
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState("");
  const [txHash, setTxHash] = useState("");

  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");
  const amountLabel = formatTipAmount(pendingTip?.amount);
  const recipientLabel = pendingTip?.authorHandle ? `@${pendingTip.authorHandle.replace(/^@/, "")}` : "this creator";
  const requestId = getRequestIdFromUrl();
  const { pendingKey } = storageKeys(requestId);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousWidth = document.body.style.width;
    const previousHeight = document.body.style.height;
    const previousMinHeight = document.body.style.minHeight;
    const root = document.getElementById("root");
    const previousRootHeight = root?.style.height;
    const previousRootMinHeight = root?.style.minHeight;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.body.style.width = "360px";
    document.body.style.height = "440px";
    document.body.style.minHeight = "0";
    if (root) {
      root.style.height = "440px";
      root.style.minHeight = "0";
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.width = previousWidth;
      document.body.style.height = previousHeight;
      document.body.style.minHeight = previousMinHeight;
      if (root) {
        root.style.height = previousRootHeight || "";
        root.style.minHeight = previousRootMinHeight || "";
      }
    };
  }, []);

  useEffect(() => {
    chrome.storage.local.get([pendingKey, "pendingTip"], (stored) => {
      const scopedPending = stored[pendingKey] as PendingTip | undefined;
      const legacyPending = stored.pendingTip as PendingTip | undefined;
      const nextPending = scopedPending || (!requestId || legacyPending?.requestId === requestId ? legacyPending : undefined);
      if (nextPending) {
        setPendingTip(nextPending);
        setStatus("ready");
      } else {
        setStatus("error");
        setError("No pending transaction found");
      }
    });
  }, [pendingKey, requestId]);

  const resolveClient = useCallback(async () => {
    if (client?.account?.address) return client;

    let lastError: unknown;
    const delays = [0, 700, 1400, 2400, 3600];
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (delays[attempt] > 0) await wait(delays[attempt]);
      try {
        const smartClient = await getClientForChain({ id: CONFIG.CHAIN_ID });
        if (smartClient?.account?.address) return smartClient;
        lastError = new Error("No Arc smart wallet client returned");
      } catch (err) {
        lastError = err;
      }
    }

    const compact = compactError(lastError);
    const msg = compact.shortMessage || compact.message || `Could not prepare your Teep wallet on Arc (${CONFIG.CHAIN_ID}).`;
    throw new Error(msg);
  }, [client, getClientForChain]);

  const createWalletProof = useCallback(async (address: string, purpose: string, smartClient: Awaited<ReturnType<typeof resolveClient>>) => {
    const challengeRes = await fetch(`${CONFIG.API_BASE_URL}/auth/wallet/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, purpose }),
    });
    const challenge = await challengeRes.json();
    if (!challengeRes.ok || !challenge.message) throw new Error(challenge.error || "Could not verify account activity.");
    const signature = await smartClient.signMessage({
      account: smartClient.account,
      message: challenge.message,
    } as Parameters<typeof smartClient.signMessage>[0]);
    return { message: challenge.message, signature };
  }, [resolveClient]);

  const executeTip = useCallback(async () => {
    if (!pendingTip) {
      setStatus("error");
      setError("No pending tip. Close and try again from the tweet.");
      return;
    }
    if (!authenticated) {
      await login();
      return;
    }

    setStatus("resolving");
    setError("");
    setDiagnostic("");

    try {
      const smartClient = await resolveClient();
      const calls: Array<{ to: `0x${string}`; data: `0x${string}`; value?: bigint }> = [];
      if (pendingTip.needsApproval && pendingTip.approveData) {
        calls.push({
          to: pendingTip.approveData.to as `0x${string}`,
          data: pendingTip.approveData.data as `0x${string}`,
        });
      }
      calls.push({
        to: pendingTip.tipData.to as `0x${string}`,
        data: pendingTip.tipData.data as `0x${string}`,
      });

      setStatus("sending");
      const hash = await smartClient.sendTransaction({
        calls,
        account: smartClient.account,
      } as any);

      const rawAmount = pendingTip.rawAmount ?? (Number(pendingTip.amount) * 1_000_000).toString();
      const resolvedRequestId = pendingTip.requestId || requestId;
      const resolvedResultKey = storageKeys(resolvedRequestId).resultKey;
      const resultPayload = {
        requestId: resolvedRequestId,
        contentId: pendingTip.contentId,
        success: true,
        txHash: hash,
        amount: pendingTip.amount,
        timestamp: Date.now(),
      };
      let activityProof: { message: string; signature: string } | null = null;
      try {
        activityProof = await createWalletProof(smartClient.account.address.toLowerCase(), "activity-write", smartClient);
      } catch (proofError) {
        debugLog("SignTip", "activity proof unavailable; indexed chain history will still reconcile", compactError(proofError));
      }
      await chrome.storage.local.set({
        [resolvedResultKey]: resultPayload,
        tipResult: resultPayload,
      });
      await rememberLocalTipSent({
        type: "tip_sent",
        fromAddress: smartClient.account.address.toLowerCase(),
        amount: rawAmount,
        tx_hash: hash.toLowerCase(),
        timestamp: Date.now(),
        author_handle: pendingTip.authorHandle,
        tweet_id: pendingTip.tweetId,
        detail: pendingTip.authorHandle ? `Tipped @${pendingTip.authorHandle}` : "Tip sent",
        local: true,
      });
      const keysToRemove = [storageKeys(resolvedRequestId).pendingKey];
      if (pendingTip.requestId) keysToRemove.push("pendingTip");
      await chrome.storage.local.remove(keysToRemove);
      chrome.runtime.sendMessage({ type: "TIP_TX_COMPLETE", payload: { success: true, txHash: hash, requestId: resolvedRequestId, requestKey: pendingTip.requestKey } }).catch(() => {});
      setTxHash(hash);
      setStatus("success");

      await Promise.allSettled([
        fetch(`${CONFIG.API_BASE_URL}/tips/metadata`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentId: pendingTip.contentId,
            authorHandle: pendingTip.authorHandle,
            tweetId: pendingTip.tweetId,
          }),
        }),
        fetch(`${CONFIG.API_BASE_URL}/tips/activity`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "tip_sent",
            fromAddress: smartClient.account.address.toLowerCase(),
            amount: rawAmount,
            txHash: hash,
            authorHandle: pendingTip.authorHandle,
            tweetId: pendingTip.tweetId,
            detail: pendingTip.authorHandle ? `Tipped @${pendingTip.authorHandle}` : "Tip sent",
            walletProof: activityProof,
          }),
        }),
      ]);

      debugLog("SignTip", "tx success", {
        txHash: hash,
        smartWallet: smartClient.account.address,
        embeddedWallet: embeddedWallet?.address,
      });
    } catch (err) {
      const compact = compactError(err);
      const message = getTipErrorMessage(err);
      const resolvedRequestId = pendingTip.requestId || requestId;
      const failurePayload = {
        requestId: resolvedRequestId,
        contentId: pendingTip.contentId,
        success: false,
        error: message,
        timestamp: Date.now(),
      };
      setStatus("error");
      setError(message);
      setDiagnostic(JSON.stringify(compact, null, 2));
      await chrome.storage.local.set({
        [storageKeys(resolvedRequestId).resultKey]: failurePayload,
        tipResult: failurePayload,
      });
      chrome.runtime.sendMessage({ type: "TIP_TX_COMPLETE", payload: { success: false, requestId: resolvedRequestId, requestKey: pendingTip.requestKey } }).catch(() => {});
      debugLog("SignTip", "tx failed", compact);
    }
  }, [authenticated, createWalletProof, embeddedWallet?.address, login, pendingTip, requestId, resolveClient]);

  return (
    <div style={S.app}>
      <header style={S.header}>
        <span style={{ fontSize: "20px" }}>$</span>
        <span style={{ fontSize: "18px", fontWeight: 800 }}>Confirm Tip</span>
      </header>
      <main style={S.main}>
        {!ready ? (
          <p style={{ color: "#8b97aa" }}>Preparing Teep...</p>
        ) : status === "error" ? (
          <div style={{ ...S.card, borderColor: "rgba(244,33,46,0.45)" }}>
            <div style={{ ...S.label, color: "#ff4d5d" }}>Tip not sent</div>
            <p style={{ fontSize: "14px", lineHeight: 1.5 }}>{error}</p>
            <button onClick={() => window.close()} style={{ ...S.ghostBtn, marginTop: "12px" }}>Close</button>
          </div>
        ) : status === "success" ? (
          <div style={{ ...S.card, borderColor: "rgba(34,197,94,0.45)", textAlign: "center" }}>
            <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: "rgba(34,197,94,0.16)", color: "#22c55e", display: "grid", placeItems: "center", margin: "0 auto 10px", fontSize: "24px", fontWeight: 900 }}>✓</div>
            <h2 style={{ margin: "6px 0 8px", color: "#22c55e", fontSize: "22px" }}>Tip sent</h2>
            <p style={{ color: "#f8fafc", fontSize: "15px", margin: "0 0 4px", fontWeight: 800 }}>You tipped {recipientLabel}</p>
            <p style={{ color: "#8b97aa", fontSize: "13px", margin: "0" }}>{amountLabel} has been sent.</p>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                receiptTweet({
                  amount: String(pendingTip?.amount || "0"),
                  authorHandle: pendingTip?.authorHandle || "",
                  tweetId: pendingTip?.tweetId,
                  txHash,
                  receiptPreferences: pendingTip?.receiptPreferences,
                })
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "block", marginTop: "14px", color: "#9f7aea", fontWeight: 800, textDecoration: "none" }}
            >
              Share on X
            </a>
            <button onClick={() => window.close()} style={{ ...S.ghostBtn, marginTop: "12px" }}>Close</button>
          </div>
        ) : pendingTip ? (
          <div style={S.card}>
            <div style={{ ...S.label, textAlign: "center" }}>Confirm tip</div>
            <div style={S.amount}>{amountLabel}</div>
            <p style={{ ...S.helper, marginBottom: "14px" }}>
              You are about to send a tip to <span style={{ color: "#f8fafc", fontWeight: 900 }}>{recipientLabel}</span>.
            </p>
            <div style={S.summaryBox}>
              <div style={{ ...S.summaryRow, marginBottom: "6px" }}>
                <span style={{ color: "#8b97aa", fontSize: "12px" }}>Creator</span>
                <span style={{ color: "#fff", fontSize: "12px", fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis" }}>{recipientLabel}</span>
              </div>
              <div style={S.summaryRow}>
                <span style={{ color: "#8b97aa", fontSize: "12px" }}>Amount</span>
                <span style={{ color: "#fff", fontSize: "12px", fontWeight: 800 }}>{amountLabel}</span>
              </div>
            </div>
            {pendingTip.needsApproval && (
              <p style={{ ...S.helper, color: "#f6a623", marginBottom: "10px" }}>First-time setup is included. You only confirm once.</p>
            )}
            <div style={{ display: "grid", gap: "8px", marginTop: "14px" }}>
              <button onClick={executeTip} disabled={status === "resolving" || status === "sending"} style={S.primaryBtn}>
                {status === "resolving" ? "Preparing tip..." : status === "sending" ? "Sending tip..." : "Send Tip"}
              </button>
              <button onClick={() => window.close()} style={S.ghostBtn}>Cancel</button>
            </div>
          </div>
        ) : (
          <p style={{ color: "#8b97aa" }}>Loading transaction...</p>
        )}
      </main>
    </div>
  );
}
