export type XTipTargetType = "post" | "creator";
export type XTipKind = "post_tip" | "direct_creator_tip";

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
export type InvalidCommand = {
  type: "INVALID_COMMAND";
  reason: "MISSING_AMOUNT" | "MISSING_RECIPIENT" | "UNSUPPORTED_ASSET" | "MALFORMED";
};

export type ParsedCommand = TipBatchCommand | BalanceCommand | HelpCommand | InvalidCommand;

export type ProcessPostResult = {
  tweetId: string;
  status: "completed" | "failed" | "ignored";
  code?: string;
  replyText?: string;
  receiptId?: string;
};
