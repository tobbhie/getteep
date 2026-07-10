import { getFreshBotAccessToken, refreshBotAccessToken } from "../client/xOAuthTokenManager";

export async function postReplyToX(inReplyToTweetId: string, text: string): Promise<string> {
  if (text.length > 280) {
    throw new Error(`X reply text is ${text.length} characters; maximum is 280.`);
  }

  let response = await createTweet(inReplyToTweetId, text, await getFreshBotAccessToken());
  if (response.status === 401) {
    response = await createTweet(inReplyToTweetId, text, await refreshBotAccessToken("reply-401"));
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`X create tweet failed: HTTP ${response.status} ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as { data?: { id?: string } };
  const replyId = data.data?.id;
  if (!replyId) throw new Error("X create tweet returned no id");
  return replyId;
}

async function createTweet(inReplyToTweetId: string, text: string, accessToken: string) {
  return fetch("https://api.x.com/2/tweets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      reply: { in_reply_to_tweet_id: inReplyToTweetId },
    }),
    signal: AbortSignal.timeout(20_000),
  });
}
