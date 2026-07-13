import * as dotenv from "dotenv";
dotenv.config();

function env(name: string, fallback = ""): string {
  return (process.env[name] || fallback).trim();
}

function envAny(primary: string, legacy: string, fallback = ""): string {
  return env(primary, env(legacy, fallback));
}

function envInt(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = {
  backendUrl: env("TEEP_BACKEND_URL", "http://localhost:3001").replace(/\/$/, ""),
  agentToken: env("X_AGENT_TOKEN"),
  botUserId: env("X_BOT_USER_ID"),
  botUsername: env("X_BOT_USERNAME", "teepagent").replace(/^@/, ""),
  bearerToken: envAny("X_BOT_BEARER_TOKEN", "X_BEARER_TOKEN"),
  botAccessToken: env("X_BOT_ACCESS_TOKEN"),
  botRefreshToken: env("X_BOT_REFRESH_TOKEN"),
  xClientId: envAny("X_BOT_CLIENT_ID", "X_CLIENT_ID"),
  xClientSecret: envAny("X_BOT_CLIENT_SECRET", "X_CLIENT_SECRET"),
  tokenStatePath: env("X_TOKEN_STATE_PATH", ".x-token-state.json"),
  pollIntervalMs: envInt("X_POLL_INTERVAL_MS", 45_000),
  mentionsPageSize: envInt("X_MENTIONS_PAGE_SIZE", 20),
  useFilteredStream: env("X_USE_FILTERED_STREAM") === "true",
};

export function assertConfig() {
  const missing: string[] = [];
  if (!config.agentToken) missing.push("X_AGENT_TOKEN");
  if (!config.botUserId) missing.push("X_BOT_USER_ID");
  if (!config.bearerToken) missing.push("X_BOT_BEARER_TOKEN");
  if (!config.botAccessToken) missing.push("X_BOT_ACCESS_TOKEN");
  if (!config.botRefreshToken) missing.push("X_BOT_REFRESH_TOKEN");
  if (!config.xClientId) missing.push("X_BOT_CLIENT_ID");
  if (!config.xClientSecret) missing.push("X_BOT_CLIENT_SECRET");
  if (missing.length) {
    throw new Error(`x-agent missing required env: ${missing.join(", ")}`);
  }
}
