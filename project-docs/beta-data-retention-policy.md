# Teep Beta Data Retention Policy

Last updated: 2026-05-13

This is the working beta policy for data Teep controls. It does not and cannot delete public blockchain history.

## Data Categories

| Category | Examples | Beta retention target |
| --- | --- | --- |
| Account identity | Email, Privy user ID, linked wallet address. | While account is active, plus up to 24 months for support/security needs. |
| Creator claim data | X handle, X numeric user ID, verification state, owner wallet, claim timestamps. | While claim is active, plus up to 24 months after unlink/support resolution. |
| Tipping/activity index | Indexed tips, tx hashes, content IDs, author IDs, amounts, timestamps. | Indefinite for product history and auditability, because it mirrors public chain events. |
| Local/client activity fallbacks | User activity rows used before indexer catch-up. | Keep until superseded by indexed chain events; retain up to 24 months if needed for receipts/support. |
| Withdrawal confirmations | Confirmation state, destination, amount, expiry, attempt metadata. | Up to 24 months for fraud, support, and accounting review. |
| Abuse/security events | Rate-limit hits, failed verification attempts, suspicious referral/tip patterns. | Up to 24 months, longer if tied to an active investigation. |
| Provider session records | Non-sensitive funding/onramp/offramp session IDs and statuses. | Up to 24 months or provider/legal requirement, whichever is longer. |
| Logs | Backend/indexer operational logs. | 30-90 days by default; security incidents may be retained longer. |
| Support requests | Emails/tickets and attachments. | Up to 24 months after resolution unless legal or safety needs require longer. |

## User Requests

- Users can ask for access, correction, or deletion of personal data Teep controls by contacting `support@teep.xyz`.
- Teep cannot delete public blockchain transactions.
- Teep may retain records needed for fraud prevention, legal compliance, dispute handling, security investigations, and financial auditability.

## Beta Defaults

- Do not sell personal data.
- Do not use third-party advertising cookies.
- Keep production logs free of private keys, bearer tokens, OAuth secrets, and full wallet-signature payloads unless explicitly needed for a security investigation.
- Prefer displaying shortened wallet addresses in user-facing surfaces.
- Revisit this policy before expanding to fiat onramp/offramp or production mainnet value.
