# Teep Arc Port Feasibility Report

Date: 2026-04-30

## Executive summary

Porting Teep from Base to Arc is feasible and strategically aligned with Teep's core product promise: make creator tipping feel like dollars moving through a normal consumer app, with crypto mechanics hidden by default.

The move should be treated as an Arc-native transaction-layer migration, not just a replacement RPC URL. The Solidity contracts should largely port because Arc is EVM-compatible, but the wallet, gas, funding, indexing, and DeFi layers need deliberate redesign.

The strongest reason to move is that Arc uses USDC as the native gas asset. This lets Teep simplify its product language: users tip dollars, creators receive dollars, and gas does not need to be explained. The biggest engineering risk is preserving the current "no gas, no chain, no crypto friction" experience while switching wallet and paymaster infrastructure.

## Updated feasibility

Feasibility is high for a production beta if Circle Paymaster/Gas Station is confirmed working on Arc Testnet.

Previous uncertainty was around whether Teep could preserve gas abstraction after leaving Base. With Circle Paymaster support on Arc Testnet, that concern becomes manageable.

Recommended architecture:

```text
Privy: login and embedded user identity
Circle Paymaster / Gas Station: gas sponsorship
Arc: USDC-native settlement
Teep contracts: tips, claim wallets, referrals, withdraw rules
Teep backend: indexer, X OAuth, anti-abuse, limits
DeFi adapters: optional Growth Mode
```

## Arc facts verified through Arc Docs MCP

- Arc Testnet chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.network`
- WebSocket: `wss://rpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`
- Faucet: Circle Faucet
- Native gas asset: USDC
- Native gas accounting precision: 18 decimals
- ERC-20 USDC interface: `0x3600000000000000000000000000000000000000`
- ERC-20 USDC precision: 6 decimals
- Arc supports ERC-4337 account abstraction and documents providers including Privy, Circle Wallets, Pimlico, Biconomy, Thirdweb, and ZeroDev.
- Arc App Kit supports Arc Testnet for Send, Bridge, Swap, and Unified Balance.
- Among testnets, Arc Testnet supports Swap for USDC and EURC.

Correction to local `project-docs/arc.md`: it mentions a 160 Gwei minimum base fee, but the Arc MCP docs now state a 20 Gwei minimum on Arc Testnet.

## Why Arc fits Teep

Teep is not trying to sell users a chain. It is trying to make social payments feel instant, familiar, and safe.

Arc strengthens that direction:

- No ETH/native token explanation.
- One consumer unit of account: dollars.
- Stablecoin-native settlement aligns with tipping, withdrawal, and future yield.
- Circle infra gives a credible path for onramp, bridge, balances, and gas sponsorship.
- DeFi can be introduced as "Growth Mode" or "earn on idle tips" without exposing vault/LP/restaking language.

## Main changes required

### Contracts

- Redeploy TipContract, WalletFactory, ClaimWallet, and ReferralRegistry to Arc.
- Use Arc USDC ERC-20 interface address.
- Keep application-level amounts in 6-decimal USDC.
- Re-check CREATE2 claim wallet addresses after compiler/config changes.
- Add tests for Arc's USDC native/ERC-20 linked behavior.

### Backend

- Add Arc chain config rather than hardcoded Base/Base Sepolia branches.
- Point indexer to Arc RPC.
- Update explorer links and receipt URLs.
- Treat one confirmation as enough only after confirming Arc finality assumptions in your production infra.
- Add Arc-specific unit conversion utilities.

### Web and extension

- Replace Base Sepolia constants with Arc Testnet config.
- Use Circle Paymaster/Gas Station in the send/withdraw/tip path.
- Keep Privy as identity/wallet onboarding unless a Circle Wallets migration is chosen.
- Hide network, gas, and explorer details behind an Advanced/Receipt layer.

### Onramp/offramp

- "Add funds" must land users in Arc USDC or bridge into Arc USDC with minimal visible chain language.
- "Withdraw to bank" should remain the primary creator exit path.
- Bridge and off-ramp errors need plain-language states.

## Critical Arc-specific footgun

Arc USDC has two interfaces over the same underlying asset:

- Native gas accounting: 18 decimals.
- ERC-20 interface: 6 decimals.

Teep should use the ERC-20 6-decimal interface for app balances, tips, withdrawals, fees, referrals, and DeFi accounting. Native gas values should be isolated to gas estimation/payment code.

Recommended constants:

```ts
export const ARC_NATIVE_GAS_DECIMALS = 18;
export const USDC_TOKEN_DECIMALS = 6;
```

Never mix raw values from native gas APIs and ERC-20 balance/transfer APIs.

## DeFi integration recommendation

Do not make Teep a pooled custodial vault for production beta.

Use an adapter model:

```text
ClaimWallet
  -> StrategyRegistry
  -> approved strategy adapter
  -> external Arc/Circle/yield protocol
```

User-facing language:

- "Grow tips"
- "Put idle tips in Growth Mode"
- "Estimated return"
- "Withdraw anytime"

Avoid default UI language like vault, LP, strategy, restaking, or protocol position.

## Recommended execution order

1. Deploy current Teep contracts to Arc Testnet.
2. Send one normal ERC-20 USDC tip end-to-end.
3. Prove Privy embedded wallet signing on Arc.
4. Prove Circle Paymaster/Gas Station sponsorship from the same wallet path.
5. Move backend/indexer to Arc.
6. Add Arc-safe decimal/accounting utilities.
7. Rebuild extension/web configs around Arc.
8. Add onramp/bridge/offramp flows.
9. Add one conservative DeFi adapter.
10. Run a full security and accounting test pass before inviting beta users.

## Final view

Yes, port to Arc.

Arc is a better strategic fit than Base for Teep's "crypto almost abstracted away" promise, especially now that Circle Paymaster support on Arc Testnet has been confirmed. The port should focus first on preserving trust and abstraction: gas sponsorship, funding, withdrawals, identity correctness, and safe accounting. DeFi should come after the base tip, claim, withdraw, and referral loop is proven on Arc.
