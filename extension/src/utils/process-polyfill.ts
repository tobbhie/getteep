/**
 * Extension/browser context has no Node "process". Bundled deps (React, viem, etc.) may reference it.
 * This must run before any other code. Used by both popup and content script.
 */
const g = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : ({} as any);
if (typeof g.process === "undefined") {
  const nodeEnv = process.env.NODE_ENV || "development";
  g.process = {
    env: {
      NODE_ENV: nodeEnv,
      BLUR_EMAIL: process.env.BLUR_EMAIL || "false",
      DEBUG_TEEP: process.env.DEBUG_TEEP || "false",
      DEBUG_TIPCOIN: process.env.DEBUG_TIPCOIN || "false",
    },
    browser: true,
  };
}
