import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "../config";

type TokenState = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

type XTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

const REFRESH_SKEW_MS = 60_000;

let state: TokenState = loadInitialState();
let refreshPromise: Promise<string> | null = null;

export function getBotAccessToken() {
  return state.accessToken;
}

export async function getFreshBotAccessToken() {
  if (Date.now() < state.expiresAt - REFRESH_SKEW_MS) {
    return state.accessToken;
  }
  return refreshBotAccessToken("expired");
}

export async function refreshBotAccessToken(reason = "manual") {
  if (refreshPromise) return refreshPromise;
  refreshPromise = doRefresh(reason).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

function loadInitialState(): TokenState {
  const fileState = readTokenStateFile();
  if (fileState) return fileState;

  return {
    accessToken: config.botAccessToken,
    refreshToken: config.botRefreshToken,
    expiresAt: 0,
  };
}

function readTokenStateFile(): TokenState | null {
  if (!config.tokenStatePath) return null;
  try {
    if (!fs.existsSync(config.tokenStatePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(config.tokenStatePath, "utf8")) as Partial<TokenState>;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: Number(parsed.expiresAt || 0),
    };
  } catch (error) {
    console.warn("[x-agent] Could not read X token state file:", error instanceof Error ? error.message : error);
    return null;
  }
}

function writeTokenStateFile(next: TokenState) {
  if (!config.tokenStatePath) return;
  try {
    const dir = path.dirname(config.tokenStatePath);
    if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(config.tokenStatePath, JSON.stringify(next, null, 2), { mode: 0o600 });
  } catch (error) {
    console.warn("[x-agent] Could not persist refreshed X token state:", error instanceof Error ? error.message : error);
  }
}

async function doRefresh(reason: string) {
  if (!state.refreshToken) throw new Error("X_BOT_REFRESH_TOKEN is not configured.");

  console.log(`[x-agent] Refreshing X bot access token (${reason}).`);
  const auth = Buffer.from(`${config.xClientId}:${config.xClientSecret}`).toString("base64");
  const response = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: state.refreshToken,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`X OAuth refresh failed: HTTP ${response.status} ${body.slice(0, 500)}`);
  }

  const payload = JSON.parse(body) as XTokenResponse;
  if (!payload.access_token) {
    throw new Error("X OAuth refresh returned no access token.");
  }

  state = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || state.refreshToken,
    expiresAt: Date.now() + Number(payload.expires_in || 7200) * 1000,
  };
  writeTokenStateFile(state);
  console.log("[x-agent] X bot access token refreshed.");
  return state.accessToken;
}
