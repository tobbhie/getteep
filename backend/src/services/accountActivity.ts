import { getDb } from "../db/database";

export type AccountActivityRecord = {
  type: string;
  amount: string;
  tx_hash: string | null;
  timestamp: number;
  author_handle?: string | null;
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

export function getAccountActivity(options: {
  address: string;
  limit?: number;
  tipContractAddress?: string;
}): AccountActivityRecord[] {
  const db = getDb();
  const address = options.address.toLowerCase();
  const limit = Math.min(options.limit || 50, 100);
  const currentContract = (options.tipContractAddress || "").toLowerCase();

  const tipsSent = currentContract
    ? db.prepare(
        `SELECT CASE WHEN m.kind = 'direct_creator_tip' THEN 'direct_creator_tip' ELSE 'tip_sent' END as type,
                t.amount, t.tx_hash, t.timestamp,
                m.author_handle, m.tweet_id
         FROM tips t
         LEFT JOIN tip_metadata m ON t.content_id = m.content_id
         WHERE t.from_address = ? AND t.tip_contract_address = ?
         ORDER BY t.timestamp DESC
         LIMIT ?`
      ).all(address, currentContract, limit) as AccountActivityRecord[]
    : db.prepare(
        `SELECT CASE WHEN m.kind = 'direct_creator_tip' THEN 'direct_creator_tip' ELSE 'tip_sent' END as type,
                t.amount, t.tx_hash, t.timestamp,
                m.author_handle, m.tweet_id
         FROM tips t
         LEFT JOIN tip_metadata m ON t.content_id = m.content_id
         WHERE t.from_address = ?
         ORDER BY t.timestamp DESC
         LIMIT ?`
      ).all(address, limit) as AccountActivityRecord[];

  const claim = db.prepare(
    "SELECT username, author_id FROM verified_claims WHERE owner_address = ? ORDER BY verified_at DESC LIMIT 1"
  ).get(address) as { username: string; author_id: string } | undefined;

  let tipsReceived: AccountActivityRecord[] = [];
  if (claim) {
    tipsReceived = currentContract
      ? db.prepare(
          `SELECT 'tip_received' as type, t.amount, t.tx_hash, t.timestamp,
                  t.from_address as from_addr, m.author_handle, m.tweet_id
           FROM tips t
           LEFT JOIN tip_metadata m ON t.content_id = m.content_id
           WHERE (t.author_id = ? OR LOWER(COALESCE(m.author_handle, '')) = LOWER(?))
             AND t.tip_contract_address = ?
           ORDER BY t.timestamp DESC
           LIMIT ?`
        ).all(claim.author_id, claim.username, currentContract, limit) as AccountActivityRecord[]
      : db.prepare(
          `SELECT 'tip_received' as type, t.amount, t.tx_hash, t.timestamp,
                  t.from_address as from_addr, m.author_handle, m.tweet_id
           FROM tips t
           LEFT JOIN tip_metadata m ON t.content_id = m.content_id
           WHERE t.author_id = ? OR LOWER(COALESCE(m.author_handle, '')) = LOWER(?)
           ORDER BY t.timestamp DESC
           LIMIT ?`
        ).all(claim.author_id, claim.username, limit) as AccountActivityRecord[];
  }

  const referralFees = db.prepare(
    `SELECT type, amount, tx_hash, timestamp, to_address, from_address, detail
     FROM user_activity
     WHERE to_address = ? AND type = 'referral_fee_received'
     ORDER BY timestamp DESC
     LIMIT ?`
  ).all(address, limit) as AccountActivityRecord[];

  const fundingRows = db.prepare(
    `SELECT
       CASE
         WHEN kind = 'crypto_receive' THEN 'deposit'
         WHEN kind = 'inbound_usdc' THEN 'deposit'
         WHEN kind = 'faucet' THEN 'deposit'
         ELSE 'funding'
       END as type,
       CASE
         WHEN json_extract(metadata_json, '$.amountRaw') IS NOT NULL THEN json_extract(metadata_json, '$.amountRaw')
         ELSE CAST(CAST(COALESCE(json_extract(metadata_json, '$.amount'), '0') AS REAL) * 1000000 AS INTEGER)
       END as amount,
       COALESCE(json_extract(metadata_json, '$.txHash'), json_extract(metadata_json, '$.hash'), provider_session_id) as tx_hash,
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
  ).all(address, limit) as AccountActivityRecord[];

  const withdrawalRows = db.prepare(
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
  ).all(address, limit) as AccountActivityRecord[];

  const normalizedRows = normalizeRows([...tipsSent, ...tipsReceived, ...fundingRows, ...withdrawalRows, ...referralFees]);
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
