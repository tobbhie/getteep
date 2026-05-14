# Teep Production Beta Checklist By Part

This checklist breaks the remaining production-beta work into surfaces that can be owned and marked done independently.

Use this as the working checklist. Keep `project-docs/production-beta-left.md` as the broader narrative/context document.

## Status Legend

- `[ ]` Not started or not complete.
- `[~]` Partially done; needs verification or finishing.
- `[x]` Done and verified.

## Contracts

### Deployment And Configuration

- [x] Compile current Arc contract set.
- [x] Redeploy changed hybrid withdrawal contract set to Arc testnet.
- [x] Update app defaults for latest Arc testnet deployment.
- [x] Confirm deployed `WalletFactory` has bytecode.
- [x] Confirm deployed `ReferralRegistry` has bytecode.
- [x] Confirm deployed `TipContract` has bytecode.
- [x] Confirm `WalletFactory.referralRegistry()` points to the deployed registry.
- [x] Confirm `TipContract.factory()` points to the deployed factory.
- [x] Confirm `TipContract.usdc()` points to Arc ERC-20 USDC.
- [x] Record deployment block for the latest `TipContract`.
- [x] Set `INDEXER_START_BLOCK` to the latest `TipContract` deployment block.
- [x] Decide whether old claim wallets/tip contracts should remain readable in history or be treated as previous-beta state only.
- [x] Add an internal deployment note that new claim wallets are created from the new factory, while old claim wallets are not upgradeable.

Internal migration/runbook note:

- New tips use the latest `TipContract`, which computes creator claim-wallet addresses from the latest `WalletFactory`.
- Claim wallets deployed by older factories are standalone contracts and cannot be upgraded in place.
- Older received tips should remain readable/claimable through legacy history or support tooling, but the user-facing product copy should stay simple: "Older received tips remain claimable. New tips use the latest Teep account system."
- Avoid exposing factory/bytecode/upgrade language in normal user UX. Keep those details in operator docs, support scripts, and audit notes.

### Withdrawal And Referral Safety

- [x] Contract enforces protocol/referral split via `withdrawWithFee`.
- [x] Direct owner withdrawals remain permissionless for non-custodial recovery.
- [x] Non-owner withdrawal destinations require backend EIP-712 authorization.
- [x] Add tests for non-owner withdrawal authorization.
- [x] Add tests for authorization expiry.
- [x] Add tests for nonce replay rejection.
- [x] Add tests for wrong signer rejection.
- [x] Add tests for wrong claim-wallet verifying contract rejection.
- [x] Add tests for wrong owner/destination/amount in signed authorization.
- [x] Add tests proving direct owner withdrawal does not need backend authorization.
- [x] Add tests proving protocol/referral fee split still happens on authorized non-owner withdrawals.
- [x] Add tests for `setWithdrawalSigner`.
- [x] Add tests for `injectWithdrawalSignerToWallet`.
- [x] Confirm referral registry owner/admin controls are owner-only and held by the deployment owner/admin path.
- [x] Referral fee parameters are owner/admin-adjustable during beta.

Current safety test coverage:

- `contracts:test` covers expiry, nonce replay, wrong signer, wrong verifying contract, and changed signed fields for `withdrawWithAuthorization`.
- `contracts:test` proves direct owner withdrawal remains permissionless while still applying protocol fees.
- `contracts:test` proves authorized non-owner withdrawal still applies the treasury/referrer split.
- `contracts:test` proves `ReferralRegistry.setFeeBps` and `setReferrerShareBps` are owner-only, capped at 100%, and adjustable by the admin during beta.
- Operational note: before public beta, confirm whether the registry owner remains the deployer EOA or is transferred to a multisig/admin wallet.

### DeFi / Grow Tips Contracts

- [x] Decide whether production beta includes real Grow Tips or only the placeholder.
- [x] If real Grow Tips ships, define the first conservative Arc strategy.
- [x] Decide whether DeFi routing lives in contracts, backend adapters, or both.
- [x] Design `StrategyRegistry` or equivalent provider registry.
- [x] Design `StrategyAdapter` interface.
- [x] Decide whether a `YieldVault` is needed or whether user-owned smart wallets interact directly with adapters.
- [x] Write threat model for DeFi custody, approvals, slippage, oracle assumptions, and emergency exits.
- [x] Add tests for deposits, withdrawals, accounting, failure modes, and emergency disablement before enabling real funds.

Current Grow Tips contract decision:

- Production beta uses live contracts behind flags, starting with Arc testnet and an Aave V3-style USDC supply adapter.
- DeFi routing is contract-gated through `StrategyRegistry` and protocol-specific adapters; backend/UI should only expose registry-approved strategies.
- No `YieldVault` for beta. User-owned smart wallets interact with adapters, and Aave position tokens are minted to the user/beneficiary.
- Teep is not custodian of invested tips or yield. If Teep disables its adapter, the user-owned Aave position can still be handled through the underlying protocol.
- Optional future counterpart exists as `PooledTipsVault`: a controlled-yield ERC-4626 pool where the vault owns pooled strategy positions and users own vault shares. This is not the beta default and needs a separate audit/governance/product-risk pass before public use.
- Deployment requires verified Arc testnet Aave Pool and USDC aToken addresses before the strategy is enabled in UI. Prefer resolving them from Aave's `PoolAddressesProvider` and `ProtocolDataProvider` where available.
- Threat model: `project-docs/grow-tips-defi-threat-model.md`.

### Contract Security Audit

- [x] Run a focused internal audit of `ClaimWallet`, `WalletFactory`, `ReferralRegistry`, and `TipContract`.
- [x] Review EIP-712 domains, type hashes, nonce handling, replay boundaries, and expiry handling.
- [x] Review every external/public function for access control.
- [x] Review token transfer paths for reentrancy, stuck funds, fee rounding, and destination validation.
- [x] Review deterministic wallet derivation and author ID assumptions.
- [x] Review upgrade/deployment assumptions: old wallets, new wallets, and migration messaging.
- [x] Review registry/admin functions for ownership risk.
- [x] Run Slither or equivalent Solidity static analysis. Manual static review completed; `slither` is not installed in this workspace, so run Slither in CI/local Python tooling before public mainnet-value release.
- [x] Run gas and revert-path tests on Arc testnet-like conditions. Hardhat revert-path suite and `REPORT_GAS=true` run passed under Arc testnet chain assumptions used by the project config.
- [x] Write final contract security notes in `project-docs/security-audit-report.md`.

Current contract audit status:

- Latest contract audit addendum: `project-docs/security-audit-report.md`.
- Verification passed on 2026-05-12: `contracts:compile`, `contracts:test` with 37 passing, and gas reporter test run with 37 passing.
- Open fixes before production beta: split attestation/withdrawal signer roles and make pooled Grow Tips valuation explicit before enabling pooled custody mode.
- Resolved on 2026-05-12: referral constructor fee/share/treasury validation, zero treasury rejection, future timestamp skew protection for claim-wallet attestations, referral signature expiry, zero factory registry rejection, and owner-destination restriction for native ETH recovery.

## Backend

### Production Configuration

- [x] Backend production boot fails if required env vars are missing.
- [x] Backend blocks unsafe production flags.
- [x] Backend build cleans `dist` and does not emit source maps.
- [x] Runtime dependency audit is clean with `npm audit --omit=dev`.
- [ ] Set production `CORS_ORIGIN` to the final web/extension origin allowlist.
- [ ] Set production `RPC_URL` or `ARC_RPC_URL`.
- [ ] Set production `TIP_CONTRACT_ADDRESS`.
- [ ] Set production `FACTORY_ADDRESS`.
- [ ] Set production `REFERRAL_REGISTRY_ADDRESS`.
- [ ] Set production `USDC_ADDRESS`.
- [ ] Set production `INDEXER_START_BLOCK` to latest deployment block.
- [ ] Set production `OPS_TOKEN`.
- [ ] Set production signer keys through host secret manager only.
- [ ] Set production X OAuth credentials.
- [ ] Confirm no production secrets exist in committed files.
- [ ] Rotate any key that was exposed during local testing or screenshots.

### Indexer And Data Correctness

- [x] Indexer supports configurable start block.
- [x] Indexer tracks lag/staleness state.
- [x] Indexer re-scans recent confirmed blocks.
- [ ] Backfill latest deployment from exact `INDEXER_START_BLOCK`.
- [ ] Verify tips from latest `TipContract` appear in activity/history.
- [ ] Verify old contract data is either intentionally hidden or intentionally included.
- [ ] Verify `total_tipped`, `total_earned`, recent activity, and history use the intended contract scope.
- [ ] Verify withdrawal events and referral fee events are indexed correctly.
- [ ] Add recovery runbook for `/ops/indexer/rewind`.
- [ ] Decide whether production stays SQLite with backups or moves to managed Postgres.
- [ ] Add automated database backup and restore test.
- [ ] Add structured logs for indexer polling, RPC errors, decode errors, and reorg handling.

### Auth, Identity, And X

- [ ] Verify X OAuth works with the production X developer project.
- [ ] Verify X bearer token lookup works for creator/user ID resolution.
- [ ] Confirm handle-to-ID fallback behavior after X API failure.
- [ ] Confirm creator claim uses deterministic author ID, not mutable handle, where required.
- [ ] Add rate limits for X auth/callback endpoints.
- [ ] Add security event logs for repeated failed X verification.
- [ ] Decide fallback product copy when X API quota/access fails.

### Withdrawal Safeguards

- [x] Withdrawal confirmation request/confirm/record lifecycle exists.
- [x] Wallet-signature proof required before creating and recording confirmations.
- [x] Daily withdrawal limit path exists.
- [x] Non-owner destination authorization is signed by backend.
- [ ] Configure production `WITHDRAWAL_EMAIL_WEBHOOK_URL`.
- [ ] Decide launch value for `WITHDRAWAL_DAILY_LIMIT_RAW`.
- [ ] Decide whether `WITHDRAWAL_AUTHORIZATION_PRIVATE_KEY` should be separate from `ATTESTATION_PRIVATE_KEY`.
- [ ] Store and monitor failed withdrawal signing attempts.
- [ ] Add cooldown/risk state for repeated failed confirmations.
- [ ] Add E2E test for successful owner withdrawal.
- [ ] Add E2E test for successful non-owner authorized withdrawal.
- [ ] Add E2E test for expired confirmation code.
- [ ] Add E2E test for wrong confirmation code.
- [ ] Add E2E test for daily limit exceeded.
- [ ] Add E2E test for failed signature proof.
- [ ] Add E2E test for transaction submitted but record call fails.

### Abuse Resistance And Ops

- [x] Abuse/security event tables exist.
- [x] Self-tip, circular-tip, high-frequency, wash-referral, reciprocal-referral, and creator self-link checks exist.
- [x] `/ops/abuse/summary` exists.
- [ ] Decide which abuse events block actions vs. only flag review.
- [ ] Add moderation workflow to resolve, ignore, or escalate abuse events.
- [ ] Add admin notes/audit trail for abuse decisions.
- [ ] Add alerts for abuse/security spikes.
- [ ] Add bot heuristics using X metadata where API access allows.
- [ ] Add contested creator claim handling.
- [ ] Tune abuse thresholds after beta traffic.
- [ ] Add external monitoring for RPC, bundler, paymaster, and backend error rates.
- [ ] Hook `/health/live` and `/health/ready` into uptime monitoring.
- [ ] Add log drain/provider integration.

### Backend Security Audit

- [ ] Re-audit all write routes for wallet proof or server-side authorization.
- [ ] Re-audit auth/session assumptions for extension, web, and backend API calls.
- [ ] Re-audit CORS, Helmet, JSON body size, and rate-limit configuration.
- [ ] Re-audit X OAuth callback state handling and token storage.
- [ ] Re-audit referral signing and withdrawal signing keys.
- [ ] Re-audit database migrations and SQL statements for injection/idempotency issues.
- [ ] Re-audit operational endpoints for `OPS_TOKEN` enforcement.
- [ ] Run dependency audit in CI with `npm audit --omit=dev --audit-level=high`.
- [ ] Track dev-only audit debt for Hardhat/Vite/Webpack as a separate tooling migration.

## Extension

### Core User Flow

- [x] Email signup/login through Privy.
- [x] Arc smart-wallet signing path works in the extension.
- [x] X DOM tip button injection exists.
- [x] Send Tip flow exists.
- [x] Add Money menu supports faucet and receive paths.
- [x] Grow Tips menu placeholder exists.
- [x] Dashboard/settings/profile/referral menu structure exists.
- [x] Share-to-X and receipt actions exist in activity cards.
- [ ] Reload unpacked extension after every build that changes `extension/dist`.
- [ ] Verify latest deployed addresses are visible in the active loaded extension.
- [ ] Verify tip flow on X timeline.
- [ ] Verify tip flow on X post detail page.
- [ ] Verify tip flow on X profile page.
- [ ] Verify tip flow on repost context.
- [ ] Verify new tips persist after X feed rerenders.
- [ ] Verify creator verification failure states are human-readable.
- [ ] Verify successful tip updates popup balance/activity without manual refresh.
- [ ] Verify activity/history cards show share and receipt actions without crowding.

### Popup UX And Crypto Abstraction

- [ ] Verify popup has no unwanted scroll on dashboard.
- [ ] Verify confirm-tip popup has no unwanted horizontal/vertical scroll.
- [ ] Verify confirm-tip copy says what the user is doing: recipient, amount, confirmation, not smart-wallet jargon.
- [ ] Replace any remaining "loading smart wallet" or protocol-heavy copy with user-facing payment language.
- [ ] Verify light theme spacing against mock.
- [ ] Verify dark theme spacing against mock.
- [ ] Verify Grow Tips footer item is highlighted but readable in both themes.
- [ ] Verify footer text is `Teep v0.1.0`.
- [ ] Verify profile/settings dropdown is usable in small popup dimensions.
- [ ] Verify withdrawal page spacing around X verification notice and button.
- [ ] Verify Add Money disabled Card/Bank state explains mainnet/future availability.
- [ ] Verify faucet path copies address and opens Circle faucet.
- [ ] Verify Receive via Crypto path copies address and gives feedback.

### Extension Production Release

- [x] Production build guard rejects missing release env vars.
- [x] Production build guard rejects localhost production URLs.
- [x] Production manifest strips dev localhost permissions.
- [x] Production source maps disabled.
- [ ] Add final Chrome extension icons: 16, 48, and 128 PNG.
- [ ] Add Chrome Web Store screenshots.
- [ ] Add Chrome Web Store short description.
- [ ] Add Chrome Web Store long description.
- [ ] Add Chrome Web Store support URL.
- [ ] Add Chrome Web Store privacy URL.
- [ ] Build `extension:build:prod` with final `API_BASE_URL`, `WEB_APP_URL`, `RECEIPT_BASE_URL`, and `PRIVY_APP_ID`.
- [ ] Inspect production `manifest.json` manually.
- [ ] Verify no debug panel, debug flags, or noisy logs in production build.
- [ ] Verify content security policy is as tight as possible for Privy/smart-wallet needs.
- [ ] Verify no secrets or private API keys are bundled into `extension/dist`.

### Extension Security Audit

- [ ] Re-audit content script DOM scraping for X layout changes and spoofing.
- [ ] Re-audit message passing between content, background, and popup.
- [ ] Re-audit extension storage: no secrets, no sensitive tokens, minimal PII.
- [ ] Re-audit external URLs opened by extension.
- [ ] Re-audit wallet transaction call construction and user confirmation copy.
- [ ] Re-audit receipt/share generation for untrusted text injection.
- [ ] Re-audit permissions and host permissions.
- [ ] Run production build and inspect bundled config.

## Web

### Product Pages

- [~] Replace placeholder Chrome Store URL with real listing. Web now falls back to beta/support copy instead of exposing a fake listing; final store URL is still needed.
- [x] Improve homepage CTA for install conversion.
- [ ] Add extension detection where practical.
- [ ] Add "open in X" / deep-link behavior where practical.
- [x] Polish creator profile page.
- [x] Add creator milestones reached.
- [x] Add creator top tipped posts with correct USDC formatting.
- [x] Add creator empty states.
- [x] Add creator share profile action.
- [x] Polish tipper profile page.
- [x] Add early supporter badges or defer explicitly.
- [x] Add milestone participation or defer explicitly.
- [x] Add privacy controls or defer explicitly.
- [ ] Polish dashboard overview.
- [ ] Polish dashboard withdrawal page copy and empty states.
- [x] Polish Grow Tips placeholder so it feels intentional, not unfinished.

### Receipts, Sharing, And SEO

- [~] Add OG/Twitter cards for receipt pages. Client-side metadata exists; server-rendered or prerendered tags are still needed for crawler-perfect shares.
- [~] Add OG/Twitter cards for creator profiles. Client-side metadata exists; server-rendered or prerendered tags are still needed for crawler-perfect shares.
- [~] Add OG/Twitter cards for tipper profiles. Client-side metadata exists; server-rendered or prerendered tags are still needed for crawler-perfect shares.
- [ ] Add OG/Twitter cards for post CTA pages.
- [~] Verify receipt page handles missing tx, not-yet-indexed tx, and failed fetch. Code paths exist; browser/API scenario verification remains.
- [ ] Verify share-to-X copy is consistent across web and extension.
- [ ] Verify generated receipt cards are marketable and accurate.
- [x] Verify explorer links use Arc testnet explorer in beta.

### Web Production Release

- [x] Production build guard rejects missing release env vars.
- [x] Production build guard rejects localhost URLs.
- [x] Production source maps disabled.
- [ ] Build `web:build:prod` with final production env.
- [ ] Deploy web to production host.
- [ ] Verify deployed web uses final API URL.
- [ ] Verify deployed web uses final contract addresses.
- [ ] Verify deployed web uses final Privy app ID.
- [~] Verify no secrets are present in the bundle. Local web build and targeted scan found no known leaked test keys or stale Base-era addresses; repeat with final production env.
- [ ] Verify legal/trust pages are linked from footer.
- [ ] Verify support contact works.

### Web Security Audit

- [ ] Re-audit all API calls for trust assumptions and wallet proof usage.
- [ ] Re-audit receipt/profile pages for untrusted text injection.
- [~] Re-audit environment variables to ensure only public config is bundled. Removed a local Circle API key from `web/.env` and kept web config to public `VITE_` values; repeat before production release.
- [ ] Re-audit external links for `rel="noopener noreferrer"`.
- [ ] Re-audit dashboard withdrawal signing and confirmation flow.
- [ ] Re-audit web dependency audit results for runtime bundle.
- [~] Run production bundle inspection for exposed secrets and stale addresses. Local development bundle scan passed for known leaked key patterns and stale addresses; production bundle still needs final-env inspection.

## General

### Funding And Cash Movement

- [x] Faucet remains the Arc testnet funding path.
- [x] Add From Card/Bank disabled for now.
- [x] Keep real fiat onramp disabled until Arc mainnet exists.
- [x] Implement provider interfaces behind feature flags:
  - [x] `FaucetFundingProvider`
  - [x] `CryptoReceiveProvider`
  - [x] `FiatOnrampProvider`
  - [x] `FiatOfframpProvider`
- [x] Add environment gates:
  - [x] `arcTestnet`: faucet + crypto receive only.
  - [x] `arcMainnet`: card/bank + crypto receive + supported offramp.
- [x] Decide primary onramp provider for Arc mainnet. Decision: Dynamic first, because it best fits Teep's account/wallet abstraction and future compliance UX.
- [x] Decide primary offramp provider for Arc mainnet. Decision: Dynamic first, with bank/KYC UX web-first rather than cramped in the extension popup.
- [x] Add non-sensitive provider session/webhook persistence.
- [x] Add product copy explaining faucet vs. real money clearly.

### Grow Tips / Social DeFi

- [x] Grow Tips navigation exists.
- [ ] Decide first production-beta Grow Tips scope: placeholder, read-only teaser, or real strategy.
- [ ] Pick first Arc DeFi primitive/provider only after liquidity and risk review.
- [ ] Design opt-in/opt-out settings.
- [ ] Design user-facing balances: Available, Growing, Earned, Withdrawable.
- [ ] Design activity types for grown/withdrawn/moved funds.
- [ ] Decide whether DeFi is allowed for tip balance, creator earnings, or only idle funds.
- [ ] Define risk language without protocol jargon.
- [ ] Add a DeFi-specific threat model before implementation.

### Security And Compliance

- [x] Runtime dependency audit currently clean.
- [~] Full repository security re-audit before public beta. Focused contract/backend/general passes exist; still run final full pass on production env/build artifacts.
- [x] Update `project-docs/security-audit-report.md` with latest contract deployment and remaining risks.
- [ ] Rotate local/dev keys before production deployment.
- [~] Confirm no `.env` files are committed. Local scan found `.env` files present but ignored; this workspace has no `.git` metadata, so verify against the real repository/remote before public beta.
- [x] Confirm `.gitignore` excludes local env, build artifacts where appropriate, logs, and local DB files.
- [x] Add a production secret inventory. See `project-docs/production-secret-inventory.md`.
- [x] Add incident response runbook for key compromise. See `project-docs/incident-response-runbooks.md`.
- [x] Add incident response runbook for bad contract deployment. See `project-docs/incident-response-runbooks.md`.
- [x] Add incident response runbook for indexer corruption. See `project-docs/incident-response-runbooks.md`.
- [~] Add privacy policy final review. Beta retention copy is implemented; external/legal review remains.
- [~] Add terms final review. Finality and X non-affiliation copy are implemented; external/legal review remains.
- [x] Add support/refund/finality language final review.
- [x] Add explicit no-affiliation-with-X language.
- [x] Decide beta user/data retention policy. See `project-docs/beta-data-retention-policy.md`.

Current General security/compliance status:

- Runtime dependency audit command: `npm run security:audit:runtime`.
- Latest runtime audit verification on 2026-05-13: `npm.cmd audit --omit=dev --audit-level=high --workspaces` returned 0 vulnerabilities.
- Local ignored sensitive/runtime files currently present in the workspace include `backend/.env`, `contracts/.env`, `extension/.env`, `web/.env`, `gasstation/.env`, `sandbox/privy-arc-smoke/.env`, and local DB files under `backend/data/`. They are ignored by `.gitignore`; verify the real repository history before release.
- Secret inventory: `project-docs/production-secret-inventory.md`.
- Incident runbooks: `project-docs/incident-response-runbooks.md`.
- Beta retention policy: `project-docs/beta-data-retention-policy.md`.

### Testing And QA

- [ ] E2E tip flow.
- [ ] E2E X OAuth verification.
- [ ] E2E creator claim wallet deployment.
- [ ] E2E withdrawal with fee split.
- [ ] E2E non-owner authorized withdrawal.
- [ ] E2E referral bind.
- [ ] E2E referral withdrawal fee share.
- [ ] E2E insufficient balance.
- [ ] E2E activity/history/receipt/share.
- [ ] E2E extension popup no-scroll checks.
- [ ] E2E X DOM tip button persistence after rerender.
- [ ] Smoke test Arc RPC.
- [ ] Smoke test deployed contract bytecode.
- [ ] Smoke test configured app IDs.
- [ ] Smoke test Privy login and smart-wallet creation.
- [ ] Smoke test sponsored transaction path.
- [ ] Smoke test backend health/readiness.
- [ ] Smoke test indexer from latest deployment block.

### Release And Operations

- [ ] Decide production hosting provider for backend.
- [ ] Decide production hosting provider for web.
- [ ] Configure production domains.
- [ ] Configure HTTPS and HSTS where applicable.
- [ ] Configure backend deploy env manager.
- [ ] Configure web deploy env manager.
- [ ] Configure extension release env build process.
- [ ] Configure uptime monitoring.
- [ ] Configure error monitoring.
- [ ] Configure structured log retention.
- [ ] Configure backup monitoring.
- [ ] Configure deploy rollback process.
- [ ] Create beta launch checklist.
- [ ] Create beta tester onboarding instructions.
- [ ] Create known-issues document.
- [ ] Create support triage workflow.

### Deferred / Explicitly Later

- [ ] X bot / reply-to-tip.
- [ ] Official Teep stats curator X bot.
- [ ] TIP token layer.
- [ ] Creator-defined milestone campaigns.
- [ ] Referred-user fee discounts.
- [ ] Native mobile/deep-link flows.
- [ ] Public SDK/webhooks beyond current external API.
- [ ] ZK/private tipping path.
