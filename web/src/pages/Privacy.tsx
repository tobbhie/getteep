import { Link } from "react-router-dom";

const lastUpdated = "2026-05-13";

export default function Privacy() {
  return (
    <div className="page-section" style={{ paddingTop: "var(--space-4)" }}>
      <h1 style={{ fontSize: "var(--text-title)", marginBottom: "var(--space-2)" }}>Privacy Policy</h1>
      <p style={{ color: "var(--text-muted)", fontSize: "var(--text-small)", marginBottom: "var(--space-4)" }}>
        Last updated: {lastUpdated}
      </p>

      <p style={{ color: "var(--text-primary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-4)" }}>
        Teep (“we”, “our”) respects your privacy. This policy describes what we collect, how we use it, and your rights. We do not sell your personal data.
      </p>

      <h2 style={{ fontSize: "var(--text-heading)", fontWeight: 600, marginTop: "var(--space-6)", marginBottom: "var(--space-2)" }}>
        What we collect
      </h2>
      <ul style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", paddingLeft: "var(--space-5)", marginBottom: "var(--space-4)" }}>
        <li><strong style={{ color: "var(--text-primary)" }}>Account and identity:</strong> Email address (e.g. when you sign in), wallet addresses you connect, and X (Twitter) account linkage — such as your X handle and verification state — when you connect or claim as a creator.</li>
        <li><strong style={{ color: "var(--text-primary)" }}>Usage and transactions:</strong> Tips you send or receive, withdrawal and referral activity, and other actions needed to run the service. Transaction data is also recorded on a public blockchain.</li>
        <li><strong style={{ color: "var(--text-primary)" }}>Technical:</strong> Logs (e.g. IP, device/browser type) for security, fraud prevention, and fixing issues.</li>
      </ul>

      <h2 style={{ fontSize: "var(--text-heading)", fontWeight: 600, marginTop: "var(--space-6)", marginBottom: "var(--space-2)" }}>
        How we use it
      </h2>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-4)" }}>
        We use this information to operate Teep: process tips and withdrawals, run referral programs, prevent abuse, provide support, comply with law, and improve the product. We do not sell your data to third parties for marketing or advertising.
      </p>

      <h2 style={{ fontSize: "var(--text-heading)", fontWeight: 600, marginTop: "var(--space-6)", marginBottom: "var(--space-2)" }}>
        Retention
      </h2>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-4)" }}>
        We keep account, claim, support, withdrawal, abuse-prevention, and provider-session records only as long as needed to operate the beta, support users, prevent fraud, and meet legal obligations. On-chain data is permanent and public. You can ask us to delete or correct personal data we hold; see “Your rights” below.
      </p>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-4)" }}>
        Our current beta retention target is up to 24 months for account, support, withdrawal, provider, and security records unless a longer period is required for an active investigation, legal need, or financial auditability. Operational logs are generally kept for 30 to 90 days.
      </p>

      <h2 style={{ fontSize: "var(--text-heading)", fontWeight: 600, marginTop: "var(--space-6)", marginBottom: "var(--space-2)" }}>
        Your rights
      </h2>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-2)" }}>
        Depending on where you live, you may have the right to:
      </p>
      <ul style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", paddingLeft: "var(--space-5)", marginBottom: "var(--space-4)" }}>
        <li>Access the personal data we hold about you</li>
        <li>Correct inaccurate data</li>
        <li>Request deletion of your data (subject to legal and operational needs)</li>
        <li>Data portability (e.g. a copy of your data in a usable format)</li>
        <li>Object to or restrict certain processing</li>
        <li>If you are in the EU/EEA/UK: lodge a complaint with your local data protection authority</li>
      </ul>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-4)" }}>
        To exercise these rights, contact us at{" "}
        <a href="mailto:support@teep.xyz" style={{ color: "var(--link)" }}>support@teep.xyz</a> or use the subject “Privacy request”. We will respond within a reasonable time.
      </p>

      <h2 style={{ fontSize: "var(--text-heading)", fontWeight: 600, marginTop: "var(--space-6)", marginBottom: "var(--space-2)" }}>
        Cookies and similar tech
      </h2>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-4)" }}>
        We use only what’s needed to run the service: for example, session and security. We don’t use third-party advertising cookies. You can control cookies in your browser settings.
      </p>

      <h2 style={{ fontSize: "var(--text-heading)", fontWeight: 600, marginTop: "var(--space-6)", marginBottom: "var(--space-2)" }}>
        Changes
      </h2>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-4)" }}>
        We may update this policy from time to time. We’ll post the new version here and update the “Last updated” date. Continued use of Teep after changes means you accept the updated policy.
      </p>

      <p style={{ color: "var(--text-muted)", fontSize: "var(--text-small)", marginTop: "var(--space-6)" }}>
        For support, see <Link to="/support">Support</Link>. For legal terms, see <Link to="/terms">Terms</Link>.
      </p>
    </div>
  );
}
