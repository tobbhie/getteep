import { useEffect, useState } from "react";
import { Navigate, Routes, Route, useLocation, useParams, useSearchParams } from "react-router-dom";
import Layout from "./Layout";
import Home from "./pages/Home";
import TipPost from "./pages/TipPost";
import CreatorProfile from "./pages/CreatorProfile";
import TipperProfile from "./pages/TipperProfile";
import Fees from "./pages/Fees";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";
import Support from "./pages/Support";
import Leaderboard from "./pages/Leaderboard";
import FundAccount from "./pages/FundAccount";
import Dashboard from "./pages/Dashboard";
import DashboardWithdraw from "./pages/DashboardWithdraw";
import DashboardDiscover from "./pages/DashboardDiscover";
import DashboardReferral from "./pages/DashboardReferral";
import DashboardSettings from "./pages/DashboardSettings";
import CreatorPerformance from "./pages/CreatorPerformance";
import CreatorDashboardHome from "./pages/CreatorDashboardHome";
import CreatorGrowLearn from "./pages/CreatorGrowLearn";
import CreatorGrowSettings from "./pages/CreatorGrowSettings";
import GrowTips from "./pages/GrowTips";
import AdminOps from "./pages/AdminOps";
import NotFound from "./pages/NotFound";
import TxReceipt from "./pages/TxReceipt";
import { useAccountRole } from "./context/AccountRoleContext";
import { DashboardPreparingPage } from "./components/DashboardAuthState";
import { API_BASE } from "./config";
import { normalizeReferralCode, storePendingReferralCode } from "./lib/referral";

const RESERVED_TOP_LEVEL_ROUTES = new Set([
  "api",
  "auth",
  "creator",
  "dashboard",
  "defi",
  "faucet",
  "fees",
  "fund",
  "health",
  "leaderboard",
  "milestones",
  "ops",
  "privacy",
  "profile",
  "referral",
  "stats",
  "support",
  "t",
  "terms",
  "tips",
  "tx",
  "withdrawal",
]);

function DashboardEntry() {
  const [searchParams] = useSearchParams();
  const accountRole = useAccountRole();
  const explicitTipperView = searchParams.get("view") === "tipper";

  if (accountRole.status === "loading" && !explicitTipperView) {
    return <DashboardPreparingPage title="Overview" address={accountRole.address} />;
  }

  if (accountRole.status === "ready" && accountRole.isCreator && !explicitTipperView) {
    return <Navigate to="/creator/dashboard" replace />;
  }

  return <Dashboard mode="tipper" />;
}

function isWalletLike(value: string | undefined) {
  return Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value));
}

function PublicUserResolver() {
  const { id } = useParams<{ id: string }>();
  return isWalletLike(id) ? <TipperProfile /> : <CreatorProfile />;
}

function LegacyCreatorProfileRedirect() {
  const { username } = useParams<{ username: string }>();
  return <Navigate to={`/creator/${encodeURIComponent(username || "")}`} replace />;
}

function LegacyTopLevelCreatorRedirect() {
  const { username } = useParams<{ username: string }>();
  const cleanUsername = (username || "").trim().replace(/^@/, "").toLowerCase();
  const [status, setStatus] = useState<"checking" | "found" | "missing">("checking");

  useEffect(() => {
    if (!/^[a-z0-9_]{1,30}$/.test(cleanUsername) || RESERVED_TOP_LEVEL_ROUTES.has(cleanUsername)) {
      setStatus("missing");
      return;
    }

    let cancelled = false;
    setStatus("checking");
    fetch(`${API_BASE}/api/v1/profile/username/${encodeURIComponent(cleanUsername)}`, {
      headers: { Accept: "application/json" },
    })
      .then((response) => {
        if (!cancelled) setStatus(response.ok ? "found" : "missing");
      })
      .catch(() => {
        if (!cancelled) setStatus("missing");
      });

    return () => {
      cancelled = true;
    };
  }, [cleanUsername]);

  if (status === "found") {
    return <Navigate to={`/creator/${encodeURIComponent(cleanUsername)}`} replace />;
  }

  if (status === "missing") {
    return <NotFound />;
  }

  return (
    <main className="public-shell public-empty">
      <section className="dashboard-card">
        <p className="eyebrow">Checking profile</p>
        <h1>Opening Teep profile</h1>
      </section>
    </main>
  );
}

export default function App() {
  const location = useLocation();

  useEffect(() => {
    const code = normalizeReferralCode(new URLSearchParams(location.search).get("ref"));
    if (code) storePendingReferralCode(code);
  }, [location.search]);

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tx/:txHash" element={<TxReceipt />} />
        <Route path="/dashboard" element={<DashboardEntry />} />
        <Route path="/dashboard/withdraw" element={<DashboardWithdraw />} />
        <Route path="/dashboard/discover" element={<DashboardDiscover />} />
        <Route path="/dashboard/referrals" element={<DashboardReferral />} />
        <Route path="/dashboard/settings" element={<DashboardSettings />} />
        <Route path="/dashboard/grow-tips" element={<GrowTips />} />
        <Route path="/creator/dashboard" element={<CreatorDashboardHome />} />
        <Route path="/creator/withdraw" element={<DashboardWithdraw />} />
        <Route path="/creator/settings" element={<DashboardSettings />} />
        <Route path="/creator/referrals" element={<DashboardReferral />} />
        <Route path="/creator/performance" element={<CreatorPerformance />} />
        <Route path="/creator/grow/earn" element={<GrowTips />} />
        <Route path="/creator/grow/learn" element={<CreatorGrowLearn />} />
        <Route path="/creator/grow/settings" element={<CreatorGrowSettings />} />
        <Route path="/t/:handle/:tweetId" element={<TipPost />} />
        <Route path="/creator/:username" element={<CreatorProfile />} />
        <Route path="/profile/creator/:username" element={<LegacyCreatorProfileRedirect />} />
        <Route path="/tipper/:address" element={<TipperProfile />} />
        <Route path="/profile/tipper/:address" element={<TipperProfile />} />
        <Route path="/u/:id" element={<PublicUserResolver />} />
        <Route path="/fees" element={<Fees />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/support" element={<Support />} />
        <Route path="/fund" element={<FundAccount />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/ops" element={<AdminOps />} />
        <Route path="/ops/dashboard" element={<AdminOps />} />
        <Route path="/:username" element={<LegacyTopLevelCreatorRedirect />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
