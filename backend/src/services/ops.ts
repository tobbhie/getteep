import crypto from "crypto";
import { getDb } from "../db/database";

type JsonRecord = Record<string, unknown>;

function safeJson(value?: JsonRecord): string | null {
  if (!value) return null;
  return JSON.stringify(value, (_key, item) => {
    if (typeof item !== "string") return item;
    if (/^0x[a-fA-F0-9]{130,}$/.test(item)) return "[signature]";
    if (/bearer\s+[a-z0-9._-]+/i.test(item)) return "[token]";
    return item;
  });
}

export function recordOpsEvent(params: {
  level: "info" | "warn" | "error";
  source: string;
  eventType: string;
  message: string;
  metadata?: JsonRecord;
}) {
  try {
    getDb().prepare(
      "INSERT INTO ops_events (level, source, event_type, message, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(params.level, params.source, params.eventType, params.message, safeJson(params.metadata), Date.now());
  } catch {
    // Observability should never break the app path.
  }
}

export function recordSecurityEvent(params: {
  eventType: string;
  actorAddress?: string | null;
  route?: string;
  ip?: string;
  reason: string;
}) {
  try {
    const ipHash = params.ip
      ? crypto.createHash("sha256").update(params.ip).digest("hex")
      : null;
    getDb().prepare(
      "INSERT INTO security_events (event_type, actor_address, route, ip_hash, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      params.eventType,
      params.actorAddress?.toLowerCase() || null,
      params.route || null,
      ipHash,
      params.reason,
      Date.now()
    );
  } catch {}
}

