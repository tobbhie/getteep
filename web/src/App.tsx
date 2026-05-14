import { Routes, Route } from "react-router-dom";
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
import Dashboard from "./pages/Dashboard";
import DashboardWithdraw from "./pages/DashboardWithdraw";
import GrowTips from "./pages/GrowTips";
import NotFound from "./pages/NotFound";
import TxReceipt from "./pages/TxReceipt";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/tx/:txHash" element={<TxReceipt />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/dashboard/withdraw" element={<DashboardWithdraw />} />
        <Route path="/dashboard/grow-tips" element={<GrowTips />} />
        <Route path="/t/:handle/:tweetId" element={<TipPost />} />
        <Route path="/profile/tipper/:address" element={<TipperProfile />} />
        <Route path="/fees" element={<Fees />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/support" element={<Support />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/:username" element={<CreatorProfile />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
