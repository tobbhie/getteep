import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
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

const PORT = parseInt(process.env.PORT || "3001");
const LOCAL_URL_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i;

function assertProductionEnv() {
  if (process.env.NODE_ENV !== "production") return;

  const required = [
    "CORS_ORIGIN",
    "ATTESTATION_PRIVATE_KEY",
    "X_CLIENT_ID",
    "X_CLIENT_SECRET",
    "X_BEARER_TOKEN",
    "PROTOCOL_TREASURY_ADDRESS",
    "USDC_ADDRESS",
    "TIP_CONTRACT_ADDRESS",
    "FACTORY_ADDRESS",
    "INDEXER_START_BLOCK",
  ];
  if (!process.env.RPC_URL && !process.env.ARC_RPC_URL) required.push("RPC_URL");

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Production backend is missing required env: ${missing.join(", ")}`);
  }

  if (LOCAL_URL_RE.test(process.env.CORS_ORIGIN || "")) {
    throw new Error("Production backend cannot use a localhost CORS_ORIGIN.");
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
  if (process.env.ALLOW_UNSIGNED_REFERRAL_WRITES === "true" || process.env.ALLOW_UNSIGNED_ATTESTATION === "true") {
    throw new Error("Production backend cannot allow unsigned writes or attestations.");
  }
  if (process.env.WITHDRAWAL_REQUIRE_EMAIL_CONFIRMATION !== "false" && !process.env.WITHDRAWAL_EMAIL_WEBHOOK_URL) {
    throw new Error("Production backend requires WITHDRAWAL_EMAIL_WEBHOOK_URL when withdrawal email confirmation is enabled.");
  }
  if (!process.env.OPS_TOKEN) {
    throw new Error("Production backend requires OPS_TOKEN.");
  }
}

assertProductionEnv();

const app = express();
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);

// Middleware
app.use(helmet() as any);
app.use(cors({
  origin: process.env.CORS_ORIGIN || false,
  methods: ["GET", "POST"],
}) as any);
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
});
const withdrawalLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.WITHDRAWAL_RATE_LIMIT_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
});

// Routes
app.use("/health", healthRouter);
app.use("/tips", tipsRouter);
app.use("/auth", authLimiter, authRouter);
app.use("/faucet", faucetRouter);
app.use("/referral", writeLimiter, referralRouter);
app.use("/withdrawal", withdrawalLimiter, withdrawalRouter);
app.use("/milestones", milestonesRouter);
app.use("/profile", profileRouter);
app.use("/stats", statsRouter);
app.use("/leaderboard", leaderboardRouter);
app.use("/ops", opsRouter);

// External API (versioned, documented)
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/v1", apiLimiter, apiV1Router);

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
  initDb();

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
