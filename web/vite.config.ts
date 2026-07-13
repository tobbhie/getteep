import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const LOCAL_URL_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i;
const DEFAULT_ALLOWED_HOSTS = [
  "435a-102-88-112-142.ngrok-free.app",
  ".getteep.xyz",
];

function collectAllowedHosts(env: Record<string, string>) {
  const hosts = new Set(DEFAULT_ALLOWED_HOSTS);

  for (const key of ["VITE_WEB_APP_URL", "VITE_RECEIPT_BASE_URL"]) {
    const value = env[key];
    if (!value) continue;

    try {
      hosts.add(new URL(value).hostname);
    } catch {
      // Production validation reports malformed URLs separately.
    }
  }

  for (const key of ["RAILWAY_PUBLIC_DOMAIN", "RAILWAY_STATIC_URL"]) {
    const value = env[key];
    if (!value) continue;

    try {
      hosts.add(value.includes("://") ? new URL(value).hostname : value);
    } catch {
      hosts.add(value);
    }
  }

  return Array.from(hosts);
}

function assertProductionEnv(env: Record<string, string>) {
  const required = ["VITE_API_URL", "VITE_WEB_APP_URL", "VITE_PRIVY_APP_ID"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length) {
    throw new Error(`Production web build is missing required env: ${missing.join(", ")}`);
  }

  for (const key of ["VITE_API_URL", "VITE_WEB_APP_URL", "VITE_RECEIPT_BASE_URL"]) {
    const value = env[key];
    if (!value) continue;
  
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`Production web build has an invalid ${key}: ${value}`);
    }
  
    if (parsed.protocol !== "https:") {
      throw new Error(`Production web build requires an https ${key}: ${value}`);
    }
  
    if (LOCAL_URL_RE.test(value)) {
      throw new Error(`Production web build cannot use a local ${key}: ${value}`);
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  if (mode === "production") assertProductionEnv(env);
  const allowedHosts = collectAllowedHosts(env);
  const devProxyTarget = env.VITE_DEV_PROXY_TARGET || env.VITE_API_URL || "http://127.0.0.1:3001";
  const apiProxyRoutes = [
    "/api/ops",
    "/api",
    "/auth",
    "/defi",
    "/faucet",
    "/health",
    "/leaderboard",
    "/milestones",
    "/referral",
    "/stats",
    "/tips",
    "/withdrawal",
  ];

  return {
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^permissionless$/,
        replacement: resolve(__dirname, "node_modules/permissionless/_esm/index.js"),
      },
      {
        find: /^permissionless\/accounts$/,
        replacement: resolve(__dirname, "node_modules/permissionless/_esm/accounts/index.js"),
      },
      {
        find: /^permissionless\/clients\/pimlico$/,
        replacement: resolve(__dirname, "node_modules/permissionless/_esm/clients/pimlico.js"),
      },
    ],
  },
  server: {
    port: 5174,
    allowedHosts,
    proxy: Object.fromEntries(apiProxyRoutes.map((route) => [route, devProxyTarget])),
  },
  preview: {
    allowedHosts,
  },
  build: {
    sourcemap: false,
  },
  };
});
