import crypto from "crypto";
import { isAddress, isUnsignedIntegerString } from "../utils/security";

type CrossmintKind = "onramp" | "offramp";

type CrossmintConfig = {
  environment: "staging" | "production";
  apiBaseUrl: string;
  apiKey: string;
  apiKeyHeader: string;
  onrampPath: string;
  offrampPath: string;
  orderStatusPathTemplate: string;
  chain: string;
  asset: string;
  fiatCurrency: string;
  requestTimeoutMs: number;
};

export type CrossmintOrderResult = {
  providerOrderId: string | null;
  redirectUrl: string | null;
  clientSecret: string | null;
  depositAddress: string | null;
  status: string | null;
  raw: unknown;
};

export class CrossmintConfigError extends Error {
  statusCode = 503;
  code = "CROSSMINT_NOT_CONFIGURED";
}

export class CrossmintProviderError extends Error {
  statusCode: number;
  code = "CROSSMINT_PROVIDER_ERROR";
  details?: unknown;

  constructor(message: string, statusCode: number, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

function cleanEnv(value?: string): string {
  return (value || "").trim();
}

function cleanBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function boolEnv(key: string): boolean {
  return process.env[key] === "true";
}

export function isCrossmintEnabled(kind: CrossmintKind): boolean {
  if (kind === "onramp") return boolEnv("CROSSMINT_ENABLE_ONRAMP");
  return boolEnv("CROSSMINT_ENABLE_OFFRAMP");
}

export function getCrossmintPublicStatus() {
  const environment = cleanEnv(process.env.CROSSMINT_ENV || "staging");
  return {
    environment,
    onrampEnabled: isCrossmintEnabled("onramp"),
    offrampEnabled: isCrossmintEnabled("offramp"),
    productionAllowed: boolEnv("CROSSMINT_ALLOW_PRODUCTION"),
  };
}

function getCrossmintConfig(kind: CrossmintKind): CrossmintConfig {
  if (!isCrossmintEnabled(kind)) {
    throw new CrossmintConfigError(`Crossmint ${kind} is not enabled.`);
  }

  const environment = cleanEnv(process.env.CROSSMINT_ENV || "staging");
  if (environment !== "staging" && environment !== "production") {
    throw new CrossmintConfigError("CROSSMINT_ENV must be staging or production.");
  }
  if (environment === "production" && !boolEnv("CROSSMINT_ALLOW_PRODUCTION")) {
    throw new CrossmintConfigError("Crossmint production is blocked until CROSSMINT_ALLOW_PRODUCTION=true.");
  }

  const apiBaseUrl = cleanBaseUrl(
    cleanEnv(process.env.CROSSMINT_API_BASE_URL) ||
      (environment === "staging" ? "https://staging.crossmint.com" : "https://www.crossmint.com")
  );
  if (environment === "staging" && !/staging\.crossmint\.com$/i.test(new URL(apiBaseUrl).hostname)) {
    throw new CrossmintConfigError("CROSSMINT_ENV=staging must use staging.crossmint.com.");
  }

  const apiKey = cleanEnv(process.env.CROSSMINT_SERVER_API_KEY);
  if (!apiKey) {
    throw new CrossmintConfigError("CROSSMINT_SERVER_API_KEY is required.");
  }

  const requestTimeoutMs = Number(process.env.CROSSMINT_REQUEST_TIMEOUT_MS || "15000");
  return {
    environment,
    apiBaseUrl,
    apiKey,
    apiKeyHeader: cleanEnv(process.env.CROSSMINT_API_KEY_HEADER) || "X-API-KEY",
    onrampPath: cleanEnv(process.env.CROSSMINT_ONRAMP_CREATE_ORDER_PATH) || "/api/2022-06-09/orders",
    offrampPath: cleanEnv(process.env.CROSSMINT_OFFRAMP_CREATE_ORDER_PATH) || "/api/2022-06-09/offramps/orders",
    orderStatusPathTemplate: cleanEnv(process.env.CROSSMINT_ORDER_STATUS_PATH_TEMPLATE),
    chain: cleanEnv(process.env.CROSSMINT_CHAIN) || "base-sepolia",
    asset: cleanEnv(process.env.CROSSMINT_ASSET) || "usdc",
    fiatCurrency: cleanEnv(process.env.CROSSMINT_FIAT_CURRENCY) || "usd",
    requestTimeoutMs: Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0 ? requestTimeoutMs : 15000,
  };
}

function rawUsdcToDecimal(amountRaw: bigint): string {
  const sign = amountRaw < 0n ? "-" : "";
  const raw = (amountRaw < 0n ? -amountRaw : amountRaw).toString().padStart(7, "0");
  const whole = raw.slice(0, -6) || "0";
  const fraction = raw.slice(-6).replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

function amountUsdToRaw(value: string): bigint | null {
  const trimmed = value.trim().replace(/^\$/, "");
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const cents = `${whole}${fraction.padEnd(2, "0")}`;
  if (!isUnsignedIntegerString(cents)) return null;
  return BigInt(cents) * 10_000n;
}

function tokenMap(params: Record<string, string | number | null | undefined>) {
  const entries = Object.entries(params).flatMap(([key, value]) => {
    const text = value == null ? "" : String(value);
    return [
      [`{{${key}}}`, text],
      [`${key.toUpperCase()}`, text],
    ] as Array<[string, string]>;
  });
  return entries;
}

function applyTokens(value: string, tokens: Array<[string, string]>): string {
  return tokens.reduce((next, [token, replacement]) => next.split(token).join(replacement), value);
}

function applyTemplateValue(value: unknown, tokens: Array<[string, string]>): unknown {
  if (typeof value === "string") return applyTokens(value, tokens);
  if (Array.isArray(value)) return value.map((item) => applyTemplateValue(item, tokens));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, applyTemplateValue(item, tokens)])
    );
  }
  return value;
}

function buildPayloadFromTemplate(template: string | undefined, tokens: Array<[string, string]>): Record<string, unknown> | null {
  if (!template?.trim()) return null;
  const parsed = JSON.parse(template);
  const hydrated = applyTemplateValue(parsed, tokens);
  if (!hydrated || typeof hydrated !== "object" || Array.isArray(hydrated)) {
    throw new CrossmintConfigError("Crossmint order body template must resolve to a JSON object.");
  }
  return hydrated as Record<string, unknown>;
}

export function normalizeOnrampAmountRaw(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  if (isUnsignedIntegerString(value)) {
    const amount = BigInt(value);
    return amount > 0n ? amount : null;
  }
  const amount = amountUsdToRaw(value);
  return amount && amount > 0n ? amount : null;
}

export function buildCrossmintOnrampPayload(params: {
  walletAddress: string;
  ownerAddress: string;
  amountRaw: bigint;
  email?: string | null;
  sessionId: string;
}) {
  const config = getCrossmintConfig("onramp");
  const amountUsd = rawUsdcToDecimal(params.amountRaw);
  const tokens = tokenMap({
    walletAddress: params.walletAddress,
    ownerAddress: params.ownerAddress,
    email: params.email || "",
    amountRaw: params.amountRaw.toString(),
    amountUsd,
    chain: config.chain,
    asset: config.asset,
    fiatCurrency: config.fiatCurrency,
    sessionId: params.sessionId,
  });
  const templated = buildPayloadFromTemplate(process.env.CROSSMINT_ONRAMP_ORDER_BODY_TEMPLATE, tokens);
  if (templated) return templated;

  return {
    recipient: {
      walletAddress: params.walletAddress,
      ...(params.email ? { email: params.email } : {}),
    },
    payment: {
      method: "fiat",
      currency: config.fiatCurrency,
    },
    lineItems: [
      {
        tokenLocator: `${config.chain}:${config.asset}`,
        executionParameters: {
          mode: "exact-in",
          amount: amountUsd,
        },
      },
    ],
    metadata: {
      source: "teep",
      environment: config.environment,
      sessionId: params.sessionId,
      ownerAddress: params.ownerAddress,
    },
  };
}

export function buildCrossmintOfframpPayload(params: {
  ownerAddress: string;
  claimWalletAddress: string;
  grossAmountRaw: bigint;
  netAmountRaw: bigint;
  feeAmountRaw: bigint;
  paymentMethodId?: string | null;
  email?: string | null;
  sessionId: string;
}) {
  const config = getCrossmintConfig("offramp");
  const netAmountUsd = rawUsdcToDecimal(params.netAmountRaw);
  const tokens = tokenMap({
    ownerAddress: params.ownerAddress,
    claimWalletAddress: params.claimWalletAddress,
    email: params.email || "",
    paymentMethodId: params.paymentMethodId || "",
    grossAmountRaw: params.grossAmountRaw.toString(),
    netAmountRaw: params.netAmountRaw.toString(),
    feeAmountRaw: params.feeAmountRaw.toString(),
    netAmountUsd,
    chain: config.chain,
    asset: config.asset,
    fiatCurrency: config.fiatCurrency,
    sessionId: params.sessionId,
  });
  const templated = buildPayloadFromTemplate(process.env.CROSSMINT_OFFRAMP_ORDER_BODY_TEMPLATE, tokens);
  if (!templated) {
    throw new CrossmintConfigError("CROSSMINT_OFFRAMP_ORDER_BODY_TEMPLATE is required for bank cash-out staging.");
  }
  return templated;
}

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function requestCrossmint(config: CrossmintConfig, path: string, options: {
  method: "GET" | "POST";
  idempotencyKey?: string;
  body?: Record<string, unknown>;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  const headers: Record<string, string> = {
    Accept: "application/json",
    [config.apiKeyHeader]: config.apiKey,
  };
  if (options.method !== "GET") headers["Content-Type"] = "application/json";
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  try {
    const response = await fetch(joinUrl(config.apiBaseUrl, path), {
      method: options.method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text.slice(0, 240) };
      }
    }
    if (!response.ok) {
      throw new CrossmintProviderError("Crossmint provider request failed.", response.status, sanitizeProviderPayload(payload));
    }
    return payload;
  } catch (error: any) {
    if (error instanceof CrossmintProviderError) throw error;
    throw new CrossmintProviderError(error?.name === "AbortError" ? "Crossmint provider request timed out." : "Crossmint provider request failed.", 503);
  } finally {
    clearTimeout(timeout);
  }
}

function pathValue(value: unknown, path: string): unknown {
  return path.split(".").reduce((current, part) => {
    if (current && typeof current === "object" && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, value);
}

function firstString(value: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const found = pathValue(value, path);
    if (typeof found === "string" && found.trim()) return found.trim();
  }
  return null;
}

function firstAddress(value: unknown, paths: string[]): string | null {
  const found = firstString(value, paths);
  return found && isAddress(found) ? found.toLowerCase() : null;
}

export function normalizeCrossmintOrderResult(raw: unknown): CrossmintOrderResult {
  return {
    raw,
    providerOrderId: firstString(raw, [
      "id",
      "orderId",
      "order.id",
      "order.orderId",
      "data.id",
      "data.orderId",
    ]),
    redirectUrl: firstString(raw, [
      "redirectUrl",
      "checkoutUrl",
      "hostedCheckoutUrl",
      "paymentUrl",
      "url",
      "order.redirectUrl",
      "order.checkoutUrl",
      "order.hostedCheckoutUrl",
      "data.redirectUrl",
      "data.checkoutUrl",
    ]),
    clientSecret: firstString(raw, [
      "clientSecret",
      "client_secret",
      "order.clientSecret",
      "data.clientSecret",
    ]),
    depositAddress: firstAddress(raw, [
      "depositAddress",
      "deposit.address",
      "cryptoDepositAddress",
      "order.depositAddress",
      "order.deposit.address",
      "data.depositAddress",
      "data.deposit.address",
      "payment.depositAddress",
      "payment.deposit.address",
      "source.depositAddress",
      "source.deposit.address",
    ]),
    status: firstString(raw, ["status", "order.status", "data.status"]),
  };
}

export async function createCrossmintOrder(kind: CrossmintKind, payload: Record<string, unknown>, idempotencyKey: string) {
  const config = getCrossmintConfig(kind);
  const raw = await requestCrossmint(config, kind === "onramp" ? config.onrampPath : config.offrampPath, {
    method: "POST",
    idempotencyKey,
    body: payload,
  });
  return normalizeCrossmintOrderResult(raw);
}

export async function fetchCrossmintOrderStatus(kind: CrossmintKind, providerOrderId: string) {
  const config = getCrossmintConfig(kind);
  if (!config.orderStatusPathTemplate) {
    throw new CrossmintConfigError("CROSSMINT_ORDER_STATUS_PATH_TEMPLATE is not configured.");
  }
  const path = config.orderStatusPathTemplate.split("{orderId}").join(encodeURIComponent(providerOrderId));
  const raw = await requestCrossmint(config, path, { method: "GET" });
  return normalizeCrossmintOrderResult(raw);
}

export function sanitizeProviderPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeProviderPayload);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (/secret|token|key|authorization|bank|account|routing|ssn|kyc/i.test(key)) {
        return [key, "[redacted]"];
      }
      return [key, sanitizeProviderPayload(item)];
    })
  );
}

export function crossmintSessionId(prefix: CrossmintKind) {
  return `crossmint_${prefix}_${crypto.randomUUID()}`;
}

export function rawUsdcToUsdString(amountRaw: bigint) {
  return rawUsdcToDecimal(amountRaw);
}
