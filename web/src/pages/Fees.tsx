export default function Fees() {
  return (
    <div className="page-section" style={{ paddingTop: "var(--space-4)" }}>
      <h1 style={{ fontSize: "var(--text-title)", marginBottom: "var(--space-4)" }}>Fees</h1>
      <div className="card" style={{ marginBottom: "var(--space-5)", borderColor: "var(--accent-muted)" }}>
        <p style={{ margin: 0, fontSize: "var(--text-body)", lineHeight: "var(--line-relaxed)" }}>
          <strong>No fees when tipping.</strong> Tip as often as you like with zero cost.
        </p>
      </div>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginBottom: "var(--space-4)" }}>
        A withdrawal fee applies when creators move tips from their Teep balance to an external wallet or bank.
        That keeps tipping frictionless and only charges when you cash out.
      </p>
      <ul style={{ color: "var(--text-primary)", lineHeight: 1.8, paddingLeft: "var(--space-5)" }}>
        <li>Withdrawal fee: 5% of the amount you withdraw (earned tips only)</li>
        <li>70% of that fee goes to the protocol</li>
        <li>30% may go to your referrer if you used a referral code</li>
      </ul>
      <p style={{ color: "var(--text-secondary)", lineHeight: "var(--line-relaxed)", marginTop: "var(--space-3)", fontSize: "var(--text-small)" }}>
        Referrers: the 30% you earn is credited to your main balance (tip balance) when your referred friends withdraw their earned tips.
      </p>
      <p style={{ color: "var(--text-muted)", fontSize: "var(--text-small)", marginTop: "var(--space-5)" }}>
        Example: if you withdraw $100, the fee is $5; you receive $95. Questions? See{" "}
        <a href="/support">Support</a> or contact support@teep.xyz
      </p>
    </div>
  );
}
