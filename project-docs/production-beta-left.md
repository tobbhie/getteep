# Teep Production Beta: What Is Left

This is the current continuation map after comparing the docs folder with the codebase.

## Current State

Teep is now mostly past the Base-to-Arc migration blocker. The extension and web app are configured for Arc testnet, the deployed Arc contract addresses are present, and the Privy email wallet plus Arc smart-wallet signing path has been separated enough to work in the extension.

The product today is best described as:

- Working Arc testnet X tipping extension.
- Privy email onboarding with embedded wallet/smart-wallet support.
- USDC tipping into creator claim wallets.
- Referral core and creator/tipper stats mostly present.
- Share-to-X and receipt generation present in the extension.
- Grow Tips UI placeholder present, but not yet real DeFi.

## 1. Production Config And Security Packaging

Status after the 2026-05-06 packaging pass: guardrails are now in code, but release-specific values still need to be supplied.

Implemented:

- Production extension builds fail when required release env vars are missing.
- Production extension builds fail if `localhost`/`127.0.0.1` URLs or debug flags are used.
- Production extension builds generate a narrower manifest without localhost/dev host permissions.
- Extension source maps are disabled for production webpack builds.
- Production web builds fail when required release env vars are missing.
- Production web builds fail if localhost URLs or placeholder Chrome Store URLs are used.
- Web production source maps are disabled.
- Backend production boot fails if required env vars are missing or unsafe dev flags are enabled.
- Backend build now cleans `dist` before compile and does not emit source maps.
- Extension and web `.env.example` files now document required release variables.

Remaining work:

- Supply the real production URLs and app IDs in deployment/CI.
- Rotate/remove local secrets from any `.env` files before deployment.

Production variables that must be deliberately set:

- `API_BASE_URL` for extension.
- `WEB_APP_URL` for extension.
- `PRIVY_APP_ID` for extension.
- `VITE_API_URL` for web.
- `VITE_WEB_APP_URL` for web.
- `VITE_CHROME_STORE_URL` for web once the listing exists.
- `VITE_PRIVY_APP_ID` for web.
- `CORS_ORIGIN` for backend.
- backend signer, OAuth, database, and RPC secrets through the host environment.

Dependency audit status:

- Runtime/store audit is clean after aligning Privy to `3.23.1` across web/extension and pinning vulnerable transitive packages through npm overrides.
- Current validation command: `npm audit --omit=dev --json` reports `0` production vulnerabilities.
- Full audit still reports dev-tooling advisories in Hardhat/Vite/Webpack chains; the available npm fixes require major upgrades (`hardhat@3`, `vite@8`, `copy-webpack-plugin@14`) and should be handled as a separate tooling migration instead of rushed into this beta path.

## 2. Funding And Cash Movement

Status: testnet usable, mainnet funding architecture not finalized.

Product constraint:

- Arc does not have a public mainnet yet. Opening a real card/bank onramp into a testnet token would be a bad product and compliance decision because users would be paying real money for non-production testnet value.
- The faucet should remain the primary testnet funding path until Arc mainnet is available.
- The product can still implement the onramp/offramp architecture now, but the real-money provider should remain disabled or environment-gated until Arc mainnet support is real.

Recommended architecture:

- Build funding behind provider interfaces instead of hardwiring one vendor into the product:
  - `FaucetFundingProvider` for Arc testnet.
  - `CryptoReceiveProvider` for advanced users who want to send assets directly.
  - `FiatOnrampProvider` for mainnet card/bank funding.
  - `FiatOfframpProvider` for mainnet cash-out/withdrawal.
- Gate real-money providers by chain environment:
  - `arcTestnet`: faucet + receive via crypto only.
  - `arcMainnet`: card/bank onramp + crypto receive + supported offramp.
- Keep provider calls server-assisted where needed:
  - Backend creates signed sessions/quotes.
  - Backend stores non-sensitive provider session IDs and webhook statuses.
  - Provider handles KYC, fraud, sanctions, payment disputes, and fiat settlement.
  - Teep never handles card data, bank credentials, or custodial fiat balances.
- Keep the extension UX crypto-abstracted:
  - User sees "Add Money", "Add from Faucet", "Receive", and later "Add from Card/Bank".
  - Advanced wallet/address details stay behind explicit secondary actions.

Provider recommendation:

- Onramp primary: Stripe Crypto Onramp if/when it supports Arc mainnet USDC and smart-wallet delivery cleanly. It best matches Teep's product ideology because it is embedded, brandable, merchant-of-record style, and pushes KYC/fraud/compliance outside Teep.
- Onramp fallback: MoonPay/Ramp/Transak-style provider if Stripe does not support Arc mainnet quickly enough. The fallback should be selected based on Arc mainnet support, USDC support, country coverage, webhook quality, fees, and smart-wallet delivery.
- Offramp primary: use a provider with both sell-to-fiat and payout coverage, likely MoonPay Offramp or Coinbase Offramp depending on Arc mainnet support. Offramp matters more than brand polish because failed cash-out destroys trust.
- Long-term best fit: Circle-native funding/payout rails if Circle exposes consumer/business-appropriate Arc mainnet flows that can fund or withdraw from user-owned smart wallets without Teep custodying funds.

Decision checklist before enabling real-money funding:

- Provider supports Arc mainnet, not only EVM generically.
- Provider supports the exact USDC token/address used by Teep.
- Provider can deliver to or withdraw from Privy/ZeroDev smart-wallet addresses.
- Provider supports webhook confirmations and idempotency.
- Provider can quote fees before the user commits.
- Provider handles KYC/fraud/compliance without Teep storing sensitive payment data.
- Provider has acceptable country coverage for Teep's target launch market.
- UX can say "Add Money" and "Withdraw" without exposing chain jargon by default.

Remaining work:

- Keep faucet active for Arc testnet.
- Keep Add From Card/Bank disabled or "coming with Arc mainnet" until Arc mainnet exists.
- Implement provider interfaces and environment gates now so activation is a config/provider decision later.
- Replace off-ramp placeholder copy and URL with a provider-backed withdrawal/offramp flow once Arc mainnet support exists.
- Add webhook/session persistence for onramp/offramp status.

## 3. Withdrawal Safeguards

Status after the hybrid tightening pass: official UI/API withdrawals have guardrails, and the claim-wallet contract now preserves non-custodial owner withdrawal while requiring backend authorization for non-owner destinations.

Implemented:

- Backend daily withdrawal limit with `WITHDRAWAL_DAILY_LIMIT_RAW`.
- Backend withdrawal confirmation request/confirm/record lifecycle.
- Withdrawal confirmations expire via `WITHDRAWAL_CONFIRMATION_TTL_MS`.
- Wallet-signature proof required before creating and recording withdrawal confirmations.
- Tips-earned withdrawals require a verified X claim.
- Extension withdrawal flow now requests confirmation before sending the transaction.
- Web withdrawal flow now requests confirmation before sending the transaction.
- Successful UI withdrawals are recorded against the confirmed request for daily-limit accounting.
- Local dev can return a `devCode` when no email webhook is configured.
- Claim wallets enforce the protocol/referral split in the contract.
- Direct owner withdrawals remain permissionless to preserve non-custodial recovery.
- Withdrawals to non-owner destinations require an EIP-712 backend authorization signed by the configured withdrawal signer.

Important limitation:

- A user can still call the claim wallet directly outside Teep, but the direct path can only withdraw to the claim-wallet owner without backend authorization. This means the contract still enforces the split, while the bypassable Teep-only guardrails are daily max limits, confirmation UX, and any future off-ramp policy checks.

Remaining work:

- Redeploy the changed claim-wallet/factory contracts and update app defaults before treating the hybrid contract guard as live.
- Configure production email delivery with `WITHDRAWAL_EMAIL_WEBHOOK_URL`.
- Decide launch daily limit by market/risk appetite.
- Replace prompt-based confirmation entry with a polished in-flow code input.
- Clear withdrawal risk/cooldown states.
- Ensure verified identity requirements are enforced consistently across any future off-ramp provider path.
- E2E tests for withdrawal success, insufficient balance, referral fee split, and failed signatures.

## 4. Grow Tips / DeFi Layer

Status: UI placeholder only.

Remaining work:

- Choose the first Arc DeFi primitive/provider to integrate.
- Design the first conservative strategy around user trust and liquidity reality.
- Add contracts or backend adapters for strategy routing.
- Likely missing contract concepts from docs:
  - `TeepRouter` or `TipRouter`.
  - `StrategyRegistry`.
  - `StrategyAdapter`.
  - optional `YieldVault`.
- Add user preferences: idle tips only, enabled strategy, risk tier, opt-in/opt-out.
- Keep UX language non-crypto: "Grow Tips", "Available", "Growing", "Projected", "Withdraw".
- Add strategy event indexing and activity history entries.
- Add receipt/history support for grown, withdrawn, or moved funds.

## 5. Web Product Polish

Status: routes exist, but production polish remains.

Remaining work:

- Replace placeholder Chrome Store URL.
- Add per-route OG/Twitter cards for receipt, creator profile, tipper profile, and post pages.
- Improve CTA pages for normie language and install conversion.
- Add extension detection/deep link behavior where practical.
- Polish creator profile:
  - milestones reached,
  - top tipped posts,
  - share profile,
  - empty states,
  - SEO/OG.
- Polish tipper profile:
  - early supporter badges,
  - milestone participation,
  - optional privacy controls.
- Legal/trust pages need final review:
  - terms,
  - privacy,
  - support,
  - no affiliation with X Corp,
  - tips finality/refund expectations.

## 6. Extension Production Readiness

Status: functional, still needs release QA.

Remaining work:

- Chrome Web Store listing, screenshots, support URL, privacy URL.
- Production manifest review.
- Verify no debug UI or debug console noise in release builds.
- Verify popup dimensions and no unwanted scroll on all key flows.
- Verify content script injection works across X timeline, profile, detail, and repost contexts.
- Verify new tips persist on the X DOM after feed rerenders.

## 7. Backend And Ops

Status after the 2026-05-06 ops pass: local backend works and the first production observability/ops guardrails are now implemented. Cloud deployment, backups, and external alert delivery still need provider setup.

Implemented:

- `/health/live` for liveness checks.
- `/health/ready` for readiness checks with indexer lag/staleness state.
- `/health` now reports indexer lag, last success, last error, and open abuse summary.
- Indexer records current block, last success time, and last error in `indexer_state`.
- Indexer can backfill from `INDEXER_START_BLOCK` instead of starting from a recent block window.
- Indexer waits for configurable confirmations before advancing the checkpoint.
- Indexer re-scans a recent confirmed block window each poll and de-dupes existing events.
- Token-protected `/ops/indexer/state` endpoint exposes indexer checkpoint state.
- Token-protected `/ops/indexer/rewind` endpoint can rewind the checkpoint for recovery backfills.
- Persistent `ops_events`, `abuse_events`, and `security_events` tables.
- Token-protected `/ops/events` and `/ops/abuse/summary` endpoints.
- Auth/referral/withdrawal-specific rate limits.
- Production backend now requires `OPS_TOKEN`.
- Production config now has explicit rate-limit, indexer-lag, indexer-recovery, abuse-threshold, and proxy knobs.

Remaining work:

- Deploy backend with production env manager.
- Configure strict `CORS_ORIGIN`.
- Configure database backups.
- Hook `/health/live` and `/health/ready` into uptime monitoring.
- Hook ops/abuse/security events into external alerting.
- Configure RPC/paymaster/bundler failure alerts outside the app.
- Tune rate limit and abuse thresholds after real test traffic.
- Add automated SQLite backup/restore workflow or move production state to managed Postgres.
- Add structured log drain/provider integration.

## 8. Abuse Resistance

Status after the 2026-05-06 abuse pass: first-pass detection is implemented and persisted; review tooling exists, but enforcement/manual review policy is still needed.

Implemented:

- Self-tipping detection when a verified creator tips their own author ID.
- Circular tipping detection when wallets tip each other within the configured window.
- High-frequency tipping heuristic.
- Wash-referral heuristic when a referred wallet tips the referrer creator.
- Reciprocal referral detection.
- Creator self-link referral detection.
- Repeated failed withdrawal signature attempts are recorded as security events.
- `/ops/abuse/summary` exposes open abuse events for review.

Remaining work:

- Decide which abuse events should block actions vs. only flag review.
- Add admin moderation workflow for resolving/ignoring abuse events.
- Add bot heuristics based on X profile/account age when X API access allows it.
- Add creator claim abuse checks around repeated claim attempts and contested accounts.
- Review referral cap/reward policy after testnet traffic.
- Add dashboards/alerts for abuse event spikes.

## 9. Test Coverage

Status: insufficient for production beta.

Remaining work:

- E2E tip flow.
- E2E X OAuth verification.
- E2E creator claim wallet deployment.
- E2E withdrawal with fee split.
- E2E referral bind and referral withdrawal fee share.
- E2E insufficient balance.
- E2E activity/receipt/share flows.
- Production build checks for web and extension.
- Smoke tests for Arc RPC, deployed contract bytecode, and configured app IDs.

## 10. Deferred / Later

These are useful but not required before the next production beta cut:

- X bot.
- TIP token layer.
- Creator-defined milestone campaigns.
- Referred-user fee discounts.
- Native mobile/deep-link flows.
- Public SDK/webhooks beyond the current external API shape.
