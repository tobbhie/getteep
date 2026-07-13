import { Link } from "react-router-dom";

const lastUpdated = "2026-06-14";

const sectionStyle = {
  color: "var(--text-secondary)",
  lineHeight: "var(--line-relaxed)",
  marginBottom: "var(--space-4)",
};

const headingStyle = {
  fontSize: "var(--text-heading)",
  fontWeight: 600,
  marginTop: "var(--space-6)",
  marginBottom: "var(--space-2)",
};

export default function Privacy() {
  return (
    <div className="page-section" style={{ paddingTop: "var(--space-4)" }}>
      <h1 style={{ fontSize: "var(--text-title)", marginBottom: "var(--space-2)" }}>Privacy Policy</h1>
      <p style={{ color: "var(--text-muted)", fontSize: "var(--text-small)", marginBottom: "var(--space-4)" }}>
        Last updated: {lastUpdated}
      </p>

      <p style={{ ...sectionStyle, color: "var(--text-primary)" }}>
        Teep respects your privacy. This policy covers the Teep website, dashboards, and connected X tipping features.
        We do not sell personal data or use it for advertising.
      </p>

      <h2 style={headingStyle}>What Teep accesses</h2>
      <p style={sectionStyle}>
        Teep processes the account, wallet, creator, post, and transaction details needed to prepare tips,
        show receipts, verify creators, and process X tip commands you enable. Teep does not collect your
        general browsing history.
      </p>

      <h2 style={headingStyle}>Information we collect</h2>
      <ul style={{ ...sectionStyle, paddingLeft: "var(--space-5)" }}>
        <li><strong style={{ color: "var(--text-primary)" }}>Account and identity:</strong> email address, connected wallet addresses, X handle, X verification state, and creator profile information.</li>
        <li><strong style={{ color: "var(--text-primary)" }}>Tips and account activity:</strong> tip intents, transaction hashes, balances, withdrawals, referrals, receipts, and related creator or post identifiers.</li>
        <li><strong style={{ color: "var(--text-primary)" }}>Product preferences:</strong> receipt preferences, X command limits, acknowledged notices, and temporary transaction state used to prevent duplicate submissions.</li>
        <li><strong style={{ color: "var(--text-primary)" }}>Technical and security data:</strong> IP address, browser or device information, request logs, errors, and abuse-prevention signals.</li>
        <li><strong style={{ color: "var(--text-primary)" }}>Public blockchain data:</strong> wallet addresses and transactions are public and may remain permanently available on the blockchain.</li>
      </ul>

      <h2 style={headingStyle}>How we use information</h2>
      <p style={sectionStyle}>
        We use this information only to provide Teep features, authenticate users, create and secure wallets,
        prepare and record transactions, prevent duplicate or fraudulent activity, show receipts and history,
        provide support, maintain the beta, and comply with applicable law. We do not use product data for
        credit decisions, advertising, or sale to data brokers.
      </p>

      <h2 style={headingStyle}>Connected X features</h2>
      <p style={sectionStyle}>
        When you choose to connect X for Teep tip commands, Teep stores the connected X account identifier,
        username, Teep account address, command preferences, and safety limits needed to recognize and process
        commands from that X account. Connecting X for this purpose enables X tip commands with default limits
        unless you pause or change them in Settings. Creating a Teep account by itself does not enable X tip
        commands.
      </p>

      <h2 style={headingStyle}>Service providers</h2>
      <p style={sectionStyle}>
        Teep uses service providers to operate the product. These currently include Privy for authentication
        and embedded-wallet services; smart-wallet, bundler, and paymaster infrastructure configured for Arc;
        Arc network RPC and blockchain-indexing services; X for creator verification and supported-page context;
        and Circle's testnet faucet when a user chooses to request test funds. Providers process only the data
        needed for their service and are governed by their own privacy terms.
      </p>

      <h2 style={headingStyle}>Browser storage</h2>
      <p style={sectionStyle}>
        The Teep web app may store local session preferences and temporary transaction state in your browser
        to keep the product usable between visits and prevent duplicate submissions. Clearing local browser
        storage does not delete Teep account records or public blockchain transactions.
      </p>

      <h2 style={headingStyle}>Retention</h2>
      <p style={sectionStyle}>
        We retain account, support, withdrawal, provider, and security records only as long as needed to operate
        the beta, prevent abuse, resolve disputes, and meet legal obligations. Our current target is up to 24
        months for these operational records and generally 30 to 90 days for routine logs. Public blockchain
        records cannot be edited or deleted by Teep.
      </p>

      <h2 style={headingStyle}>Your choices and deletion</h2>
      <p style={sectionStyle}>
        Depending on where you live, you may request access, correction, deletion, portability, restriction, or
        objection regarding personal data we control. To request account or data deletion, email{" "}
        <a href="mailto:support@getteep.xyz?subject=Account%20deletion%20request" style={{ color: "var(--link)" }}>
          support@getteep.xyz
        </a>{" "}
        from your account email with the subject "Account deletion request" and include your Teep wallet address
        or X handle. We may ask you to verify account ownership. We cannot delete public blockchain records or
        records we must retain for security or legal reasons.
      </p>

      <h2 style={headingStyle}>Changes and contact</h2>
      <p style={sectionStyle}>
        We may update this policy as Teep changes. We will post the revised version here and update the date
        above. Questions and privacy requests can be sent to{" "}
        <a href="mailto:support@getteep.xyz" style={{ color: "var(--link)" }}>support@getteep.xyz</a>.
      </p>

      <p style={{ color: "var(--text-muted)", fontSize: "var(--text-small)", marginTop: "var(--space-6)" }}>
        See <Link to="/support#account-deletion">Support and deletion instructions</Link> or read the <Link to="/terms">Terms</Link>.
      </p>
    </div>
  );
}
