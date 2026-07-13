import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import type { CorsOptions } from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { initDb } from "./db/database";
import { Indexer } from "./services/indexer";
import tipsRouter from "./routes/tips";
import authRouter from "./routes/auth";
import healthRouter from "./routes/health";
import faucetRouter from "./routes/faucet";
import referralRouter from "./routes/referral";
import withdrawalRouter from "./routes/withdrawal";
import milestonesRouter from "./routes/milestones";
import profileRouter from "./routes/profile";
import statsRouter from "./routes/stats";
import leaderboardRouter from "./routes/leaderboard";
import apiV1Router from "./routes/api-v1";
import opsRouter from "./routes/ops";
import defiRouter from "./routes/defi";
import crossmintRouter from "./routes/crossmint";
import xBotInternalRouter from "./routes/x-bot-internal";
import xBalanceRouter from "./routes/x-balance";
import { mountWebProfileRenderer } from "./services/webProfileRenderer";

const PORT = parseInt(process.env.PORT || "3001");
const LOCAL_URL_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i;
const DEFAULT_PRODUCTION_CORS_ORIGINS = [
  "https://getteep.xyz",
  "https://www.getteep.xyz",
];

function splitCsv(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function configuredCorsOrigins(): string[] {
  return [
    ...splitCsv(process.env.CORS_ORIGIN),
    ...splitCsv(process.env.CORS_ORIGINS),
    ...splitCsv(process.env.CHROME_EXTENSION_ORIGINS),
    ...splitCsv(process.env.WEB_APP_URL),
    ...splitCsv(process.env.RECEIPT_BASE_URL),
    ...(process.env.NODE_ENV === "production" ? DEFAULT_PRODUCTION_CORS_ORIGINS : []),
  ].filter((value, index, values) => values.indexOf(value) === index);
}

function isAllowedOrigin(origin: string, allowedOrigins: Set<string>): boolean {
  if (allowedOrigins.has(origin)) return true;
  if (process.env.NODE_ENV !== "production" && LOCAL_URL_RE.test(origin)) return true;
  if (process.env.NODE_ENV !== "production" && /^chrome-extension:\/\/[a-z]{32}$/i.test(origin)) return true;

  try {
    const url = new URL(origin);
    return process.env.NODE_ENV !== "production" && url.hostname.endsWith(".ngrok-free.app");
  } catch {
    return false;
  }
}

const corsOrigins = configuredCorsOrigins();
const corsOriginSet = new Set(corsOrigins);
const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin, corsOriginSet)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  maxAge: 86400,
};

function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;

  const xOAuthClientAuth = (process.env.X_AUTH_CLIENT_AUTH || process.env.X_OAUTH_CLIENT_AUTH || "auto").trim().toLowerCase();
  if (!["auto", "basic", "none"].includes(xOAuthClientAuth)) {
    throw new Error("Production backend has invalid X_AUTH_CLIENT_AUTH. Use auto, basic, or none.");
  }
  const hasAnyEnv = (keys: string[]) => keys.some((key) => Boolean(process.env[key]));
  const missingAnyEnv = (label: string, keys: string[]) => (hasAnyEnv(keys) ? null : `${label} (${keys.join(" or ")})`);

  const required = [
    "WEB_APP_URL",
    "RECEIPT_BASE_URL",
    "ATTESTATION_PRIVATE_KEY",
    "PROTOCOL_TREASURY_ADDRESS",
    "USDC_ADDRESS",
    "TIP_CONTRACT_ADDRESS",
    "FACTORY_ADDRESS",
    "INDEXER_START_BLOCK",
  ];
  if (!process.env.RPC_URL && !process.env.ARC_RPC_URL) required.push("RPC_URL");

  const missing = [
    ...required.filter((key) => !process.env[key]),
    missingAnyEnv("X auth client id", ["X_AUTH_CLIENT_ID", "X_CLIENT_ID"]),
    missingAnyEnv("X auth bearer token", ["X_AUTH_BEARER_TOKEN", "X_BEARER_TOKEN"]),
    xOAuthClientAuth === "none"
      ? null
      : missingAnyEnv("X auth client secret", ["X_AUTH_CLIENT_SECRET", "X_CLIENT_SECRET"]),
  ].filter(Boolean) as string[];
  if (missing.length) {
    throw new Error(`Production backend is missing required env: ${missing.join(", ")}`);
  }

  if (!configuredCorsOrigins().length) {
    throw new Error("Production backend requires at least one configured CORS origin.");
  }

  for (const key of ["CORS_ORIGIN", "CORS_ORIGINS", "CHROME_EXTENSION_ORIGINS", "WEB_APP_URL", "RECEIPT_BASE_URL"]) {
    if (splitCsv(process.env[key]).some((value) => LOCAL_URL_RE.test(value))) {
      throw new Error(`Production backend cannot use a localhost ${key}.`);
    }
  }
  const xRedirectUri = process.env.X_AUTH_REDIRECT_URI || process.env.X_REDIRECT_URI;
  if (!xRedirectUri) {
    throw new Error("Production backend requires X_AUTH_REDIRECT_URI.");
  }
  try {
    const redirectUrl = new URL(xRedirectUri);
    const webUrl = new URL(process.env.WEB_APP_URL!);
    if (redirectUrl.protocol !== "https:") {
      throw new Error("Production X_AUTH_REDIRECT_URI must use https.");
    }
    if (redirectUrl.origin === webUrl.origin) {
      throw new Error("Production X_AUTH_REDIRECT_URI must point to the backend/API origin, not the web frontend origin.");
    }
    if (redirectUrl.pathname !== "/auth/x/callback") {
      throw new Error("Production X_AUTH_REDIRECT_URI must end with /auth/x/callback.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid URL";
    throw new Error(`Production backend has an invalid X_AUTH_REDIRECT_URI: ${message}`);
  }
  if (process.env.ENABLE_FAUCET === "true") {
    throw new Error("Production backend cannot enable ENABLE_FAUCET.");
  }
  if (process.env.ALLOW_CLIENT_ACTIVITY_WRITES === "true") {
    throw new Error("Production backend cannot enable ALLOW_CLIENT_ACTIVITY_WRITES.");
  }
  if (process.env.ALLOW_INSECURE_RPC_TLS === "true") {
    throw new Error("Production backend cannot enable ALLOW_INSECURE_RPC_TLS.");
  }
  if (process.env.ALLOW_INSECURE_OEMBED_TLS === "true") {
    throw new Error("Production backend cannot enable ALLOW_INSECURE_OEMBED_TLS.");
  }
  if (process.env.ALLOW_INSECURE_AVATAR_TLS === "true") {
    throw new Error("Production backend cannot enable ALLOW_INSECURE_AVATAR_TLS.");
  }
  if (process.env.ALLOW_UNSIGNED_REFERRAL_WRITES === "true" || process.env.ALLOW_UNSIGNED_ATTESTATION === "true") {
    throw new Error("Production backend cannot allow unsigned writes or attestations.");
  }
  if (process.env.ENABLE_DEFI_TRANSACTIONS === "true") {
    const defiRequired = ["DEFI_STRATEGIES_JSON"];
    const missingDefi = defiRequired.filter((key) => !process.env[key]);
    if (missingDefi.length) {
      throw new Error(`Production DeFi transactions are enabled but missing env: ${missingDefi.join(", ")}`);
    }
  }
  if (process.env.WITHDRAWAL_REQUIRE_EMAIL_CONFIRMATION !== "false" && !process.env.WITHDRAWAL_EMAIL_WEBHOOK_URL) {
    throw new Error("Production backend requires WITHDRAWAL_EMAIL_WEBHOOK_URL when withdrawal email confirmation is enabled.");
  }
  const crossmintEnabled = process.env.CROSSMINT_ENABLE_ONRAMP === "true" || process.env.CROSSMINT_ENABLE_OFFRAMP === "true";
  if (crossmintEnabled) {
    if (!process.env.CROSSMINT_SERVER_API_KEY) {
      throw new Error("Production Crossmint staging requires CROSSMINT_SERVER_API_KEY.");
    }
    if (process.env.CROSSMINT_ENV === "production" && process.env.CROSSMINT_ALLOW_PRODUCTION !== "true") {
      throw new Error("Crossmint production is blocked until CROSSMINT_ALLOW_PRODUCTION=true.");
    }
    if ((process.env.CROSSMINT_ENV || "staging") === "staging") {
      const baseUrl = process.env.CROSSMINT_API_BASE_URL || "https://staging.crossmint.com";
      try {
        const parsed = new URL(baseUrl);
        if (parsed.hostname !== "staging.crossmint.com") {
          throw new Error("CROSSMINT_ENV=staging must use staging.crossmint.com.");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid URL";
        throw new Error(`Production Crossmint staging URL is invalid: ${message}`);
      }
    }
    if (process.env.CROSSMINT_ENABLE_OFFRAMP === "true" && !process.env.CROSSMINT_OFFRAMP_ORDER_BODY_TEMPLATE) {
      throw new Error("Crossmint off-ramp requires CROSSMINT_OFFRAMP_ORDER_BODY_TEMPLATE.");
    }
  }
  if (!process.env.OPS_TOKEN) {
    throw new Error("Production backend requires OPS_TOKEN.");
  }
}

assertProductionEnv();

const app = express();
app.disable("x-powered-by");
const trustProxy =
  process.env.NODE_ENV === "production" || process.env.TRUST_PROXY === "true"
    ? 1
    : false;
app.set("trust proxy", trustProxy);

// Middleware
app.use(helmet() as any);
app.use(cors(corsOptions) as any);
app.options("*", cors(corsOptions) as any);
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "64kb" }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: Number(process.env.RATE_LIMIT_MAX || 100),
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.AUTH_RATE_LIMIT_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
});
const writeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.WRITE_RATE_LIMIT_MAX || 60),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "GET",
  handler: (_req, res) => {
    res.status(429).json({
      error: "Too many write attempts. Wait a moment and try again.",
      code: "WRITE_RATE_LIMIT",
    });
  },
});
const withdrawalLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.WITHDRAWAL_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === "GET",
  handler: (_req, res) => {
    res.status(429).json({
      error: "Too many withdrawal attempts. Wait a moment and try again.",
      code: "WITHDRAWAL_RATE_LIMIT",
    });
  },
});

// Routes
app.use("/health", healthRouter);
app.use("/tips", tipsRouter);
app.use("/auth", authLimiter, authRouter);
app.use("/faucet", faucetRouter);
app.use("/referral", writeLimiter, referralRouter);
app.use("/withdrawal", withdrawalLimiter, withdrawalRouter);
app.use("/crossmint", withdrawalLimiter, crossmintRouter);
app.use("/milestones", milestonesRouter);
app.use("/profile", profileRouter);
app.use("/stats", statsRouter);
app.use("/leaderboard", leaderboardRouter);
app.use("/defi", defiRouter);
app.use("/internal/x-bot", xBotInternalRouter);
app.use("/x-balance", xBalanceRouter);

// External API (versioned, documented)
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/v1/profile", apiLimiter, profileRouter);
app.use("/api/ops", opsRouter);
app.use("/api/v1", apiLimiter, apiV1Router);

// Optional production web shell. When web/dist exists, creator profile URLs can
// return crawler-visible OpenGraph/Twitter metadata before the React app hydrates.
mountWebProfileRenderer(app);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[Server] Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// Start
async function main() {
  // Initialize database
  await initDb();

  // Start indexer
  const indexer = new Indexer();
  indexer.start();

  // Start HTTP server
  app.listen(PORT, () => {
    console.log(`[Server] Teep backend running on port ${PORT}`);
    console.log(`[Server] Health: http://localhost:${PORT}/health`);
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[Server] Shutting down...");
    indexer.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[Server] Fatal error:", err);
  process.exit(1);
});
