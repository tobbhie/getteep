import { config } from "../config";
import type { XIncomingPost } from "../parser/commandTypes";

type RawTweet = {
  id: string;
  text: string;
  author_id: string;
  conversation_id?: string;
  referenced_tweets?: Array<{ type: string; id: string }>;
};

type RawUser = { id: string; username: string; name?: string; profile_image_url?: string };

type MentionsResponse = {
  data?: RawTweet[];
  includes?: { users?: RawUser[]; tweets?: RawTweet[] };
  meta?: { newest_id?: string; result_count?: number };
};

async function xFetch(path: string): Promise<Response> {
  const hosts = ["api.x.com", "api.twitter.com"];
  let lastError = "unknown";
  for (const host of hosts) {
    try {
      const response = await fetch(`https://${host}${path}`, {
        headers: { Authorization: `Bearer ${config.bearerToken}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return response;
      lastError = `${host}: HTTP ${response.status}`;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  throw new Error(`X API request failed (${lastError})`);
}

function usersById(includes?: { users?: RawUser[] }) {
  const map = new Map<string, RawUser>();
  for (const user of includes?.users || []) {
    map.set(user.id, user);
  }
  return map;
}

function tweetsById(includes?: { tweets?: RawTweet[] }) {
  const map = new Map<string, RawTweet>();
  for (const tweet of includes?.tweets || []) {
    map.set(tweet.id, tweet);
  }
  return map;
}

function toIncomingPost(tweet: RawTweet, users: Map<string, RawUser>, refTweets: Map<string, RawTweet>): XIncomingPost {
  const author = users.get(tweet.author_id);
  const replyRef = tweet.referenced_tweets?.find((ref) => ref.type === "replied_to");
  const parent = replyRef ? refTweets.get(replyRef.id) : undefined;
  const parentAuthor = parent ? users.get(parent.author_id) : undefined;

  return {
    id: tweet.id,
    text: tweet.text,
    authorId: tweet.author_id,
    authorUsername: author?.username,
    authorName: author?.name,
    authorProfileImageUrl: author?.profile_image_url,
    conversationId: tweet.conversation_id,
    parentTweetId: parent?.id,
    parentAuthorId: parent?.author_id,
    parentAuthorUsername: parentAuthor?.username,
    parentAuthorName: parentAuthor?.name,
    parentAuthorProfileImageUrl: parentAuthor?.profile_image_url,
  };
}

export async function fetchRecentMentions(sinceId?: string): Promise<XIncomingPost[]> {
  const params = new URLSearchParams({
    max_results: String(Math.min(Math.max(config.mentionsPageSize, 5), 100)),
    "tweet.fields": "author_id,conversation_id,referenced_tweets",
    expansions: "author_id,referenced_tweets.id,referenced_tweets.id.author_id",
    "user.fields": "username,name,profile_image_url",
  });
  if (sinceId) params.set("since_id", sinceId);

  const response = await xFetch(`/2/users/${config.botUserId}/mentions?${params.toString()}`);
  const payload = (await response.json()) as MentionsResponse;
  const users = usersById(payload.includes);
  const refTweets = tweetsById(payload.includes);

  return (payload.data || [])
    .map((tweet) => toIncomingPost(tweet, users, refTweets))
    .sort((a, b) => BigInt(a.id) > BigInt(b.id) ? 1 : -1);
}

export type PollingState = {
  lastSeenId?: string;
};

export async function pollMentions(state: PollingState): Promise<{ posts: XIncomingPost[]; state: PollingState }> {
  const posts = await fetchRecentMentions(state.lastSeenId);
  if (posts.length === 0) return { posts, state };

  const newestId = posts.reduce((max, post) => (BigInt(post.id) > BigInt(max) ? post.id : max), posts[0].id);
  return {
    posts,
    state: { lastSeenId: newestId },
  };
}
