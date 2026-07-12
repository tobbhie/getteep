import { one, query } from "../db/database";

export type AccountActivityRecord = {
  type: string;
  amount: string;
  tx_hash: string | null;
  timestamp: number;
  author_handle?: string | null;
  profileImageUrl?: string | null;
  tweet_id?: string | null;
  from_addr?: string | null;
  from_address?: string | null;
  to_address?: string | null;
  detail?: string | null;
};

function normalizeTimestamp(timestamp: unknown): number {
  const value = Number(timestamp || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
}

function decimalUsdcToRaw(value: unknown): string {
  const text = String(value ?? "0").trim();
  if (!text || !/^\d+(\.\d+)?$/.test(text)) return "0";
  const [whole, fraction = ""] = text.split(".");
  return `${whole}${fraction.padEnd(6, "0").slice(0, 6)}`.replace(/^0+(?=\d)/, "") || "0";
}

function normalizeUsdcRaw(value: unknown): string {
  const text = String(value ?? "0").trim();
  if (!/^\d+$/.test(text)) return decimalUsdcToRaw(text);
  const raw = BigInt(text || "0");
  // Some provider/indexer rows can carry 18-decimal token units. History is displayed as Arc USDC
  // with 6 decimals, so normalize very large raw values into the UI/accounting unit.
  if (raw > 10_000_000_000_000_000n) return (raw / 1_000_000_000_000n).toString();
  return raw.toString();
}

function normalizeRows(rows: AccountActivityRecord[]): AccountActivityRecord[] {
  return rows.map((row) => ({
    ...row,
    amount: row.type === "deposit" || row.type === "funding" ? normalizeUsdcRaw(row.amount) : String(row.amount ?? "0"),
    timestamp: normalizeTimestamp(row.timestamp),
  }));
}

export async function getAccountActivity(options: {
  address: string;
  limit?: number;
  tipContractAddress?: string;
}): Promise<AccountActivityRecord[]> {
  const address = options.address.toLowerCase();
  const limit = Math.min(options.limit || 50, 100);
  const currentContract = (options.tipContractAddress || "").toLowerCase();

  const tipsSent = currentContract
    ? await query<AccountActivityRecord>(
        `SELECT CASE WHEN m.kind = 'direct_creator_tip' THEN 'direct_creator_tip' ELSE 'tip_sent' END as type,
                t.amount, t.tx_hash, t.timestamp,
                m.author_handle, m.tweet_id,
                COALESCE(
                  (SELECT profile_image_url FROM verified_claims WHERE author_id = t.author_id AND profile_image_url IS NOT NULL ORDER BY verified_at DESC LIMIT 1),
                  (SELECT profile_image_url FROM verified_claims WHERE LOWER(username) = LOWER(COALESCE(m.author_handle, '')) AND profile_image_url IS NOT NULL ORDER BY verified_at DESC LIMIT 1)
                ) as profileImageUrl
         FROM tips t
         LEFT JOIN tip_metadata m ON t.content_id = m.content_id
         WHERE t.from_address = ? AND t.tip_contract_address = ?
         ORDER BY t.timestamp DESC
         LIMIT ?`
      , [address, currentContract, limit])
    : await query<AccountActivityRecord>(
        `SELECT CASE WHEN m.kind = 'direct_creator_tip' THEN 'direct_creator_tip' ELSE 'tip_sent' END as type,
                t.amount, t.tx_hash, t.timestamp,
                m.author_handle, m.tweet_id,
                COALESCE(
                  (SELECT profile_image_url FROM verified_claims WHERE author_id = t.author_id AND profile_image_url IS NOT NULL ORDER BY verified_at DESC LIMIT 1),
                  (SELECT profile_image_url FROM verified_claims WHERE LOWER(username) = LOWER(COALESCE(m.author_handle, '')) AND profile_image_url IS NOT NULL ORDER BY verified_at DESC LIMIT 1)
                ) as profileImageUrl
         FROM tips t
         LEFT JOIN tip_metadata m ON t.content_id = m.content_id
         WHERE t.from_address = ?
         ORDER BY t.timestamp DESC
         LIMIT ?`
      , [address, limit]);

  const xBotTipsSent = await query<AccountActivityRecord>(
    `SELECT 'direct_creator_tip' as type,
            amount_raw as amount,
            tx_hash,
            CAST(created_at / 1000 AS INTEGER) as timestamp,
            recipient_x_username as author_handle,
            source_tweet_id as tweet_id,
            'X tip command' as detail,
            COALESCE(
              (SELECT profile_image_url FROM verified_claims WHERE author_id = xbt.recipient_x_user_id AND profile_image_url IS NOT NULL ORDER BY verified_at DESC LIMIT 1),
              (SELECT profile_image_url FROM verified_claims WHERE LOWER(username) = LOWER(COALESCE(xbt.recipient_x_username, '')) AND profile_image_url IS NOT NULL ORDER BY verified_at DESC LIMIT 1)
            ) as profileImageUrl
     FROM x_bot_tips xbt
     WHERE LOWER(sender_address) = ?
       AND status = 'completed'
     ORDER BY created_at DESC
     LIMIT ?`,
    [address, limit],
  );

  let claim = await one<{ username: string; author_id: string }>(
    "SELECT username, author_id FROM verified_claims WHERE owner_address = ? ORDER BY verified_at DESC LIMIT 1",
    [address]
  );
  if (!claim) {
    claim = await one<{ username: string; author_id: string }>(
      "SELECT x_username as username, x_user_id as author_id FROM x_accounts WHERE user_address = ? ORDER BY verified_at DESC LIMIT 1",
      [address]
    );
  }

  let tipsReceived: AccountActivityRecord[] = [];
  let xBotTipsReceived: AccountActivityRecord[] = [];
  if (claim) {
    tipsReceived = currentContract
      ? await query<AccountActivityRecord>(
          `SELECT 'tip_received' as type, t.amount, t.tx_hash, t.timestamp,
                  t.from_address as from_addr, m.author_handle, m.tweet_id,
                  COALESCE(
                    (SELECT profile_image_url FROM verified_claims WHERE author_id = t.author_id AND profile_image_url IS NOT NULL ORDER BY verified_at DESC LIMIT 1),
                    (SELECT profile_image_url FROM verified_claims WHERE LOWER(username) = LOWER(COALESCE(m.author_handle, '')) AND profile_image_url IS NOT NULL ORDER BY verified_at DESC LIMIT 1)
                  ) as profileImageUrl
           FROM tips t
           LEFT JOIN tip_metadata m ON t.content_id = m.content_id
           WHERE (t.author_id = ? OR LOWER(COALESCE(m.author_handle, '')) = LOWER(?))
             AND t.tip_contract_address = ?
           ORDER BY t.timestamp DESC
           LIMIT ?`
        , [claim.author_id, claim.username, currentContract, limit])
      : await query<AccountActivityRecord>(
          `SELECT 'tip_received' as type, t.amount, t.tx_hash, t.timestamp,
                  t.from_address as from_addr, m.author_handle, m.tweet_id,
                  COALESCE(
                    (SELECT profile_image_url FROM verified_claims WHERE author_id = t.author_id AND profile_image_url IS NOT NULL ORDER BY verified_at DESC LIMIT 1),
                    (SELECT profile_image_url FROM verified_claims WHERE LOWER(username) = LOWER(COALESCE(m.author_handle, '')) AND profile_image_url IS NOT NULL ORDER BY verified_at DESC LIMIT 1)
                  ) as profileImageUrl
           FROM tips t
           LEFT JOIN tip_metadata m ON t.content_id = m.content_id
           WHERE t.author_id = ? OR LOWER(COALESCE(m.author_handle, '')) = LOWER(?)
           ORDER BY t.timestamp DESC
           LIMIT ?`
        , [claim.author_id, claim.username, limit]);

    xBotTipsReceived = await query<AccountActivityRecord>(
      `SELECT 'tip_received' as type,
              amount_raw as amount,
              tx_hash,
              CAST(created_at / 1000 AS INTEGER) as timestamp,
              sender_address as from_addr,
              recipient_x_username as author_handle,
              source_tweet_id as tweet_id,
              'X tip command' as detail,
              COALESCE(
                (SELECT profile_image_url FROM verified_claims WHERE author_id = xbt.recipient_x_user_id AND profile_image_url IS NOT NULL ORDER BY verified_at DESC LIMIT 1),
                (SELECT profile_image_url FROM verified_claims WHERE LOWER(username) = LOWER(COALESCE(xbt.recipient_x_username, '')) AND profile_image_url IS NOT NULL ORDER BY verified_at DESC LIMIT 1)
              ) as profileImageUrl
       FROM x_bot_tips xbt
       WHERE status = 'completed'
         AND (
           recipient_x_user_id = ?
           OR LOWER(COALESCE(recipient_x_username, '')) = LOWER(?)
           OR LOWER(COALESCE(recipient_address, '')) = ?
         )
       ORDER BY created_at DESC
       LIMIT ?`,
      [claim.author_id, claim.username, address, limit],
    );
  }

  const referralFees = await query<AccountActivityRecord>(
    `SELECT type, amount, tx_hash, timestamp, to_address, from_address, detail
     FROM user_activity
     WHERE to_address = ? AND type = 'referral_fee_received'
     ORDER BY timestamp DESC
     LIMIT ?`
  , [address, limit]);

  const fundingRows = await query<AccountActivityRecord>(
    `SELECT
       CASE
         WHEN kind = 'crypto_receive' THEN 'deposit'
         WHEN kind = 'inbound_usdc' THEN 'deposit'
         WHEN kind = 'faucet' THEN 'deposit'
         ELSE 'funding'
       END as type,
       CASE
         WHEN metadata_json::jsonb ->> 'amountRaw' IS NOT NULL THEN metadata_json::jsonb ->> 'amountRaw'
         ELSE CAST((CAST(COALESCE(metadata_json::jsonb ->> 'amount', '0') AS NUMERIC) * 1000000) AS BIGINT)::TEXT
       END as amount,
       COALESCE(metadata_json::jsonb ->> 'txHash', metadata_json::jsonb ->> 'hash', provider_session_id) as tx_hash,
       CAST(created_at / 1000 AS INTEGER) as timestamp,
       CASE
         WHEN kind = 'faucet' THEN 'Faucet Funding'
         WHEN kind = 'crypto_receive' THEN 'Inbound Transfer'
         WHEN kind = 'inbound_usdc' THEN 'Inbound Transfer'
         ELSE provider
       END as detail
     FROM funding_provider_sessions
     WHERE LOWER(user_address) = ?
       AND status IN ('completed', 'success', 'confirmed', 'synced')
     ORDER BY created_at DESC
     LIMIT ?`
  , [address, limit]);

  const withdrawalRows = await query<AccountActivityRecord>(
    `SELECT
       'withdraw' as type,
       amount_raw as amount,
       tx_hash,
       CAST(created_at / 1000 AS INTEGER) as timestamp,
       destination_address as to_address,
       'Withdrawal' as detail
     FROM withdrawal_records
     WHERE LOWER(owner_address) = ?
     ORDER BY created_at DESC
     LIMIT ?`
  , [address, limit]);

  const normalizedRows = normalizeRows([...tipsSent, ...xBotTipsSent, ...tipsReceived, ...xBotTipsReceived, ...fundingRows, ...withdrawalRows, ...referralFees]);
  const seenTxHash = new Set<string>();
  const deduped: AccountActivityRecord[] = [];
  for (const row of normalizedRows) {
    const txHash = row.tx_hash ? String(row.tx_hash).toLowerCase() : null;
    if (txHash && seenTxHash.has(txHash)) continue;
    if (txHash) seenTxHash.add(txHash);
    deduped.push(row);
  }

  return deduped.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
}
