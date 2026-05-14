import React, { useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { CONFIG } from "../utils/config";
import { computeContentId, handleToAuthorId, parsePostUrl } from "../utils/contentId";
import { checkFactoryBytecode, compactError, FactoryCodeResult } from "./diagnostics";
import { DEFAULT_WALLET_ARCHITECTURE } from "./walletArchitectures";
import "./walletLab.css";

type ClientResult = {
  ok: boolean;
  account?: string;
  chainId?: number;
  error?: unknown;
};

type TxResult = {
  ok: boolean;
  hash?: string;
  to?: string;
  error?: unknown;
};

export function WalletLab() {
  const architecture = DEFAULT_WALLET_ARCHITECTURE;
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { client, getClientForChain } = useSmartWallets();
  const [busy, setBusy] = useState("");
  const [clientResult, setClientResult] = useState<ClientResult | null>(null);
  const [factoryResults, setFactoryResults] = useState<FactoryCodeResult[]>([]);
  const [signature, setSignature] = useState("");
  const [txResult, setTxResult] = useState<TxResult | null>(null);
  const [labPostUrl, setLabPostUrl] = useState("");
  const [labTipAmount, setLabTipAmount] = useState("0.01");
  const [labTipResult, setLabTipResult] = useState<unknown>(null);

  const embeddedWallet = useMemo(
    () => wallets.find((wallet) => wallet.walletClientType === "privy"),
    [wallets]
  );

  const resolveClient = async () => {
    const smartClient = client || (await getClientForChain({ id: architecture.chainId }));
    if (!smartClient?.account?.address) throw new Error("No smart wallet client for Arc");
    return smartClient;
  };

  const inspectClient = async () => {
    setBusy("client");
    setClientResult(null);
    try {
      const smartClient = await resolveClient();
      const result = {
        ok: true,
        account: smartClient.account.address,
        chainId: architecture.chainId,
      };
      setClientResult(result);
      console.info("[Teep:WalletLab] getClientForChain success", result);
    } catch (err) {
      const result = { ok: false, chainId: architecture.chainId, error: compactError(err) };
      setClientResult(result);
      console.warn("[Teep:WalletLab] getClientForChain failed", result);
    } finally {
      setBusy("");
    }
  };

  const inspectFactories = async () => {
    setBusy("factories");
    try {
      const results = await checkFactoryBytecode(architecture);
      setFactoryResults(results);
      console.info("[Teep:WalletLab] factory bytecode", results);
    } finally {
      setBusy("");
    }
  };

  const signMessage = async () => {
    setBusy("sign");
    setSignature("");
    try {
      const smartClient = await resolveClient();
      const signed = await smartClient.signMessage({
        message: `Teep wallet lab ${new Date().toISOString()}`,
      });
      setSignature(signed);
      console.info("[Teep:WalletLab] signMessage success", { signature: signed });
    } catch (err) {
      setClientResult({ ok: false, chainId: architecture.chainId, error: compactError(err) });
      console.warn("[Teep:WalletLab] signMessage failed", compactError(err));
    } finally {
      setBusy("");
    }
  };

  const sendNoopTransaction = async () => {
    setBusy("tx");
    setTxResult(null);
    try {
      const smartClient = await resolveClient();
      if (!embeddedWallet?.address) throw new Error("No embedded wallet destination available");
      const hash = await smartClient.sendTransaction({
        calls: [
          {
            to: embeddedWallet.address as `0x${string}`,
            value: 0n,
            data: "0x",
          },
        ],
        account: smartClient.account,
      } as any);
      const result = { ok: true, hash, to: embeddedWallet.address };
      setTxResult(result);
      console.info("[Teep:WalletLab] no-op tx success", result);
    } catch (err) {
      const result = { ok: false, error: compactError(err) };
      setTxResult(result);
      console.warn("[Teep:WalletLab] no-op tx failed", result);
    } finally {
      setBusy("");
    }
  };

  const openExistingPendingTipInLabSigner = async () => {
    const url = chrome.runtime.getURL("wallet-lab-sign.html");
    await chrome.windows.create({ url, type: "popup", width: 980, height: 760, focused: true });
  };

  const runLabTipRequest = async () => {
    setBusy("lab-tip");
    setLabTipResult(null);
    try {
      const parsed = parsePostUrl(labPostUrl);
      if (!parsed) throw new Error("Enter a valid X post URL");
      const amount = Number(labTipAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid tip amount");
      const contentId = computeContentId(parsed.authorHandle, parsed.tweetId);
      const authorId = handleToAuthorId(parsed.authorHandle);
      const response = await chrome.runtime.sendMessage({
        type: "TIP_REQUEST_LAB",
        payload: {
          contentId,
          authorId,
          amount,
          tweetId: parsed.tweetId,
          authorHandle: parsed.authorHandle,
        },
      });
      setLabTipResult(response);
      console.info("[Teep:WalletLab] TIP_REQUEST_LAB response", response);
    } catch (err) {
      const failure = compactError(err);
      setLabTipResult(failure);
      console.warn("[Teep:WalletLab] TIP_REQUEST_LAB failed", failure);
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="walletLab">
      <section className="panel hero">
        <div>
          <p className="eyebrow">Decoupled wallet architecture</p>
          <h1>{architecture.label}</h1>
          <p className="muted">A sidecar page inside the extension. The current popup remains untouched.</p>
        </div>
        <div className="actions">
          {!ready ? (
            <button disabled>Loading Privy...</button>
          ) : authenticated ? (
            <button className="secondary" onClick={logout}>Logout</button>
          ) : (
            <button onClick={login}>Login with Privy</button>
          )}
        </div>
      </section>

      <section className="grid">
        <div className="panel">
          <h2>Runtime</h2>
          <dl>
            <dt>Privy app ID</dt>
            <dd>{architecture.privyAppId}</dd>
            <dt>Ready</dt>
            <dd>{String(ready)}</dd>
            <dt>Authenticated</dt>
            <dd>{String(authenticated)}</dd>
            <dt>Arc chain ID</dt>
            <dd>{architecture.chainId}</dd>
            <dt>User ID</dt>
            <dd>{user?.id || "none"}</dd>
            <dt>Embedded wallet</dt>
            <dd>{embeddedWallet?.address || "none"}</dd>
            <dt>Hook smart wallet</dt>
            <dd>{client?.account?.address || "none"}</dd>
            <dt>RPC URL</dt>
            <dd>{CONFIG.RPC_URL}</dd>
          </dl>
        </div>

        <div className="panel">
          <h2>Blocks</h2>
          <div className="buttonStack">
            <button disabled={busy !== ""} onClick={inspectFactories}>{busy === "factories" ? "Checking..." : "1. Check factories"}</button>
            <button disabled={!authenticated || busy !== ""} onClick={inspectClient}>{busy === "client" ? "Resolving..." : "2. Resolve smart wallet"}</button>
            <button disabled={!authenticated || busy !== ""} onClick={signMessage}>{busy === "sign" ? "Signing..." : "3. Sign message"}</button>
            <button disabled={!authenticated || busy !== ""} onClick={sendNoopTransaction}>{busy === "tx" ? "Sending..." : "4. Send no-op tx"}</button>
          </div>
          {signature && <p className="success">Signed: {signature.slice(0, 18)}...{signature.slice(-12)}</p>}
        </div>
      </section>

      <section className="panel">
        <h2>Smart wallet client</h2>
        {clientResult ? <pre className={clientResult.ok ? "" : "errorBlock"}>{JSON.stringify(clientResult, null, 2)}</pre> : <p className="muted">Run block 2.</p>}
      </section>

      <section className="panel">
        <h2>No-op transaction</h2>
        {txResult ? <pre className={txResult.ok ? "" : "errorBlock"}>{JSON.stringify(txResult, null, 2)}</pre> : <p className="muted">Run block 4 after the client resolves.</p>}
      </section>

      <section className="panel">
        <h2>Lab tip signer A/B</h2>
        <p className="muted">
          Builds the same pending tip in the background, but opens `wallet-lab-sign.html` instead of the current popup signer.
        </p>
        <div className="formGrid">
          <input value={labPostUrl} onChange={(event) => setLabPostUrl(event.target.value)} placeholder="https://x.com/handle/status/123" />
          <input value={labTipAmount} onChange={(event) => setLabTipAmount(event.target.value)} placeholder="0.01" />
        </div>
        <div className="buttonStack">
          <button disabled={!authenticated || busy !== ""} onClick={runLabTipRequest}>{busy === "lab-tip" ? "Opening..." : "Open lab signer with real tip"}</button>
          <button disabled={busy !== ""} className="secondary" onClick={openExistingPendingTipInLabSigner}>Open lab signer for existing pendingTip</button>
        </div>
        {labTipResult ? <pre>{JSON.stringify(labTipResult, null, 2)}</pre> : null}
      </section>

      <section className="panel">
        <h2>Factory bytecode</h2>
        {factoryResults.length === 0 ? (
          <p className="muted">Run block 1.</p>
        ) : (
          <div className="factoryList">
            {factoryResults.map((result) => (
              <div className="factoryRow" key={result.address}>
                <div>
                  <strong>{result.name}</strong>
                  <span>{result.address}</span>
                </div>
                <b className={result.deployed ? "ok" : "bad"}>{result.deployed ? `${result.codeLength} bytes` : "0x"}</b>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
