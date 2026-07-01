import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const LOCAL_URL_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i;

function assertProductionEnv() {
  const required = ["VITE_API_URL", "VITE_WEB_APP_URL", "VITE_PRIVY_APP_ID", "VITE_CHROME_STORE_URL"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Production web build is missing required env: ${missing.join(", ")}`);
  }

  for (const key of ["VITE_API_URL", "VITE_WEB_APP_URL", "VITE_RECEIPT_BASE_URL"]) {
    const value = process.env[key];
    if (value && LOCAL_URL_RE.test(value)) {
      throw new Error(`Production web build cannot use a local ${key}: ${value}`);
    }
  }

  const storeUrl = process.env.VITE_CHROME_STORE_URL;
  if (storeUrl && /PLACEHOLDER/i.test(storeUrl)) {
    throw new Error("Production web build cannot use the placeholder Chrome Store URL.");
  }
}

export default defineConfig(({ mode }) => {
  if (mode === "production") assertProductionEnv();

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
    allowedHosts: ["435a-102-88-112-142.ngrok-free.app"],
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/auth": "http://127.0.0.1:3001",
      "/defi": "http://127.0.0.1:3001",
      "/faucet": "http://127.0.0.1:3001",
      "/health": "http://127.0.0.1:3001",
      "/leaderboard": "http://127.0.0.1:3001",
      "/milestones": "http://127.0.0.1:3001",
      "/api/ops": "http://127.0.0.1:3001",
      "/referral": "http://127.0.0.1:3001",
      "/stats": "http://127.0.0.1:3001",
      "/tips": "http://127.0.0.1:3001",
      "/withdrawal": "http://127.0.0.1:3001",
    },
  },
  build: {
    sourcemap: false,
  },
  };
});
