/**
 * Reusable avatar URL service for web and extension.
 * - Parses tweet URLs to get X username
 * - Primary: unavatar.io/twitter/{username}
 * - Fallback: default gravatar (ui-avatars) when no X username or image fails
 */

const UNAVATAR_TWITTER_BASE = "https://unavatar.io/twitter/";
const DEFAULT_AVATAR_BASE = "https://ui-avatars.com/api/";

/**
 * Parse X/Twitter username from a tweet or profile URL.
 * Supports: x.com/handle/status/123, twitter.com/handle/status/123, x.com/handle
 */
export function parseUsernameFromTweetUrl(url: string): string | null {
  const trimmed = (url || "").trim();
  if (!trimmed) return null;
  // status/article URL: x.com/handle/status/123 or twitter.com/handle/status/123
  const statusMatch = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com|mobile\.twitter\.com)\/([^/]+)\/(?:status|article)\/\d+/i
  );
  if (statusMatch) {
    const handle = statusMatch[1].replace(/^@/, "");
    if (handle.toLowerCase() === "i" || !handle) return null;
    return handle;
  }
  // profile URL: x.com/handle (no trailing path)
  const profileMatch = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com|mobile\.twitter\.com)\/([^/?#]+)/i
  );
  if (profileMatch) {
    const handle = profileMatch[1].replace(/^@/, "");
    if (handle.toLowerCase() === "i" || !handle) return null;
    return handle;
  }
  return null;
}

/**
 * Normalize identifier to a possible X username (strip @, accept handle-only string).
 */
function toTwitterHandle(identifier: string): string | null {
  const s = (identifier || "").trim().replace(/^@/, "");
  if (!s || s.length > 100) return null;
  // Basic sanity: handle-like (alphanumeric, underscores)
  if (/^[a-zA-Z0-9_]+$/.test(s)) return s;
  return null;
}

/**
 * URL for X avatar via unavatar.io (no API key).
 */
export function getTwitterAvatarUrl(username: string): string {
  const handle = username.replace(/^@/, "");
  return `${UNAVATAR_TWITTER_BASE}${encodeURIComponent(handle)}`;
}

/**
 * Default/fallback avatar URL when we have no X username or image fails.
 * Uses ui-avatars.com with initials from display name.
 */
export function getDefaultAvatarUrl(
  displayName: string,
  options?: { background?: string; size?: number }
): string {
  const name = (displayName || "U").trim() || "U";
  const background = (options?.background || "64748b").replace(/^#/, "");
  const size = options?.size ?? 64;
  return `${DEFAULT_AVATAR_BASE}?name=${encodeURIComponent(name)}&size=${size}&background=${background}`;
}

export interface AvatarUrls {
  /** Use this first (unavatar.io/twitter/username if we have X handle, else fallback) */
  primary: string;
  /** Use on img onError (default gravatar) */
  fallback: string;
}

/**
 * Get avatar URLs for an identifier that may be:
 * - A tweet/post URL (we parse username and use unavatar)
 * - An X username or @handle (we use unavatar)
 * - Anything else (e.g. wallet address) → fallback only
 */
export function getAvatarUrls(
  identifier: string,
  fallbackDisplayName?: string
): AvatarUrls {
  const displayName = (fallbackDisplayName || identifier || "U").trim() || "U";
  const fallback = getDefaultAvatarUrl(displayName);

  const fromUrl = parseUsernameFromTweetUrl(identifier);
  const fromHandle = toTwitterHandle(identifier);
  const username = fromUrl ?? fromHandle;

  if (username) {
    return {
      primary: getTwitterAvatarUrl(username),
      fallback,
    };
  }

  return {
    primary: fallback,
    fallback,
  };
}
