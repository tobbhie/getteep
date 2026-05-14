import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../../data/teep.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

export function initDb(): void {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS tips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      from_address TEXT NOT NULL,
      to_address TEXT NOT NULL,
      amount TEXT NOT NULL,
      tx_hash TEXT NOT NULL UNIQUE,
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tips_content_id ON tips(content_id);
    CREATE INDEX IF NOT EXISTS idx_tips_author_id ON tips(author_id);
    CREATE INDEX IF NOT EXISTS idx_tips_from ON tips(from_address);
    CREATE INDEX IF NOT EXISTS idx_tips_block ON tips(block_number);

    CREATE TABLE IF NOT EXISTS indexer_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_block INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO indexer_state (id, last_block) VALUES (1, 0);

    CREATE TABLE IF NOT EXISTS claim_wallets (
      author_id TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL,
      owner_address TEXT NOT NULL,
      deployed_at_block INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS claim_wallet_legacy (
      author_id TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (author_id, wallet_address)
    );

    CREATE TABLE IF NOT EXISTS verified_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_id TEXT NOT NULL,
      username TEXT NOT NULL,
      display_name TEXT,
      owner_address TEXT NOT NULL,
      verified_at TEXT DEFAULT (datetime('now')),
      UNIQUE(author_id, owner_address)
    );

    CREATE INDEX IF NOT EXISTS idx_verified_claims_owner ON verified_claims(owner_address);

    CREATE TABLE IF NOT EXISTS tip_metadata (
      content_id TEXT NOT NULL,
      author_handle TEXT NOT NULL,
      tweet_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(content_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tip_metadata_content ON tip_metadata(content_id);

    CREATE TABLE IF NOT EXISTS user_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      from_address TEXT NOT NULL,
      to_address TEXT,
      amount TEXT NOT NULL,
      tx_hash TEXT,
      detail TEXT,
      author_handle TEXT,
      tweet_id TEXT,
      timestamp INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_user_activity_from ON user_activity(from_address);
    CREATE INDEX IF NOT EXISTS idx_user_activity_ts ON user_activity(timestamp DESC);

    CREATE TABLE IF NOT EXISTS referral_codes (
      code TEXT PRIMARY KEY,
      referrer_address TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_referral_codes_referrer ON referral_codes(referrer_address);

    CREATE TABLE IF NOT EXISTS user_referrals (
      user_address TEXT PRIMARY KEY,
      referrer_address TEXT NOT NULL,
      referral_code TEXT NOT NULL,
      referred_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS post_milestones (
      content_id TEXT NOT NULL,
      milestone_usd INTEGER NOT NULL,
      reached_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (content_id, milestone_usd)
    );
    CREATE INDEX IF NOT EXISTS idx_post_milestones_content ON post_milestones(content_id);

    CREATE TABLE IF NOT EXISTS milestone_notified (
      content_id TEXT NOT NULL,
      author_id TEXT NOT NULL,
      milestone_usd INTEGER NOT NULL,
      notified_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (content_id, milestone_usd)
    );

    CREATE TABLE IF NOT EXISTS withdrawal_confirmations (
      id TEXT PRIMARY KEY,
      owner_address TEXT NOT NULL,
      destination_address TEXT NOT NULL,
      source TEXT NOT NULL,
      amount_raw TEXT NOT NULL,
      email TEXT,
      code_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      tx_hash TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      confirmed_at INTEGER,
      used_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_withdrawal_confirmations_owner ON withdrawal_confirmations(owner_address);
    CREATE INDEX IF NOT EXISTS idx_withdrawal_confirmations_created ON withdrawal_confirmations(created_at);

    CREATE TABLE IF NOT EXISTS withdrawal_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_address TEXT NOT NULL,
      destination_address TEXT NOT NULL,
      source TEXT NOT NULL,
      amount_raw TEXT NOT NULL,
      tx_hash TEXT NOT NULL UNIQUE,
      confirmation_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (confirmation_id) REFERENCES withdrawal_confirmations(id)
    );

    CREATE INDEX IF NOT EXISTS idx_withdrawal_records_owner_created ON withdrawal_records(owner_address, created_at);

    CREATE TABLE IF NOT EXISTS ops_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_ops_events_created ON ops_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ops_events_type ON ops_events(source, event_type);

    CREATE TABLE IF NOT EXISTS abuse_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      severity TEXT NOT NULL,
      event_type TEXT NOT NULL,
      actor_address TEXT,
      counterparty_address TEXT,
      author_id TEXT,
      content_id TEXT,
      tx_hash TEXT,
      reason TEXT NOT NULL,
      metadata_json TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_abuse_events_created ON abuse_events(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_abuse_events_actor ON abuse_events(actor_address);
    CREATE INDEX IF NOT EXISTS idx_abuse_events_type ON abuse_events(event_type, status);

    CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      actor_address TEXT,
      route TEXT,
      ip_hash TEXT,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_security_events_actor_created ON security_events(actor_address, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_security_events_type_created ON security_events(event_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS funding_provider_sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_session_id TEXT,
      kind TEXT NOT NULL,
      user_address TEXT,
      status TEXT NOT NULL,
      redirect_url TEXT,
      metadata_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_funding_provider_sessions_user_created ON funding_provider_sessions(user_address, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_funding_provider_sessions_provider ON funding_provider_sessions(provider, provider_session_id);

    CREATE TABLE IF NOT EXISTS funding_provider_webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      provider_event_id TEXT,
      event_type TEXT NOT NULL,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      metadata_json TEXT,
      received_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_provider_webhooks_unique_event ON funding_provider_webhooks(provider, provider_event_id);
    CREATE INDEX IF NOT EXISTS idx_funding_provider_webhooks_session ON funding_provider_webhooks(session_id);
  `);

  // Backfill optional columns for existing DBs
  try {
    database.exec("ALTER TABLE user_activity ADD COLUMN author_handle TEXT");
  } catch {}
  try {
    database.exec("ALTER TABLE user_activity ADD COLUMN tweet_id TEXT");
  } catch {}
  try {
    database.exec("ALTER TABLE verified_claims ADD COLUMN profile_image_url TEXT");
  } catch {}
  try {
    database.exec("ALTER TABLE tips ADD COLUMN tip_contract_address TEXT");
  } catch {}
  try {
    database.exec("ALTER TABLE indexer_state ADD COLUMN current_block INTEGER");
  } catch {}
  try {
    database.exec("ALTER TABLE indexer_state ADD COLUMN last_success_at INTEGER");
  } catch {}
  try {
    database.exec("ALTER TABLE indexer_state ADD COLUMN last_error TEXT");
  } catch {}
  try {
    database.exec("ALTER TABLE indexer_state ADD COLUMN last_error_at INTEGER");
  } catch {}

  console.log("[DB] Database initialized");
}
