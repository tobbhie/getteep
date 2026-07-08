import { Link } from "react-router-dom";

export default function Terms() {
  return (
    <div className="page-section" style={{ paddingTop: "var(--space-4)" }}>
      <h1 style={{ fontSize: "var(--text-title)", marginBottom: "var(--space-4)" }}>Terms of Service</h1>
      <p style={{ color: "var(--text-primary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-4)" }}>
        <strong>Teep is currently a testnet beta.</strong> Balances and transactions use test funds on Arc testnet.
        Test funds have no real-world monetary value and cannot be withdrawn to a bank.
      </p>
      <p style={{ color: "var(--text-primary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-4)" }}>
        <strong>Tips are final.</strong> Once you send money to a creator, we cannot reverse or refund it.
        Only tip people you trust.
      </p>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-4)" }}>
        You are responsible for your account and keeping it secure. We do not have access to your funds.
      </p>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-4)" }}>
        Teep may show balances, receipts, and history from indexed blockchain activity and provider records. During beta, displayed history can lag while indexing catches up, but completed blockchain transactions remain final.
      </p>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-4)" }}>
        <strong style={{ color: "var(--text-primary)" }}>X tip commands require your X connection.</strong> When you connect X for Teep commands, you authorize Teep to process commands from that connected X account within your configured limits. The default limits are $10 per tip and $50 per day, and you can pause or change them in Settings. Creating a Teep account alone does not authorize X tip commands.
      </p>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)" }}>
        Teep is an independent product and is not affiliated with, endorsed by, or sponsored by X Corp. For support, see <Link to="/support">Support</Link>.
      </p>
    </div>
  );
}
