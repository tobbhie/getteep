# Railway Deployment

Teep is configured for Railway as three services from the same GitHub repo:

1. Backend API service from the repository root.
2. Web frontend service using `web/railway.json`.
3. X agent worker service using `x-agent/railway.json`.

`@teep/contracts` is not a Railway service. Deploy contracts separately.
`@teep/extension` is not a Railway service. Build and publish it through the
Chrome Web Store.

## Backend API Service

Use the repository root and `railway.json`.

- Build command: `npm run backend:build`
- Pre-deploy command: `npm run backend:db:migrate:prod`
- Start command: `npm run start --workspace=backend`
- Health check: `/health/live`

The backend no longer builds the web app in this split-service setup, so it does
not need `VITE_*` variables. It only needs backend runtime variables.

Use `/health/live` for Railway liveness. `/health` and `/health/ready` can
report degraded while the indexer catches up and should not restart the service.

### Backend Variables

```env
NODE_ENV=production
TRUST_PROXY=true
PORT=3001
DATABASE_URL=${{Postgres.DATABASE_URL}}
CORS_ORIGIN=https://YOUR_WEB_DOMAIN
WEB_APP_URL=https://YOUR_WEB_DOMAIN
RECEIPT_BASE_URL=https://YOUR_WEB_DOMAIN
RPC_URL=https://rpc.testnet.arc.network
ARC_RPC_URL=https://rpc.testnet.arc.network
CHAIN=arcTestnet
CHAIN_ID=5042002
USDC_ADDRESS=0x3600000000000000000000000000000000000000
TIP_CONTRACT_ADDRESS=...
FACTORY_ADDRESS=...
INDEXER_START_BLOCK=0
ATTESTATION_PRIVATE_KEY=...
PROTOCOL_TREASURY_ADDRESS=...
OPS_TOKEN=...
X_CLIENT_ID=...
X_CLIENT_SECRET=...
X_BEARER_TOKEN=...
X_REDIRECT_URI=https://YOUR_BACKEND_DOMAIN/auth/x/callback
X_AGENT_TOKEN=...
X_BOT_USERNAME=teepagent
PRIVY_APP_ID=...
PRIVY_APP_SECRET=...
WITHDRAWAL_EMAIL_WEBHOOK_URL=...
```

Keep these production safety flags unset or false:

```env
ENABLE_FAUCET=false
ALLOW_CLIENT_ACTIVITY_WRITES=false
ALLOW_INSECURE_RPC_TLS=false
ALLOW_INSECURE_AVATAR_TLS=false
ALLOW_INSECURE_OEMBED_TLS=false
ALLOW_UNSIGNED_REFERRAL_WRITES=false
ALLOW_UNSIGNED_ATTESTATION=false
ENABLE_DEFI_TRANSACTIONS=false
```

## Web Frontend Service

Use the repository root, but set the Railway config file to:

```text
web/railway.json
```

- Build command: `npm run web:build:prod`
- Start command: `npm run preview --workspace=web -- --host 0.0.0.0 --port ${PORT}`

The web service needs `VITE_*` variables because Vite bakes them into the
browser bundle at build time.

### Web Variables

```env
NODE_ENV=production
VITE_API_URL=https://YOUR_BACKEND_DOMAIN
VITE_WEB_APP_URL=https://YOUR_WEB_DOMAIN
VITE_RECEIPT_BASE_URL=https://YOUR_WEB_DOMAIN
VITE_CHROME_STORE_URL=https://chromewebstore.google.com/detail/teep/REAL_EXTENSION_ID
VITE_PRIVY_APP_ID=...
VITE_USDC_ADDRESS=0x3600000000000000000000000000000000000000
VITE_FACTORY_ADDRESS=...
VITE_TIP_CONTRACT_ADDRESS=...
VITE_REFERRAL_REGISTRY_ADDRESS=...
VITE_FUNDING_ENV=arcTestnet
VITE_FAUCET_URL=https://faucet.circle.com
VITE_ENABLE_FIAT_ONRAMP=false
VITE_ENABLE_FIAT_OFFRAMP=false
VITE_TWITTER_URL=https://x.com/teepxyz
```

## X Agent Worker Service

Use the repository root, but set the Railway config file to:

```text
x-agent/railway.json
```

- Build command: `npm run x-agent:build`
- Start command: `npm run start --workspace=x-agent`
- No HTTP health check. This is a worker, not a web server.

### X Agent Variables

```env
NODE_ENV=production
TEEP_BACKEND_URL=https://YOUR_BACKEND_DOMAIN
X_AGENT_TOKEN=...
X_BOT_USER_ID=...
X_BOT_USERNAME=teepagent
X_BEARER_TOKEN=...
X_BOT_ACCESS_TOKEN=...
X_POLL_INTERVAL_MS=45000
X_MENTIONS_PAGE_SIZE=20
X_USE_FILTERED_STREAM=false
```

`X_AGENT_TOKEN` must be the same value on the backend and X agent services.
Only the X agent service should receive `X_BOT_ACCESS_TOKEN`.

For beta, start with polling:

```env
X_USE_FILTERED_STREAM=false
```

Only switch to filtered stream mode after the X API access tier and stream
limits are confirmed for the bot account.

## Provider Callback URLs

After Railway gives each service a domain, update providers to use the exact
domains.

X OAuth:

```text
https://YOUR_BACKEND_DOMAIN/auth/x/callback
```

Privy:

```text
https://YOUR_WEB_DOMAIN
```

If custom domains are added later, update these together:

- Backend: `CORS_ORIGIN`, `WEB_APP_URL`, `RECEIPT_BASE_URL`, `X_REDIRECT_URI`
- Web: `VITE_API_URL`, `VITE_WEB_APP_URL`, `VITE_RECEIPT_BASE_URL`
- X agent: `TEEP_BACKEND_URL`

## Post-Deploy Checks

1. Open backend `/health/live` and confirm `{"status":"ok"}`.
2. Open backend `/health` and confirm the database responds.
3. Open the web domain and confirm the landing page loads.
4. Open `/creator/pipsandbills`, `/tx/<knownTxHash>`, and `/ops`.
5. Start an X OAuth connection and verify the callback returns to the web app.
6. Confirm X bot replies work from the worker service.
7. Confirm `/internal/x-bot/*` routes reject requests without `X_AGENT_TOKEN`.
