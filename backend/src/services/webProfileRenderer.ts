import express, { type Express, type NextFunction, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import { getDb } from "../db/database";
import { getUnifiedTipperStats } from "./tipperStats";
import { getPublicCreatorProfileByUsername, type PublicCreatorProfile } from "./publicProfile";
import { getUserSettings, resolveTipperIdentifier } from "./userSettings";
import { isAddress } from "../utils/security";

const RESERVED_TOP_LEVEL_ROUTES = new Set([
  "api",
  "auth",
  "creator",
  "dashboard",
  "defi",
  "faucet",
  "fees",
  "health",
  "leaderboard",
  "milestones",
  "ops",
  "privacy",
  "profile",
  "referral",
  "register",
  "stats",
  "support",
  "t",
  "terms",
  "tips",
  "tx",
  "withdrawal",
  "x",
]);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rawUsd(raw: string): string {
  const amount = Number(raw) / 1e6;
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function displayName(profile: PublicCreatorProfile): string {
  return profile.displayName?.trim() || `@${profile.username}`;
}

function baseUrl(req: Request): string {
  const configured = process.env.WEB_APP_URL || process.env.RECEIPT_BASE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  return `${req.protocol}://${req.get("host")}`.replace(/\/+$/, "");
}

function defaultImageUrl(base: string): string {
  return `${base}/logo.svg`;
}

function profileImageUrl(profile: PublicCreatorProfile, base: string): string {
  return profile.profileImageUrl || defaultImageUrl(base);
}

function profileDescription(profile: PublicCreatorProfile): string {
  const name = displayName(profile);
  if (profile.tipCount > 0) {
    return `Support ${name} on Teep. They have received $${rawUsd(profile.totalReceived)} across ${profile.tipCount.toLocaleString()} tips from their community.`;
  }
  return `Be among the first to support ${name} on Teep, where creators receive, withdraw, re-tip, and grow from one simple account.`;
}

function metaTag(attr: "name" | "property", key: string, content: string): string {
  return `<meta ${attr}="${escapeHtml(key)}" content="${escapeHtml(content)}" />`;
}

function creatorMetaBlock(profile: PublicCreatorProfile, req: Request): string {
  const base = baseUrl(req);
  const name = displayName(profile);
  const title = `Support ${name} on Teep`;
  const description = profileDescription(profile);
  const canonical = `${base}/creator/${encodeURIComponent(profile.username)}`;
  const image = profileImageUrl(profile, base);

  return [
    `<title>${escapeHtml(title)}</title>`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    metaTag("name", "description", description),
    metaTag("name", "robots", "index, follow"),
    metaTag("property", "og:site_name", "Teep"),
    metaTag("property", "og:title", title),
    metaTag("property", "og:description", description),
    metaTag("property", "og:url", canonical),
    metaTag("property", "og:type", "profile"),
    metaTag("property", "og:image", image),
    metaTag("property", "og:image:alt", `${name}'s creator profile on Teep`),
    metaTag("property", "profile:username", profile.username),
    metaTag("name", "twitter:card", "summary"),
    metaTag("name", "twitter:title", title),
    metaTag("name", "twitter:description", description),
    metaTag("name", "twitter:image", image),
    metaTag("name", "twitter:image:alt", `${name}'s creator profile on Teep`),
    metaTag("name", "twitter:creator", `@${profile.username.replace(/^@/, "")}`),
  ].join("\n    ");
}

async function receiptMetaBlock(txHash: string, req: Request): Promise<string> {
  const base = baseUrl(req);
  const canonical = `${base}/tx/${encodeURIComponent(txHash)}`;
  const db = getDb();
  let tip = await db
    .prepare(
      `SELECT t.amount, t.tx_hash, t.from_address, t.author_id, t.timestamp, m.author_handle
       FROM tips t
       LEFT JOIN tip_metadata m ON t.content_id = m.content_id
       WHERE LOWER(t.tx_hash) = LOWER(?)
       ORDER BY t.timestamp DESC
       LIMIT 1`,
    )
    .get(txHash) as
      | { amount: string; tx_hash: string; from_address: string; author_id: string; timestamp: number; author_handle: string | null }
      | undefined;
  if (!tip) {
    tip = await db
      .prepare(
        `SELECT amount_raw as amount,
                tx_hash,
                sender_address as from_address,
                recipient_x_user_id as author_id,
                CAST(created_at / 1000 AS INTEGER) as timestamp,
                recipient_x_username as author_handle
         FROM x_bot_tips
         WHERE LOWER(tx_hash) = LOWER(?)
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(txHash) as
      | { amount: string; tx_hash: string; from_address: string; author_id: string; timestamp: number; author_handle: string | null }
      | undefined;
  }

  const fallbackTitle = "Teep receipt";
  if (!tip) {
    return [
      `<title>${escapeHtml(fallbackTitle)}</title>`,
      `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
      metaTag("name", "description", "View this Teep receipt."),
      metaTag("name", "robots", "noindex, follow"),
      metaTag("property", "og:site_name", "Teep"),
      metaTag("property", "og:title", fallbackTitle),
      metaTag("property", "og:description", "View this Teep receipt."),
      metaTag("property", "og:url", canonical),
      metaTag("property", "og:type", "website"),
      metaTag("property", "og:image", defaultImageUrl(base)),
      metaTag("name", "twitter:card", "summary"),
      metaTag("name", "twitter:title", fallbackTitle),
      metaTag("name", "twitter:description", "View this Teep receipt."),
    ].join("\n    ");
  }

  const claim = tip.author_handle
    ? await db
        .prepare(
          `SELECT username
           FROM verified_claims
           WHERE author_id = ? OR LOWER(username) = LOWER(?)
           ORDER BY CASE WHEN author_id = ? THEN 0 ELSE 1 END, verified_at DESC
           LIMIT 1`,
        )
        .get(tip.author_id, tip.author_handle, tip.author_id) as { username: string } | undefined
    : await db
        .prepare(
          `SELECT username
           FROM verified_claims
           WHERE author_id = ?
           ORDER BY verified_at DESC
           LIMIT 1`,
        )
        .get(tip.author_id) as { username: string } | undefined;
  const settings = await getUserSettings(tip.from_address);
  const creatorHandle = (claim?.username || tip.author_handle || "creator").replace(/^@/, "");
  const amount = `$${rawUsd(tip.amount)}`;
  const title = settings.receipts.shareAmountEnabled
    ? `@${creatorHandle} received ${amount} on Teep`
    : `@${creatorHandle} received a tip on Teep`;
  const description = settings.receipts.shareAmountEnabled
    ? `View the Teep receipt for a ${amount} creator support payment.`
    : "View the Teep receipt for this creator support payment.";

  return [
    `<title>${escapeHtml(title)}</title>`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    metaTag("name", "description", description),
    metaTag("name", "robots", "index, follow"),
    metaTag("property", "og:site_name", "Teep"),
    metaTag("property", "og:title", title),
    metaTag("property", "og:description", description),
    metaTag("property", "og:url", canonical),
    metaTag("property", "og:type", "article"),
    metaTag("property", "og:image", defaultImageUrl(base)),
    metaTag("name", "twitter:card", "summary"),
    metaTag("name", "twitter:title", title),
    metaTag("name", "twitter:description", description),
    metaTag("name", "twitter:image", defaultImageUrl(base)),
  ].join("\n    ");
}

async function tipperMetaBlock(address: string, req: Request): Promise<string> {
  const base = baseUrl(req);
  const canonical = `${base}/tipper/${encodeURIComponent(address)}`;
  const stats = await getUnifiedTipperStats(address);
  const settings = await getUserSettings(address);
  const publicName = settings.socialXHandle || settings.username || "Teep supporter";
  const identity = publicName.startsWith("@") || publicName === "Teep supporter" ? publicName : `@${publicName}`;
  const total = `$${rawUsd(stats.totalSent)}`;
  const title = `${identity} supports creators on Teep`;
  const description = `${identity} has sent ${total} across ${stats.tipCount.toLocaleString()} tips to ${stats.creatorsSupported.length.toLocaleString()} creators.`;

  return [
    `<title>${escapeHtml(title)}</title>`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    metaTag("name", "description", description),
    metaTag("name", "robots", settings.privacy.privateActivity ? "noindex, follow" : "index, follow"),
    metaTag("property", "og:site_name", "Teep"),
    metaTag("property", "og:title", title),
    metaTag("property", "og:description", description),
    metaTag("property", "og:url", canonical),
    metaTag("property", "og:type", "profile"),
    metaTag("property", "og:image", defaultImageUrl(base)),
    metaTag("name", "twitter:card", "summary"),
    metaTag("name", "twitter:title", title),
    metaTag("name", "twitter:description", description),
    metaTag("name", "twitter:image", defaultImageUrl(base)),
  ].join("\n    ");
}

function notFoundMetaBlock(username: string, req: Request): string {
  const base = baseUrl(req);
  const canonical = `${base}/${encodeURIComponent(username)}`;
  const title = "Creator profile not found on Teep";
  const description = "This Teep creator profile is not available yet.";
  return [
    `<title>${escapeHtml(title)}</title>`,
    `<link rel="canonical" href="${escapeHtml(canonical)}" />`,
    metaTag("name", "description", description),
    metaTag("name", "robots", "noindex, follow"),
    metaTag("property", "og:site_name", "Teep"),
    metaTag("property", "og:title", title),
    metaTag("property", "og:description", description),
    metaTag("property", "og:url", canonical),
    metaTag("property", "og:type", "website"),
    metaTag("name", "twitter:card", "summary"),
    metaTag("name", "twitter:title", title),
    metaTag("name", "twitter:description", description),
  ].join("\n    ");
}

function stripDefaultMeta(html: string): string {
  return html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, "")
    .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, "")
    .replace(/<meta\s+(?:name|property)=["'](?:description|robots|og:[^"']+|twitter:[^"']+|profile:[^"']+)["'][^>]*>\s*/gi, "");
}

function injectMeta(indexHtml: string, metaBlock: string): string {
  const html = stripDefaultMeta(indexHtml);
  return html.replace(/<head>/i, `<head>\n    ${metaBlock}`);
}

function setWebShellHeaders(res: Response): void {
  res.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "style-src-attr 'unsafe-inline'",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' https: data: blob:",
      "connect-src 'self' https: wss:",
      "frame-src 'self' https:",
      "form-action 'self'",
    ].join("; "),
  );
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "SAMEORIGIN");
}

function webDistCandidates(): string[] {
  return [
    ...(process.env.WEB_DIST_DIR ? [path.resolve(process.env.WEB_DIST_DIR)] : []),
    path.resolve(process.cwd(), "web/dist"),
    path.resolve(process.cwd(), "../web/dist"),
    path.resolve(__dirname, "../../web/dist"),
    path.resolve(__dirname, "../../../web/dist"),
  ];
}

function resolveWebDistDir(): string | null {
  for (const candidate of webDistCandidates()) {
    if (fs.existsSync(path.join(candidate, "index.html"))) return candidate;
  }
  return null;
}

function isTopLevelCreatorPath(reqPath: string): string | null {
  const cleanPath = reqPath.split("?")[0].replace(/^\/+|\/+$/g, "");
  if (!cleanPath || cleanPath.includes("/") || cleanPath.includes(".")) return null;
  const username = cleanPath.replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,30}$/.test(username)) return null;
  if (RESERVED_TOP_LEVEL_ROUTES.has(username)) return null;
  return username;
}

export function mountWebProfileRenderer(app: Express): void {
  const webDistDir = resolveWebDistDir();
  if (!webDistDir) {
    console.warn("[Web] web/dist/index.html not found; server-side profile metadata is disabled until the web app is built.");
    return;
  }

  const indexHtml = fs.readFileSync(path.join(webDistDir, "index.html"), "utf8");

  app.use(express.static(webDistDir, {
    index: false,
    maxAge: "1y",
    immutable: true,
  }));

  function sendGenericShell(req: Request, res: Response) {
    res.set("Cache-Control", "public, max-age=60");
    setWebShellHeaders(res);
    res.status(200).type("html").send(indexHtml);
  }

  app.get(
    [
      "/",
      "/dashboard",
      "/dashboard/withdraw",
      "/dashboard/discover",
      "/dashboard/referrals",
      "/dashboard/settings",
      "/dashboard/grow-tips",
      "/creator/dashboard",
      "/creator/withdraw",
      "/creator/settings",
      "/creator/referrals",
      "/creator/performance",
      "/creator/grow/earn",
      "/creator/grow/learn",
      "/creator/grow/settings",
      "/leaderboard",
      "/fees",
      "/fund",
      "/ops",
      "/ops/dashboard",
      "/register",
      "/terms",
      "/privacy",
      "/support",
    ],
    (req: Request, res: Response, next: NextFunction) => {
    if (!req.accepts("html")) {
      next();
      return;
    }
    sendGenericShell(req, res);
    },
  );

  app.get("/x/:receiptId", (req: Request, res: Response, next: NextFunction) => {
    if (!req.accepts("html")) {
      next();
      return;
    }
    const receiptId = String(req.params.receiptId || "").trim();
    if (!/^[a-f0-9]{16}$/i.test(receiptId)) {
      next();
      return;
    }
    sendGenericShell(req, res);
  });

  app.get("/tx/:txHash", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.accepts("html")) {
      next();
      return;
    }
    const txHash = String(req.params.txHash || "").trim();
    if (!/^0x[a-f0-9]{16,}$/i.test(txHash)) {
      next();
      return;
    }
    const html = injectMeta(indexHtml, await receiptMetaBlock(txHash, req));
    res.set("Cache-Control", "public, max-age=60");
    setWebShellHeaders(res);
    res.status(200).type("html").send(html);
  });

  async function sendTipperShell(identifier: string, req: Request, res: Response, next: NextFunction) {
    if (!req.accepts("html")) {
      next();
      return;
    }
    const address = await resolveTipperIdentifier(identifier);
    if (!address) {
      next();
      return;
    }
    const html = injectMeta(indexHtml, await tipperMetaBlock(address, req));
    res.set("Cache-Control", "public, max-age=60");
    setWebShellHeaders(res);
    res.status(200).type("html").send(html);
  }

  app.get("/tipper/:identifier", async (req: Request, res: Response, next: NextFunction) => {
    await sendTipperShell(String(req.params.identifier || ""), req, res, next);
  });

  app.get("/profile/tipper/:address", async (req: Request, res: Response, next: NextFunction) => {
    await sendTipperShell(String(req.params.address || ""), req, res, next);
  });

  async function sendCreatorShell(username: string, req: Request, res: Response) {
    const profile = await getPublicCreatorProfileByUsername(username);
    const html = injectMeta(indexHtml, profile ? creatorMetaBlock(profile, req) : notFoundMetaBlock(username, req));
    res.set("Cache-Control", profile ? "public, max-age=60" : "public, max-age=300");
    setWebShellHeaders(res);
    res.status(profile ? 200 : 404).type("html").send(html);
  }

  app.get("/creator/:username", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.accepts("html")) {
      next();
      return;
    }
    const username = String(req.params.username || "").trim().replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{1,30}$/.test(username)) {
      next();
      return;
    }
    await sendCreatorShell(username, req, res);
  });

  app.get("/u/:id", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.accepts("html")) {
      next();
      return;
    }
    const id = String(req.params.id || "").trim();
    if (isAddress(id)) {
      await sendTipperShell(id, req, res, next);
      return;
    }
    const username = id.replace(/^@/, "").toLowerCase();
    if (!/^[a-z0-9_]{1,30}$/.test(username)) {
      next();
      return;
    }
    await sendCreatorShell(username, req, res);
  });

  app.get("/:username", async (req: Request, res: Response, next: NextFunction) => {
    if (!req.accepts("html")) {
      next();
      return;
    }

    const username = isTopLevelCreatorPath(req.path);
    if (!username) {
      next();
      return;
    }

    const profile = await getPublicCreatorProfileByUsername(username);
    if (!profile) {
      await sendCreatorShell(username, req, res);
      return;
    }
    res.redirect(308, `/creator/${encodeURIComponent(profile.username)}`);
  });
}
