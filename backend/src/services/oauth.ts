/**
 * X (Twitter) OAuth 2.0 verification service.
 * Used during the claim flow to verify a user owns a specific X account.
 */

function envValue(name: string, fallback = ""): string {
  return (process.env[name] || fallback).trim();
}

const X_AUTH_CLIENT_ID = envValue("X_AUTH_CLIENT_ID", envValue("X_CLIENT_ID"));
const X_AUTH_CLIENT_SECRET = envValue("X_AUTH_CLIENT_SECRET", envValue("X_CLIENT_SECRET"));
const X_AUTH_REDIRECT_URI = envValue(
  "X_AUTH_REDIRECT_URI",
  envValue("X_REDIRECT_URI", "http://localhost:3001/auth/x/callback")
);
const X_AUTH_BEARER_TOKEN = envValue("X_AUTH_BEARER_TOKEN", envValue("X_BEARER_TOKEN"));
const X_AUTH_CLIENT_AUTH = envValue(
  "X_AUTH_CLIENT_AUTH",
  envValue("X_OAUTH_CLIENT_AUTH", "auto")
).toLowerCase();

type XOAuthClientAuthMode = "auto" | "basic" | "none";
type XTokenExchangeMode = "basic" | "none";

function oauthClientAuthMode(): XOAuthClientAuthMode {
  if (X_AUTH_CLIENT_AUTH === "basic" || X_AUTH_CLIENT_AUTH === "none") return X_AUTH_CLIENT_AUTH;
  return "auto";
}

function tokenExchangeAttempts(): XTokenExchangeMode[] {
  const mode = oauthClientAuthMode();
  if (mode === "basic") return ["basic"];
  if (mode === "none") return ["none"];
  return X_AUTH_CLIENT_SECRET ? ["basic", "none"] : ["none"];
}

function buildTokenRequestBody(code: string, codeVerifier: string, mode: XTokenExchangeMode): URLSearchParams {
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    redirect_uri: X_AUTH_REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  // PKCE/public-client token exchange authenticates the client through client_id + code_verifier.
  if (mode === "none") {
    body.set("client_id", X_AUTH_CLIENT_ID);
  }

  return body;
}

function buildTokenRequestHeaders(mode: XTokenExchangeMode): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (mode === "basic") {
    if (!X_AUTH_CLIENT_ID || !X_AUTH_CLIENT_SECRET) {
      throw new Error("X OAuth basic client auth requires X_AUTH_CLIENT_ID and X_AUTH_CLIENT_SECRET.");
    }
    headers.Authorization = `Basic ${Buffer.from(`${X_AUTH_CLIENT_ID}:${X_AUTH_CLIENT_SECRET}`).toString("base64")}`;
  }

  return headers;
}

function shouldRetryWithoutClientSecret(status: number, errorBody: string): boolean {
  if (oauthClientAuthMode() !== "auto") return false;
  if (![400, 401].includes(status)) return false;
  return /unauthorized_client|authorization header|client authentication|invalid client|public client/i.test(errorBody);
}

export interface XUserProfile {
  id: string;       // numeric user ID
  username: string;  // @handle
  name: string;
  profile_image_url?: string;  // X profile picture (from user.fields)
}

export class XOAuthService {
  private usernameCache = new Map<string, { profile: XUserProfile; expiresAt: number }>();
  private usernameRequests = new Map<string, Promise<XUserProfile>>();

  /**
   * Generate the X OAuth 2.0 authorization URL
   */
  getAuthUrl(state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: X_AUTH_CLIENT_ID,
      redirect_uri: X_AUTH_REDIRECT_URI,
      scope: "tweet.read users.read",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
  }

  /**
   * Exchange an authorization code for tokens and fetch the user profile
   */
  async verifyAndGetProfile(code: string, codeVerifier: string): Promise<XUserProfile> {
    // Exchange code for access token
    let tokenData: { access_token: string } | null = null;
    const exchangeErrors: string[] = [];

    for (const mode of tokenExchangeAttempts()) {
      const tokenResponse = await fetch("https://api.twitter.com/2/oauth2/token", {
        method: "POST",
        headers: buildTokenRequestHeaders(mode),
        body: buildTokenRequestBody(code, codeVerifier, mode),
      });

      if (tokenResponse.ok) {
        tokenData = (await tokenResponse.json()) as { access_token: string };
        break;
      }

      const errorBody = await tokenResponse.text();
      exchangeErrors.push(`${mode}: ${tokenResponse.status} ${errorBody}`);

      if (mode === "basic" && shouldRetryWithoutClientSecret(tokenResponse.status, errorBody)) {
        continue;
      }

      break;
    }

    if (!tokenData?.access_token) {
      throw new Error(`X OAuth token exchange failed: ${exchangeErrors.join("; ")}`);
    }

    // Fetch user profile (user.fields=profile_image_url for avatar)
    const userResponse = await fetch(
      "https://api.twitter.com/2/users/me?user.fields=profile_image_url",
      {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
        },
      }
    );

    if (!userResponse.ok) {
      const errorBody = await userResponse.text();
      throw new Error(`X user profile fetch failed: ${userResponse.status} ${errorBody || ""}`);
    }

    const userData = (await userResponse.json()) as {
      data: { id: string; username: string; name: string; profile_image_url?: string };
    };

    return {
      id: userData.data.id,
      username: userData.data.username,
      name: userData.data.name,
      profile_image_url: userData.data.profile_image_url,
    };
  }

  /**
   * Resolve a public X handle to X's stable numeric user ID.
   */
  async getUserByUsername(username: string): Promise<XUserProfile> {
    if (!X_AUTH_BEARER_TOKEN) {
      throw new Error("X_AUTH_BEARER_TOKEN not configured");
    }

    const handle = username.replace(/^@/, "").toLowerCase();
    const cached = this.usernameCache.get(handle);
    if (cached && cached.expiresAt > Date.now()) return cached.profile;

    const existingRequest = this.usernameRequests.get(handle);
    if (existingRequest) return existingRequest;

    const request = this.fetchUserByUsername(handle);
    this.usernameRequests.set(handle, request);
    try {
      const profile = await request;
      this.usernameCache.set(handle, { profile, expiresAt: Date.now() + 10 * 60 * 1000 });
      return profile;
    } finally {
      this.usernameRequests.delete(handle);
    }
  }

  private async fetchUserByUsername(handle: string): Promise<XUserProfile> {
    const urlPath = `/2/users/by/username/${encodeURIComponent(handle)}?user.fields=profile_image_url`;
    const hosts = ["api.x.com", "api.twitter.com"];
    const failures: string[] = [];

    for (const host of hosts) {
      try {
        const response = await fetch(`https://${host}${urlPath}`, {
          headers: {
            Authorization: `Bearer ${X_AUTH_BEARER_TOKEN}`,
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          const errorBody = (await response.text()).slice(0, 500);
          failures.push(`${host}: HTTP ${response.status}${errorBody ? ` ${errorBody}` : ""}`);
          if (response.status < 500 && response.status !== 429) break;
          continue;
        }

        const userData = (await response.json()) as {
          data?: { id: string; username: string; name: string; profile_image_url?: string };
        };
        if (!userData.data?.id || !/^[0-9]+$/.test(userData.data.id)) {
          failures.push(`${host}: response contained no numeric user ID`);
          continue;
        }

        return {
          id: userData.data.id,
          username: userData.data.username,
          name: userData.data.name,
          profile_image_url: userData.data.profile_image_url,
        };
      } catch (err: any) {
        const cause = err?.cause;
        const detail = cause?.code || cause?.message || err?.message || String(err);
        failures.push(`${host}: ${detail}`);
      }
    }

    throw new Error(`X username lookup failed (${failures.join("; ")})`);
  }
}
