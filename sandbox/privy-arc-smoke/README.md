# Privy Arc Smoke Test

Isolated browser smoke test for Privy embedded auth + Privy smart wallets on Arc testnet.

This intentionally avoids Teep extension APIs, Teep contracts, backend routes, and Circle/Pimlico custom code.

## Setup

```powershell
cd sandbox/privy-arc-smoke
Copy-Item .env.example .env
```

Edit `.env` if you want a different Privy app:

```env
VITE_PRIVY_APP_ID=cmoslas9401se0cjx2g6mk2a3
VITE_ARC_RPC_URL=https://rpc.testnet.arc.network
VITE_ARC_BUNDLER_URL=
VITE_ARC_PAYMASTER_URL=
```

## Run

```powershell
npm run dev
```

Open:

```text
http://127.0.0.1:5188
```

## What To Test

1. Login with Privy using a fresh test email.
2. Click **Check factory bytecode**.
   - ZeroDev factory addresses should show deployed bytecode.
   - Coinbase factory `0xBA5ED110...` should show `0x` on Arc testnet.
3. Click **Get Arc smart wallet**.
   - If Privy returns a smart wallet, the account address appears.
   - If it fails and mentions `0xBA5ED110...`, the app/user/session is still resolving to Coinbase Smart Wallet.
4. Click **Sign smoke message** after smart wallet creation works.
5. Optional: add `VITE_ARC_BUNDLER_URL` and `VITE_ARC_PAYMASTER_URL`, restart Vite, then click **Probe AA endpoints**.
6. Click **Send sponsored no-op tx**.
   - This sends a zero-value call from the Privy smart wallet to the embedded wallet address.
   - Watch the browser console for `[Privy Arc Smoke:network]` logs to see the provider/bundler/paymaster URLs the browser actually calls.
   - A transaction hash means the Privy smart wallet flow produced and submitted a UserOperation successfully.

## Expected Diagnostic

For ZeroDev on Arc, Privy should not call:

```text
0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842
```

That is the Coinbase Smart Wallet factory, and Arc testnet currently returns `0x` for it.
