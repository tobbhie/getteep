# Teep Production Secret Inventory

Last updated: 2026-05-13

This inventory lists the secrets Teep expects in production. Do not commit real values to the repository, extension bundle, web bundle, screenshots, support tickets, or public logs. Store production values in the hosting provider secret manager only.

## Backend Secrets

| Secret | Purpose | Required in production | Rotation trigger | Notes |
| --- | --- | --- | --- | --- |
| `ATTESTATION_PRIVATE_KEY` | Signs creator claim attestations. | Yes | Any suspected exposure, signer role change, or deployment/admin handoff. | Prefer a dedicated signer. Do not reuse deployer keys. |
| `WITHDRAWAL_AUTHORIZATION_PRIVATE_KEY` | Signs non-owner withdrawal destination authorizations. | Yes if non-owner withdrawal UX is enabled | Any suspected exposure or abnormal failed signing spike. | Should be separate from `ATTESTATION_PRIVATE_KEY` before public beta. |
| `REFERRAL_SIGNER_PRIVATE_KEY` | Signs referral registry actions when backend-assisted referral binding is used. | Yes if referral signing is enabled | Any suspected exposure or referral abuse incident. | Should be monitored separately from withdrawal signer. |
| `OPS_TOKEN` | Protects operational endpoints such as indexer rewind and abuse summaries. | Yes | Operator departure, leaked logs, failed auth spike, or deploy handoff. | Use a high-entropy token. Never expose to web/extension. |
| `X_CLIENT_SECRET` | X OAuth confidential client secret. | Yes for X OAuth | Any OAuth error suggesting misuse, portal regeneration, or exposure. | Must match the X developer project attached to Teep. |
| `X_BEARER_TOKEN` | X API lookup for handle/user ID resolution. | Yes while X API lookup is active | Quota abuse, 403 remediation, or exposure. | Treat as server-only. |
| `FAUCET_PRIVATE_KEY` | Sends Arc testnet USDC from faucet wallet. | Testnet only | Any exposure or faucet drain/abuse event. | Never use deployer key for faucet. Disable in production mainnet mode. |
| Provider webhook secrets | Verify funding/onramp/offramp provider callbacks. | When provider is enabled | Provider rotation, failed webhook signature checks, or exposure. | Dynamic/Circle/etc. specific. |
| Database credentials / backup keys | Managed DB and backup access. | If managed DB/backups are used | Provider rotation, staff changes, or exposure. | SQLite local beta should still protect backups. |

## Public Configuration

These values are not secrets and may appear in browser/extension bundles:

- `VITE_PRIVY_APP_ID` / `PRIVY_APP_ID`
- `VITE_API_BASE` / `API_BASE_URL`
- `VITE_CHAIN_ID` / chain metadata
- Public contract addresses
- Public RPC URLs, if no private API key is embedded
- Public explorer URLs

If an RPC, bundler, paymaster, analytics, or funding URL contains an API key, treat it as a secret and proxy it through the backend or provider dashboard.

## Rotation Checklist

1. Generate the replacement secret in the provider dashboard or offline signer process.
2. Add the new value to the production secret manager.
3. Deploy or restart the affected service.
4. Verify health checks and one low-value smoke test.
5. Revoke the old secret.
6. Record the rotation date, operator, reason, and verification result in the private operations log.

## Pre-Beta Checks

- Confirm production `.env` files are not used as source of truth.
- Confirm no secret-like values are present in `web/dist`, `extension/dist`, or deployment artifacts.
- Confirm screenshots and support captures do not reveal provider keys, private keys, OAuth secrets, or bearer tokens.
- Rotate any local/dev key that appeared in screenshots, chat logs, terminal logs, support tickets, or shared files.
