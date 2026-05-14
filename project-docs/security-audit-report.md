# Teep Security Audit Report

Date: 2026-04-30

## General security and compliance update - 2026-05-13

Scope:

- Production beta security/compliance checklist items that can be implemented in-repo.
- Runtime dependency audit status.
- Local repository hygiene around env/build/log/database ignore rules.
- Public trust copy for retention, finality, delayed history, and X non-affiliation.

Changes implemented:

- Added `project-docs/production-secret-inventory.md` with production secret classes, public-config boundaries, and rotation triggers.
- Added `project-docs/incident-response-runbooks.md` for key compromise, bad contract deployment, and indexer corruption.
- Added `project-docs/beta-data-retention-policy.md` with beta retention targets for account, claim, activity, withdrawal, abuse, provider, log, and support data.
- Added root script `security:audit:runtime` for `npm audit --omit=dev --audit-level=high --workspaces`.
- Updated the web privacy policy with beta retention language.
- Updated terms/support copy for finality, delayed indexer history, and explicit non-affiliation with X Corp.

Verification:

- `npm.cmd audit --omit=dev --audit-level=high --workspaces` passed with 0 vulnerabilities.
- Local file scan found `.env` files in workspace directories and local SQLite DB files under `backend/data`, but `.gitignore` excludes `.env`, `.env.*`, `backend/data/`, `*.db`, `dist/`, contract build artifacts, and logs.
- This workspace is not a git repository, so this pass cannot prove whether `.env` files were ever committed in history. Verify in the real repository/remote before public beta.

Remaining security/compliance work:

- Rotate local/dev keys before production deployment, especially any values exposed in screenshots, chats, terminal logs, or support workflows.
- Run final production bundle scans with final environment values.
- Complete legal review of terms, privacy, refund/finality, and regional compliance language.
- Decide whether `WITHDRAWAL_AUTHORIZATION_PRIVATE_KEY` is separated from `ATTESTATION_PRIVATE_KEY` before public beta.
- Add production monitoring and alerting for signer failures, auth abuse, indexer corruption, and provider webhook failures.

## Contract security audit update - 2026-05-12

Scope:

- Core tipping contracts: `ClaimWallet`, `WalletFactory`, `ReferralRegistry`, `TipContract`.
- Grow Tips contracts now present in the repo: `StrategyRegistry`, `AaveV3SupplyAdapter`, `PooledTipsVault`.
- Review focus: access control, EIP-712 domains/type hashes/nonces/expiry, replay boundaries, deterministic wallet derivation, token transfer paths, fee splitting, stuck-fund cases, admin/registry risk, and upgrade/deployment assumptions.

Verification:

- `npm.cmd run contracts:compile` passed.
- `npm.cmd run contracts:test` passed: 37 passing.
- `REPORT_GAS=true npm.cmd run contracts:test` passed: 37 passing.
- `slither` and `solc` CLIs were not installed on PATH in this workspace. This pass used a manual static review plus targeted source scans and the Hardhat/gas test suite. Run Slither in CI or a local Python toolchain before public mainnet-value release.

### Contract audit findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| SC-01 | Medium | `WalletFactory` uses `attestationSigner` both for claim-wallet deployment attestations and as the `withdrawalSigner` injected into wallets. A compromise of that one key can authorize both wallet creation and non-owner withdrawal destinations. | Open |
| SC-02 | Medium | `ReferralRegistry` constructor does not cap initial `feeBps` and `referrerShareBps`, although setters do. A bad deployment can start with impossible fee/share values. | Resolved on 2026-05-12 |
| SC-03 | Medium | `ReferralRegistry` allows `treasury` to be zero. If treasury is zero, protocol fee amounts are deducted from creator withdrawals but not transferred, leaving those tokens in the claim wallet. | Resolved on 2026-05-12 |
| SC-04 | Medium | `WalletFactory.deployClaimWallet` only checks that `_timestamp` is not older than 10 minutes. A signature with a future timestamp remains valid until that future time plus the window. | Resolved on 2026-05-12 |
| SC-05 | Low | `ReferralRegistry.setReferrer` signatures have nonce replay protection but no expiry. A leaked unused referral signature can be exercised later until the owner has a referrer. | Resolved on 2026-05-12 |
| SC-06 | Low | `WalletFactory.setReferralRegistry` accepts zero. That can intentionally or accidentally cause newly deployed wallets to have no registry, making ERC-20 withdrawals fail until an owner injection is performed. | Resolved on 2026-05-12 |
| SC-07 | Low | `ClaimWallet.withdrawETH` is owner-only but does not apply the same destination restriction or authorization model as ERC-20 withdrawals. This is mostly a recovery path, but it is a policy mismatch if native balances become meaningful. | Resolved on 2026-05-12 |
| SC-08 | Medium | `PooledTipsVault.totalAssets()` values `positionToken.balanceOf(this)` as 1:1 underlying. That is acceptable only for adapters whose position token balance is denominated in the same asset units, like standard Aave aToken behavior. It is unsafe as a generic adapter assumption. | Open before pooled mode |

### Positive observations

- `ClaimWallet` and `TipContract` use `ReentrancyGuard` and `SafeERC20` on ERC-20 paths.
- Claim-wallet ERC-20 withdrawals now fail closed if `referralRegistry` is missing.
- Direct owner withdrawals still enforce the protocol/referral split.
- Non-owner ERC-20 withdrawal destinations require EIP-712 authorization, include expiry, and bind owner, token, destination, amount, nonce, chain ID, and verifying wallet.
- EIP-712 domains are contract-bound for `ClaimWallet` and `ReferralRegistry`, reducing cross-contract replay risk.
- `TipContract` does not custody balances; it forwards USDC to deterministic claim wallet addresses and emits events.
- `StrategyRegistry` is an allowlist/gating contract and does not custody user funds.
- `AaveV3SupplyAdapter` beta path is non-custodial: deposits supply with the user-selected beneficiary, and withdrawals redeem caller-owned position tokens directly to the recipient.
- Disabling a strategy in the registry blocks new deposits but still allows adapter exits, while adapter-level `pause()` remains an emergency brake.
- `PooledTipsVault` is clearly marked as future pooled custody mode and should not be enabled in beta UX without a separate audit.

### Recommended contract fixes before production beta

1. Split factory signer roles: keep `attestationSigner` for claim-wallet deployment and add a separate `withdrawalSigner` for wallet injection.
2. Before enabling `PooledTipsVault`, make adapter valuation explicit instead of assuming all `positionToken` balances equal underlying assets 1:1.

Resolved on 2026-05-12:

- Added constructor validation to `ReferralRegistry`: nonzero treasury, `_feeBps <= 10000`, and `_referrerShareBps <= 10000`.
- Made `setTreasury` reject zero.
- Added a future-skew bound to `WalletFactory.deployClaimWallet`.
- Added `expiresAt` to `ReferralRegistry.SetReferrer` EIP-712 data.
- Made `WalletFactory.setReferralRegistry` reject zero.
- Restricted `ClaimWallet.withdrawETH` to the owner destination.
- Updated backend referral signing and extension referral registry calls for the new expiry field.
- Verification passed: `contracts:compile`, `contracts:test` with 43 passing, `backend:build`, and extension TypeScript check.

### Deployment and abstraction notes

- 2026-05-12 hardened Arc testnet deployment after contract security fixes:
  - WalletFactory: `0xB53E8919627BcE6845eEee399E27A023D23C0dD4`
  - ReferralRegistry: `0x967A2Bb3Ba05D1c0F3071C2c94C02950966c3655`
  - TipContract: `0xc4b18D3FB3aE76b37B6dfd69E5037c5865A47886`
  - USDC: `0x3600000000000000000000000000000000000000`
  - Backend local `INDEXER_START_BLOCK`: `41811022`
  - Deployer/Admin/Treasury used by this deploy: `0x24Ac4AD3d4a53029bEEE731003Ab16b0014a9CC2`
  - Attestation/referral signer configured by this deploy: `0xde7fa6622803Ed142B3826b651bffa6E4e17dF49`
- New claim wallets are created from the currently deployed factory bytecode and config. Old claim wallets are not upgradeable; they keep the registry and withdrawal signer previously injected into them.
- This detail should remain in operator/audit documentation and support tooling. The normal Teep UX should continue to describe user outcomes: tips received, tips sent, withdrawal destination, fees, and confirmation status.
- Even if a creator calls a claim wallet directly, the contract still enforces the protocol/referral split on ERC-20 withdrawals. Direct contract calls bypass Teep-managed UX/API guardrails such as confirmation emails, max limits, and activity labeling, not the on-chain fee split.

## Re-audit update - 2026-05-02

This follow-up pass implemented the remaining repo-level fixes that do not need to be redone for the Base-to-Arc port, then re-ran focused checks.

### Changes implemented

- Added wallet ownership challenges at `POST /auth/wallet/challenge`.
- Required wallet signatures for fresh claim attestations through `POST /auth/attestation/:address`; the old unsigned `GET` path now returns `403` unless `ALLOW_UNSIGNED_ATTESTATION=true`.
- Required wallet signatures for referral code creation, referral linking, and set-referrer signature issuance. Existing referral-code reads remain public, but creating or mutating referral state now requires proof of wallet control.
- Added EOA and ERC-1271 smart-account signature verification so Privy/Circle-style smart wallets can prove ownership without exposing crypto complexity to the user.
- Removed the dead handle-hash fallback in `backend/src/routes/auth.ts`; X numeric IDs are now the only active author identity path.
- Changed the faucet to require `FAUCET_PRIVATE_KEY` instead of `DEPLOYER_PRIVATE_KEY`, and kept faucet disabled by default.
- Hardened `.gitignore` to ignore `.env.*` while preserving `.env.example`.
- Updated `ClaimWallet` so ERC-20 withdrawals fail closed when no referral registry is set. `withdraw()` now routes through the same fee path as `withdrawWithFee()`.
- Gated noisy extension startup/wallet logs behind debug flags.
- Updated contract tests for registry-backed withdrawal behavior.

### Verification run

- `npm.cmd run backend:build` passed.
- `npx.cmd tsc --noEmit --project extension\tsconfig.json` passed.
- `npm.cmd run compile --workspace=contracts` passed.
- `npm.cmd run test --workspace=contracts` passed: 8 passing.
- Focused scans found no remaining backend use of `DEPLOYER_PRIVATE_KEY`.
- `npm audit --omit=dev --workspaces --json` still reports dependency risk: 75 production advisories total, including 12 high, 61 moderate, 2 low, and 0 critical.

### Updated finding status

| Finding | Status after re-audit |
| --- | --- |
| C-01 `.env` secrets in workspace | Partially mitigated. Ignore rules are stronger and backend faucet no longer uses the deployer key, but local secrets still need rotation and removal from working `.env` files. |
| C-02 mutable X handles | Mitigated in active tip/claim flow by resolving stable X numeric user IDs. |
| H-01 public metadata/activity writes | Partially mitigated. Activity writes are env-gated; metadata remains public but validated/recomputed. Production history should still come from indexed chain events. |
| H-02 referral writes without ownership proof | Mitigated with wallet signature challenges. |
| H-03 fee bypass when registry is unset | Mitigated in source and tests. Existing deployed factories must be redeployed before this bytecode is active on Arc. |
| H-04 permissive CORS | Mitigated by `CORS_ORIGIN` allow-listing. |
| H-05 faucet/deployer-key risk | Mitigated in code by using `FAUCET_PRIVATE_KEY` and disabled-by-default faucet. Do not put deployer keys in backend env. |
| H-06 dependency audit vulnerabilities | Still open. `npm audit` now reports 75 prod advisories, including 12 high. |
| M-01 JSON body limit | Mitigated. |
| M-02 OAuth HTML escaping | Mitigated. |
| M-03 public attestation issuance | Mitigated with wallet signature challenges. |
| M-04 extension trusts X DOM identity | Partially mitigated by backend X user-ID resolution before tipping; DOM parsing still starts the UX and should remain defensive. |
| M-05 debug logging | Mostly mitigated. Extension startup/wallet logs are debug-gated; web wallet-resolution log is dev-only. |
| M-06 inconsistent validation | Improved with shared validators on key backend routes. |
| L-01 manifest/dev permissions | Still needs production packaging review. |
| L-02 hardcoded public config | Acceptable for public RPC/contract addresses, but production API/RPC values should be deployment-configured. |

### Remaining production-beta blockers

1. Rotate and remove secrets that have appeared in local `.env` files. `.gitignore` prevents new accidental tracking; it does not make exposed keys safe.
2. Completed on 2026-05-02: Arc contracts were redeployed after the `ClaimWallet` fee-enforcement change, and local defaults now point at the hardened deployment:
   - WalletFactory: `0xB53E8919627BcE6845eEee399E27A023D23C0dD4`
   - ReferralRegistry: `0x967A2Bb3Ba05D1c0F3071C2c94C02950966c3655`
   - TipContract: `0xc4b18D3FB3aE76b37B6dfd69E5037c5865A47886`
3. Triage `npm audit` high-severity transitive advisories, especially wallet connector and Express dependency chains. Some may require package upgrades rather than direct code changes.
4. Do a Chrome-extension production manifest pass before store submission: host permissions, local API defaults, debug flags, and build-time API URL injection.

## Executive summary

This audit found several production-beta blockers. The largest risks are not exotic smart-contract bugs; they are trust-boundary and operational issues around identity, unauthenticated write APIs, local secret material, fee enforcement assumptions, and dependency hygiene.

Most urgent findings:

- Real `.env` files contain private keys and OAuth secrets in the workspace.
- Creator identity is derived from mutable X handles instead of stable X numeric IDs, which can misdirect future tips and claims after handle changes or handle recycling.
- Public backend routes allow arbitrary clients to write tip metadata, activity history, referral links, and referral codes for wallet addresses they do not control.
- Withdrawal fee enforcement depends on each ClaimWallet having a referral registry; any wallet without a registry can withdraw without protocol fees.
- The dependency tree has 155 `npm audit` findings, including 1 critical and 31 high severity advisories.

This report is a source review, not a formal external audit. Solidity should still receive a dedicated smart-contract audit before real funds are invited.

## Critical findings

### C-01: Secret-bearing `.env` files are present in the workspace

Severity: Critical

Locations:

- `backend/.env`: lines 18, 26, 31
- `contracts/.env`: lines 2, 11
- `web/.env`: lines 1, 8, 12-14, 17-20

Evidence:

The audit found real environment files in the repo workspace:

```text
backend/.env
contracts/.env
web/.env
```

The files contain secret or sensitive variables including:

```text
backend/.env: DEPLOYER_PRIVATE_KEY
backend/.env: ATTESTATION_PRIVATE_KEY
backend/.env: X_CLIENT_SECRET
contracts/.env: DEPLOYER_PRIVATE_KEY
contracts/.env: BASESCAN_API_KEY
```

Impact:

If these files were ever committed, backed up, shared, copied into build artifacts, or exposed through support/debug workflows, an attacker could deploy contracts, mint test tokens, impersonate the attestation signer, or abuse the X OAuth app.

Fix:

- Rotate all private keys and OAuth/API secrets that appear in local `.env` files.
- Keep only `.env.example` in the repo.
- Move production secrets to a secret manager or deployment platform environment.
- Add a pre-commit secret scanner such as Gitleaks or TruffleHog.
- Confirm whether these files were ever committed or uploaded. If yes, treat the secrets as compromised even if later removed.

Mitigation:

The root `.gitignore` does ignore `.env`, but that only prevents future accidental tracking. It does not protect secrets that already exist in the workspace or may have been previously committed.

### C-02: Mutable X handles are used as creator identity for funds

Severity: Critical

Locations:

- `extension/src/utils/contentId.ts`: lines 21-23
- `extension/src/utils/dom.ts`: lines 47-50
- `web/src/lib/contracts.ts`: lines 51-54
- `backend/src/routes/auth.ts`: lines 91-102

Evidence:

```ts
export function handleToAuthorId(handle: string): `0x${string}` {
  return keccak256(toBytes(handle.toLowerCase()));
}
```

The extension extracts the handle from the visible X URL and hashes it:

```ts
const authorId = handleToAuthorId(authorHandle);
```

The OAuth callback also computes the claim author ID from the handle:

```ts
const authorIdHash = handleToAuthorId(profile.username);
const authorIdForDb = BigInt(authorIdHash).toString();
```

Impact:

X handles are mutable and may be recycled. A creator who changes handles can split future tips into a new claim wallet. Worse, if an old handle is later controlled by someone else before the original creator claimed funds, the new handle owner may be able to verify that handle and claim tips intended for the previous identity. This violates the original architecture goal of deterministic claimable ownership tied to stable X identity.

Fix:

- Return to stable X numeric author IDs for on-chain `authorId`.
- Use OAuth or a trusted X API lookup to bind `handle -> numeric X user id` at tip time, claim time, or both.
- Store handle as mutable metadata only.
- During Arc migration, introduce a versioned content/author identity scheme so old handle-hash data can be migrated or isolated.

Mitigation:

For beta, do not allow large balances to accumulate under handle-derived claim wallets. Warn that handle changes are not supported until numeric author ID resolution is restored.

## High findings

### H-01: Public write endpoints allow activity and metadata spoofing

Severity: High

Locations:

- `backend/src/routes/tips.ts`: lines 270-283
- `backend/src/routes/tips.ts`: lines 295-319
- `extension/src/popup/App.tsx`: lines 1093-1120
- `web/src/pages/Home.tsx`: lines 352-373

Evidence:

```ts
router.post("/metadata", (req: Request, res: Response) => {
  const { contentId, authorHandle, tweetId } = req.body;
  ...
  db.prepare(
    "INSERT OR IGNORE INTO tip_metadata (content_id, author_handle, tweet_id) VALUES (?, ?, ?)"
  ).run(contentId, authorHandle.toLowerCase(), tweetId);
});
```

```ts
router.post("/activity", (req: Request, res: Response) => {
  const { type, fromAddress, toAddress, amount, txHash, detail, authorHandle, tweetId } = req.body;
  ...
  db.prepare(
    "INSERT INTO user_activity (...) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(...);
});
```

Impact:

Any internet client can create fake history rows, fake withdrawals, fake referral-fee receipts, or misleading post metadata for arbitrary addresses. Even if this does not move funds, it corrupts user-facing financial history and can be used for fraud, support scams, social proof manipulation, and reputational attacks.

Fix:

- Remove direct public writes for activity.
- Derive tip activity from indexed on-chain events.
- For client-submitted optimistic activity, require an authenticated Privy session and verify the wallet owns `fromAddress`.
- Verify `txHash` on-chain before persisting financial activity.
- For metadata, recompute `contentId` server-side from validated handle/tweet ID and only accept metadata attached to an observed or pending transaction.

Mitigation:

Mark client-submitted activity as unverified and exclude it from financial totals until verified by the indexer.

### H-02: Referral creation and linking do not prove wallet ownership

Severity: High

Locations:

- `backend/src/routes/referral.ts`: lines 24-40
- `backend/src/routes/referral.ts`: lines 49-105
- `backend/src/routes/referral.ts`: lines 114-138

Evidence:

```ts
router.get("/code/:address", (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  ...
  db.prepare(
    "INSERT INTO referral_codes (code, referrer_address) VALUES (?, ?)"
  ).run(code, address);
});
```

```ts
router.post("/link", async (req: Request, res: Response) => {
  const { userAddress, code } = req.body;
  ...
  db.prepare(
    "INSERT INTO user_referrals (user_address, referrer_address, referral_code) VALUES (?, ?, ?)"
  ).run(user, referrer, codeNorm);
});
```

Impact:

An attacker can generate referral codes for addresses they do not control and pre-link any known user wallet to the attacker's referral code in the backend DB. In legacy withdrawal paths that trust backend breakdowns, this can redirect referral fee display and transfers. Even with on-chain registry protection, it pollutes backend state and creates user/support confusion.

Fix:

- Require wallet authentication or a signed challenge before creating a referral code for an address.
- Require wallet authentication or a signed challenge before linking `userAddress`.
- Bind referral code actions to the authenticated wallet from Privy/session middleware, not request body strings.
- Make `/sign-set-referrer` return signatures only to the owner after auth.

Mitigation:

For production beta, disable referral linking until wallet-authenticated backend sessions exist.

### H-03: Fee enforcement can be bypassed for claim wallets without a registry

Severity: High

Locations:

- `contracts/contracts/ClaimWallet.sol`: lines 89-100
- `contracts/contracts/ClaimWallet.sol`: lines 130-147
- `extension/src/popup/App.tsx`: lines 1025-1040
- `extension/src/popup/App.tsx`: lines 1040-1087

Evidence:

```solidity
function withdraw(address token, address to, uint256 amount) external onlyOwner nonReentrant {
    require(to != address(0), "ClaimWallet: zero recipient");
    if (referralRegistry != address(0)) {
        _withdrawWithFee(token, to, amount);
        return;
    }
    IERC20(token).safeTransfer(to, amount);
    emit Withdrawn(token, to, amount);
}
```

Impact:

If a ClaimWallet does not have `referralRegistry` set, the owner can call `withdraw()` directly and avoid withdrawal fees entirely. The UI has a legacy multi-call path, but protocol revenue and referral fees are not enforced on-chain unless every wallet has a registry injected.

Fix:

- For production, deploy wallets with fee enforcement active from day one.
- Consider making the registry immutable or required at ClaimWallet deployment.
- If backward compatibility is needed, block withdrawals until registry is set.
- Add tests proving fee enforcement cannot be bypassed by direct `withdraw()`.

Mitigation:

Before beta, run an on-chain script to verify every deployed claim wallet has the expected registry address.

### H-04: Backend CORS is permissive while state-changing routes are unauthenticated

Severity: High

Location:

- `backend/src/index.ts`: lines 27-32

Evidence:

```ts
app.use(cors({
  origin: process.env.CORS_ORIGIN || "*",
  methods: ["GET", "POST"],
}) as any);
app.use(express.json());
```

Impact:

Because many POST routes do not require authentication, permissive CORS allows arbitrary websites to call backend write endpoints from browsers. This makes spoofing/referral pollution easier and expands the abuse surface.

Fix:

- Set explicit production origins.
- Add authentication/authorization before write routes.
- Separate public read API from authenticated app API.
- Keep CORS narrow even after auth is added.

Mitigation:

Use an API gateway/WAF rule to block public POSTs except explicitly intended endpoints.

### H-05: Faucet route holds a deployer key and can mint if production is misconfigured

Severity: High

Location:

- `backend/src/routes/faucet.ts`: lines 8-10
- `backend/src/routes/faucet.ts`: lines 27-36
- `backend/src/routes/faucet.ts`: lines 39-52
- `backend/src/routes/faucet.ts`: lines 87-90

Evidence:

```ts
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
...
if (CHAIN === "base") {
  res.status(403).json({ error: "Faucet is only available on testnet" });
  return;
}
```

Impact:

This route keeps a powerful private key in the backend process and only disables itself when `CHAIN === "base"`. If production Arc/Base config uses another chain name or is missing/incorrect, the faucet may remain available. The route also validates addresses only by `startsWith("0x")` and returns raw transaction failure messages to clients.

Fix:

- Remove the faucet route from production builds.
- Gate it with an explicit `ENABLE_FAUCET=true` plus testnet chain allowlist.
- Use a dedicated faucet key with no deployer/admin privileges.
- Validate addresses with a strict `0x[a-fA-F0-9]{40}` regex or viem address validation.
- Do not expose raw RPC/contract errors to clients.

Mitigation:

Deploy the faucet as a separate testnet-only service, not inside the production backend.

### H-06: Dependency audit reports critical and high vulnerabilities

Severity: High

Location:

- `package-lock.json`

Evidence:

`npm.cmd audit --audit-level=moderate` reported:

```text
155 vulnerabilities (9 low, 114 moderate, 31 high, 1 critical)
```

Notable advisories include:

- Critical `handlebars` issues through Solidity coverage tooling.
- High `path-to-regexp`, `qs`, and `body-parser` through Express.
- High `undici` advisories through Hardhat tooling.
- High `rollup` arbitrary file write advisory.
- High `lodash`, `hono`, `defu`, `serialize-javascript`, and WalletConnect/AppKit transitive advisories.

Impact:

Some findings are likely dev-only, but production dependencies include Express and browser wallet stacks. Unpatched dependencies increase DoS, prototype pollution, SSRF, file write, and supply-chain risk.

Fix:

- Run `npm audit fix` on a branch and review lockfile changes.
- Upgrade Express/body-parser/path-to-regexp where possible.
- Separate production dependencies from dev-only contract tooling.
- Re-run audit per workspace after dependency pruning.
- Consider replacing or upgrading wallet/connect packages that pull vulnerable transitive trees.

Mitigation:

Do not ship with public source maps or dev tooling bundled. Confirm extension/web production bundles do not include vulnerable dev-only packages.

## Medium findings

### M-01: Express JSON body parser has no explicit size limit

Severity: Medium

Location:

- `backend/src/index.ts`: line 32

Evidence:

```ts
app.use(express.json());
```

Impact:

The default body limit may be too high or change across versions, and every route gets the parser. Attackers can send large JSON bodies to consume memory/CPU.

Fix:

Use an explicit limit:

```ts
app.use(express.json({ limit: "64kb" }));
```

Use route-specific larger limits only where needed.

### M-02: OAuth success/error HTML interpolates remote profile data without escaping

Severity: Medium

Location:

- `backend/src/routes/auth.ts`: lines 112-118
- `backend/src/routes/auth.ts`: lines 145-162

Evidence:

```ts
<p>@${profile.username} is already linked to another wallet...</p>
...
<p>Welcome, <span class="handle">@${profile.username}</span></p>
```

Impact:

X usernames are currently constrained, so practical exploitability is lower. Still, this creates an unsafe pattern: remote identity-provider data is inserted into HTML without escaping. If another field is later added, or the provider behavior changes, this becomes XSS.

Fix:

Escape all interpolated HTML values with a shared helper before insertion, or render static pages without dynamic HTML.

### M-03: Attestations can be requested for any verified owner address

Severity: Medium

Location:

- `backend/src/routes/auth.ts`: lines 345-370

Evidence:

```ts
router.get("/attestation/:address", async (req: Request, res: Response) => {
  const address = (req.params.address as string).toLowerCase();
  ...
  const claim = db.prepare(
    "SELECT username FROM verified_claims WHERE owner_address = ?"
  ).get(address)
  ...
  const attestation = await attestationService.createAttestation(authorIdHash, address);
});
```

Impact:

Anyone can request a fresh deployment attestation for any address that has a verified claim. This does not directly let them steal funds because the wallet owner is still the target address, but it enables front-running/griefing, leaks operational state, and removes a useful proof-of-wallet-control boundary.

Fix:

- Require an authenticated session or wallet signature for the requested owner address.
- Bind OAuth verification and attestation retrieval to the same session or signed challenge.
- Delete stored attestations after use if you keep a pending-attestation table.

### M-04: Extension transaction construction trusts X DOM-derived identity

Severity: Medium

Locations:

- `extension/src/utils/dom.ts`: lines 25-50
- `extension/src/background/index.ts`: lines 146-178

Evidence:

```ts
const statusLinks = article.querySelectorAll('a[href*="/status/"]');
...
authorHandle = segment;
...
const authorId = handleToAuthorId(authorHandle);
```

```ts
args: [contentId as `0x${string}`, BigInt(authorId), rawAmount],
```

Impact:

The extension bases payment destination on visible DOM links. If X changes markup, if a misleading embedded/status link is selected, or if malicious/compromised page content influences the article structure, Teep can compute the wrong recipient identity. This is amplified by handle-based identity.

Fix:

- Verify tweet ID and author identity against a trusted API or signed link resolver before transaction signing.
- Show the resolved creator identity in the signing confirmation.
- Move recipient resolution to the backend and return a signed tip intent.

### M-05: Client-side debug logging leaks wallet/account metadata in production code

Severity: Medium

Location:

- `web/src/pages/Home.tsx`: lines 125-142

Evidence:

```ts
console.log("[Teep Tip Form] Wallet address resolution", {
  ...
  linkedAccountTypes: linkedAccounts.map((a) => a?.type).filter(Boolean),
  resolvedAddress: address ? `${address.slice(0, 10)}...` : "(empty)",
});
```

Impact:

This logs wallet resolution and linked-account metadata in user browsers. It is not a direct exploit by itself, but it creates unnecessary privacy leakage and makes support recordings/debug captures more sensitive.

Fix:

Remove the log or guard it behind a build-time debug flag that is false in production.

### M-06: Public API input validation is inconsistent

Severity: Medium

Locations:

- `backend/src/routes/withdrawal.ts`: lines 21-34
- `backend/src/routes/leaderboard.ts`: lines 22-27
- `backend/src/routes/tips.ts`: lines 52-73
- `backend/src/routes/api-v1.ts`: lines 50-80

Evidence:

Some routes validate addresses strictly, such as:

```ts
if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
```

Others only check presence, length, or `startsWith("0x")`, and `amountRaw` is passed directly to `BigInt`.

Impact:

Malformed inputs can cause 500s, inconsistent behavior, oversized DB queries, and abuse of index/read endpoints.

Fix:

- Add route-level schema validation with zod, valibot, or express-validator.
- Validate all addresses, hashes, handles, tweet IDs, enum values, limits, offsets, and raw integer strings.
- Reject unexpected object/array query shapes.

## Low findings

### L-01: Extension manifest includes localhost and broad connect permissions

Severity: Low

Location:

- `extension/public/manifest.json`: lines 10-20

Evidence:

```json
"host_permissions": [
  "https://*.g.alchemy.com/*",
  "http://localhost:3001/*"
],
"connect-src": "'self' https: wss: http://localhost:3001;"
```

Impact:

This is expected during development, but production Chrome Web Store builds should not include localhost and should keep host permissions as narrow as possible.

Fix:

Create dev and production manifest variants. Remove localhost and unused hosts from production.

### L-02: Hardcoded public RPC/API configuration in extension

Severity: Low

Location:

- `extension/src/utils/config.ts`: lines 8-23

Evidence:

```ts
BASE_RPC_URL: "https://base-sepolia.g.alchemy.com/..."
API_BASE_URL: "http://localhost:3001"
PRIVY_APP_ID: "..."
```

Impact:

The Privy app ID is public by design, but hardcoded RPC/API URLs make production builds brittle and increase the chance of shipping testnet/local configuration.

Fix:

Use build-time environment injection with explicit production defaults failing closed if missing.

## Positive observations

- The backend uses Helmet and has a custom error handler.
- SQL access uses prepared statements rather than string-concatenated SQL.
- ClaimWallet and TipContract use OpenZeppelin SafeERC20 and ReentrancyGuard.
- ReferralRegistry uses EIP-712 signatures and nonce replay protection.
- OAuth `state` is random and expires.
- The sybil "same X claimed by multiple wallets" issue appears partially addressed with a first-claim-wins check.

## Recommended remediation order

1. Rotate/remove secrets and add secret scanning.
2. Decide and implement stable X numeric author ID resolution before new beta funds.
3. Add wallet-authenticated backend sessions for all write routes.
4. Remove or protect public `/tips/activity`, `/tips/metadata`, referral write routes, and faucet.
5. Make withdrawal fee enforcement impossible to bypass on-chain.
6. Add route schema validation and explicit body limits.
7. Update dependencies and split production/dev dependency trees.
8. Add tests for identity, referral, withdrawal fee, and Arc USDC decimal behavior.

## Suggested security tests before beta

- A user cannot create a referral code for an address they do not control.
- A user cannot link someone else's wallet to a referrer.
- A user cannot write activity history for another wallet.
- A fake `txHash` cannot appear as verified activity.
- A creator changing X handle does not change claim wallet ownership.
- A recycled handle cannot claim old creator funds.
- Every claim wallet enforces withdrawal fee rules.
- Arc migration tests keep native gas decimals and ERC-20 USDC decimals separate.
- Production build contains no localhost URLs, faucet access, debug panels, or source maps intended to be private.
