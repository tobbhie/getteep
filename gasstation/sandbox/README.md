# Teep Arc Gasless Sandbox

This folder is an isolated proof harness. It does not change the backend, web app,
extension, or contracts.

What it proves:

- create an `ARC-TESTNET` Circle dev-controlled `SCA` wallet;
- use Circle contract execution on that SCA wallet;
- sponsor the transaction path through Circle Gas Station on Arc Testnet;
- execute Teep's existing `tip(bytes32,uint256,uint256)` flow without adding
  gas handling to the main app yet.

Arc's docs describe this route as: Circle dev-controlled SCA wallets on Arc
Testnet have transaction fees automatically sponsored by Circle Gas Station.

## Run

From `gasstation`:

```powershell
npx.cmd tsx .\sandbox\teep-gasless-tip-sandbox.ts
```

Default mode only prints the plan and expected environment variables.

## Environment

The script loads `gasstation/.env` first, then `gasstation/sandbox/.env`. Values
in the shell still win.

Required for Circle calls:

```env
CIRCLE_API_KEY=...
CIRCLE_ENTITY_SECRET=...
```

Required for estimating or executing a Teep tip:

```env
TIP_CONTRACT_ADDRESS=0x...
CONTENT_ID=0x...
AUTHOR_ID=1234567890
AMOUNT_USDC=1.00
```

Optional:

```env
CIRCLE_WALLET_ID=...
USDC_ADDRESS=0x3600000000000000000000000000000000000000
```

If `CIRCLE_WALLET_ID` is omitted, run wallet creation once:

```powershell
$env:CREATE_WALLET='true'; npx.cmd tsx .\sandbox\teep-gasless-tip-sandbox.ts
```

The created SCA wallet is saved to `sandbox/output/sca-wallet.json`, and later
runs can reuse it automatically.

Estimate both sponsored contract executions:

```powershell
$env:ESTIMATE='true'; npx.cmd tsx .\sandbox\teep-gasless-tip-sandbox.ts
```

Submit the full two-step Teep flow:

```powershell
$env:EXECUTE='true'; npx.cmd tsx .\sandbox\teep-gasless-tip-sandbox.ts
```

The execute path sends:

1. `USDC.approve(TIP_CONTRACT_ADDRESS, amountRaw)`
2. `TipContract.tip(CONTENT_ID, AUTHOR_ID, amountRaw)`

The SCA wallet must hold enough Arc testnet USDC to cover the tip amount. It
should not need native gas when Circle Gas Station sponsorship is active for the
entity and wallet.
