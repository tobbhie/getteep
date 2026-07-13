export type XTipTargetType = "post" | "creator";

export type TipIntent = {
  targetType: XTipTargetType;
  recipientXHandle?: string;
  amount: string;
  tokenSymbol: "USDC";
};

export type TipBatchCommand = {
  type: "TIP_BATCH";
  tips: TipIntent[];
};

export type BalanceCommand = { type: "BALANCE" };
export type HelpCommand = { type: "HELP" };

export type ParsedCommand = TipBatchCommand | BalanceCommand | HelpCommand;

export type XIncomingPost = {
  id: string;
  text: string;
  authorId: string;
  authorUsername?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  conversationId?: string;
  parentTweetId?: string;
  parentAuthorId?: string;
  parentAuthorUsername?: string;
  parentAuthorName?: string;
  parentAuthorProfileImageUrl?: string;
};

export type ProcessPostResult = {
  tweetId: string;
  status: "completed" | "failed" | "ignored";
  code?: string;
  replyText?: string;
  receiptId?: string;
};
