import { CONFIG } from "../utils/config";
import type { WalletArchitecture } from "./walletArchitectures";

export type JsonRpcResponse<T = unknown> = {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

export type FactoryCodeResult = {
  name: string;
  address: `0x${string}`;
  expected: "deployed" | "empty";
  deployed: boolean;
  codeLength: number;
  rawPrefix: string;
};

export function compactError(err: unknown) {
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

export async function rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(CONFIG.RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const payload = (await response.json()) as JsonRpcResponse<T>;
  if (payload.error) throw new Error(payload.error.message || "RPC error");
  return payload.result as T;
}

export async function checkFactoryBytecode(architecture: WalletArchitecture): Promise<FactoryCodeResult[]> {
  return Promise.all(
    architecture.factories.map(async (factory) => {
      const code = String(await rpc("eth_getCode", [factory.address, "latest"]));
      return {
        ...factory,
        deployed: code !== "0x",
        codeLength: code === "0x" ? 0 : (code.length - 2) / 2,
        rawPrefix: code.slice(0, 18),
      };
    })
  );
}

export function installAaNetworkLogger(label = "Teep:WalletLab") {
  const marker = "__teepWalletLabFetchPatched";
  const w = window as any;
  if (w[marker]) return;
  w[marker] = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (/zerodev|bundler|paymaster|useroperation|rpc/i.test(url)) {
      console.info(`[${label}:network]`, init?.method || "GET", url);
    }
    return originalFetch(input, init);
  };
}
