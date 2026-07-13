import type React from "react";
import { Link } from "react-router-dom";

const faqItems: { q: string; a: React.ReactNode }[] = [
  {
    q: "How do I tip?",
    a: "Launch the Teep web app, add test funds, then tip from a creator page, direct post tip link, or a supported X tip command.",
  },
  {
    q: "How do I add funds?",
    a: "During the beta, use the supported testnet faucet or receive test funds from another compatible wallet. Card and bank funding are not enabled.",
  },
  {
    q: "How do I withdraw?",
    a: (
      <>
        Open Withdraw from Teep to transfer test funds to a compatible wallet. Bank withdrawals are not enabled
        during the testnet beta. See <Link to="/fees">Fees</Link> for details.
      </>
    ),
  },
  {
    q: "Why are tips final?",
    a: "A confirmed blockchain transaction cannot be reversed by Teep. Check the creator and amount before signing.",
  },
  {
    q: "How do I get a receipt?",
    a: "After you tip, you can open or share the transaction receipt. Activity may take a short moment to appear while the web indexer catches up.",
  },
  {
    q: "I am a creator. How do I receive tips?",
    a: "Link and verify your X account. Teep then connects supported creator activity to your claim flow and creator dashboard.",
  },
  {
    q: "Why does my history or total look delayed?",
    a: "Teep reads blockchain activity through an indexer. If a confirmed transaction is missing for more than a few minutes, contact support with its transaction hash.",
  },
];

const headingStyle = {
  fontSize: "var(--text-heading)",
  fontWeight: 600,
  marginTop: "var(--space-6)",
  marginBottom: "var(--space-2)",
};

export default function Support() {
  return (
    <div className="page-section" style={{ paddingTop: "var(--space-4)" }}>
      <h1 style={{ fontSize: "var(--text-title)", marginBottom: "var(--space-4)" }}>Support</h1>
      <p style={{ color: "var(--text-primary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-4)" }}>
        Teep currently runs as an Arc testnet beta using test funds with no real-world value. For questions about
        tipping, withdrawals, privacy, or your account, contact{" "}
        <a href="mailto:support@getteep.xyz" style={{ color: "var(--link)" }}>support@getteep.xyz</a>.
        We aim to respond within a few business days.
      </p>

      <h2 style={headingStyle}>Frequently asked questions</h2>
      <dl style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)" }}>
        {faqItems.map(({ q, a }) => (
          <div key={q} style={{ marginTop: "var(--space-3)" }}>
            <dt style={{ fontWeight: 600, color: "var(--text-primary)" }}>{q}</dt>
            <dd style={{ marginLeft: 0, marginBottom: "var(--space-2)", marginTop: "var(--space-1)" }}>{a}</dd>
          </div>
        ))}
      </dl>

      <h2 style={headingStyle}>What we can help with</h2>
      <ul style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", paddingLeft: "var(--space-5)" }}>
        <li>Launching the web app and connecting your account</li>
        <li>Using test funds and withdrawing to a compatible wallet</li>
        <li>Creator verification, referrals, balances, and receipts</li>
        <li>Missing or delayed indexed activity</li>
        <li>Privacy requests and account deletion</li>
        <li>Technical or security issues</li>
      </ul>

      <h2 id="account-deletion" style={headingStyle}>Account and data deletion</h2>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-2)" }}>
        Email{" "}
        <a href="mailto:support@getteep.xyz?subject=Account%20deletion%20request" style={{ color: "var(--link)" }}>
          support@getteep.xyz
        </a>{" "}
        from your account email with the subject "Account deletion request." Include your Teep wallet address or
        connected X handle. We may ask you to verify ownership before deleting account records.
      </p>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-2)" }}>
        Account deletion removes Teep-controlled account records where possible. Public blockchain transactions cannot
        be deleted, and limited records may be retained when required for security, fraud prevention, or legal obligations.
      </p>

      <h2 style={headingStyle}>Limits</h2>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-2)" }}>
        Teep cannot reverse confirmed transactions or remove public blockchain records. Teep is not affiliated
        with, endorsed by, or sponsored by X Corp.
      </p>

      <p style={{ color: "var(--text-muted)", fontSize: "var(--text-small)", marginTop: "var(--space-6)" }}>
        Read the <Link to="/terms">Terms</Link>, <Link to="/privacy">Privacy Policy</Link>, and <Link to="/fees">Fees</Link>.
      </p>
    </div>
  );
}
