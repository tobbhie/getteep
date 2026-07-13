# Teep

Teep is a production-facing creator tipping dapp that lets fans support creators directly from supported social posts. The experience is designed to feel native to everyone: fans tip from the post, creators claim or withdraw from Teep, and the wallet and network details stay behind the flow.

Teep is currently configured for Arc testnet while the product is prepared for beta release.

## What Teep Does

- Lets fans send tips from creator pages, direct post links, and connected X tip commands.
- Lets creators receive support before they have manually claimed a Teep account.
- Gives creators a simple dashboard to claim, withdraw, and track tips.
- Keeps the core flow non-custodial: Teep coordinates the experience, but users keep control of funds.
- Uses indexed onchain events as the durable source of truth for balances, activity, receipts, and stats.

## Why It Exists

Creator support should not feel like a wallet tutorial. Teep abstracts the hard parts of onchain payments so the visible product stays familiar: discover a post, send a tip, receive support, withdraw when ready.

The dapp is built around three product principles:

- **Native support:** tipping should appear where creator attention already lives.
- **Creator ownership:** creators should have a direct path to claim and move their funds.
- **Crypto abstraction:** the user interface should speak in tips, balances, claims, and withdrawals, not protocol jargon.

## Product Surface

| Surface | Purpose |
| --- | --- |
| Web app | Landing page, dashboard, creator/tipper profiles, receipts, withdrawal flows |
| X agent | X tip command parsing and reply/claim flow |
| Legacy extension | Retained workspace for browser-extension experiments; not a primary product surface |
| Backend API | Auth, X OAuth, creator lookup, attestations, referrals, activity, ops, indexer |
| Smart contracts | Tip escrow, deterministic claim wallets, referral accounting, growth strategy contracts |
| Shared package | Cross-app helpers and types |

## Repository Layout

```text
teep/
  backend/       Express API, SQLite, indexer, auth, ops, and creator routes
  contracts/     Solidity contracts, Hardhat config, deployment scripts, tests
  extension/     Legacy Chrome MV3 extension workspace retained for reference
  shared/        Shared helpers and types
  web/           Public app, dashboard, profiles, receipts, withdrawal UI
  gasstation/    Gas sponsorship and wallet experimentation workspace
  sandbox/       Local experiments and smoke-test apps
```

## Current Network

Arc testnet is the active deployment target for the current beta track.

| Item | Value |
| --- | --- |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| ERC-20 USDC | `0x3600000000000000000000000000000000000000` |
| Tip contract | `0xFAF11e9b2242927E996f0ff6a0239Da2B742893C` |
| Wallet factory | `0x7acd5485C975649626bF379710f57021C097115b` |
| Referral registry | `0x9FFD4f2429A7d8484B6920a01653Ac61Fa40d134` |

Arc native gas is USDC-like with 18 decimals. The tipping ERC-20 USDC token uses 6 decimals. Keep those units separate in product, backend, and contract logic.

## Prerequisites

- Node.js 18+
- npm 9+
- Chrome or Chromium only if working on the legacy extension workspace
- Privy app configured for Arc testnet smart wallets
- Arc testnet RPC access
- X Developer credentials for OAuth and creator identity lookup

## Install

```bash
npm install
```

This repository uses npm workspaces for `contracts`, `backend`, `extension`, `web`, and `shared`.

## Local Development

Create local env files from the checked-in examples:

```bash
cp backend/.env.example backend/.env
cp contracts/.env.example contracts/.env
cp extension/.env.example extension/.env
cp web/.env.example web/.env
```

Run the backend:

```bash
npm run db:migrate --workspace=backend
npm run backend:dev
```

Run the web app:

```bash
npm run web:dev
```

Build and load the legacy extension only when working on that workspace:

```bash
npm run extension:build:dev
```

Then open `chrome://extensions`, enable Developer Mode, choose **Load unpacked**, and select `extension/dist`.

Compile and test contracts:

```bash
npm run contracts:compile
npm run contracts:test
```

Useful local URLs:

| Service | URL |
| --- | --- |
| Backend | `http://localhost:3001` |
| Web app | `http://localhost:5174` |

## Production Builds

Production builds intentionally fail fast when release-critical env vars are missing or unsafe localhost values are used.

### Web

Required env:

```bash
VITE_API_URL=https://api.getteep.xyz
VITE_WEB_APP_URL=https://getteep.xyz
VITE_RECEIPT_BASE_URL=https://getteep.xyz
VITE_PRIVY_APP_ID=...
```

Build:

```bash
npm run web:build:prod
```

### Legacy Extension

Required env:

```bash
API_BASE_URL=https://api.getteep.xyz
WEB_APP_URL=https://getteep.xyz
RECEIPT_BASE_URL=https://getteep.xyz
PRIVY_APP_ID=...
ARC_RPC_URL=https://rpc.testnet.arc.network
```

Build:

```bash
npm run extension:build:prod
```

The extension workspace is retained for reference and experiments. It is not part of the primary Teep web/X bot product path.

### Backend

Required production env includes:

- `CORS_ORIGIN`
- `WEB_APP_URL`
- `RECEIPT_BASE_URL`
- `RPC_URL` or `ARC_RPC_URL`
- `ATTESTATION_PRIVATE_KEY`
- `USDC_ADDRESS`
- `X_CLIENT_ID`
- `X_CLIENT_SECRET`
- `X_BEARER_TOKEN`
- `PROTOCOL_TREASURY_ADDRESS`
- `TIP_CONTRACT_ADDRESS`
- `FACTORY_ADDRESS`
- `INDEXER_START_BLOCK`
- `OPS_TOKEN`

Set `WEB_DIST_DIR` to the built web app directory, for example `../web/dist`, when the backend should serve creator profile URLs with crawler-visible OpenGraph/Twitter metadata.
In production, route top-level creator profile URLs such as `/:username` to this backend renderer, or serve the built web app from the backend, so crawlers receive the injected metadata before React hydrates.

Build and start:

```bash
npm run backend:build
NODE_ENV=production npm run start --workspace=backend
```

Production backend guardrails block unsafe local CORS, faucet mode, unsigned referral or attestation flows, client-side activity writes, and incomplete withdrawal confirmation configuration.

## Smart Contracts

Common commands:

```bash
npm run contracts:compile
npm run contracts:test
npm run contracts:deploy:arc-testnet
```

Additional deployment scripts exist for local deployments, Arc testnet DeFi contracts, Base Sepolia, mainnet configuration, and referral-only deployments. See `contracts/package.json` for the exact commands.

## Operational Checks

Health and ops endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /health/live` | Liveness check |
| `GET /health/ready` | Readiness check with indexer freshness |
| `GET /health` | Detailed health, indexer state, abuse summary |
| `GET /ops/events` | Token-protected ops/security/abuse events |
| `GET /ops/abuse/summary` | Token-protected abuse summary |
| `GET /ops/indexer/state` | Token-protected indexer checkpoint state |
| `POST /ops/indexer/rewind` | Token-protected checkpoint rewind for recovery |

Validation commands:

```bash
npx tsc --noEmit --project extension/tsconfig.json --pretty false
npx tsc --noEmit --project web/tsconfig.json --pretty false
npm run backend:build
npm audit --omit=dev --audit-level=high --workspaces
```

## Security Model

- Teep is non-custodial; the backend never holds user funds.
- Claim wallets keep creator recovery permissionless at the contract level.
- Official withdrawal flows add wallet signatures, confirmation checks, and daily-limit safeguards.
- Backend attestations and referral signatures are produced server-side from protected keys.
- Ops routes require `OPS_TOKEN` in production.
- Local `.env` files are ignored by git. Do not commit secrets or generated private deployment data.

## Status

Teep is in beta preparation on Arc testnet. The repository includes the web app, X agent, backend, contracts, retained legacy extension workspace, production build guardrails, and operational documentation needed to move toward a public dapp release.
