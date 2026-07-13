import { randomUUID } from "crypto";
import { run } from "../db/database";

type ProviderKind = "faucet" | "crypto_receive" | "fiat_onramp" | "fiat_offramp";
type ProviderStatus = "created" | "pending" | "completed" | "failed" | "cancelled";

interface CreateFundingProviderSessionInput {
  id?: string;
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

export async function createFundingProviderSession(input: CreateFundingProviderSessionInput): Promise<string> {
  const id = input.id || randomUUID();
  const now = Date.now();
  await run(`
    INSERT INTO funding_provider_sessions (
      id, provider, provider_session_id, kind, user_address, status, redirect_url, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
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
  ]);
  return id;
}

export async function updateFundingProviderSessionStatus(id: string, status: ProviderStatus, metadata?: Record<string, unknown>): Promise<void> {
  await run(`
    UPDATE funding_provider_sessions
    SET status = ?, metadata_json = COALESCE(?, metadata_json), updated_at = ?
    WHERE id = ?
  `, [status, safeJson(metadata), Date.now(), id]);
}

export async function updateFundingProviderSession(input: {
  id: string;
  status?: ProviderStatus;
  providerSessionId?: string | null;
  redirectUrl?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await run(`
    UPDATE funding_provider_sessions
    SET
      status = COALESCE(?, status),
      provider_session_id = COALESCE(?, provider_session_id),
      redirect_url = COALESCE(?, redirect_url),
      metadata_json = COALESCE(?, metadata_json),
      updated_at = ?
    WHERE id = ?
  `, [
    input.status || null,
    input.providerSessionId || null,
    input.redirectUrl || null,
    safeJson(input.metadata),
    Date.now(),
    input.id,
  ]);
}

export async function recordFundingProviderWebhook(input: RecordFundingProviderWebhookInput): Promise<void> {
  await run(`
    INSERT INTO funding_provider_webhooks (
      provider, provider_event_id, event_type, session_id, status, metadata_json, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (provider, provider_event_id) DO NOTHING
  `, [
    input.provider,
    input.providerEventId || null,
    input.eventType,
    input.sessionId || null,
    input.status || "received",
    safeJson(input.metadata),
    Date.now()
  ]);
}
