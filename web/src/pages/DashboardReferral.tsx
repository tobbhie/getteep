import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import DashboardShell from "../components/DashboardShell";
import { DashboardConnectPage, DashboardPreparingPage } from "../components/DashboardAuthState";
import { useReferral } from "../context/ReferralContext";

export default function DashboardReferral() {
  const { ready, authenticated } = usePrivy();
  const { address, code, appliedCode, referredCount, status, loading, referralUrl, createCode, copyLink, applyCode } = useReferral();
  const [manualCode, setManualCode] = useState("");
  const [applyMessage, setApplyMessage] = useState<{ type: "success" | "error" | "info"; text: string } | null>(null);

  const handleApplyCode = async () => {
    const result = await applyCode(manualCode);
    setApplyMessage({
      type: result.ok ? (result.alreadyLinked ? "info" : "success") : "error",
      text: result.message,
    });
    if (result.ok) setManualCode("");
  };

  if (!ready) {
    return <DashboardPreparingPage title="Referrals" />;
  }
  if (!authenticated) {
    return <DashboardConnectPage title="Referrals" />;
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

            <section className="dashboard-metric-card dashboard-referral-manual">
              <div className="dashboard-metric-label">Have a Referral Code?</div>
              <h3>{appliedCode ? "Referral linked" : "Apply a code"}</h3>
              <div className="dashboard-referral-apply-row">
                <input
                  value={appliedCode || manualCode}
                  onChange={(event) => setManualCode(event.target.value)}
                  placeholder="Enter referral code or Teep referral link"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={Boolean(appliedCode)}
                  readOnly={Boolean(appliedCode)}
                />
                {!appliedCode && (
                  <button type="button" className="btn-primary" onClick={handleApplyCode} disabled={loading || !manualCode.trim()}>
                    Apply
                  </button>
                )}
              </div>
              {applyMessage && <p className={`dashboard-referral-apply-message is-${applyMessage.type}`}>{applyMessage.text}</p>}
              <p className="dashboard-settings-muted">
                {appliedCode ? "This account is already linked to a referral code." : "Paste a referral code or a full Teep referral link."}
              </p>
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
