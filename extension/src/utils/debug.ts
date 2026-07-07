/**
 * Debug mode: set DEBUG_TEEP=true at build time (env) to enable.
 * When enabled: console logs every important action/inaction and popup can show a Debug panel.
 */

const DEBUG =
  typeof process !== "undefined" &&
  process.env &&
  (process.env.DEBUG_TEEP === "true" || process.env.DEBUG_TIPCOIN === "true");

export const isDebug = (): boolean => !!DEBUG;

export type DebugEntry = { tag: string; message: string; data?: unknown; ts: number };

const MAX_ENTRIES = 80;
let logEntries: DebugEntry[] = [];
const listeners = new Set<(entries: DebugEntry[]) => void>();

export function getDebugEntries(): DebugEntry[] {
  return [...logEntries];
}

export function clearDebugEntries(): void {
  logEntries = [];
  listeners.forEach((fn) => fn(logEntries));
}

export function addDebugListener(fn: (entries: DebugEntry[]) => void): () => void {
  listeners.add(fn);
  fn(logEntries);
  return () => listeners.delete(fn);
}

export function debugLog(tag: string, message: string, data?: unknown): void {
  if (!DEBUG) return;
  const entry: DebugEntry = { tag, message, data, ts: Date.now() };
  logEntries.push(entry);
  if (logEntries.length > MAX_ENTRIES) logEntries = logEntries.slice(-MAX_ENTRIES);
  const prefix = `[Teep:${tag}]`;
  if (data !== undefined) {
    console.log(prefix, message, data);
  } else {
    console.log(prefix, message);
  }
  listeners.forEach((fn) => fn([...logEntries]));
}
