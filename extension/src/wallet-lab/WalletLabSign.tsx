import React, { useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { DEFAULT_WALLET_ARCHITECTURE } from "./walletArchitectures";
import { compactError } from "./diagnostics";
import { rememberLocalTipSent } from "../utils/localTipLedger";
import "./walletLab.css";

type PendingTip = {
  requestId?: string;
  requestKey?: string;
  contentId: string;
  authorHandle: string;
  tweetId?: string;
  amount: number;
  rawAmount: string;
  needsApproval?: boolean;
  approveData?: { to: string; data: string } | null;
  tipData: { to: string; data: string };
};

type Status = "loading" | "ready" | "resolving" | "sending" | "success" | "error";

function getRequestIdFromUrl() {
  return new URLSearchParams(window.location.search).get("requestId") || "";
}

function storageKeys(requestId?: string) {
  return {
    pendingKey: requestId ? `pendingTip:${requestId}` : "pendingTip",
    resultKey: requestId ? `tipResult:${requestId}` : "tipResult",
  };
}

export function WalletLabSign() {
  const architecture = DEFAULT_WALLET_ARCHITECTURE;
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { client, getClientForChain } = useSmartWallets();
  const [pendingTip, setPendingTip] = useState<PendingTip | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [result, setResult] = useState<unknown>(null);
  const requestId = getRequestIdFromUrl();
  const { pendingKey } = storageKeys(requestId);

  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");

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
        setResult({ message: "No pendingTip found in extension storage" });
      }
    });
  }, [pendingKey, requestId]);

  const resolveClient = async () => {
    const smartClient = client || (await getClientForChain({ id: architecture.chainId }));
    if (!smartClient?.account?.address) throw new Error("No smart wallet client for Arc");
    return smartClient;
  };

  const executePendingTip = async () => {
    if (!pendingTip) return;
    setStatus("resolving");
    setResult(null);
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
      const txHash = await smartClient.sendTransaction({
        calls,
        account: smartClient.account,
      } as any);

      const success = {
        requestId: pendingTip.requestId || requestId,
        success: true,
        txHash,
        smartWallet: smartClient.account.address,
        embeddedWallet: embeddedWallet?.address,
        amount: pendingTip.amount,
        contentId: pendingTip.contentId,
      };
      setResult(success);
      setStatus("success");
      const resolvedRequestId = pendingTip.requestId || requestId;
      const resultPayload = {
        requestId: resolvedRequestId,
        contentId: pendingTip.contentId,
        success: true,
        txHash,
        amount: pendingTip.amount,
        timestamp: Date.now(),
      };
      await chrome.storage.local.set({
        [storageKeys(resolvedRequestId).resultKey]: resultPayload,
        tipResult: resultPayload,
      });
      await rememberLocalTipSent({
        type: "tip_sent",
        fromAddress: smartClient.account.address.toLowerCase(),
        amount: pendingTip.rawAmount,
        tx_hash: txHash.toLowerCase(),
        timestamp: Date.now(),
        author_handle: pendingTip.authorHandle,
        tweet_id: pendingTip.tweetId,
        detail: pendingTip.authorHandle ? `Tipped @${pendingTip.authorHandle}` : "Tip sent",
        local: true,
      });
      const keysToRemove = [storageKeys(resolvedRequestId).pendingKey];
      if (pendingTip.requestId) keysToRemove.push("pendingTip");
      await chrome.storage.local.remove(keysToRemove);
      chrome.runtime.sendMessage({ type: "TIP_TX_COMPLETE", payload: { success: true, txHash, requestId: resolvedRequestId, requestKey: pendingTip.requestKey } }).catch(() => {});
      console.info("[Teep:WalletLabSign] pending tip tx success", success);
    } catch (err) {
      const failure = compactError(err);
      const resolvedRequestId = pendingTip.requestId || requestId;
      const failurePayload = {
        requestId: resolvedRequestId,
        contentId: pendingTip.contentId,
        success: false,
        error: (failure as any).shortMessage || (failure as any).message || "Wallet lab signer failed",
        timestamp: Date.now(),
      };
      setResult(failure);
      setStatus("error");
      await chrome.storage.local.set({
        [storageKeys(resolvedRequestId).resultKey]: failurePayload,
        tipResult: failurePayload,
      });
      chrome.runtime.sendMessage({ type: "TIP_TX_COMPLETE", payload: { success: false, requestId: resolvedRequestId, requestKey: pendingTip.requestKey } }).catch(() => {});
      console.warn("[Teep:WalletLabSign] pending tip tx failed", failure);
    }
  };

  return (
    <main className="walletLab">
      <section className="panel hero">
        <div>
          <p className="eyebrow">Decoupled signer</p>
          <h1>Wallet Lab Signer</h1>
          <p className="muted">Consumes the same `pendingTip` shape, but avoids the current popup signer code.</p>
        </div>
        {!ready ? <button disabled>Loading Privy...</button> : !authenticated ? <button onClick={login}>Login</button> : null}
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Runtime</h2>
          <dl>
            <dt>Ready</dt>
            <dd>{String(ready)}</dd>
            <dt>Authenticated</dt>
            <dd>{String(authenticated)}</dd>
            <dt>Arc chain ID</dt>
            <dd>{architecture.chainId}</dd>
            <dt>Embedded wallet</dt>
            <dd>{embeddedWallet?.address || "none"}</dd>
            <dt>Hook smart wallet</dt>
            <dd>{client?.account?.address || "none"}</dd>
            <dt>Status</dt>
            <dd>{status}</dd>
          </dl>
        </div>

        <div className="panel">
          <h2>Action</h2>
          <button disabled={!ready || !authenticated || !pendingTip || status === "sending" || status === "resolving"} onClick={executePendingTip}>
            {status === "resolving" ? "Resolving..." : status === "sending" ? "Sending..." : "Execute pending tip"}
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Pending tip</h2>
        {pendingTip ? <pre>{JSON.stringify(pendingTip, null, 2)}</pre> : <p className="muted">No pending tip loaded.</p>}
      </section>

      <section className="panel">
        <h2>Result</h2>
        {result ? <pre className={status === "error" ? "errorBlock" : ""}>{JSON.stringify(result, null, 2)}</pre> : <p className="muted">No result yet.</p>}
      </section>
    </main>
  );
}
