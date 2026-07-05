import { useEffect, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { buildFundingPolicy, getTeepActivityTypeLabel } from "@teep/shared";
import * as QRCode from "qrcode";
import { parseUnits } from "viem";
import { arcTestnet } from "../chains";
import { computeDirectCreatorContentId, encodeApproveCall, encodeTipCall, TIP_CONTRACT_ADDRESS } from "../lib/contracts";
import { avatarErrorFallback, creatorAvatarUrl, localInitialsAvatar } from "../lib/avatar";
import DashboardShell from "../components/DashboardShell";
import { DashboardConnectPage } from "../components/DashboardAuthState";
import CreatorClaimPrompt from "../components/dashboard/CreatorClaimPrompt";
import TeepTipModal from "../components/TeepTipModal";
import { useAccountRole } from "../context/AccountRoleContext";
import {
  clearPendingReferralCode,
  normalizeReferralCode,
  readPendingReferralCode,
  referralAppliedKey,
  referralAttemptKey,
} from "../lib/referral";
import {
  API_BASE,
  ENABLE_FIAT_OFFRAMP,
  ENABLE_FIAT_ONRAMP,
  FAUCET_URL,
  FUNDING_ENV,
  OFFRAMP_URL,
  ONRAMP_URL,
  RECEIPT_BASE_URL,
  USDC_ADDRESS,
  WEB_APP_URL,
} from "../config";

/** Format raw USDC (6 decimals) to USD string */
function formatUsdRaw(raw: string): string {
  const n = Number(raw) / 1e6;
  if (isNaN(n)) return "0.00";
  return n.toFixed(2);
}

const HISTORY_PAGE_SIZE = 7;
const CREATOR_TIPS_PAGE_SIZE = 5;

function buildReceiptTweetText(params: { amount: string; authorHandle?: string; tweetId?: string; txHash?: string; shareAmount?: boolean }): string {
  const amount = params.amount.replace(/^\$/, "");
  const handle = params.authorHandle?.replace(/^@/, "");
  const postUrl = handle && params.tweetId ? `https://x.com/${handle}/status/${params.tweetId}` : "";
  const receiptUrl = params.txHash ? `${RECEIPT_BASE_URL}/tx/${params.txHash}` : WEB_APP_URL;
  const amountPart = params.shareAmount === false ? "" : ` $${amount}`;
  const receiptPart = `\n\nReceipt: ${receiptUrl}`;
  if (handle) {
    const line1 = postUrl
      ? `Hey @${handle}, just tipped you${amountPart} via Teep for this wonderful piece: ${postUrl}`
      : `Hey @${handle}, just tipped you${amountPart} via Teep`;
    return `${line1}${receiptPart}\nSupport creators directly via @teepxyz.`;
  }
  return `I just tipped${amountPart} via Teep.${receiptPart}\nSupport creators directly via @teepxyz.`;
}

function safeAddress(address?: string): string | null {
  if (!address) return null;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

type AddressIdentity = {
  displayName?: string | null;
  truncatedAddress?: string | null;
  teepUsername?: string | null;
  socialXHandle?: string | null;
  creatorUsername?: string | null;
  creatorDisplayName?: string | null;
};

function displayAddressName(_address?: string, identity?: AddressIdentity | null) {
  return identity?.displayName || identity?.creatorDisplayName || "Teep supporter";
}

function initialsForIdentity(address?: string, identity?: AddressIdentity | null) {
  const label = displayAddressName(address, identity).replace(/^@/, "");
  return label.slice(0, 2).toUpperCase();
}

function formatHistoryTime(timestamp: number) {
  if (!timestamp) return "Just now";
  const millis = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
  return new Date(millis).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  if (line) ctx.fillText(line, x, y);
}

async function drawReceiptQr(ctx: CanvasRenderingContext2D, receiptUrl: string, x: number, y: number, size: number) {
  if (!receiptUrl) return;
  const qrCanvas = document.createElement("canvas");
  qrCanvas.width = size;
  qrCanvas.height = size;
  try {
    await QRCode.toCanvas(qrCanvas, receiptUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: size,
      color: {
        dark: "#111111",
        light: "#ffffff",
      },
    });
    ctx.drawImage(qrCanvas, x, y, size, size);
  } catch {
    ctx.fillStyle = "rgba(205,189,255,0.16)";
    roundRect(ctx, x, y, size, size, 18);
    ctx.fill();
  }
}

function receiptInitial(value?: string) {
  const clean = (value || "T").replace(/^@/, "").trim();
  return clean.slice(0, 2).toUpperCase() || "T";
}

async function renderMinimalReceiptImage(
  ctx: CanvasRenderingContext2D,
  receiptUrl: string,
  params: { amount: string; title: string; subtitle: string; from?: string; to?: string; date: string },
): Promise<string> {
  const canvas = ctx.canvas;
  const from = params.from || "You";
  const to = params.to || "Creator";

  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 150, 150, 780, 780, 30);
  ctx.fill();
  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 3;
  roundRect(ctx, 150, 150, 780, 780, 30);
  ctx.stroke();

  ctx.fillStyle = "#111111";
  ctx.font = "900 36px Inter, system-ui, sans-serif";
  ctx.fillText("Teep", 205, 238);
  ctx.fillStyle = "#7c3aed";
  ctx.font = "800 18px Inter, system-ui, sans-serif";
  ctx.fillText("RECEIPT", 205, 274);

  ctx.fillStyle = "#111111";
  ctx.font = "900 82px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`$${params.amount}`, 875, 265);
  ctx.textAlign = "left";

  ctx.strokeStyle = "#eee9f8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(205, 325);
  ctx.lineTo(875, 325);
  ctx.stroke();

  ctx.fillStyle = "#111111";
  ctx.font = "900 34px Inter, system-ui, sans-serif";
  ctx.fillText(`${params.title} sent`, 205, 385);
  ctx.fillStyle = "#55505f";
  ctx.font = "500 22px Inter, system-ui, sans-serif";
  wrapCanvasText(ctx, params.subtitle || "You supported a creator and helped fuel the social internet.", 205, 425, 620, 31);

  const avatarY = 580;
  ctx.fillStyle = "#f4f0ff";
  ctx.beginPath();
  ctx.arc(300, avatarY, 50, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#7c3aed";
  ctx.beginPath();
  ctx.arc(300, avatarY, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 23px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(receiptInitial(from), 300, avatarY + 8);

  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(390, avatarY);
  ctx.lineTo(690, avatarY);
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(540, avatarY, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#7c3aed";
  ctx.font = "800 29px Inter, system-ui, sans-serif";
  ctx.fillText(">", 540, avatarY + 10);

  ctx.fillStyle = "#f4f0ff";
  ctx.beginPath();
  ctx.arc(780, avatarY, 50, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#7c3aed";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#111111";
  ctx.beginPath();
  ctx.arc(780, avatarY, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 23px Inter, system-ui, sans-serif";
  ctx.fillText(receiptInitial(to), 780, avatarY + 8);

  ctx.fillStyle = "#111111";
  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.fillText(from, 300, 665);
  ctx.fillText(to, 780, 665);
  ctx.textAlign = "left";

  ctx.strokeStyle = "#eee9f8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(205, 710);
  ctx.lineTo(875, 710);
  ctx.stroke();

  ctx.fillStyle = "#6b6478";
  ctx.font = "500 21px Inter, system-ui, sans-serif";
  ctx.fillText("Date", 205, 770);
  ctx.fillStyle = "#111111";
  ctx.font = "650 21px Inter, system-ui, sans-serif";
  ctx.fillText(params.date, 205, 807);

  ctx.fillStyle = "#f8f7fb";
  roundRect(ctx, 718, 730, 132, 132, 18);
  ctx.fill();
  await drawReceiptQr(ctx, receiptUrl, 728, 740, 112);
  ctx.fillStyle = "#7c3aed";
  ctx.font = "750 20px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Scan to view", 784, 894);
  ctx.textAlign = "left";

  ctx.fillStyle = "#ffffff";
  ctx.font = "800 24px Inter, system-ui, sans-serif";
  ctx.fillText("Support creators directly via @teepxyz", 150, 990);
  ctx.fillStyle = "#a78bfa";
  ctx.font = "700 21px Inter, system-ui, sans-serif";
  ctx.fillText("https://getteep.xyz", 150, 1028);

  return canvas.toDataURL("image/png");
}

async function generateReceiptImage(params: { amount: string; title: string; subtitle: string; from?: string; to?: string; txHash?: string; txUrl?: string; date: string; kind: string }): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d")!;
  const receiptUrl = params.txUrl || "https://getteep.xyz";
  return renderMinimalReceiptImage(ctx, receiptUrl, params);
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1350);
  gradient.addColorStop(0, "#08070d");
  gradient.addColorStop(0.58, "#160d26");
  gradient.addColorStop(1, "#050506");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1350);

  ctx.fillStyle = "rgba(127, 74, 255, 0.16)";
  ctx.beginPath();
  ctx.arc(940, 135, 240, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0, 214, 143, 0.10)";
  ctx.beginPath();
  ctx.arc(65, 970, 270, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(20,18,28,0.94)";
  roundRect(ctx, 140, 185, 800, 710, 34);
  ctx.fill();
  ctx.strokeStyle = "rgba(205,189,255,0.14)";
  ctx.lineWidth = 2;
  roundRect(ctx, 140, 185, 800, 710, 34);
  ctx.stroke();

  const cardGlow = ctx.createLinearGradient(140, 185, 940, 185);
  cardGlow.addColorStop(0, "rgba(255,255,255,0.02)");
  cardGlow.addColorStop(1, "rgba(99,36,235,0.14)");
  ctx.fillStyle = cardGlow;
  roundRect(ctx, 140, 185, 800, 710, 34);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.fillRect(140, 350, 800, 1);
  ctx.fillRect(140, 672, 800, 1);

  ctx.fillStyle = "rgba(16,185,129,0.14)";
  ctx.beginPath();
  ctx.arc(242, 270, 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#10b981";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(242, 270, 13, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(235, 271);
  ctx.lineTo(240, 276);
  ctx.lineTo(251, 263);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.font = "900 34px Inter, system-ui, sans-serif";
  ctx.fillText(`${params.title} sent!`, 310, 253);
  ctx.fillStyle = "rgba(230,224,239,0.86)";
  ctx.font = "500 22px Inter, system-ui, sans-serif";
  wrapCanvasText(ctx, params.subtitle || "You supported a creator and helped fuel the social internet.", 310, 292, 380, 31);

  ctx.fillStyle = "#cdbdff";
  ctx.font = "900 52px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`$${params.amount}`, 880, 285);
  ctx.textAlign = "left";

  const from = params.from || "You";
  const to = params.to || "Creator";
  const avatarY = 470;
  ctx.fillStyle = "#15111d";
  ctx.beginPath();
  ctx.arc(285, avatarY, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#7c3aed";
  ctx.beginPath();
  ctx.arc(285, avatarY, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 23px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(receiptInitial(from), 285, avatarY + 8);

  ctx.strokeStyle = "rgba(169,137,255,0.62)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(395, avatarY);
  ctx.lineTo(685, avatarY);
  ctx.stroke();
  ctx.fillStyle = "#211e29";
  ctx.beginPath();
  ctx.arc(540, avatarY, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(205,189,255,0.32)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#cdbdff";
  ctx.font = "800 29px Inter, system-ui, sans-serif";
  ctx.fillText("→", 540, avatarY + 10);

  ctx.fillStyle = "#15111d";
  ctx.beginPath();
  ctx.arc(795, avatarY, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#cdbdff";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = "#0f766e";
  ctx.beginPath();
  ctx.arc(795, avatarY, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "900 23px Inter, system-ui, sans-serif";
  ctx.fillText(receiptInitial(to), 795, avatarY + 8);

  ctx.font = "700 22px Inter, system-ui, sans-serif";
  ctx.fillText(from, 285, 575);
  ctx.fillText(to, 795, 575);
  ctx.textAlign = "left";

  ctx.fillStyle = "rgba(255,255,255,0.04)";
  roundRect(ctx, 735, 716, 140, 140, 22);
  ctx.fill();
  await drawReceiptQr(ctx, receiptUrl, 746, 727, 118);

  ctx.fillStyle = "rgba(230,224,239,0.70)";
  ctx.font = "500 21px Inter, system-ui, sans-serif";
  ctx.fillText("Date", 202, 760);
  ctx.fillStyle = "#ffffff";
  ctx.font = "650 21px Inter, system-ui, sans-serif";
  ctx.fillText(params.date, 202, 800);
  ctx.fillStyle = "rgba(230,224,239,0.70)";
  ctx.font = "500 21px Inter, system-ui, sans-serif";
  ctx.fillText("Receipt", 202, 840);
  ctx.fillStyle = "#cdbdff";
  ctx.font = "750 20px Inter, system-ui, sans-serif";
  ctx.fillText("Scan to view", 202, 880);

  ctx.fillStyle = "#22c55e";
  ctx.font = "900 24px Inter, system-ui, sans-serif";
  ctx.fillText("Support creators directly via @teepxyz", 140, 965);
  ctx.fillStyle = "rgba(226,232,240,0.72)";
  ctx.font = "700 21px Inter, system-ui, sans-serif";
  ctx.fillText("https://getteep.xyz", 140, 1004);
  return canvas.toDataURL("image/png");
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadActivityCsv(items: HistoryItem[]) {
  const rows = [
    ["date", "type", "creator_handle", "amount_usd", "status", "post_url", "receipt_url", "tx_hash"],
    ...items.map((item) => {
      const handle = item.author_handle?.replace(/^@/, "") || "";
      const postUrl = handle && item.tweet_id ? `https://x.com/${handle}/status/${item.tweet_id}` : "";
      const receiptUrl = item.tx_hash ? `${RECEIPT_BASE_URL}/tx/${item.tx_hash}` : "";
      return [
        formatHistoryTime(item.timestamp),
        getTeepActivityTypeLabel(item.type),
        handle ? `@${handle}` : item.detail || "",
        formatUsdRaw(item.amount),
        item.tx_hash ? "teep_receipt_ready" : "sent",
        postUrl,
        receiptUrl,
        item.tx_hash || "",
      ];
    }),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `teep-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

interface HistoryItem {
  type: string;
  amount: string;
  tx_hash?: string;
  timestamp: number;
  author_handle?: string;
  profileImageUrl?: string | null;
  tweet_id?: string;
  from_addr?: string;
  from_address?: string;
  fromIdentity?: AddressIdentity | null;
  to_address?: string;
  detail?: string;
}

interface TipperCreator {
  authorId?: string;
  username: string | null;
  profileImageUrl?: string | null;
  totalRaw?: string;
  total?: string;
  tipCount?: number;
  isVerified?: boolean;
  claimWalletDeployed?: boolean;
  claimStatus?: "unclaimed" | "verified" | "claim_wallet_active";
}

interface DiscoverCreator {
  authorId: string;
  username: string | null;
  displayName?: string | null;
  profileImageUrl?: string | null;
  totalReceivedUsd?: string;
  tipCount?: number;
  rank?: number;
}

interface CreatorData {
  username: string;
  totalReceivedUsd: string;
  tipCount: number;
  topPosts: Array<{
    contentId: string;
    totalUsd: string;
    count: number;
    tweetId: string | null;
    authorHandle: string | null;
  }>;
  topSupporters: Array<{ address: string; totalUsd: string } & AddressIdentity>;
  recentTips?: HistoryItem[];
}

interface EarningsDaily {
  date: string;
  amountUsd: string;
}

type PostPreview = {
  excerpt: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
  unavailable?: boolean;
};

function normalizeRawUsd(raw: string | number | undefined | null) {
  return formatUsdRaw(String(raw ?? "0"));
}

function money(value: string | number | undefined | null) {
  const amount = Number(value ?? 0);
  return `$${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function shortDate(value: string) {
  if (!value) return "";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function postDisplayLabel(post: CreatorData["topPosts"][number]) {
  if (post.tweetId) return `Post #${post.tweetId.slice(-6)}...`;
  return `Content ${post.contentId.slice(-6)}`;
}

function DashboardDataSkeleton({ mode = "tipper" }: { mode?: DashboardMode }) {
  const isCreatorView = mode === "creator";
  if (isCreatorView) {
    return (
      <DashboardShell title="Creator Dashboard">
        <div className="dashboard-body-inner creator-overview" aria-busy="true">
          <section className="creator-overview-hero-grid">
            <div className="creator-overview-hero dashboard-card">
              <div>
                <span className="dashboard-skeleton-line dashboard-skeleton-line--subtitle" style={{ width: 150, height: 12 }} />
                <span className="dashboard-skeleton-line dashboard-skeleton-line--title" style={{ width: "min(340px, 70%)", height: 64, marginTop: "var(--space-3)" }} />
                <span className="dashboard-skeleton-line dashboard-skeleton-line--subtitle" style={{ width: "min(520px, 88%)", marginTop: "var(--space-4)" }} />
                <div className="creator-overview-actions">
                  <span className="dashboard-skeleton-line" style={{ width: 96, height: 44 }} />
                  <span className="dashboard-skeleton-line" style={{ width: 116, height: 44 }} />
                  <span className="dashboard-skeleton-avatar" style={{ width: 44, height: 44, borderRadius: "var(--radius-md)" }} />
                </div>
              </div>
              <div className="creator-overview-balance-split">
                <span className="dashboard-skeleton-card" style={{ minHeight: 116 }} />
                <span className="dashboard-skeleton-card" style={{ minHeight: 116 }} />
              </div>
            </div>

            <aside className="creator-readiness-card dashboard-card">
              <div className="creator-section-head">
                <span className="dashboard-skeleton-line dashboard-skeleton-line--section" style={{ width: 120 }} />
              </div>
              <div className="creator-readiness-list">
                {[0, 1, 2].map((item) => (
                  <div className="creator-readiness-row" key={item}>
                    <span className="dashboard-skeleton-avatar" style={{ width: 32, height: 32 }} />
                    <div style={{ display: "grid", gap: 8 }}>
                      <span className="dashboard-skeleton-line" style={{ width: "70%", height: 14 }} />
                      <span className="dashboard-skeleton-line" style={{ width: "92%", height: 10 }} />
                    </div>
                    <span className="dashboard-skeleton-line" style={{ width: 48, height: 18 }} />
                  </div>
                ))}
              </div>
            </aside>
          </section>

          <section className="creator-overview-stats">
            {Array.from({ length: 4 }).map((_, index) => (
              <span key={index} className="dashboard-skeleton-card" style={{ minHeight: 102 }} />
            ))}
          </section>

          <section className="creator-overview-main-grid">
            <span className="dashboard-skeleton-card" style={{ minHeight: 288 }} />
            <span className="dashboard-skeleton-card" style={{ minHeight: 288 }} />
          </section>

          <section className="creator-overview-main-grid creator-overview-main-grid--lower">
            <span className="dashboard-skeleton-card" style={{ minHeight: 238 }} />
            <span className="dashboard-skeleton-card" style={{ minHeight: 238 }} />
          </section>

          <span className="dashboard-skeleton-table" style={{ minHeight: 260 }} />
        </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title="Overview">
      <div className="dashboard-body-inner" aria-busy="true">
        <div className="dashboard-page-heading">
          <div>
            <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 var(--space-1)" }}>
              Your creator support
            </h1>
            <p style={{ color: "var(--text-secondary)", margin: 0 }}>
              Tip again, track receipts, and see when creators can claim what you sent.
            </p>
          </div>
        </div>
        <div className="dashboard-skeleton-overview">
          <span className="dashboard-skeleton-card dashboard-skeleton-card--large" />
          <span className="dashboard-skeleton-card dashboard-skeleton-card--large" />
        </div>
        <h3 style={{ fontSize: "1.25rem", margin: "0 0 var(--space-3)" }}>
          Creators to tip again
        </h3>
        <div className="dashboard-skeleton-repeat-grid">
          <span className="dashboard-skeleton-card dashboard-skeleton-card--creator" />
          <span className="dashboard-skeleton-card dashboard-skeleton-card--creator" />
        </div>
        <div className="dashboard-activity-section">
          <div className="dashboard-history-header dashboard-history-header--table">
            <div>
              <div className="dashboard-metric-label">Activity</div>
              <h3 style={{ fontSize: "1.25rem", margin: 0 }}>
                Tip activity and receipts
              </h3>
            </div>
          </div>
          <span className="dashboard-skeleton-table" />
        </div>
      </div>
    </DashboardShell>
  );
}

type DashboardMode = "auto" | "tipper" | "creator";
type OverviewSupporterTab = "top" | "recent" | "repeat";
type CreatorClaimFlowStatus = "idle" | "starting" | "waiting" | "checking" | "success" | "error";
type CreatorClaimPromptDismissal = {
  dismissedAt: number;
  unclaimedSignal: string;
};

const CREATOR_CLAIM_PROMPT_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;
const TRUSTED_X_AUTH_ORIGINS = new Set(["https://x.com", "https://twitter.com", "https://api.x.com"]);

function safeXAuthUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (!TRUSTED_X_AUTH_ORIGINS.has(url.origin)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function readCreatorClaimPromptDismissal(key: string): CreatorClaimPromptDismissal | null {
  if (!key || typeof window === "undefined") return null;
  const value = window.localStorage.getItem(key);
  if (!value) return null;
  if (value === "1") {
    const migrated = { dismissedAt: Date.now(), unclaimedSignal: "legacy" };
    window.localStorage.setItem(key, JSON.stringify(migrated));
    return migrated;
  }
  try {
    const parsed = JSON.parse(value) as Partial<CreatorClaimPromptDismissal>;
    if (typeof parsed.dismissedAt === "number" && typeof parsed.unclaimedSignal === "string") {
      return {
        dismissedAt: parsed.dismissedAt,
        unclaimedSignal: parsed.unclaimedSignal,
      };
    }
  } catch {
    window.localStorage.removeItem(key);
  }
  return null;
}

export default function Dashboard({ mode = "auto" }: { mode?: DashboardMode }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const accountRole = useAccountRole();
  const { ready, authenticated } = usePrivy();
  const { client: smartWalletClient } = useSmartWallets();
  const address = (ready && authenticated ? smartWalletClient?.account?.address || "" : "").toLowerCase();

  const [loading, setLoading] = useState(true);
  const [isCreator, setIsCreator] = useState(false);
  const [creatorData, setCreatorData] = useState<CreatorData | null>(null);
  const [earningsDaily, setEarningsDaily] = useState<EarningsDaily[]>([]);
  const [chartDays, setChartDays] = useState<number>(30);
  const [balanceRaw, setBalanceRaw] = useState("0");
  const [mainBalanceRaw, setMainBalanceRaw] = useState("0");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [postPreviews, setPostPreviews] = useState<Record<string, PostPreview>>({});
  const [overviewSupporterTab, setOverviewSupporterTab] = useState<OverviewSupporterTab>("top");
  
  // Extra tipper data
  const [tipperStats, setTipperStats] = useState<{
    totalSent: string;
    tipCount: number;
    creatorsSupported: TipperCreator[];
  }>({ totalSent: "0", tipCount: 0, creatorsSupported: [] });
  const [discoverCreators, setDiscoverCreators] = useState<DiscoverCreator[]>([]);
  
  const [addFundsOpen, setAddFundsOpen] = useState(false);
  const [addFundsPanelRect, setAddFundsPanelRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const [walletCopyFeedback, setWalletCopyFeedback] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [fundingMsg, setFundingMsg] = useState("");
  const [receiptPrefs, setReceiptPrefs] = useState({ shareAmountEnabled: true });
  const [tipperIdentity, setTipperIdentity] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [creatorTipsPage, setCreatorTipsPage] = useState(1);
  const [historyFiltersOpen, setHistoryFiltersOpen] = useState(false);
  const [historyActionsOpen, setHistoryActionsOpen] = useState<string | null>(null);
  const [directTipTarget, setDirectTipTarget] = useState<TipperCreator | null>(null);
  const [directTipAmount, setDirectTipAmount] = useState("5.00");
  const [directTipSending, setDirectTipSending] = useState(false);
  const [directTipError, setDirectTipError] = useState("");
  const [inviteIndex, setInviteIndex] = useState(0);
  const [creatorPromptDismissal, setCreatorPromptDismissal] = useState<CreatorClaimPromptDismissal | null>(null);
  const [creatorClaimStarted, setCreatorClaimStarted] = useState(false);
  const [creatorClaimOpen, setCreatorClaimOpen] = useState(false);
  const [creatorClaimStatus, setCreatorClaimStatus] = useState<CreatorClaimFlowStatus>("idle");
  const [creatorClaimMessage, setCreatorClaimMessage] = useState("");
  const [creatorClaimAuthUrl, setCreatorClaimAuthUrl] = useState("");
  const [creatorClaimDetails, setCreatorClaimDetails] = useState<{
    username?: string;
    claimWalletAddress?: string | null;
    totalEarnedRaw?: string;
  } | null>(null);
  const addFundsRef = useRef<HTMLDivElement>(null);
  const addFundsButtonRef = useRef<HTMLButtonElement>(null);
  const activeAddressRef = useRef(address);
  const creatorClaimPromptSignalRef = useRef("none");

  const creatorPromptStorageKey = address ? `teep_creator_claim_prompt_dismissed_${address}` : "";
  const creatorClaimStartedStorageKey = address ? `teep_creator_claim_started_${address}` : "";
  const explicitCreatorClaim = searchParams.get("claim") === "creator";

  useEffect(() => {
    activeAddressRef.current = address;
  }, [address]);

  useEffect(() => {
    if (!creatorPromptStorageKey) {
      setCreatorPromptDismissal(null);
      return;
    }
    setCreatorPromptDismissal(readCreatorClaimPromptDismissal(creatorPromptStorageKey));
  }, [creatorPromptStorageKey]);

  useEffect(() => {
    if (!creatorClaimStartedStorageKey || typeof window === "undefined") {
      setCreatorClaimStarted(false);
      return;
    }
    setCreatorClaimStarted(window.localStorage.getItem(creatorClaimStartedStorageKey) === "1");
  }, [creatorClaimStartedStorageKey]);

  useEffect(() => {
    if (!explicitCreatorClaim || !authenticated || accountRole.isCreator) return;
    setCreatorClaimOpen(true);
  }, [accountRole.isCreator, authenticated, explicitCreatorClaim]);

  const dismissCreatorPrompt = useCallback(() => {
    const dismissal = {
      dismissedAt: Date.now(),
      unclaimedSignal: creatorClaimPromptSignalRef.current,
    };
    setCreatorPromptDismissal(dismissal);
    if (creatorPromptStorageKey) window.localStorage.setItem(creatorPromptStorageKey, JSON.stringify(dismissal));
  }, [creatorPromptStorageKey]);

  useEffect(() => {
    if (!historyActionsOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".dashboard-history-menu-wrap")) return;
      setHistoryActionsOpen(null);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [historyActionsOpen]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (addFundsRef.current && !addFundsRef.current.contains(target) && !(target instanceof Element && target.closest(".dashboard-funding-panel--floating"))) {
        setAddFundsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!addFundsOpen || !addFundsButtonRef.current) return;
    const updatePosition = () => {
      const rect = addFundsButtonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAddFundsPanelRect({
        left: Math.max(16, Math.min(rect.left, window.innerWidth - 340)),
        top: rect.bottom + 8,
        width: Math.max(320, rect.width + 220),
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [addFundsOpen]);

  useEffect(() => {
    if (!creatorData?.topPosts?.length) {
      setPostPreviews({});
      return;
    }
    let cancelled = false;
    const previewTargets = creatorData.topPosts
      .filter((post) => post.tweetId && (post.authorHandle || creatorData.username))
      .slice(0, 5);
    if (previewTargets.length === 0) {
      setPostPreviews({});
      return;
    }
    Promise.all(previewTargets.map(async (post) => {
      const handle = post.authorHandle || creatorData.username;
      const tweetUrl = `https://x.com/${handle}/status/${post.tweetId}`;
      try {
        const response = await fetch(`${API_BASE}/api/v1/oembed?url=${encodeURIComponent(tweetUrl)}`);
        const data = response.ok ? await response.json() : null;
        return {
          contentId: post.contentId,
          preview: {
            excerpt: data?.excerpt || null,
            authorName: data?.author_name || null,
            thumbnailUrl: data?.thumbnail_url || null,
            unavailable: Boolean(data?.unavailable),
          } satisfies PostPreview,
        };
      } catch {
        return {
          contentId: post.contentId,
          preview: { excerpt: null, authorName: null, thumbnailUrl: null, unavailable: true } satisfies PostPreview,
        };
      }
    })).then((items) => {
      if (cancelled) return;
      setPostPreviews(Object.fromEntries(items.map((item) => [item.contentId, item.preview])));
    });
    return () => {
      cancelled = true;
    };
  }, [creatorData]);

  const requestWalletProof = useCallback(async (purpose: "referral-code" | "referral-link" | "activity-write") => {
    if (!address || !smartWalletClient?.account) throw new Error("Connect your account first.");
    const challengeRes = await fetch(`${API_BASE}/auth/wallet/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, purpose }),
    });
    const challenge = await challengeRes.json();
    if (!challengeRes.ok || !challenge.message) throw new Error(challenge.error || "Could not verify account.");
    const signature = await smartWalletClient.signMessage({
      account: smartWalletClient.account,
      message: challenge.message,
    } as Parameters<typeof smartWalletClient.signMessage>[0]);
    return { message: challenge.message, signature };
  }, [address, smartWalletClient]);

  const loadData = useCallback(async () => {
    const targetAddress = address;
    if (!targetAddress) {
      setLoading(true);
      return;
    }
    setLoading(true);
    const timeoutMs = 12000;
    const timeoutPromise = new Promise<null>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs));
    try {
      const result = await Promise.race([
        Promise.all([
          fetch(`${API_BASE}/auth/claim-status/${targetAddress}`).then((r) => (r.ok ? r.json() : { verified: false, claims: [] })).catch(() => ({ verified: false, claims: [] })),
          fetch(`${API_BASE}/tips/history/${targetAddress}?limit=100`).then((r) => (r.ok ? r.json() : { history: [] })).catch(() => ({ history: [] })),
        ]),
        timeoutPromise,
      ]) as [{ verified?: boolean; claims?: unknown[] }, { history?: unknown[] }] | null;
      if (activeAddressRef.current !== targetAddress) return;
      if (!result) return;
      const [claimRes, historyRes] = result;
      setHistory(Array.isArray(historyRes?.history) ? (historyRes.history as HistoryItem[]) : []);

      const claimedUsername = claimRes?.verified && Array.isArray(claimRes.claims) && claimRes.claims.length > 0
        ? (claimRes.claims[0] as { username?: string }).username
        : undefined;
      const shouldShowCreatorDashboard = mode === "creator" || (mode === "auto" && Boolean(claimedUsername));

      if (shouldShowCreatorDashboard) {
        const username = claimedUsername;
        setIsCreator(true);
        const [creatorRes, earningsRes, balanceRes, mainBalanceRes] = await Promise.all([
          username ? fetch(`${API_BASE}/api/v1/creators/${username}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null),
          username ? fetch(`${API_BASE}/api/v1/creators/${username}/earnings-over-time?days=30`).then((r) => (r.ok ? r.json() : { daily: [] })).catch(() => ({ daily: [] })) : Promise.resolve({ daily: [] }),
          fetch(`${API_BASE}/api/v1/wallet/${targetAddress}/balance`).then((r) => (r.ok ? r.json() : { balanceRaw: "0" })).catch(() => ({ balanceRaw: "0" })),
          fetch(`${API_BASE}/api/v1/wallet/${targetAddress}/usdc-balance`).then((r) => (r.ok ? r.json() : { balanceRaw: "0" })).catch(() => ({ balanceRaw: "0" })),
        ]);
        if (activeAddressRef.current !== targetAddress) return;
        if (creatorRes) setCreatorData(creatorRes);
        if (earningsRes?.daily?.length) setEarningsDaily(earningsRes.daily);
        setBalanceRaw(balanceRes?.balanceRaw ?? "0");
        setMainBalanceRaw(mainBalanceRes?.balanceRaw ?? "0");
      } else {
        setIsCreator(false);
        // Load tipper specific data
        const [walletRes, usdcRes, leaderboardRes] = await Promise.all([
          fetch(`${API_BASE}/tips/wallet/${targetAddress}`).then(r => r.ok ? r.json() : null).catch(() => null),
          fetch(`${API_BASE}/api/v1/wallet/${targetAddress}/usdc-balance`).then((r) => (r.ok ? r.json() : { balanceRaw: "0" })).catch(() => ({ balanceRaw: "0" })),
          fetch(`${API_BASE}/leaderboard/creators?limit=12&period=7d`)
            .then(async (r) => {
              const data = r.ok ? await r.json() : { creators: [] };
              if (Array.isArray(data.creators) && data.creators.length > 0) return data;
              const fallback = await fetch(`${API_BASE}/leaderboard/creators?limit=12`);
              return fallback.ok ? fallback.json() : { creators: [] };
            })
            .catch(() => ({ creators: [] }))
        ]);
        if (activeAddressRef.current !== targetAddress) return;
        if (walletRes) {
          setTipperStats({
            totalSent: walletRes.totalSent || "0",
            tipCount: walletRes.tipCount || 0,
            creatorsSupported: Array.isArray(walletRes.creatorsSupported) ? walletRes.creatorsSupported : [],
          });
        }
        setBalanceRaw(usdcRes?.balanceRaw ?? "0");
        if (leaderboardRes?.creators) setDiscoverCreators(leaderboardRes.creators);
      }
    } catch {
      setIsCreator(false);
      setHistory([]);
    } finally {
      if (activeAddressRef.current === targetAddress) setLoading(false);
    }
  }, [address, mode]);

  useEffect(() => {
    if (address) loadData();
  }, [address, loadData]);

  const checkCreatorClaim = useCallback(async (options?: { quiet?: boolean }) => {
    if (!address) return false;
    if (!options?.quiet) {
      setCreatorClaimStatus("checking");
      setCreatorClaimMessage("Checking whether your X account is connected...");
    }
    try {
      const [claimRes, walletRes] = await Promise.all([
        fetch(`${API_BASE}/auth/claim-status/${address}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${API_BASE}/auth/claim-wallet-status/${address}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      const verified = Boolean(claimRes?.verified && Array.isArray(claimRes?.claims) && claimRes.claims.length > 0);
      if (!verified) {
        if (!options?.quiet) {
          setCreatorClaimStatus("waiting");
          setCreatorClaimMessage("We have not seen the X connection yet. Finish the X approval tab, then check again.");
        }
        return false;
      }

      const claim = claimRes.claims[0] as { username?: string };
      setCreatorClaimDetails({
        username: claim?.username,
        claimWalletAddress: walletRes?.claimWalletAddress || null,
        totalEarnedRaw: walletRes?.totalEarnedRaw || "0",
      });
      setCreatorClaimStatus("success");
      setCreatorClaimMessage(`@${claim?.username || "your X account"} is connected. Your creator workspace is ready.`);
      setCreatorClaimStarted(false);
      if (creatorClaimStartedStorageKey) window.localStorage.removeItem(creatorClaimStartedStorageKey);
      await accountRole.refreshRole();
      await loadData();
      return true;
    } catch (err: unknown) {
      if (!options?.quiet) {
        setCreatorClaimStatus("error");
        setCreatorClaimMessage(err instanceof Error ? err.message : "Could not check your creator claim yet.");
      }
      return false;
    }
  }, [accountRole, address, creatorClaimStartedStorageKey, loadData]);

  const startCreatorClaim = useCallback(async () => {
    if (!address) {
      setCreatorClaimStatus("error");
      setCreatorClaimMessage("Connect your Teep account first.");
      return;
    }
    setCreatorClaimOpen(true);
    setCreatorClaimStarted(true);
    if (creatorClaimStartedStorageKey) window.localStorage.setItem(creatorClaimStartedStorageKey, "1");
    setCreatorClaimStatus("starting");
    setCreatorClaimMessage("Opening X so you can prove the creator account is yours.");
    setCreatorClaimAuthUrl("");
    try {
      const response = await fetch(`${API_BASE}/auth/x/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerAddress: address, returnTo: `${WEB_APP_URL}/dashboard` }),
      });
      const data = await response.json();
      if (!response.ok || !data?.authUrl) {
        throw new Error(data?.error || "Could not start X connection.");
      }
      const authUrl = safeXAuthUrl(data.authUrl);
      if (!authUrl) {
        throw new Error("X returned an unexpected verification URL.");
      }
      setCreatorClaimAuthUrl(authUrl);
      const popup = window.open(authUrl, "_blank", "noopener,noreferrer");
      setCreatorClaimStatus("waiting");
      setCreatorClaimMessage(
        popup
          ? "Finish the X approval in the new tab. Return here when it says you are verified."
          : "Your browser blocked the X window. Open the verification link below, then return here."
      );
    } catch (err: unknown) {
      setCreatorClaimStatus("error");
      setCreatorClaimMessage(err instanceof Error ? err.message : "Could not start X connection.");
    }
  }, [address, creatorClaimStartedStorageKey]);

  useEffect(() => {
    if (creatorClaimStatus !== "waiting") return;
    const onFocus = () => {
      void checkCreatorClaim({ quiet: true });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [checkCreatorClaim, creatorClaimStatus]);

  useEffect(() => {
    if (!address || !smartWalletClient?.account) return;
    const params = new URLSearchParams(window.location.search);
    const code = normalizeReferralCode(params.get("ref")) || readPendingReferralCode();
    if (!code) return;

    const appliedKey = referralAppliedKey(code, address);
    const attemptKey = referralAttemptKey(code, address);
    if (sessionStorage.getItem(appliedKey) || sessionStorage.getItem(attemptKey)) return;
    sessionStorage.setItem(attemptKey, "1");

    let cancelled = false;
    const applyReferral = async () => {
      try {
        const walletProof = await requestWalletProof("referral-link");
        if (cancelled) return;
        const response = await fetch(`${API_BASE}/referral/link`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userAddress: address, code, walletProof }),
        });
        const data = await response.json();
        if (response.ok) {
          sessionStorage.setItem(appliedKey, "1");
          clearPendingReferralCode(code);
        } else if (data?.error) {
          console.info("[Referral] Could not apply referral link:", data.error);
          if (response.status === 400 || response.status === 404) {
            clearPendingReferralCode(code);
          }
        }
      } catch {
        // Keep this quiet; referral links should never block dashboard use.
        sessionStorage.removeItem(attemptKey);
      }
    };
    applyReferral();
    return () => {
      cancelled = true;
    };
  }, [address, smartWalletClient?.account, requestWalletProof]);

  useEffect(() => {
    if (ready && authenticated && isCreator && creatorData?.username) {
      fetch(`${API_BASE}/api/v1/creators/${creatorData.username}/earnings-over-time?days=${chartDays}`)
        .then(r => r.ok ? r.json() : { daily: [] })
        .then(data => {
          if (data?.daily?.length) setEarningsDaily(data.daily);
        })
        .catch(() => {});
    }
  }, [chartDays, ready, authenticated, isCreator, creatorData?.username]);

  useEffect(() => {
    if (ready && authenticated && !address) setLoading(true);
  }, [ready, authenticated, address]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historySearch, history.length]);

  useEffect(() => {
    setCreatorTipsPage(1);
  }, [creatorData?.recentTips?.length, history.length]);

  useEffect(() => {
    setInviteIndex(0);
  }, [tipperStats.creatorsSupported.length]);

  const fundingPolicy = buildFundingPolicy({
    environment: FUNDING_ENV,
    faucetUrl: FAUCET_URL,
    fiatOnrampUrl: ONRAMP_URL,
    fiatOfframpUrl: OFFRAMP_URL,
    enableFiatOnramp: ENABLE_FIAT_ONRAMP,
    enableFiatOfframp: ENABLE_FIAT_OFFRAMP,
  });

  const onrampUrl = address && fundingPolicy.providers.fiatOnramp.enabled && fundingPolicy.providers.fiatOnramp.url
    ? fundingPolicy.providers.fiatOnramp.url.replace("WALLET", address)
    : "";

  const copyDepositAddress = useCallback(() => {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setWalletCopyFeedback(true);
      setFundingMsg("Address copied. Paste it in your wallet to send funds.");
      setTimeout(() => setWalletCopyFeedback(false), 1500);
      setTimeout(() => setFundingMsg(""), 5000);
    }).catch(() => {
      setFundingMsg("Could not copy address.");
      setTimeout(() => setFundingMsg(""), 5000);
    });
  }, [address]);

  const handleFaucet = useCallback(async () => {
    if (!address) return;
    if (!fundingPolicy.providers.faucet.enabled || !fundingPolicy.providers.faucet.url) {
      setFundingMsg(fundingPolicy.providers.faucet.disabledReason || "Faucet funding is not available.");
      setTimeout(() => setFundingMsg(""), 5000);
      return;
    }
    setFaucetLoading(true);
    setFundingMsg("Copying wallet address...");
    try {
      await navigator.clipboard.writeText(address);
      setWalletCopyFeedback(true);
      setFundingMsg("Address copied. Opening faucet...");
      window.open(fundingPolicy.providers.faucet.url, "_blank", "noopener,noreferrer");
      setTimeout(() => setWalletCopyFeedback(false), 1500);
    } catch (err: unknown) {
      setFundingMsg(err instanceof Error ? err.message : "Could not open faucet.");
    }
    setFaucetLoading(false);
    setTimeout(() => setFundingMsg(""), 5000);
  }, [address, fundingPolicy]);

  useEffect(() => {
    if (!address) return;
    fetch(`${API_BASE}/api/v1/wallet/${address}/tipper-settings-public`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.receipts) {
          setReceiptPrefs({
            shareAmountEnabled: data.receipts.shareAmountEnabled !== false,
          });
        }
        if (data?.publicIdentity?.label) setTipperIdentity(data.publicIdentity.label);
      })
      .catch(() => {});
  }, [address]);

  const shareHistoryOnX = useCallback((item: HistoryItem) => {
    const text = buildReceiptTweetText({
      amount: formatUsdRaw(item.amount),
      authorHandle: item.author_handle,
      tweetId: item.tweet_id,
      txHash: item.tx_hash,
      shareAmount: receiptPrefs.shareAmountEnabled,
    });
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }, [receiptPrefs.shareAmountEnabled]);

  const downloadHistoryReceipt = useCallback(async (item: HistoryItem) => {
    const handle = item.author_handle ? `@${item.author_handle.replace(/^@/, "")}` : "Creator";
    const kind = getTeepActivityTypeLabel(item.type);
    const imageUrl = await generateReceiptImage({
      amount: formatUsdRaw(item.amount),
      title: kind,
      subtitle: item.detail || (item.type === "direct_creator_tip" ? `You sent a direct creator tip to ${handle}.` : item.author_handle ? `You sent a post tip to ${handle}.` : "You tipped a creator via Teep."),
      from: tipperIdentity || safeAddress(address) || "You",
      to: handle,
      txHash: item.tx_hash,
      txUrl: item.tx_hash ? `${RECEIPT_BASE_URL}/tx/${item.tx_hash}` : RECEIPT_BASE_URL,
      date: formatHistoryTime(item.timestamp),
      kind,
    });
    if (!imageUrl) return;
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = `teep-receipt-${item.tx_hash?.slice(0, 10) || item.timestamp}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }, [address, tipperIdentity]);

  const openDirectTip = useCallback((creator: TipperCreator) => {
    setDirectTipTarget(creator);
    setDirectTipAmount("5.00");
    setDirectTipError("");
  }, []);

  const sendDirectTip = useCallback(async () => {
    if (!directTipTarget || !smartWalletClient?.account || !address) return;
    const handle = directTipTarget.username?.replace(/^@/, "");
    let authorId = directTipTarget.authorId;
    const amount = Number(directTipAmount);
    if (!handle) {
      setDirectTipError("This creator needs a handle before direct tipping.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setDirectTipError("Enter a valid tip amount.");
      return;
    }

    setDirectTipSending(true);
    setDirectTipError("");
    try {
      if (!authorId) {
        const resolved = await fetch(`${API_BASE}/auth/x/user/${encodeURIComponent(handle)}`);
        if (!resolved.ok) throw new Error("Could not verify this creator. Try again in a moment.");
        const resolvedData = (await resolved.json()) as { id?: string };
        if (!resolvedData.id || !/^[0-9]+$/.test(resolvedData.id)) throw new Error("Could not verify this creator.");
        authorId = resolvedData.id;
      }

      const rawAmount = parseUnits(directTipAmount, 6);
      const contentId = computeDirectCreatorContentId(authorId);
      const approveData = encodeApproveCall(TIP_CONTRACT_ADDRESS, rawAmount);
      const tipData = encodeTipCall(contentId, BigInt(authorId), rawAmount);
      const txHash = await smartWalletClient.sendTransaction({
        calls: [
          { to: USDC_ADDRESS, data: approveData },
          { to: TIP_CONTRACT_ADDRESS, data: tipData },
        ],
        chain: arcTestnet,
        account: smartWalletClient.account,
      } as Parameters<typeof smartWalletClient.sendTransaction>[0]);

      await fetch(`${API_BASE}/tips/metadata`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentId,
          authorHandle: handle,
          authorId,
          kind: "direct_creator_tip",
        }),
      }).catch(() => {});

      await fetch(`${API_BASE}/tips/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "direct_creator_tip",
          fromAddress: address,
          amount: rawAmount.toString(),
          txHash,
          authorHandle: handle,
          detail: `Direct tip to @${handle}`,
          sourceMethod: "web_dashboard",
          walletProof: await requestWalletProof("activity-write"),
        }),
      }).catch(() => {});

      setDirectTipTarget(null);
      setDirectTipAmount("5.00");
      await loadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setDirectTipError(message.includes("insufficient") || message.includes("balance") ? "Insufficient funds to send this tip." : message);
    } finally {
      setDirectTipSending(false);
    }
  }, [directTipTarget, smartWalletClient, address, directTipAmount, loadData, requestWalletProof]);

  const directTipModal = directTipTarget ? (
    <TeepTipModal
      open
      title="Send direct tip"
      modeLabel="Direct tip"
      recipientLabel={`@${(directTipTarget.username || "creator").replace(/^@/, "")}`}
      context="This supports the creator directly without attaching the tip to a specific post."
      amount={directTipAmount}
      onAmountChange={setDirectTipAmount}
      confirmLabel="Send Direct Tip"
      sending={directTipSending}
      error={directTipError}
      onConfirm={sendDirectTip}
      onClose={() => setDirectTipTarget(null)}
    />
  ) : null;

  if (!ready) {
    return <DashboardDataSkeleton mode={mode} />;
  }

  if (!authenticated) {
    return (
      <DashboardConnectPage
        title="Overview"
        message={explicitCreatorClaim ? "Sign in to claim tips sent to your creator account and connect your X profile." : undefined}
      />
    );
  }

  if (loading) {
    return <DashboardDataSkeleton mode={mode} />;
  }

  // Non-creator: minimal view — history of spendings only
  if (mode !== "creator" && !isCreator) {
    const sentItems = history.filter((h) => h.type === "tip_sent" || h.type === "direct_creator_tip" || h.type === "send");
    const normalizedHistorySearch = historySearch.trim().replace(/^@/, "").toLowerCase();
    const filteredSentItems = normalizedHistorySearch
      ? sentItems.filter((item) => {
          const handle = (item.author_handle || "").replace(/^@/, "").toLowerCase();
          const detail = (item.detail || "").replace(/^@/, "").toLowerCase();
          return handle.includes(normalizedHistorySearch) || detail.includes(normalizedHistorySearch);
        })
      : sentItems;
    const historyPageCount = Math.max(1, Math.ceil(filteredSentItems.length / HISTORY_PAGE_SIZE));
    const safeHistoryPage = Math.min(historyPage, historyPageCount);
    const pagedSentItems = filteredSentItems.slice((safeHistoryPage - 1) * HISTORY_PAGE_SIZE, safeHistoryPage * HISTORY_PAGE_SIZE);
    const totalSentUsd = Number(tipperStats.totalSent) / 1e6;
    const averageTipUsd = tipperStats.tipCount > 0 ? totalSentUsd / tipperStats.tipCount : 0;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const referralEarnedThisMonthRaw = history.reduce((sum, item) => {
      if (item.type !== "referral_fee_received" || item.timestamp * 1000 < monthStart.getTime()) return sum;
      try {
        return sum + BigInt(item.amount || "0");
      } catch {
        return sum;
      }
    }, 0n);
    const referralEarnedThisMonth = (Number(referralEarnedThisMonthRaw) / 1e6).toFixed(2);
    const topSupported = tipperStats.creatorsSupported.slice(0, 2);
    const mostSupported = topSupported[0];
    const mostSupportedHandle = mostSupported?.username || mostSupported?.authorId || "";
    const allUnclaimedTargets = tipperStats.creatorsSupported.filter((creator) => creator.claimStatus === "unclaimed");
    const unclaimedSignal = allUnclaimedTargets
      .map((creator) => {
        const identity = creator.username || creator.authorId || "unknown";
        return `${identity.replace(/^@/, "").toLowerCase()}:${creator.totalRaw || creator.total || "0"}`;
      })
      .sort()
      .join("|") || "none";
    creatorClaimPromptSignalRef.current = unclaimedSignal;
    const inviteTargets = allUnclaimedTargets.slice(0, 3);
    const safeInviteIndex = inviteTargets.length ? inviteIndex % inviteTargets.length : 0;
    const inviteTarget = inviteTargets[safeInviteIndex];
    const inviteHandle = inviteTarget?.username || inviteTarget?.authorId || "";
    const inviteTotal = inviteTarget?.totalRaw ? Number(inviteTarget.totalRaw) / 1e6 : Number(inviteTarget?.total || 0);
    const inviteWaiting = inviteTotal > 0 ? `$${inviteTotal.toFixed(2)}` : "unclaimed tips";
    const inviteCopy = inviteHandle
      ? `Hey @${inviteHandle.replace(/^@/, "")}, you have ${inviteWaiting} waiting to be claimed on Teep. Connect your creator account to receive it.\n\n${WEB_APP_URL}`
      : "Creators can claim support sent through Teep when their account is connected.";
    const shareInviteUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(inviteCopy)}`;
    const supportedHandles = new Set(
      tipperStats.creatorsSupported
        .map((creator) => (creator.username || creator.authorId || "").replace(/^@/, "").toLowerCase())
        .filter(Boolean)
    );
    const discoverCreator = discoverCreators.find((c) => c?.username && !supportedHandles.has(String(c.username).replace(/^@/, "").toLowerCase()));
    const discoverHandle = discoverCreator?.username || "";
    const showNextBestAction = Boolean(inviteTarget);
    const creatorPromptDismissedInCooldown = Boolean(
      creatorPromptDismissal &&
      Date.now() - creatorPromptDismissal.dismissedAt < CREATOR_CLAIM_PROMPT_COOLDOWN_MS &&
      creatorPromptDismissal.unclaimedSignal === unclaimedSignal
    );
    const showCreatorClaimPrompt =
      accountRole.status === "ready" &&
      authenticated &&
      !accountRole.isCreator &&
      !isCreator &&
      (explicitCreatorClaim || !creatorPromptDismissedInCooldown);
    const creatorClaimTitle = creatorClaimStarted ? "Finish connecting X" : "Claim creator tips";
    const creatorClaimBody = creatorClaimStarted
      ? "Complete X verification to unlock creator tools and tips sent to your handle."
      : "Connect your X account to become a creator and unlock tips sent to your handle.";
    const claimEarnedUsd = creatorClaimDetails?.totalEarnedRaw
      ? formatUsdRaw(creatorClaimDetails.totalEarnedRaw)
      : "0.00";

    return (
      <DashboardShell address={address} title="Overview">
          <div className="dashboard-body-inner">
            {showCreatorClaimPrompt && (
              <CreatorClaimPrompt
                open={creatorClaimOpen}
                started={creatorClaimStarted}
                title={creatorClaimTitle}
                body={creatorClaimBody}
                status={creatorClaimStatus}
                message={creatorClaimMessage}
                authUrl={creatorClaimAuthUrl}
                claimEarnedUsd={claimEarnedUsd}
                onExpand={() => setCreatorClaimOpen(true)}
                onMinimize={() => setCreatorClaimOpen(false)}
                onDismiss={dismissCreatorPrompt}
                onStart={startCreatorClaim}
                onCheck={() => checkCreatorClaim()}
                onOpenCreatorOverview={() => navigate("/creator/dashboard")}
              />
            )}

            <div className="dashboard-page-heading">
              <div>
                <h1 style={{ fontSize: "2rem", fontWeight: 900, margin: "0 0 var(--space-1)", letterSpacing: "-0.02em" }}>Your creator support</h1>
                <p style={{ color: "var(--text-secondary)", margin: 0 }}>Tip again, track receipts, and see when creators can claim what you sent.</p>
              </div>
            </div>

            <div className="dashboard-tipper-overview">
              <div className="dashboard-metric-card dashboard-balance-readiness">
                <div className="dashboard-metric-label">Balance Readiness</div>
                <div className="dashboard-metric-value">
                  ${formatUsdRaw(balanceRaw)}
                  <span className="dashboard-metric-value-sub">USD</span>
                </div>
                <div className="dashboard-ready-state">
                  <span aria-hidden />
                  Ready to tip
                </div>
                <div className="dashboard-balance-actions-wrap" ref={addFundsRef}>
                  <div className="dashboard-balance-actions">
                    <button type="button" ref={addFundsButtonRef} onClick={() => setAddFundsOpen((open) => !open)} className="btn-primary">
                      <span className="material-symbols-outlined" aria-hidden>add_circle</span>
                      Add Funds
                    </button>
                    <Link to="/dashboard/withdraw" className="dashboard-balance-withdraw">
                      <span className="material-symbols-outlined" aria-hidden>arrow_downward</span>
                      Withdraw
                    </Link>
                  </div>
                  {addFundsOpen && addFundsPanelRect && createPortal(
                    <div
                      className="dashboard-funding-panel dashboard-funding-panel--balance dashboard-funding-panel--floating"
                      style={{
                        left: addFundsPanelRect.left,
                        top: addFundsPanelRect.top,
                        width: addFundsPanelRect.width,
                      }}
                    >
                      <div className="dashboard-funding-title">Add Funds</div>
                      <div className="dashboard-funding-options">
                        {onrampUrl ? (
                          <a href={onrampUrl} target="_blank" rel="noopener noreferrer" className="dashboard-funding-option">
                            <span>
                              <strong>{fundingPolicy.providers.fiatOnramp.label}</strong>
                              <small>{fundingPolicy.providers.fiatOnramp.description}</small>
                            </span>
                            <span>Open</span>
                          </a>
                        ) : (
                          <button type="button" className="dashboard-funding-option" disabled title={fundingPolicy.providers.fiatOnramp.disabledReason}>
                            <span>
                              <strong>{fundingPolicy.providers.fiatOnramp.label}</strong>
                              <small>{fundingPolicy.providers.fiatOnramp.disabledReason || "Card and bank funding is not available yet."}</small>
                            </span>
                            <span>Soon</span>
                          </button>
                        )}
                        <button type="button" onClick={handleFaucet} disabled={faucetLoading || !fundingPolicy.providers.faucet.enabled} className="dashboard-funding-option">
                          <span>
                            <strong>{fundingPolicy.providers.faucet.label}</strong>
                            <small>{fundingPolicy.providers.faucet.description}</small>
                          </span>
                          <span>{faucetLoading ? "..." : "Open"}</span>
                        </button>
                        <button type="button" onClick={copyDepositAddress} className="dashboard-funding-option">
                          <span>
                            <strong>{fundingPolicy.providers.cryptoReceive.label}</strong>
                            <small>{fundingPolicy.providers.cryptoReceive.description}</small>
                          </span>
                          <span>{walletCopyFeedback ? "Copied" : "Copy"}</span>
                        </button>
                      </div>
                      <p className="dashboard-funding-note">{fundingPolicy.testnetCopy}</p>
                      {fundingMsg && <p className="dashboard-funding-note dashboard-funding-note--status">{fundingMsg}</p>}
                    </div>,
                    document.body
                  )}
                </div>
                <div className="dashboard-balance-watermark" aria-hidden>$</div>
              </div>

              <div className="dashboard-metric-card dashboard-tip-impact">
                <div className="dashboard-impact-main">
                  <div className="dashboard-impact-icon">
                    <span className="material-symbols-outlined" aria-hidden>volunteer_activism</span>
                  </div>
                  <div>
                    <div className="dashboard-impact-title">
                      You supported {tipperStats.creatorsSupported.length} creator{tipperStats.creatorsSupported.length === 1 ? "" : "s"}
                    </div>
                    <div className="dashboard-metric-footer">Across {tipperStats.tipCount} tips this month</div>
                  </div>
                </div>
                <div className="dashboard-impact-stats">
                  <div>
                    <div className="dashboard-metric-label">Most Supported</div>
                    {mostSupportedHandle ? (
                      <div className="dashboard-most-supported">
                        <img
                          src={creatorAvatarUrl({ username: mostSupportedHandle, authorId: mostSupported?.authorId, profileImageUrl: mostSupported?.profileImageUrl })}
                          alt=""
                          onError={(event) => avatarErrorFallback(event, mostSupportedHandle)}
                        />
                        <span>@{mostSupportedHandle.replace(/^@/, "")}</span>
                      </div>
                    ) : (
                      <div className="dashboard-impact-stat">None yet</div>
                    )}
                  </div>
                  <div>
                    <div className="dashboard-metric-label">Average Tip</div>
                    <div className="dashboard-impact-stat">${averageTipUsd.toFixed(2)}</div>
                  </div>
                </div>
              </div>

              <div className="dashboard-metric-card dashboard-referral-impact-card">
                <div className="dashboard-referral-impact-watermark" aria-hidden>
                  <span className="material-symbols-outlined">rocket_launch</span>
                </div>
                <div className="dashboard-metric-label">Referral Impact</div>
                <h3>{Number(referralEarnedThisMonth) > 0 ? "Network fees earned" : "Invite users to Teep"}</h3>
                <p>
                  {Number(referralEarnedThisMonth) > 0 ? (
                    <>You've earned <strong>${referralEarnedThisMonth}</strong> this month from eligible referral activity.</>
                  ) : (
                    <>Invite users and earn when eligible referred withdrawals happen.</>
                  )}
                </p>
                <Link to="/dashboard/referrals" className="dashboard-referral-impact-action">
                  Share Invite Link
                </Link>
              </div>

              {showNextBestAction && inviteTarget && (
                <div className="dashboard-metric-card dashboard-next-action">
                  <div className="dashboard-next-action-main">
                    <div className="dashboard-metric-label">Next Best Action</div>
                    <h3>Invite @{inviteHandle.replace(/^@/, "")} to claim</h3>
                    <p>Your tips are sent. Help this creator discover Teep and activate their receiving account.</p>
                    <div className="dashboard-next-target">
                      <img
                        src={creatorAvatarUrl({ username: inviteHandle, authorId: inviteTarget.authorId, profileImageUrl: inviteTarget.profileImageUrl })}
                        alt=""
                        className="dashboard-next-target-avatar"
                        onError={(event) => avatarErrorFallback(event, inviteHandle)}
                      />
                      <div>
                        <strong>@{inviteHandle.replace(/^@/, "")}</strong>
                        <span>${inviteTotal.toFixed(2)} sent across {inviteTarget.tipCount || 0} tips</span>
                      </div>
                      <span>Awaiting claim</span>
                    </div>
                  </div>
                  <div className="dashboard-next-action-side">
                    <div>
                      <div className="dashboard-metric-label">Invite {safeInviteIndex + 1} of {inviteTargets.length}</div>
                      <p>Share a ready-made X post that points the creator back to Teep.</p>
                    </div>
                    <a href={shareInviteUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">
                      Share Invite to X
                    </a>
                    {inviteTargets.length > 1 && (
                      <div className="dashboard-next-carousel" aria-label="Unclaimed creator invites">
                        <button
                          type="button"
                          className="btn-secondary"
                          aria-label="Previous invite"
                          onClick={() => setInviteIndex((current) => (current - 1 + inviteTargets.length) % inviteTargets.length)}
                        >
                          <span className="material-symbols-outlined" aria-hidden>chevron_left</span>
                        </button>
                        <div className="dashboard-next-dots" aria-hidden>
                          {inviteTargets.map((target, idx) => (
                            <span key={target.authorId || target.username || idx} className={idx === safeInviteIndex ? "is-active" : ""} />
                          ))}
                        </div>
                        <button
                          type="button"
                          className="btn-secondary"
                          aria-label="Next invite"
                          onClick={() => setInviteIndex((current) => (current + 1) % inviteTargets.length)}
                        >
                          <span className="material-symbols-outlined" aria-hidden>chevron_right</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="dashboard-section-heading">
              <h3>Creators to tip again</h3>
            </div>
            <div className="dashboard-creator-repeat-grid">
              {topSupported.map((creator, idx) => {
                const handle = creator.username || creator.authorId || "creator";
                const total = creator.totalRaw ? Number(creator.totalRaw) / 1e6 : Number(creator.total || 0);
                return (
                  <div key={handle} className="dashboard-repeat-card">
                    <div className="dashboard-repeat-cover" />
                    <div className="dashboard-repeat-body">
                      <img
                        src={creatorAvatarUrl({ username: creator.username, authorId: creator.authorId, profileImageUrl: creator.profileImageUrl, seed: handle })}
                        alt=""
                        className="dashboard-repeat-avatar"
                        onError={(event) => avatarErrorFallback(event, handle)}
                      />
                      <h4>
                        @{handle}
                        {idx === 0 && <span>Top Supported</span>}
                      </h4>
                      <p>Creator you support on Teep</p>
                      <div className="dashboard-repeat-stats">
                        <div><span>Total Tipped</span><strong>${total.toFixed(2)}</strong></div>
                        <div><span>Tips Given</span><strong>{creator.tipCount || 0}</strong></div>
                      </div>
                      <button type="button" className="btn-primary" onClick={() => openDirectTip(creator)} disabled={!creator.authorId && !creator.username}>
                        Send Direct Tip
                      </button>
                    </div>
                  </div>
                );
              })}
              {discoverHandle && (
                <div className="dashboard-repeat-card">
                  <div className="dashboard-repeat-cover" />
                  <div className="dashboard-repeat-body">
                    <img
                      src={creatorAvatarUrl({ username: discoverHandle, authorId: discoverCreator?.authorId, profileImageUrl: discoverCreator?.profileImageUrl })}
                      alt=""
                      className="dashboard-repeat-avatar"
                      onError={(event) => avatarErrorFallback(event, discoverHandle)}
                    />
                    <h4>
                      @{discoverHandle}
                      <span>Trending</span>
                    </h4>
                    <p>{discoverCreator?.displayName || "Trending creator on Teep"}</p>
                    <div className="dashboard-repeat-stats">
                      <div><span>Total Tipped</span><strong>$0.00</strong></div>
                      <div><span>7d Signal</span><strong>{discoverCreator?.tipCount || 0} tips</strong></div>
                    </div>
                    <div className="dashboard-repeat-actions">
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => openDirectTip({
                          authorId: discoverCreator?.authorId,
                          username: discoverCreator?.username || null,
                          profileImageUrl: discoverCreator?.profileImageUrl || null,
                          totalRaw: "0",
                          total: "0",
                          tipCount: 0,
                          isVerified: true,
                          claimStatus: "verified",
                        })}
                        disabled={!discoverCreator?.authorId && !discoverCreator?.username}
                      >
                        Send Direct Tip
                      </button>
                      <a href={`https://x.com/${discoverHandle}`} target="_blank" rel="noopener noreferrer" className="btn-secondary" aria-label={`Open @${discoverHandle} on X`}>
                        <span className="material-symbols-outlined" aria-hidden>open_in_new</span>
                      </a>
                    </div>
                  </div>
                </div>
              )}
              <Link to="/dashboard/discover" className="dashboard-repeat-card dashboard-repeat-discover">
                <div>
                  <div className="dashboard-impact-icon">
                    <span className="material-symbols-outlined" aria-hidden>person_add</span>
                  </div>
                  <h4>Discover creators on Teep</h4>
                  <p>Creators receiving support across Teep.</p>
                </div>
              </Link>
            </div>

            <div className="dashboard-activity-section">
              <div>
                <div className="dashboard-history-header dashboard-history-header--table">
                  <div>
                    <div className="dashboard-metric-label">Activity</div>
                    <h3 style={{ fontSize: "1.25rem", margin: 0 }}>Tip activity and receipts</h3>
                  </div>
                  <div className="dashboard-history-tools">
                    <button type="button" className="btn-secondary dashboard-history-download-btn" onClick={() => downloadActivityCsv(filteredSentItems)} aria-label="Download CSV">
                      <span className="material-symbols-outlined dashboard-history-tool-icon" aria-hidden>file_download</span>
                      <span className="dashboard-history-tool-label">Download CSV</span>
                    </button>
                    <button type="button" className="dashboard-filter-icon-btn" aria-label="Filter activity" onClick={() => setHistoryFiltersOpen((open) => !open)}>
                      <span className="material-symbols-outlined" aria-hidden>tune</span>
                    </button>
                  </div>
                </div>
                {historyFiltersOpen && (
                  <div className="dashboard-history-filter-row">
                    <label className="dashboard-history-search">
                      <span className="material-symbols-outlined" aria-hidden>search</span>
                      <input
                        type="search"
                        value={historySearch}
                        onChange={(e) => setHistorySearch(e.target.value)}
                        placeholder="Search creator or @handle"
                        aria-label="Search spending history by creator"
                      />
                    </label>
                  </div>
                )}
                <div className="dashboard-card" style={{ padding: 0 }}>
                  {filteredSentItems.length === 0 ? (
                    <div style={{ padding: "var(--space-6)", textAlign: "center", color: "var(--text-muted)" }}>
                      {sentItems.length === 0 ? "No tips given yet." : "No tips match that search."}
                    </div>
                  ) : (
                    <>
                      <div className="dashboard-table-container">
                        <table className="dashboard-table">
                          <thead>
                            <tr>
                              <th>Creator</th>
                              <th>Amount</th>
                              <th>Date</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pagedSentItems.map((item, i) => {
                              const actionKey = item.tx_hash || `${item.timestamp}-${i}`;
                              const isActionMenuOpen = historyActionsOpen === actionKey;

                              return (
                              <tr key={actionKey}>
                                <td>
                                  <div className="dashboard-table-cell-content" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}>
                                    {item.author_handle && (
                                      <img
                                        src={creatorAvatarUrl({ username: item.author_handle, profileImageUrl: item.profileImageUrl, seed: item.author_handle })}
                                        alt=""
                                        style={{ width: 32, height: 32, flexShrink: 0, borderRadius: "50%", background: "var(--bg-elevated)", objectFit: "cover" }}
                                        onError={(event) => avatarErrorFallback(event, item.author_handle)}
                                      />
                                    )}
                                    <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {item.author_handle ? `@${item.author_handle}` : (item.detail || "Unknown")}
                                    </span>
                                    <span className={`dashboard-history-type-pill ${item.type === "direct_creator_tip" ? "is-direct" : "is-post"}`}>
                                      {getTeepActivityTypeLabel(item.type)}
                                    </span>
                                  </div>
                                </td>
                                <td style={{ fontWeight: 600 }}>${formatUsdRaw(item.amount)}</td>
                                <td style={{ color: "var(--text-secondary)" }}>
                                  {new Date(item.timestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                </td>
                                <td className="dashboard-history-actions-cell">
                                  <div className="dashboard-history-actions" aria-label="Activity actions">
                                    {item.author_handle && item.tweet_id && (
                                      <a
                                        href={`https://x.com/${item.author_handle.replace(/^@/, "")}/status/${item.tweet_id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="dashboard-history-action"
                                      >
                                        <span className="material-symbols-outlined" aria-hidden>open_in_new</span>
                                        Post
                                      </a>
                                    )}
                                    <button type="button" onClick={() => shareHistoryOnX(item)} className="dashboard-history-action">
                                      <span className="material-symbols-outlined" aria-hidden>ios_share</span>
                                      Share to X
                                    </button>
                                    <button type="button" onClick={() => downloadHistoryReceipt(item)} className="dashboard-history-action">
                                      <span className="material-symbols-outlined" aria-hidden>receipt_long</span>
                                      Receipt
                                    </button>
                                  </div>
                                  <div className="dashboard-history-menu-wrap">
                                    <button
                                      type="button"
                                      className="dashboard-history-menu-trigger"
                                      aria-label="Activity actions"
                                      aria-expanded={isActionMenuOpen}
                                      onClick={() => setHistoryActionsOpen((open) => open === actionKey ? null : actionKey)}
                                    >
                                      <span className="material-symbols-outlined" aria-hidden>more_horiz</span>
                                    </button>
                                    {isActionMenuOpen && (
                                      <div className="dashboard-history-actions-menu">
                                        {item.author_handle && item.tweet_id && (
                                          <a
                                            href={`https://x.com/${item.author_handle.replace(/^@/, "")}/status/${item.tweet_id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="dashboard-history-action"
                                            onClick={() => setHistoryActionsOpen(null)}
                                          >
                                            <span className="material-symbols-outlined" aria-hidden>open_in_new</span>
                                            Post
                                          </a>
                                        )}
                                        <button type="button" onClick={() => { shareHistoryOnX(item); setHistoryActionsOpen(null); }} className="dashboard-history-action">
                                          <span className="material-symbols-outlined" aria-hidden>ios_share</span>
                                          Share to X
                                        </button>
                                        <button type="button" onClick={() => { downloadHistoryReceipt(item); setHistoryActionsOpen(null); }} className="dashboard-history-action">
                                          <span className="material-symbols-outlined" aria-hidden>receipt_long</span>
                                          Download Receipt
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="dashboard-pagination">
                        <span>
                          Showing {(safeHistoryPage - 1) * HISTORY_PAGE_SIZE + 1}-{Math.min(safeHistoryPage * HISTORY_PAGE_SIZE, filteredSentItems.length)} of {filteredSentItems.length}
                        </span>
                        <div className="dashboard-pagination-actions">
                          <button type="button" onClick={() => setHistoryPage((p) => Math.max(1, p - 1))} disabled={safeHistoryPage <= 1}>
                            Previous
                          </button>
                          <span>{safeHistoryPage} / {historyPageCount}</span>
                          <button type="button" onClick={() => setHistoryPage((p) => Math.min(historyPageCount, p + 1))} disabled={safeHistoryPage >= historyPageCount}>
                            Next
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div style={{ display: "none" }}>
                <h3 style={{ fontSize: "1.25rem", margin: "0 0 var(--space-4) 0" }}>Top Supported</h3>
                <div className="dashboard-card" style={{ padding: "var(--space-4) var(--space-5)" }}>
                  {topSupported.length === 0 ? (
                    <div style={{ padding: "var(--space-4) 0", color: "var(--text-muted)", textAlign: "center" }}>No supported creators yet</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                      {topSupported.map((creator, idx) => {
                        const handle = creator.username || creator.authorId || "creator";
                        const total = creator.totalRaw ? Number(creator.totalRaw) / 1e6 : Number(creator.total || 0);
                        return (
                        <div key={handle} className="dashboard-top-supported-item">
                          <div className="dashboard-top-supported-left">
                            <div className="dashboard-top-supported-avatar">
                              <img
                                src={creatorAvatarUrl({ username: creator.username, authorId: creator.authorId, profileImageUrl: creator.profileImageUrl, seed: handle })}
                                alt=""
                                onError={(event) => avatarErrorFallback(event, handle)}
                              />
                              <div className="dashboard-top-supported-rank" style={idx === 0 ? { background: "var(--accent)", color: "#fff" } : idx === 1 ? { background: "#9ca3af", color: "#fff" } : idx === 2 ? { background: "#b45309", color: "#fff" } : {}}>
                                {idx + 1}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: "var(--text-small)", fontWeight: 700 }}>{creator.username ? `@${handle}` : handle}</div>
                              <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{creator.tipCount || 0} Tips given</div>
                            </div>
                          </div>
                          <div style={{ fontSize: "var(--text-small)", fontWeight: 800 }}>
                            ${total.toFixed(2)}
                          </div>
                        </div>
                      )})}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {false && discoverCreators.length > 0 && (
              <div style={{ marginTop: "var(--space-4)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
                  <h3 style={{ fontSize: "1.25rem", margin: 0 }}>Discover Creators</h3>
                </div>
                <div className="dashboard-discover-grid">
                  {discoverCreators.slice(0, 4).map((c: any) => (
                    <div key={c.authorId || c.username} className="dashboard-discover-card">
                      <div className="dashboard-discover-cover">
                        <img src={localInitialsAvatar(c.username)} alt="" />
                      </div>
                      <div className="dashboard-discover-avatar">
                        <img
                          src={creatorAvatarUrl({ username: c.username, authorId: c.authorId, profileImageUrl: c.profileImageUrl })}
                          alt=""
                          onError={(event) => avatarErrorFallback(event, c.username)}
                        />
                      </div>
                      <div className="dashboard-discover-info">
                        <h4>@{c.username}</h4>
                        <p>Web3 Creator</p>
                        <Link to={`/creator/${c.username}`} className="dashboard-discover-btn" style={{ display: "block", textAlign: "center" }}>
                          Send Tip
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {directTipModal}
      </DashboardShell>
    );
  }

  // Creator: full dashboard
  const totalReceived = creatorData?.totalReceivedUsd || "0.00";
  const tipCount = creatorData?.tipCount ?? 0;
  const topPosts = (creatorData?.topPosts || []).slice(0, 5);
  const topSupporters = creatorData?.topSupporters || [];
  const receivedTips = creatorData?.recentTips || [];
  const creatorTipsPageCount = Math.max(1, Math.ceil(receivedTips.length / CREATOR_TIPS_PAGE_SIZE));
  const safeCreatorTipsPage = Math.min(creatorTipsPage, creatorTipsPageCount);
  const pagedReceivedTips = receivedTips.slice((safeCreatorTipsPage - 1) * CREATOR_TIPS_PAGE_SIZE, safeCreatorTipsPage * CREATOR_TIPS_PAGE_SIZE);
  const supporterByAddress = new Map(topSupporters.map((supporter) => [supporter.address.toLowerCase(), supporter]));
  const recentSupporterAddresses = Array.from(new Set(
    receivedTips
      .map((item) => (item.from_addr || item.from_address || "").toLowerCase())
      .filter(Boolean),
  ));
  const repeatSupporterCounts = receivedTips.reduce<Record<string, number>>((counts, item) => {
    const supporter = (item.from_addr || item.from_address || "").toLowerCase();
    if (!supporter) return counts;
    counts[supporter] = (counts[supporter] || 0) + 1;
    return counts;
  }, {});
  const recentSupporters = recentSupporterAddresses
    .map((supporter) => supporterByAddress.get(supporter))
    .filter((supporter): supporter is (typeof topSupporters)[number] => Boolean(supporter));
  const repeatSupporters = topSupporters.filter((supporter) => repeatSupporterCounts[supporter.address.toLowerCase()] > 1);
  const visibleSupporters =
    overviewSupporterTab === "recent"
      ? recentSupporters
      : overviewSupporterTab === "repeat"
        ? repeatSupporters
        : topSupporters;
  const supporterEmptyText =
    overviewSupporterTab === "recent"
      ? "Recent supporters will appear after new tips are indexed."
      : overviewSupporterTab === "repeat"
        ? "Repeat supporters will appear after someone tips more than once."
        : "Supporter totals will appear once tips are indexed.";
  const maxDaily = Math.max(...earningsDaily.map((d) => parseFloat(d.amountUsd)), 0);
  const totalDaily = earningsDaily.reduce((sum, day) => sum + Number(day.amountUsd || 0), 0);
  const dailyAxisTicks = maxDaily > 0 ? [maxDaily, maxDaily / 2, 0] : [0];
  const chartLabels = earningsDaily.length > 0
    ? [
        shortDate(earningsDaily[0]?.date || ""),
        shortDate(earningsDaily[Math.floor(earningsDaily.length / 2)]?.date || ""),
        shortDate(earningsDaily[earningsDaily.length - 1]?.date || ""),
      ].filter(Boolean)
    : [];
  return (
    <DashboardShell address={address} title="Creator Dashboard">
      <div className="dashboard-body-inner creator-overview">
        <section className="creator-overview-hero-grid">
          <div className="creator-overview-hero dashboard-card">
            <div>
              <div className="dashboard-metric-label">Available to withdraw</div>
              <div className="creator-overview-balance">${normalizeRawUsd(balanceRaw)}</div>
              <p>Creator tips earned from your verified X identity and ready for the cash-out flow.</p>
              <div className="creator-overview-actions">
                <Link to="/creator/withdraw" className="btn-primary">Cash out</Link>
                <Link to="/creator/settings?tab=receipts" className="btn-secondary">View receipts</Link>
                <a href={`${WEB_APP_URL}/creator/${creatorData?.username || ""}`} target="_blank" rel="noopener noreferrer" className="creator-overview-icon-btn" aria-label="Open public profile">
                  <span className="material-symbols-outlined" aria-hidden>ios_share</span>
                </a>
              </div>
            </div>
            <div className="creator-overview-balance-split">
              <div className="creator-overview-balance-tile creator-overview-balance-tile--primary">
                <div className="dashboard-metric-label">Total support received</div>
                <strong>${totalReceived}</strong>
                <span>All creator support recorded for your claimed X identity.</span>
              </div>
              <div className="creator-overview-balance-tile">
                <div className="dashboard-metric-label">Main Teep balance</div>
                <strong>${normalizeRawUsd(mainBalanceRaw)}</strong>
                <span>Balance available for tipping and other account actions.</span>
              </div>
            </div>
          </div>

          <aside className="creator-readiness-card dashboard-card">
            <div className="creator-section-head">
              <h3>Next steps</h3>
            </div>
            <div className="creator-readiness-list">
              <div className="creator-readiness-row">
                <span className="creator-readiness-icon is-complete"><span className="material-symbols-outlined" aria-hidden>check</span></span>
                <div>
                  <strong>X account verified</strong>
                  <p>Your creator tips are linked to your verified X identity.</p>
                </div>
                <span className="creator-status is-complete">Done</span>
              </div>
              <div className="creator-readiness-row is-open">
                <span className="creator-readiness-icon" aria-hidden />
                <div>
                  <strong>Review receipt sharing</strong>
                  <p>Choose whether shared tip receipts include amounts.</p>
                </div>
                <Link to="/creator/settings?tab=receipts" className="creator-status">Review</Link>
              </div>
              <div className="creator-readiness-row is-open">
                <span className="creator-readiness-icon" aria-hidden />
                <div>
                  <strong>Explore Grow Tips</strong>
                  <p>See the beta growth option before strategy settings are enabled.</p>
                </div>
                <Link to="/creator/grow/earn" className="creator-status">Open</Link>
              </div>
            </div>
          </aside>
        </section>

        <section className="creator-overview-stats">
          <div className="dashboard-metric-card">
            <div className="dashboard-metric-label">Total received</div>
            <div className="dashboard-metric-value">${totalReceived}</div>
          </div>
          <div className="dashboard-metric-card">
            <div className="dashboard-metric-label">Tips received</div>
            <div className="dashboard-metric-value">{tipCount}</div>
          </div>
          <div className="dashboard-metric-card">
            <div className="dashboard-metric-label">Supporters</div>
            <div className="dashboard-metric-value">{topSupporters.length}</div>
          </div>
          <div className="dashboard-metric-card">
            <div className="dashboard-metric-label">Supported posts</div>
            <div className="dashboard-metric-value">{topPosts.length}</div>
          </div>
        </section>

        <section className="creator-overview-main-grid">
          <div className="dashboard-card creator-latest-card">
            <div className="creator-section-head">
              <h3>Latest tips</h3>
              <span className="creator-section-count">{tipCount} total</span>
            </div>
            {receivedTips.length === 0 ? (
              <div className="dashboard-empty-state">New creator tips will appear here after they are indexed.</div>
            ) : (
              <>
                <div className="creator-tip-list">
                  {pagedReceivedTips.map((item) => {
                    const handle = item.author_handle?.replace(/^@/, "");
                    const postUrl = handle && item.tweet_id ? `https://x.com/${handle}/status/${item.tweet_id}` : "";
                    const supporter = item.from_addr || item.from_address || "";
                    const supporterName = displayAddressName(supporter, item.fromIdentity);
                    return (
                      <article className="creator-tip-row" key={`${item.tx_hash || item.timestamp}-${item.amount}`}>
                        <div className="creator-supporter-avatar">{initialsForIdentity(supporter, item.fromIdentity)}</div>
                        <div>
                          <div className="creator-tip-title">
                            {supporterName} tipped you <span>${formatUsdRaw(item.amount)}</span>
                          </div>
                          <p>{handle ? `For a verified X post by @${handle}` : "For creator support on Teep"}</p>
                          <div className="creator-row-actions">
                            {postUrl && <a href={postUrl} target="_blank" rel="noopener noreferrer">View post</a>}
                            <button type="button" onClick={() => shareHistoryOnX(item)}>Share</button>
                            <button type="button" onClick={() => downloadHistoryReceipt(item)}>Receipt</button>
                          </div>
                        </div>
                        <time>{formatHistoryTime(item.timestamp)}</time>
                      </article>
                    );
                  })}
                </div>
                {receivedTips.length > CREATOR_TIPS_PAGE_SIZE && (
                  <div className="creator-card-pagination">
                    <span>Showing {(safeCreatorTipsPage - 1) * CREATOR_TIPS_PAGE_SIZE + 1}-{Math.min(safeCreatorTipsPage * CREATOR_TIPS_PAGE_SIZE, receivedTips.length)} of {receivedTips.length}</span>
                    <div>
                      <button type="button" onClick={() => setCreatorTipsPage((page) => Math.max(1, page - 1))} disabled={safeCreatorTipsPage <= 1}>Previous</button>
                      <strong>{safeCreatorTipsPage} / {creatorTipsPageCount}</strong>
                      <button type="button" onClick={() => setCreatorTipsPage((page) => Math.min(creatorTipsPageCount, page + 1))} disabled={safeCreatorTipsPage >= creatorTipsPageCount}>Next</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="dashboard-card creator-top-posts-card">
            <div className="creator-section-head">
              <h3>Top tipped posts</h3>
              <Link to="/creator/performance">30D</Link>
            </div>
            {topPosts.length === 0 ? (
              <div className="dashboard-empty-state">Posts that receive tips will appear here.</div>
            ) : (
              <div className="creator-top-post-list">
                {topPosts.slice(0, 4).map((post) => {
                  const handle = post.authorHandle || creatorData?.username || "";
                  const tweetUrl = handle && post.tweetId ? `https://x.com/${handle}/status/${post.tweetId}` : "";
                  const preview = postPreviews[post.contentId];
                  return (
                    <article className="creator-top-post-row" key={post.contentId}>
                      <div className="creator-post-thumb">
                        {preview?.thumbnailUrl ? <img src={preview.thumbnailUrl} alt="" /> : <span>X</span>}
                      </div>
                      <div>
                        <strong>{preview?.excerpt || postDisplayLabel(post)}</strong>
                        <span><b>${post.totalUsd} earned</b> - {post.count} tips</span>
                      </div>
                      {tweetUrl && (
                        <a href={tweetUrl} target="_blank" rel="noopener noreferrer" aria-label="Open post on X">
                          <span className="material-symbols-outlined" aria-hidden>open_in_new</span>
                        </a>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="creator-overview-main-grid creator-overview-main-grid--lower">
          <div className="dashboard-card creator-supporters-card">
            <div className="creator-section-head">
              <h3>Supporters</h3>
              <div className="creator-tabs" role="group" aria-label="Supporter view">
                {(["top", "recent", "repeat"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={overviewSupporterTab === tab ? "is-active" : ""}
                    aria-pressed={overviewSupporterTab === tab}
                    onClick={() => setOverviewSupporterTab(tab)}
                  >
                    {tab[0].toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            {visibleSupporters.length === 0 ? (
              <div className="dashboard-empty-state">{supporterEmptyText}</div>
            ) : (
              <div className="creator-supporter-grid">
                {visibleSupporters.slice(0, 4).map((supporter) => (
                  <Link to={`/tipper/${supporter.address}`} key={supporter.address} className="creator-supporter-tile">
                    <div className="creator-supporter-avatar">{initialsForIdentity(supporter.address, supporter)}</div>
                    <div>
                      <strong>{displayAddressName(supporter.address, supporter)}</strong>
                      <span><b>${supporter.totalUsd}</b> supported</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="creator-side-stack">
            <div className="dashboard-card creator-grow-card">
              <span className="material-symbols-outlined" aria-hidden>eco</span>
              <h3>Grow Tips</h3>
              <p>Move available tip balance into Grow Tips when the beta strategy is enabled.</p>
              <div className="creator-grow-amount">
                <div className="dashboard-metric-label">Available to grow</div>
                <strong>${normalizeRawUsd(balanceRaw)}</strong>
              </div>
              <Link to="/creator/grow/earn" className="creator-grow-cta">
                Explore Grow Tips
                <span className="material-symbols-outlined" aria-hidden>arrow_forward</span>
              </Link>
            </div>
          </div>
        </section>

        <section className="dashboard-card creator-trend-card">
          <div className="creator-section-head">
            <div>
              <h3>Earnings trend</h3>
              <p>Creator support over time.</p>
            </div>
            <div className="creator-trend-head-actions">
              <div className="creator-performance-legend">
                <span>{money(totalDaily)} total</span>
                <span>{money(maxDaily)} best day</span>
              </div>
              <div className="creator-tabs" role="group" aria-label="Earnings chart period">
                {[7, 30, 90].map((days) => (
                  <button key={days} type="button" className={chartDays === days ? "is-active" : ""} aria-pressed={chartDays === days} onClick={() => setChartDays(days)}>
                    {days}D
                  </button>
                ))}
              </div>
            </div>
          </div>
          {earningsDaily.length === 0 ? (
            <div className="dashboard-empty-state">Earnings trend appears after creator tips are indexed.</div>
          ) : (
            <>
              <div className="creator-trend-plot">
                <div className="creator-trend-axis" aria-hidden>
                  {dailyAxisTicks.map((tick) => <span key={tick}>{money(tick)}</span>)}
                </div>
                <div
                  className={`creator-trend-chart ${chartDays >= 90 ? "creator-trend-chart--dense" : ""}`}
                  style={{ gridTemplateColumns: `repeat(${earningsDaily.length}, minmax(0, 1fr))` }}
                  role="img"
                  aria-label={`Earnings trend for ${chartDays} days. Total ${money(totalDaily)}. Best day ${money(maxDaily)}.`}
                >
                  {earningsDaily.map((day) => {
                    const amount = parseFloat(day.amountUsd);
                    const height = maxDaily > 0 ? Math.max((amount / maxDaily) * 100, amount > 0 ? 5 : 2) : 2;
                    return (
                      <div key={day.date} className="creator-trend-bar-wrap" title={`${day.date}: ${money(day.amountUsd)}`} aria-hidden>
                        <div className="creator-trend-bar" style={{ height: `${height}%` }} />
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="creator-trend-labels">
                {chartLabels.map((label) => <span key={label}>{label}</span>)}
              </div>
            </>
          )}
        </section>
      </div>
      {directTipModal}
    </DashboardShell>
  );

}
