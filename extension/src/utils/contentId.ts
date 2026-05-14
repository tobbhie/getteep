import { keccak256, toBytes } from "viem";

/**
 * Compute the canonical content ID for an X post.
 * contentId = keccak256("x.com/{handle}/status/{tweetId}")
 *
 * Uses the handle (lowercased) for human-readable canonical URLs.
 */
export function computeContentId(authorHandle: string, tweetId: string): `0x${string}` {
  const canonical = `x.com/${authorHandle.toLowerCase()}/status/${tweetId}`;
  return keccak256(toBytes(canonical));
}

/**
 * Convert an X handle to a deterministic uint256-compatible author ID.
 * authorId = keccak256(handle.toLowerCase())
 *
 * Returns a 0x-prefixed hex string. Pass to BigInt() for contract calls.
 * This is the on-chain authorId used by TipContract, WalletFactory, and ClaimWallet.
 */
export function handleToAuthorId(handle: string): `0x${string}` {
  return keccak256(toBytes(handle.toLowerCase()));
}

/**
 * Supported domains for tweet URLs (aligned with docs/tweet-link-types.md).
 * Includes standard, mobile, and embed/fixup domains. Query params and
 * /photo/1, /video/1 after the tweet ID are ignored by capturing only digits.
 */
const TWEET_URL_DOMAINS =
  "twitter\\.com|x\\.com|mobile\\.twitter\\.com|fxtwitter\\.com|vxtwitter\\.com|fixupx\\.com";

/**
 * Parse an X/Twitter post URL to extract handle and tweet ID.
 * Supports: twitter.com, x.com, mobile.twitter.com, fxtwitter.com, vxtwitter.com, fixupx.com.
 * Ignores query params and trailing /photo/1, /video/1. Rejects x.com/i/status/{id} (no author in URL).
 * Returns { authorHandle, tweetId } or null if invalid.
 */
export function parsePostUrl(url: string): { authorHandle: string; tweetId: string } | null {
  const trimmed = url.trim();
  // Match /status/{id} or /article/{id}; capture segment before it (username). Reject "i" (username-less format).
  const match = trimmed.match(
    new RegExp(
      `(?:https?:\\/\\/)?(?:www\\.)?(?:${TWEET_URL_DOMAINS})\\/([^/]+)\\/(?:status|article)\\/(\\d+)`,
      "i"
    )
  );
  if (!match) return null;
  const authorHandle = match[1].replace(/^@/, "");
  const tweetId = match[2];
  // x.com/i/status/123 has no real username; doc says resolve via API (we don't, so reject)
  if (authorHandle.toLowerCase() === "i" || !authorHandle || !tweetId) return null;
  return { authorHandle, tweetId };
}
