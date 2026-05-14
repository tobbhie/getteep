import { useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { ARC_CHAIN_ID, KNOWN_FACTORIES, arcTestnet } from "./chains";

type CheckResult = {
  name: string;
  address: string;
  deployed: boolean;
  codeLength: number;
  rawPrefix: string;
};

type SmartWalletAttempt = {
  ok: boolean;
  account?: string;
  chainId?: number;
  error?: unknown;
};

type TxAttempt = {
  ok: boolean;
  hash?: string;
  to?: string;
  error?: unknown;
};

type EndpointCheck = {
  label: string;
  url: string;
  ok: boolean;
  response?: unknown;
  error?: unknown;
};

function compactError(err: unknown) {
  const e = err as any;
  return {
    name: e?.name,
    message: e?.message ?? String(err),
    shortMessage: e?.shortMessage,
    details: e?.details,
    cause: e?.cause
      ? {
          name: e.cause?.name,
          message: e.cause?.message,
          shortMessage: e.cause?.shortMessage,
          details: e.cause?.details,
        }
      : undefined,
  };
}

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(arcTestnet.rpcUrls.default.http[0], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || "RPC error");
  return payload.result;
}

export function App({ appId }: { appId: string }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useWallets();
  const { client, getClientForChain } = useSmartWallets();
  const [smartWalletAttempt, setSmartWalletAttempt] = useState<SmartWalletAttempt | null>(null);
  const [txAttempt, setTxAttempt] = useState<TxAttempt | null>(null);
  const [endpointChecks, setEndpointChecks] = useState<EndpointCheck[]>([]);
  const [factoryChecks, setFactoryChecks] = useState<CheckResult[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [signedMessage, setSignedMessage] = useState<string>("");
  const bundlerUrl = import.meta.env.VITE_ARC_BUNDLER_URL || "";
  const paymasterUrl = import.meta.env.VITE_ARC_PAYMASTER_URL || "";

  const embeddedWallet = useMemo(
    () => wallets.find((wallet) => wallet.walletClientType === "privy"),
    [wallets]
  );

  const inspectSmartWallet = async () => {
    setBusy("smart-wallet");
    setSmartWalletAttempt(null);
    try {
      const smartClient = await getClientForChain({ id: ARC_CHAIN_ID });
      setSmartWalletAttempt({
        ok: !!smartClient,
        account: smartClient?.account?.address,
        chainId: ARC_CHAIN_ID,
      });
      console.info("[Privy Arc Smoke] getClientForChain success", {
        account: smartClient?.account?.address,
        chainId: ARC_CHAIN_ID,
      });
    } catch (err) {
      const compact = compactError(err);
      setSmartWalletAttempt({ ok: false, chainId: ARC_CHAIN_ID, error: compact });
      console.warn("[Privy Arc Smoke] getClientForChain failed", compact);
    } finally {
      setBusy("");
    }
  };

  const checkFactories = async () => {
    setBusy("factories");
    try {
      const checks = await Promise.all(
        KNOWN_FACTORIES.map(async (factory) => {
          const code = String(await rpc("eth_getCode", [factory.address, "latest"]));
          return {
            name: factory.name,
            address: factory.address,
            deployed: code !== "0x",
            codeLength: code === "0x" ? 0 : (code.length - 2) / 2,
            rawPrefix: code.slice(0, 18),
          };
        })
      );
      setFactoryChecks(checks);
      console.info("[Privy Arc Smoke] factory checks", checks);
    } catch (err) {
      console.warn("[Privy Arc Smoke] factory check failed", compactError(err));
    } finally {
      setBusy("");
    }
  };

  const probeEndpoint = async (label: string, url: string): Promise<EndpointCheck> => {
    if (!url) return { label, url, ok: false, error: "Not configured" };
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "eth_chainId", params: [] }),
      });
      const payload = await response.json();
      return { label, url, ok: response.ok && !payload.error, response: payload };
    } catch (err) {
      return { label, url, ok: false, error: compactError(err) };
    }
  };

  const checkAaEndpoints = async () => {
    setBusy("endpoints");
    try {
      const checks = await Promise.all([
        probeEndpoint("Bundler", bundlerUrl),
        probeEndpoint("Paymaster", paymasterUrl),
      ]);
      setEndpointChecks(checks);
      console.info("[Privy Arc Smoke] AA endpoint checks", checks);
    } finally {
      setBusy("");
    }
  };

  const signSmokeMessage = async () => {
    setBusy("sign");
    setSignedMessage("");
    try {
      const smartClient = client || (await getClientForChain({ id: ARC_CHAIN_ID }));
      if (!smartClient) throw new Error("No Privy smart wallet client returned for Arc");
      const signature = await smartClient.signMessage({
        message: `Privy Arc smoke test ${new Date().toISOString()}`,
      });
      setSignedMessage(signature);
      console.info("[Privy Arc Smoke] signMessage success", { signature });
    } catch (err) {
      const compact = compactError(err);
      setSmartWalletAttempt({ ok: false, chainId: ARC_CHAIN_ID, error: compact });
      console.warn("[Privy Arc Smoke] signMessage failed", compact);
    } finally {
      setBusy("");
    }
  };

  const sendNoopTransaction = async () => {
    setBusy("tx");
    setTxAttempt(null);
    try {
      const smartClient = client || (await getClientForChain({ id: ARC_CHAIN_ID }));
      if (!smartClient?.account?.address) throw new Error("No Privy smart wallet client returned for Arc");
      if (!embeddedWallet?.address) throw new Error("No embedded wallet address available for no-op destination");

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

      setTxAttempt({ ok: true, hash, to: embeddedWallet.address });
      console.info("[Privy Arc Smoke] no-op smart wallet tx success", {
        hash,
        smartWallet: smartClient.account.address,
        to: embeddedWallet.address,
      });
    } catch (err) {
      const compact = compactError(err);
      setTxAttempt({ ok: false, error: compact });
      console.warn("[Privy Arc Smoke] no-op smart wallet tx failed", compact);
    } finally {
      setBusy("");
    }
  };

  return (
    <main className="shell">
      <section className="panel hero">
        <div>
          <p className="eyebrow">Privy + Arc AA smoke test</p>
          <h1>Isolated smart wallet check</h1>
          <p className="muted">
            No Teep contracts, no extension APIs. This only checks Privy auth, Privy smart wallet client
            creation on Arc testnet, and the factory contracts visible through Arc RPC.
          </p>
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
            <dd>{appId}</dd>
            <dt>Ready</dt>
            <dd>{String(ready)}</dd>
            <dt>Authenticated</dt>
            <dd>{String(authenticated)}</dd>
            <dt>Arc chain ID</dt>
            <dd>{ARC_CHAIN_ID}</dd>
            <dt>User ID</dt>
            <dd>{user?.id || "none"}</dd>
            <dt>Embedded wallet</dt>
            <dd>{embeddedWallet?.address || "none"}</dd>
            <dt>Hook smart wallet</dt>
            <dd>{client?.account?.address || "none"}</dd>
            <dt>Bundler URL</dt>
            <dd>{bundlerUrl || "not configured in .env"}</dd>
            <dt>Paymaster URL</dt>
            <dd>{paymasterUrl || "not configured in .env"}</dd>
          </dl>
        </div>

        <div className="panel">
          <h2>Actions</h2>
          <div className="buttonStack">
            <button disabled={!authenticated || busy !== ""} onClick={inspectSmartWallet}>
              {busy === "smart-wallet" ? "Checking..." : "Get Arc smart wallet"}
            </button>
            <button disabled={busy !== ""} onClick={checkFactories}>
              {busy === "factories" ? "Checking..." : "Check factory bytecode"}
            </button>
            <button disabled={busy !== ""} onClick={checkAaEndpoints}>
              {busy === "endpoints" ? "Checking..." : "Probe AA endpoints"}
            </button>
            <button disabled={!authenticated || busy !== ""} onClick={signSmokeMessage}>
              {busy === "sign" ? "Signing..." : "Sign smoke message"}
            </button>
            <button disabled={!authenticated || busy !== ""} onClick={sendNoopTransaction}>
              {busy === "tx" ? "Sending..." : "Send sponsored no-op tx"}
            </button>
          </div>
          {signedMessage && (
            <p className="success">Signed: {signedMessage.slice(0, 18)}...{signedMessage.slice(-12)}</p>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Smart wallet result</h2>
        {!smartWalletAttempt ? (
          <p className="muted">Click “Get Arc smart wallet”.</p>
        ) : smartWalletAttempt.ok ? (
          <pre>{JSON.stringify(smartWalletAttempt, null, 2)}</pre>
        ) : (
          <pre className="errorBlock">{JSON.stringify(smartWalletAttempt, null, 2)}</pre>
        )}
      </section>

      <section className="panel">
        <h2>AA endpoint probe</h2>
        {endpointChecks.length === 0 ? (
          <p className="muted">
            Optional. Put `VITE_ARC_BUNDLER_URL` and `VITE_ARC_PAYMASTER_URL` in `.env`, restart Vite,
            then click “Probe AA endpoints”.
          </p>
        ) : (
          <pre>{JSON.stringify(endpointChecks, null, 2)}</pre>
        )}
      </section>

      <section className="panel">
        <h2>Sponsored transaction result</h2>
        {!txAttempt ? (
          <p className="muted">
            Sends a zero-value smart-wallet call to your embedded wallet address. This should create a
            UserOperation through Privy’s configured smart-wallet provider.
          </p>
        ) : txAttempt.ok ? (
          <pre>{JSON.stringify(txAttempt, null, 2)}</pre>
        ) : (
          <pre className="errorBlock">{JSON.stringify(txAttempt, null, 2)}</pre>
        )}
      </section>

      <section className="panel">
        <h2>Factory bytecode</h2>
        {factoryChecks.length === 0 ? (
          <p className="muted">Click “Check factory bytecode”.</p>
        ) : (
          <div className="factoryList">
            {factoryChecks.map((check) => (
              <div className="factoryRow" key={check.address}>
                <div>
                  <strong>{check.name}</strong>
                  <span>{check.address}</span>
                </div>
                <b className={check.deployed ? "ok" : "bad"}>
                  {check.deployed ? `${check.codeLength} bytes` : "0x"}
                </b>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
