import { ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import DashboardShell from "./DashboardShell";

type CreatorDashboardShellProps = {
  title: string;
  children: ReactNode;
};

export const creatorNavPaths = {
  dashboard: "/creator/dashboard",
  withdraw: "/creator/withdraw",
  settings: "/creator/settings",
  referrals: "/creator/referrals",
  performance: "/creator/performance",
  earn: "/creator/grow/earn",
  learn: "/creator/grow/learn",
  growSettings: "/creator/grow/settings",
  tipperDashboard: "/dashboard",
  tipperSettings: "/dashboard/settings",
} as const;

export default function CreatorDashboardShell({ title, children }: CreatorDashboardShellProps) {
  const { ready, authenticated } = usePrivy();
  const { client: smartWalletClient } = useSmartWallets();
  const address = ready && authenticated ? (smartWalletClient?.account?.address || "").toLowerCase() : "";

  return (
    <DashboardShell address={address} title={title}>
      {children}
    </DashboardShell>
  );
}
