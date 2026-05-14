import { randomUUID } from "crypto";
import { getDb } from "../db/database";

type ProviderKind = "faucet" | "crypto_receive" | "fiat_onramp" | "fiat_offramp";
type ProviderStatus = "created" | "pending" | "completed" | "failed" | "cancelled";

interface CreateFundingProviderSessionInput {
  provider: string;
  kind: ProviderKind;
  userAddress?: string | null;
  providerSessionId?: string | null;
  status?: ProviderStatus;
  redirectUrl?: string | null;
  metadata?: Record<string, unknown>;
}

interface RecordFundingProviderWebhookInput {
  provider: string;
  eventType: string;
  providerEventId?: string | null;
  sessionId?: string | null;
  status?: string;
  metadata?: Record<string, unknown>;
}

function safeJson(metadata?: Record<string, unknown>): string | null {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  return JSON.stringify(metadata);
}

export function createFundingProviderSession(input: CreateFundingProviderSessionInput): string {
  const id = randomUUID();
  const now = Date.now();
  getDb().prepare(`
    INSERT INTO funding_provider_sessions (
      id, provider, provider_session_id, kind, user_address, status, redirect_url, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.provider,
    input.providerSessionId || null,
    input.kind,
    input.userAddress?.toLowerCase() || null,
    input.status || "created",
    input.redirectUrl || null,
    safeJson(input.metadata),
    now,
    now
  );
  return id;
}

export function updateFundingProviderSessionStatus(id: string, status: ProviderStatus, metadata?: Record<string, unknown>): void {
  getDb().prepare(`
    UPDATE funding_provider_sessions
    SET status = ?, metadata_json = COALESCE(?, metadata_json), updated_at = ?
    WHERE id = ?
  `).run(status, safeJson(metadata), Date.now(), id);
}

export function recordFundingProviderWebhook(input: RecordFundingProviderWebhookInput): void {
  getDb().prepare(`
    INSERT OR IGNORE INTO funding_provider_webhooks (
      provider, provider_event_id, event_type, session_id, status, metadata_json, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.provider,
    input.providerEventId || null,
    input.eventType,
    input.sessionId || null,
    input.status || "received",
    safeJson(input.metadata),
    Date.now()
  );
}
