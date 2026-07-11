export type XIncomingPost = {
  id: string;
  text: string;
  authorId: string;
  authorUsername?: string;
  conversationId?: string;
  parentTweetId?: string;
  parentAuthorId?: string;
  parentAuthorUsername?: string;
};

export type TipIntent = {
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
