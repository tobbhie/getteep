import { Pool, type PoolClient, type QueryResultRow } from "pg";

export type DbClient = Pool | PoolClient;

export type DbFacade = {
  client: DbClient;
  prepare(sql: string): {
    all<T extends QueryResultRow = QueryResultRow>(...params: unknown[]): Promise<T[]>;
    get<T extends QueryResultRow = QueryResultRow>(...params: unknown[]): Promise<T | undefined>;
    run(...params: unknown[]): Promise<{ changes: number }>;
  };
  transaction<T>(fn: (db: DbFacade) => Promise<T>): () => Promise<T>;
};

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;

let pool: Pool | null = null;

function requireDatabaseUrl() {
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL or POSTGRES_URL is required for the Postgres backend.");
  }
  return DATABASE_URL;
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: requireDatabaseUrl(),
      max: Number(process.env.POSTGRES_POOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.POSTGRES_IDLE_TIMEOUT_MS || 30_000),
      connectionTimeoutMillis: Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS || 10_000),
      ssl:
        process.env.POSTGRES_SSL === "true"
          ? { rejectUnauthorized: process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== "false" }
          : undefined,
    });
  }
  return pool;
}

function toPostgresPlaceholders(sql: string) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
  client: DbClient = getPool()
): Promise<T[]> {
  const result = await client.query<T>(toPostgresPlaceholders(sql), [...params]);
  return result.rows;
}

export async function one<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
  client?: DbClient
): Promise<T | undefined> {
  const rows = await query<T>(sql, params, client);
  return rows[0];
}

export async function run(
  sql: string,
  params: readonly unknown[] = [],
  client: DbClient = getPool()
): Promise<number> {
  const result = await client.query(toPostgresPlaceholders(sql), [...params]);
  return result.rowCount ?? 0;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function getDb(client: DbClient = getPool()): DbFacade {
  return {
    client,
    prepare(sql: string) {
      return {
        all<T extends QueryResultRow = QueryResultRow>(...params: unknown[]) {
          return query<T>(sql, params, client);
        },
        get<T extends QueryResultRow = QueryResultRow>(...params: unknown[]) {
          return one<T>(sql, params, client);
        },
        async run(...params: unknown[]) {
          return { changes: await run(sql, params, client) };
        },
      };
    },
    transaction<T>(fn: (db: DbFacade) => Promise<T>) {
      return () => transaction((txClient) => fn(getDb(txClient)));
    },
  };
}

const schemaSql = `
  CREATE TABLE IF NOT EXISTS tips (
    id BIGSERIAL PRIMARY KEY,
    content_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    amount TEXT NOT NULL,
    tx_hash TEXT NOT NULL UNIQUE,
    block_number BIGINT NOT NULL,
    log_index INTEGER NOT NULL,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    tip_contract_address TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tips_content_id ON tips(content_id);
  CREATE INDEX IF NOT EXISTS idx_tips_author_id ON tips(author_id);
  CREATE INDEX IF NOT EXISTS idx_tips_from ON tips(from_address);
  CREATE INDEX IF NOT EXISTS idx_tips_block ON tips(block_number);

  CREATE TABLE IF NOT EXISTS indexer_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_block BIGINT NOT NULL DEFAULT 0,
    current_block BIGINT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    last_success_at BIGINT,
    last_error TEXT,
    last_error_at BIGINT
  );

  INSERT INTO indexer_state (id, last_block)
  VALUES (1, 0)
  ON CONFLICT (id) DO NOTHING;

  CREATE TABLE IF NOT EXISTS claim_wallets (
    author_id TEXT PRIMARY KEY,
    wallet_address TEXT NOT NULL,
    owner_address TEXT NOT NULL,
    deployed_at_block BIGINT NOT NULL,
    tx_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS claim_wallet_legacy (
    author_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (author_id, wallet_address)
  );

  CREATE TABLE IF NOT EXISTS verified_claims (
    id BIGSERIAL PRIMARY KEY,
    author_id TEXT NOT NULL,
    username TEXT NOT NULL,
    display_name TEXT,
    owner_address TEXT NOT NULL,
    profile_image_url TEXT,
    verified_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(author_id, owner_address)
  );

  CREATE INDEX IF NOT EXISTS idx_verified_claims_owner ON verified_claims(owner_address);

  CREATE TABLE IF NOT EXISTS pending_attestations (
    owner_address TEXT PRIMARY KEY,
    attestation_json TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS tip_metadata (
    content_id TEXT NOT NULL UNIQUE,
    author_handle TEXT NOT NULL,
    tweet_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'post_tip',
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_tip_metadata_content ON tip_metadata(content_id);

  CREATE TABLE IF NOT EXISTS user_activity (
    id BIGSERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT,
    amount TEXT NOT NULL,
    tx_hash TEXT,
    detail TEXT,
    author_handle TEXT,
    tweet_id TEXT,
    source_method TEXT,
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_user_activity_from ON user_activity(from_address);
  CREATE INDEX IF NOT EXISTS idx_user_activity_ts ON user_activity(timestamp DESC);

  CREATE TABLE IF NOT EXISTS referral_codes (
    code TEXT PRIMARY KEY,
    referrer_address TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_referral_codes_referrer ON referral_codes(referrer_address);

  CREATE TABLE IF NOT EXISTS user_referrals (
    user_address TEXT PRIMARY KEY,
    referrer_address TEXT NOT NULL,
    referral_code TEXT NOT NULL,
    referred_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    address TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    social_x_handle TEXT,
    default_tip_amount TEXT NOT NULL DEFAULT '5.00',
    receipt_share_links_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    receipt_share_amount_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    receipt_post_aware_copy_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    notify_creator_claimed BOOLEAN NOT NULL DEFAULT TRUE,
    notify_low_balance BOOLEAN NOT NULL DEFAULT TRUE,
    notify_receipt_ready BOOLEAN NOT NULL DEFAULT FALSE,
    notify_new_tip BOOLEAN NOT NULL DEFAULT TRUE,
    notify_repeat_supporter BOOLEAN NOT NULL DEFAULT TRUE,
    notify_claim_wallet_activity BOOLEAN NOT NULL DEFAULT TRUE,
    notify_withdrawal_completed BOOLEAN NOT NULL DEFAULT TRUE,
    notify_grow_tips_status BOOLEAN NOT NULL DEFAULT TRUE,
    privacy_hide_address BOOLEAN NOT NULL DEFAULT TRUE,
    privacy_private_activity BOOLEAN NOT NULL DEFAULT TRUE,
    privacy_require_verification BOOLEAN NOT NULL DEFAULT TRUE,
    privacy_hide_supporter_names_publicly BOOLEAN NOT NULL DEFAULT FALSE,
    privacy_hide_growth_activity BOOLEAN NOT NULL DEFAULT FALSE,
    payout_default_destination TEXT,
    payout_confirmation_preference TEXT NOT NULL DEFAULT 'email',
    payout_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    grow_default_strategy_id TEXT,
    grow_risk_visibility_level TEXT NOT NULL DEFAULT 'standard',
    grow_maturity_exit_reminders BOOLEAN NOT NULL DEFAULT TRUE,
    engagement_default_thank_you_message TEXT NOT NULL DEFAULT 'Thank you for supporting my work on Teep.',
    engagement_auto_suggest_x_thank_you BOOLEAN NOT NULL DEFAULT TRUE,
    engagement_repeat_supporter_reminders BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_user_settings_username ON user_settings(username);

  CREATE TABLE IF NOT EXISTS user_notifications (
    id BIGSERIAL PRIMARY KEY,
    user_address TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unread',
    metadata_json TEXT,
    created_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created ON user_notifications(user_address, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_user_notifications_status ON user_notifications(user_address, status);

  CREATE TABLE IF NOT EXISTS supporter_thank_yous (
    id BIGSERIAL PRIMARY KEY,
    supporter_address TEXT NOT NULL,
    creator_owner_address TEXT NOT NULL,
    creator_author_id TEXT NOT NULL,
    creator_username TEXT,
    tip_count INTEGER NOT NULL DEFAULT 0,
    total_raw TEXT NOT NULL DEFAULT '0',
    message TEXT,
    notification_id BIGINT,
    created_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_supporter_thank_yous_supporter_created ON supporter_thank_yous(supporter_address, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_supporter_thank_yous_creator ON supporter_thank_yous(creator_author_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS post_milestones (
    content_id TEXT NOT NULL,
    milestone_usd INTEGER NOT NULL,
    reached_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (content_id, milestone_usd)
  );

  CREATE INDEX IF NOT EXISTS idx_post_milestones_content ON post_milestones(content_id);

  CREATE TABLE IF NOT EXISTS milestone_notified (
    content_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    milestone_usd INTEGER NOT NULL,
    notified_at TIMESTAMPTZ DEFAULT now(),
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
    record_token_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    tx_hash TEXT,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    confirmed_at BIGINT,
    used_at BIGINT
  );

  CREATE INDEX IF NOT EXISTS idx_withdrawal_confirmations_owner ON withdrawal_confirmations(owner_address);
  CREATE INDEX IF NOT EXISTS idx_withdrawal_confirmations_created ON withdrawal_confirmations(created_at);

  CREATE TABLE IF NOT EXISTS withdrawal_records (
    id BIGSERIAL PRIMARY KEY,
    owner_address TEXT NOT NULL,
    destination_address TEXT NOT NULL,
    source TEXT NOT NULL,
    amount_raw TEXT NOT NULL,
    tx_hash TEXT NOT NULL UNIQUE,
    confirmation_id TEXT REFERENCES withdrawal_confirmations(id),
    created_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_withdrawal_records_owner_created ON withdrawal_records(owner_address, created_at);

  CREATE TABLE IF NOT EXISTS ops_events (
    id BIGSERIAL PRIMARY KEY,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    event_type TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata_json TEXT,
    created_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_ops_events_created ON ops_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ops_events_type ON ops_events(source, event_type);

  CREATE TABLE IF NOT EXISTS abuse_events (
    id BIGSERIAL PRIMARY KEY,
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
    created_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_abuse_events_created ON abuse_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_abuse_events_actor ON abuse_events(actor_address);
  CREATE INDEX IF NOT EXISTS idx_abuse_events_type ON abuse_events(event_type, status);

  CREATE TABLE IF NOT EXISTS security_events (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    actor_address TEXT,
    route TEXT,
    ip_hash TEXT,
    reason TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_security_events_actor_created ON security_events(actor_address, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_security_events_type_created ON security_events(event_type, created_at DESC);

  CREATE TABLE IF NOT EXISTS oauth_flows (
    state TEXT PRIMARY KEY,
    owner_address TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    mode TEXT NOT NULL,
    expected_author_id TEXT,
    return_to TEXT,
    expires_at BIGINT NOT NULL,
    created_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_oauth_flows_expires ON oauth_flows(expires_at);

  ALTER TABLE oauth_flows
    ADD COLUMN IF NOT EXISTS return_to TEXT;

  CREATE TABLE IF NOT EXISTS funding_provider_sessions (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_session_id TEXT,
    kind TEXT NOT NULL,
    user_address TEXT,
    status TEXT NOT NULL,
    redirect_url TEXT,
    metadata_json TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_funding_provider_sessions_user_created ON funding_provider_sessions(user_address, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_funding_provider_sessions_provider ON funding_provider_sessions(provider, provider_session_id);

  CREATE TABLE IF NOT EXISTS funding_sync_state (
    user_address TEXT PRIMARY KEY,
    last_block BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS funding_provider_webhooks (
    id BIGSERIAL PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_event_id TEXT,
    event_type TEXT NOT NULL,
    session_id TEXT,
    status TEXT NOT NULL DEFAULT 'received',
    metadata_json TEXT,
    received_at BIGINT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_funding_provider_webhooks_unique_event ON funding_provider_webhooks(provider, provider_event_id);
  CREATE INDEX IF NOT EXISTS idx_funding_provider_webhooks_session ON funding_provider_webhooks(session_id);

  CREATE TABLE IF NOT EXISTS defi_strategies (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    strategy_type TEXT NOT NULL,
    status TEXT NOT NULL,
    source_chain_id INTEGER NOT NULL,
    destination_chain_id INTEGER,
    asset_address TEXT NOT NULL,
    target_address TEXT,
    metadata_json TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_defi_strategies_provider ON defi_strategies(provider, status);
  CREATE INDEX IF NOT EXISTS idx_defi_strategies_chain ON defi_strategies(source_chain_id, destination_chain_id);

  CREATE TABLE IF NOT EXISTS defi_positions (
    id TEXT PRIMARY KEY,
    user_address TEXT NOT NULL,
    strategy_id TEXT NOT NULL REFERENCES defi_strategies(id),
    provider TEXT NOT NULL,
    source_chain_id INTEGER NOT NULL,
    destination_chain_id INTEGER,
    asset_address TEXT NOT NULL,
    target_address TEXT,
    principal_raw TEXT NOT NULL,
    current_value_raw TEXT NOT NULL,
    yield_earned_raw TEXT NOT NULL,
    shares_raw TEXT,
    chain_state TEXT NOT NULL,
    metadata_json TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_defi_positions_user ON defi_positions(user_address, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_defi_positions_strategy ON defi_positions(strategy_id);

  CREATE TABLE IF NOT EXISTS defi_transactions (
    id TEXT PRIMARY KEY,
    user_address TEXT NOT NULL,
    strategy_id TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    source_chain_id INTEGER NOT NULL,
    destination_chain_id INTEGER,
    source_tx_hash TEXT,
    destination_tx_hash TEXT,
    bridge_message_id TEXT,
    amount_raw TEXT,
    shares_raw TEXT,
    error TEXT,
    metadata_json TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_defi_transactions_user ON defi_transactions(user_address, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_defi_transactions_status ON defi_transactions(status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS x_accounts (
    x_user_id TEXT PRIMARY KEY,
    user_address TEXT NOT NULL UNIQUE,
    x_username TEXT NOT NULL,
    verified_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS idx_x_accounts_username ON x_accounts(LOWER(x_username));
  CREATE INDEX IF NOT EXISTS idx_x_accounts_address ON x_accounts(LOWER(user_address));

  CREATE TABLE IF NOT EXISTS user_teep_balances (
    user_address TEXT NOT NULL,
    token_address TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    amount_raw TEXT NOT NULL DEFAULT '0',
    updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_address, token_address, chain_id)
  );

  CREATE TABLE IF NOT EXISTS teep_balance_ledger (
    id BIGSERIAL PRIMARY KEY,
    user_address TEXT NOT NULL,
    token_address TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    delta_raw TEXT NOT NULL,
    balance_after_raw TEXT NOT NULL,
    reason TEXT NOT NULL,
    ref_id TEXT,
    created_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_teep_balance_ledger_user ON teep_balance_ledger(user_address, created_at DESC);

  CREATE TABLE IF NOT EXISTS x_tipping_permissions (
    user_address TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    token_address TEXT NOT NULL,
    max_per_tip_raw TEXT NOT NULL DEFAULT '10000000',
    max_daily_raw TEXT NOT NULL DEFAULT '50000000',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS processed_x_posts (
    tweet_id TEXT PRIMARY KEY,
    author_x_user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    receipt_id TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_processed_x_posts_status ON processed_x_posts(status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS x_bot_tips (
    id TEXT PRIMARY KEY,
    sender_address TEXT NOT NULL,
    recipient_address TEXT,
    recipient_x_user_id TEXT NOT NULL,
    recipient_x_username TEXT,
    token_address TEXT NOT NULL,
    amount_raw TEXT NOT NULL,
    source_tweet_id TEXT NOT NULL UNIQUE,
    receipt_id TEXT NOT NULL UNIQUE,
    tx_hash TEXT,
    status TEXT NOT NULL,
    created_at BIGINT NOT NULL
  );

  ALTER TABLE x_bot_tips
    ADD COLUMN IF NOT EXISTS tx_hash TEXT;

  CREATE INDEX IF NOT EXISTS idx_x_bot_tips_sender ON x_bot_tips(sender_address, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_x_bot_tips_recipient ON x_bot_tips(recipient_address, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_x_bot_tips_tx_hash ON x_bot_tips(LOWER(tx_hash));

  CREATE TABLE IF NOT EXISTS claimable_tips (
    id TEXT PRIMARY KEY,
    recipient_x_user_id TEXT NOT NULL,
    recipient_x_username TEXT NOT NULL,
    sender_address TEXT NOT NULL,
    token_address TEXT NOT NULL,
    amount_raw TEXT NOT NULL,
    source_tweet_id TEXT NOT NULL UNIQUE,
    receipt_id TEXT,
    status TEXT NOT NULL DEFAULT 'unclaimed',
    expires_at BIGINT,
    created_at BIGINT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_claimable_tips_recipient ON claimable_tips(recipient_x_user_id, status);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_claimable_tips_receipt ON claimable_tips(receipt_id)
    WHERE receipt_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS teep_balance_deposits (
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    user_address TEXT NOT NULL,
    amount_raw TEXT NOT NULL,
    token_address TEXT NOT NULL,
    chain_id INTEGER NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (tx_hash, log_index)
  );
`;

export async function initDb(): Promise<void> {
  await getPool().query(schemaSql);
  console.log("[DB] Postgres database initialized");
}
