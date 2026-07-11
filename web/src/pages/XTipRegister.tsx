import { Link, useSearchParams } from "react-router-dom";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import DashboardShell from "../components/DashboardShell";
import { DashboardConnectCard, DashboardPreparingPage } from "../components/DashboardAuthState";

function cleanHandle(value: string | null) {
  return (value || "").replace(/^@/, "").trim().toLowerCase();
}

function cleanAmount(value: string | null) {
  const normalized = (value || "").trim().replace(/^\$/, "");
  return /^\d+(\.\d{1,2})?$/.test(normalized) ? normalized : "";
}

function appendParams(path: string, params: URLSearchParams) {
  const next = new URLSearchParams();
  for (const key of ["intent", "tweetId", "recipient", "amount"]) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  const query = next.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

export default function XTipRegister() {
  const [searchParams] = useSearchParams();
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  const { client: smartWalletClient } = useSmartWallets();
  const embeddedWallet = wallets.find((wallet) => wallet.walletClientType === "privy");
  const address = (smartWalletClient?.account?.address || embeddedWallet?.address || (user?.wallet as { address?: string } | undefined)?.address || "").toLowerCase();
  const recipient = cleanHandle(searchParams.get("recipient"));
  const amount = cleanAmount(searchParams.get("amount"));
  const intent = searchParams.get("intent") || "x-tip";
  const isTipIntent = intent === "x-tip" && recipient && amount;
  const fundPath = appendParams("/fund", searchParams);

  if (!ready) {
    return <DashboardPreparingPage title="Continue with Teep" message="Preparing your X tip." />;
  }

  if (!authenticated) {
    return (
      <DashboardShell title="Continue with Teep">
        <DashboardConnectCard
          message={
            isTipIntent
              ? `Sign in to continue the $${amount} tip to @${recipient}.`
              : "Sign in to connect your Teep account and continue from X."
          }
        />
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title="Continue with Teep" address={address}>
      <main className="dashboard-body-inner">
        <section className="dashboard-page-heading" style={{ maxWidth: 760 }}>
          <p className="eyebrow">X tip setup</p>
          <h1 style={{ margin: 0 }}>{isTipIntent ? `Send $${amount} to @${recipient}` : "Finish your Teep setup"}</h1>
          <p style={{ color: "var(--text-secondary)", maxWidth: 620 }}>
            {isTipIntent
              ? "You are signed in. Fund your Teep balance, then return to X and run the same tip command."
              : "Your Teep account is ready. Add funds or connect X tipping from settings when you are ready."}
          </p>
        </section>

        <section className="dashboard-card" style={{ display: "grid", gap: "var(--space-5)", maxWidth: 760 }}>
          <div style={{ display: "grid", gap: "var(--space-3)" }}>
            <div className="dashboard-settings-list-row" style={{ alignItems: "center" }}>
              <div>
                <strong>Recipient</strong>
                <span>{recipient ? `@${recipient}` : "Selected from X"}</span>
              </div>
              <strong style={{ color: "var(--text-primary)" }}>{amount ? `$${amount}` : "Ready"}</strong>
            </div>
            <div className="dashboard-settings-list-row" style={{ alignItems: "center" }}>
              <div>
                <strong>Your Teep account</strong>
                <span>{address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Ready"}</span>
              </div>
              <span className="creator-status">Signed in</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <Link to={fundPath} className="btn-primary">
              Fund balance
            </Link>
            <Link to="/dashboard/settings?tab=tipping" className="btn-secondary">
              X tipping settings
            </Link>
          </div>

          <p className="dashboard-funding-note" style={{ margin: 0 }}>
            After funding, go back to X and send the command again. If X tipping is enabled, Teep can process eligible small tips using your saved limits.
          </p>
        </section>
      </main>
    </DashboardShell>
  );
}
