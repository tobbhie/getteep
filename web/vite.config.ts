import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
  server: { port: 5174 },
  build: {
    sourcemap: false,
  },
  };
});
