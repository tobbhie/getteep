import { Link } from "react-router-dom";

const faqItems: { q: string; a: React.ReactNode }[] = [
  {
    q: "How do I tip?",
    a: "Install the Teep extension for Chrome or Brave, add funds to your balance, then use the tip button on any post on X. Your tip goes directly to the creator.",
  },
  {
    q: "How do I add funds?",
    a: "In the Teep extension, open your balance and choose “Add funds”. You can add money with a card or other methods we support. Your balance is shown in dollars.",
  },
  {
    q: "How do I cash out (withdraw)?",
    a: (
      <>
        In the extension, open your balance and tap “Cash out tips”. You’ll complete the withdrawal on our secure page to your bank or wallet. A small fee applies when you withdraw; there’s no fee when you tip. See <Link to="/fees">Fees</Link> for details.
      </>
    ),
  },
  {
    q: "Why are tips final?",
    a: "Once you send a tip, we cannot reverse or refund it. Tips are like sending cash: only tip people you trust. Any dispute about content or delivery is between you and the creator. We don’t reverse completed tips.",
  },
  {
    q: "How do I get a receipt?",
    a: "After you tip, you can share a receipt on X or generate a receipt image from the extension. Your transaction history is also visible in the extension and on your tipper profile if you’ve received tips.",
  },
  {
    q: "I’m a creator — how do I receive tips?",
    a: "Link your X account in the Teep extension and claim your wallet. Once linked, tips sent to your posts go to your Teep balance. You can cash out from the extension or at teep.xyz/dashboard.",
  },
  {
    q: "Why does my history or total look delayed?",
    a: "Teep reads blockchain activity through an indexer. A completed tip can appear in the extension first, then settle into web history after the indexer catches up. If a confirmed transaction is missing for more than a few minutes, contact support with the receipt or transaction hash.",
  },
];

export default function Support() {
  return (
    <div className="page-section" style={{ paddingTop: "var(--space-4)" }}>
      <h1 style={{ fontSize: "var(--text-title)", marginBottom: "var(--space-4)" }}>Support</h1>
      <p style={{ color: "var(--text-primary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-4)" }}>
        We’re here to help. For questions about tipping, withdrawals, or your account, contact us at{" "}
        <a href="mailto:support@teep.xyz" style={{ color: "var(--link)" }}>
          support@teep.xyz
        </a>
        . We aim to respond within a few business days.
      </p>

      <h2 style={{ fontSize: "var(--text-heading)", fontWeight: 600, marginTop: "var(--space-6)", marginBottom: "var(--space-2)" }}>
        Frequently asked questions
      </h2>
      <dl style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)" }}>
        {faqItems.map(({ q, a }) => (
          <div key={q} style={{ marginTop: "var(--space-3)" }}>
            <dt style={{ fontWeight: 600, color: "var(--text-primary)" }}>{q}</dt>
            <dd style={{ marginLeft: 0, marginBottom: "var(--space-2)", marginTop: "var(--space-1)" }}>{a}</dd>
          </div>
        ))}
      </dl>

      <h2 style={{ fontSize: "var(--text-heading)", fontWeight: 600, marginTop: "var(--space-6)", marginBottom: "var(--space-2)" }}>
        What we can help with
      </h2>
      <ul style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", paddingLeft: "var(--space-5)" }}>
        <li>Installing the extension and connecting your account</li>
        <li>Adding funds and cashing out</li>
        <li>Understanding fees and referral</li>
        <li>Creator claim and verification</li>
        <li>Missing or delayed receipts, balances, and history</li>
        <li>Technical issues or errors in the product</li>
      </ul>

      <h2 style={{ fontSize: "var(--text-heading)", fontWeight: 600, marginTop: "var(--space-6)", marginBottom: "var(--space-2)" }}>
        What we can’t do
      </h2>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-2)" }}>
        We cannot reverse or refund a tip once it’s been sent. Tips are final. We also aren’t able to resolve disputes between tippers and creators about content or whether a tip was deserved. For those matters, please work directly with the other party.
      </p>

      <p style={{ color: "var(--text-muted)", fontSize: "var(--text-small)", marginTop: "var(--space-6)" }}>
        Teep is not affiliated with X Corp. For fees, see <Link to="/fees">Fees</Link>. For legal terms, see <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy</Link>.
      </p>
    </div>
  );
}
