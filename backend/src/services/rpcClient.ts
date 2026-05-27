import https from "node:https";
import { createPublicClient, http, type HttpTransportConfig } from "viem";
import { getConfiguredChain, getRpcUrl } from "../config/chain";

const DEFAULT_RPC_TIMEOUT_MS = parseInt(process.env.RPC_TIMEOUT_MS || "30000", 10) || 30000;
const ALLOW_INSECURE_RPC_TLS = process.env.ALLOW_INSECURE_RPC_TLS === "true" && process.env.NODE_ENV !== "production";
let warnedInsecureRpcTls = false;

export function isInsecureRpcTlsEnabled(): boolean {
  return ALLOW_INSECURE_RPC_TLS;
}

export function warnIfInsecureRpcTlsEnabled(source: string): void {
  if (!ALLOW_INSECURE_RPC_TLS || warnedInsecureRpcTls) return;
  warnedInsecureRpcTls = true;
  console.warn(`[${source}] ALLOW_INSECURE_RPC_TLS=true is enabled. RPC TLS verification is disabled for local development only.`);
}

export function createBackendHttpTransport(url = getRpcUrl(), timeoutMs = DEFAULT_RPC_TIMEOUT_MS) {
  const config: HttpTransportConfig = {
    timeout: timeoutMs,
    fetchFn: ALLOW_INSECURE_RPC_TLS ? createInsecureRpcFetch(timeoutMs) : undefined,
  };
  return http(url, config);
}

export function createBackendPublicClient(options: { timeoutMs?: number; url?: string } = {}) {
  warnIfInsecureRpcTlsEnabled("RPC");
  return createPublicClient({
    chain: getConfiguredChain(),
    transport: createBackendHttpTransport(options.url, options.timeoutMs),
  });
}

function createInsecureRpcFetch(timeoutMs: number) {
  const agent = new https.Agent({ rejectUnauthorized: false });

  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    const method = init?.method || (input instanceof Request ? input.method : "GET");
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const body = typeof init?.body === "string" || init?.body instanceof Buffer ? init.body : init?.body?.toString();
    const headerRecord: Record<string, string> = {};
    headers.forEach((value, key) => {
      headerRecord[key] = value;
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        url,
        {
          method,
          headers: headerRecord,
          agent,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          res.on("end", () => {
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode || 0,
                statusText: res.statusMessage,
                headers: res.headers as HeadersInit,
              })
            );
          });
        }
      );

      req.on("timeout", () => {
        req.destroy(new Error(`RPC request timed out after ${timeoutMs}ms`));
      });
      req.on("error", reject);
      if (body) req.write(body);
      req.end();
    });
  };
}
