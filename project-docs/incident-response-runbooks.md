# Teep Incident Response Runbooks

Last updated: 2026-05-13

These runbooks are operator procedures for beta incidents. They intentionally use product language where possible, while keeping contract/provider details available to the response team.

## Severity Levels

| Severity | Meaning | Examples |
| --- | --- | --- |
| SEV-1 | Funds, signing authority, or production identity is at immediate risk. | Private key leak, bad contract deployment receiving live tips, malicious withdrawal signer, database corruption causing unsafe balances. |
| SEV-2 | User trust or accounting is materially degraded, but direct fund loss is not confirmed. | Indexer lag/corruption, wrong activity totals, X verification outage, provider webhook failures. |
| SEV-3 | Limited impact or degraded UX. | Broken receipt cards, support copy error, non-critical provider outage. |

## Key Compromise

Use this if any backend signer, provider token, OAuth secret, faucet key, or ops token may be exposed.

1. Freeze risky paths:
   - Disable faucet if `FAUCET_PRIVATE_KEY` is involved.
   - Disable non-owner withdrawal signing if `WITHDRAWAL_AUTHORIZATION_PRIVATE_KEY` is involved.
   - Disable creator claim attestation if `ATTESTATION_PRIVATE_KEY` is involved.
   - Disable ops endpoints by rotating `OPS_TOKEN` if operator auth is involved.
2. Rotate the affected secret in the provider or secret manager.
3. Redeploy/restart the backend with the new secret.
4. Revoke the old secret.
5. Review logs for usage after the suspected exposure time.
6. If a contract signer role changed, submit the owner/admin transaction to update the on-chain signer.
7. Run a smoke test for the affected flow with a low-value account.
8. Document:
   - exposed secret name,
   - first known exposure time,
   - rotation time,
   - affected actions,
   - user communication decision.

## Bad Contract Deployment

Use this if the app points to the wrong contract, a contract has unsafe configuration, or a deployment is later found to be flawed.

1. Stop new app traffic to the bad contract:
   - Update backend and extension/web config to remove the bad address.
   - Disable actions that write to the bad contract.
2. Preserve evidence:
   - Save deployed addresses, deployment block, tx hashes, constructor args, and operator address.
3. Confirm whether funds are at risk:
   - Check USDC balances on the contract and related claim wallets.
   - Check owner/admin permissions and signer roles.
4. Deploy the corrected contract set.
5. Update:
   - backend env,
   - web env,
   - extension release env,
   - `INDEXER_START_BLOCK`,
   - docs deployment note.
6. Rebuild and reload/release clients.
7. Keep old contract data readable through support tooling where needed, but do not expose confusing bytecode/factory language in user UX.
8. Publish a user-facing note only if users may see stale balances, failed claims, or changed withdrawal behavior.

## Indexer Corruption

Use this if dashboard totals, history, receipts, or creator balances disagree with chain truth.

1. Put the indexer in read-only/recovery mode if writes are actively corrupting data.
2. Snapshot the database before changing it.
3. Identify the affected contract address and block range.
4. Confirm `INDEXER_START_BLOCK` and current `TIP_CONTRACT_ADDRESS`.
5. Use the ops rewind flow for the smallest safe block range.
6. Re-run the indexer from the correct block.
7. Compare:
   - total tips given,
   - creator received totals,
   - recent activity,
   - receipt lookups,
   - withdrawal/referral events.
8. If corruption came from client activity writes, keep indexed chain events authoritative and dedupe by `tx_hash`.
9. Document the root cause, rewind range, and verification queries.

## Communication Baseline

- Do not speculate publicly about causes before logs and chain data are checked.
- Be direct about user impact: whether funds moved, whether balances are delayed, and what users should do.
- Avoid exposing private addresses, emails, OAuth data, or support-ticket contents in public updates.
- If funds are not at risk but display data is wrong, say that clearly.
