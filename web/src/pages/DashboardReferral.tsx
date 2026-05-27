import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { API_BASE, WEB_APP_URL } from "../config";
import DashboardShell from "../components/DashboardShell";

export default function DashboardReferral() {
  const { ready, authenticated, login } = usePrivy();
  const { client: smartWalletClient } = useSmartWallets();
  const address = (ready && authenticated ? smartWalletClient?.account?.address || "" : "").toLowerCase();

  const [code, setCode] = useState<string | null>(null);
  const [referredCount, setReferredCount] = useState(0);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const referralUrl = code ? `${WEB_APP_URL || window.location.origin}/?ref=${encodeURIComponent(code)}` : "";

  const requestWalletProof = useCallback(async () => {
    if (!address || !smartWalletClient?.account) throw new Error("Connect your account first.");
    const challengeRes = await fetch(`${API_BASE}/auth/wallet/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, purpose: "referral-code" }),
    });
    const challenge = await challengeRes.json();
    if (!challengeRes.ok || !challenge.message) throw new Error(challenge.error || "Could not verify account.");
    const signature = await smartWalletClient.signMessage({
      account: smartWalletClient.account,
      message: challenge.message,
    } as Parameters<typeof smartWalletClient.signMessage>[0]);
    return { message: challenge.message, signature };
  }, [address, smartWalletClient]);

  const loadReferral = useCallback(async () => {
    if (!address) return;
    const [codeRes, statsRes] = await Promise.all([
      fetch(`${API_BASE}/referral/code/${address}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`${API_BASE}/referral/stats/${address}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    setCode(codeRes?.code || null);
    setReferredCount(Number(statsRes?.referredCount || 0));
  }, [address]);

  useEffect(() => {
    if (address) loadReferral();
  }, [address, loadReferral]);

  const createCode = useCallback(async (): Promise<string | null> => {
    setLoading(true);
    setStatus("");
    try {
      const walletProof = await requestWalletProof();
      const response = await fetch(`${API_BASE}/referral/code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, walletProof }),
      });
      const data = await response.json();
      if (!response.ok || !data.code) throw new Error(data.error || "Could not create referral link.");
      setCode(data.code);
      setStatus("Referral link ready.");
      return String(data.code);
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "Could not create referral link.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [address, requestWalletProof]);

  const copyLink = useCallback(async () => {
    try {
      const usableCode = code || await createCode();
      const link = usableCode ? `${WEB_APP_URL || window.location.origin}/?ref=${encodeURIComponent(usableCode)}` : referralUrl;
      if (!link) return;
      await navigator.clipboard.writeText(link);
      setStatus("Referral link copied.");
    } catch {
      setStatus("Could not copy referral link.");
    }
  }, [code, createCode, referralUrl]);

  if (!ready) {
    return (
      <DashboardShell title="Referrals">
        <main className="dashboard-body-inner">
          <div className="dashboard-empty-auth"><h1>Referrals</h1><p>Preparing your dashboard.</p></div>
        </main>
      </DashboardShell>
    );
  }
  if (!authenticated) {
    return (
      <DashboardShell title="Referrals">
        <main className="dashboard-body-inner">
          <div className="dashboard-empty-auth">
            <h1>Connect your account</h1>
            <p>Sign in to manage your Teep referral link.</p>
            <button type="button" className="btn-primary" onClick={login}>Connect</button>
          </div>
        </main>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell address={address} title="Referrals">
        <main className="dashboard-body-inner">
          <div className="dashboard-page-heading">
            <div>
              <h1>Referral program</h1>
              <p>Invite people to Teep and earn when referred users become active and withdraw earned tips.</p>
            </div>
          </div>
          <div className="dashboard-referral-grid">
            <section className="dashboard-metric-card dashboard-referral-hero">
              <div className="dashboard-metric-label">Your Referral Link</div>
              <h3>{!address ? "Preparing your referral link" : code ? "Ready to share" : "Create your referral link"}</h3>
              <div className="dashboard-referral-link-box">
                <span>{!address ? "Waiting for your account..." : referralUrl || "Create a link to start sharing"}</span>
              </div>
              <div className="dashboard-referral-actions">
                <button type="button" className="btn-primary" onClick={code ? copyLink : createCode} disabled={loading || !address}>
                  {loading ? "Preparing..." : code ? "Copy Link" : "Create Link"}
                </button>
                {code && (
                  <a
                    className="btn-secondary"
                    href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`I use Teep to support creators directly. Join with my referral link: ${referralUrl}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Share to X
                  </a>
                )}
              </div>
              {status && <p className="dashboard-settings-status">{status}</p>}
            </section>

            <section className="dashboard-metric-card dashboard-referral-economics">
              <div className="dashboard-metric-label">Fee Split</div>
              <div className="dashboard-referral-split">
                <div>
                  <strong>5%</strong>
                  <span>withdrawal fee on earned tips</span>
                </div>
                <div>
                  <strong>30%</strong>
                  <span>of that fee can go to the referrer</span>
                </div>
                <div>
                  <strong>70%</strong>
                  <span>of that fee remains protocol revenue</span>
                </div>
              </div>
              <p className="dashboard-settings-muted">
                Referral rewards are only calculated on eligible creator earned-tip withdrawals, not when a normal tip is sent.
              </p>
            </section>

            <section className="dashboard-metric-card">
              <div className="dashboard-metric-label">Referral Stats</div>
              <div className="dashboard-referral-stat">
                <strong>{address ? referredCount : <span className="dashboard-inline-skeleton" />}</strong>
                <span>Linked accounts</span>
              </div>
              <p className="dashboard-settings-muted">
                Referral earnings are credited when a referred user becomes eligible and performs a fee-bearing withdrawal.
              </p>
            </section>

            <section className="dashboard-metric-card dashboard-referral-flow">
              <div className="dashboard-metric-label">Reward Lifecycle</div>
              <div className="dashboard-referral-steps">
                <div>
                  <span>1</span>
                  <div>
                    <strong>User joins with your link</strong>
                    <p>Their account is linked to your referral code after wallet proof. A user can only be linked once.</p>
                  </div>
                </div>
                <div>
                  <span>2</span>
                  <div>
                    <strong>Referral becomes active</strong>
                    <p>The referred user needs to meet the activity rule, currently at least one sent tip, before rewards apply.</p>
                  </div>
                </div>
                <div>
                  <span>3</span>
                  <div>
                    <strong>They withdraw earned tips</strong>
                    <p>When they withdraw creator earnings, Teep calculates the withdrawal fee and referral share.</p>
                  </div>
                </div>
                <div>
                  <span>4</span>
                  <div>
                    <strong>Your reward lands in tip balance</strong>
                    <p>Referral rewards are credited to your main balance, so you can use them to tip creators or withdraw later.</p>
                  </div>
                </div>
              </div>
            </section>

            <section className="dashboard-metric-card dashboard-referral-rules">
              <div className="dashboard-metric-label">Limits & Anti-Gaming</div>
              <ul>
                <li>No self-referrals: the referred wallet cannot be the same as the referrer.</li>
                <li>One referral link per user: once linked, the referrer cannot be changed casually.</li>
                <li>Wallet proof is required to create or apply a referral code.</li>
                <li>Referral rewards only activate after real tipping activity.</li>
                <li>Referral volume is capped per referrer and suspicious patterns are flagged for abuse review.</li>
              </ul>
            </section>
          </div>
        </main>
    </DashboardShell>
  );
}
