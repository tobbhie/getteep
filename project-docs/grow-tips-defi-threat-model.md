# Grow Tips DeFi Threat Model

## Scope

This document covers the first production-beta Grow Tips contract surface:

- `StrategyRegistry`
- `IStrategyAdapter`
- `AaveV3SupplyAdapter`

The starting integration is Arc testnet USDC routed into an Aave V3-style testnet market.

## Product Decision

Production beta should include live adapter and strategy contracts, but only behind explicit feature flags and testnet copy until Arc mainnet and the selected DeFi market are production-ready.

The first conservative strategy is:

- Asset: Arc USDC ERC-20 interface.
- Strategy: Aave V3-style USDC supply market.
- Position owner: user wallet or creator owner wallet.
- Teep custody: none.

No shared `YieldVault` is used for beta. Teep should not pool user funds, issue shares, or custody yield. The adapter supplies to Aave with the user as beneficiary, so the resulting position token belongs to the user, not Teep.

## Optional Future Pooled Model

`PooledTipsVault` is a separate future option for controlled-yield pooled tips. It is not the beta default.

This model intentionally changes the trust boundary:

- Users deposit USDC into an ERC-4626 vault and receive vault shares.
- The vault can allocate pooled idle USDC through an approved strategy adapter.
- The vault owns the resulting strategy position tokens.
- Users own claims on the pool through vault shares, not direct Aave positions.
- Teep/admin controls strategy allocation, caps, pausing, and recall.

This can support protocol-controlled yield, pooled liquidity, and future automated treasury strategies, but it requires stronger audit, governance, disclosure, and operational controls before public use.

## Trust Boundaries

- User wallet or smart wallet: owns funds and signs deposits/withdrawals.
- Teep UI/backend: presents approved strategies and builds transactions.
- `StrategyRegistry`: owner-managed allowlist and emergency switch.
- `AaveV3SupplyAdapter`: stateless transaction adapter.
- `PooledTipsVault`: optional future custodial pooled vault; not beta default.
- Aave Pool and aToken: external protocol contracts.
- Arc RPC/bundler/paymaster: execution infrastructure.

## Assets

- User USDC.
- User aToken/position token.
- Strategy allowlist state.
- Adapter pause/emergency controls.
- UI transaction construction.

## Attacker Capabilities

- Call contracts directly outside the Teep UI.
- Approve malicious spenders if tricked by another UI.
- Attempt to use disabled strategies.
- Attempt reentrancy through token callbacks or external protocol calls.
- Exploit incorrect Aave Pool/aToken addresses.
- Exploit stale or malicious frontend configuration.
- Abuse testnet/mainnet confusion.

## Main Risks And Mitigations

### Custody Creep

Risk: Teep accidentally becomes custodian by pooling deposits or holding aTokens.

Mitigation:

- No shared `YieldVault` for beta.
- Adapter supplies with `beneficiary` as Aave `onBehalfOf`.
- Tests assert adapter does not retain USDC or aTokens after deposit/withdraw.
- If `PooledTipsVault` is used later, it must be presented as a different product mode with explicit pooled-custody risk language.

### Pooled Vault Share Accounting

Risk: incorrect vault accounting can dilute users or misprice deposits/withdrawals.

Mitigation:

- `PooledTipsVault` uses ERC-4626 share accounting instead of custom share math.
- `totalAssets()` includes idle USDC plus vault-owned position tokens.
- Tests cover deposits, allocation, recall, withdrawal, strategy cap, and pause behavior.
- Any real yield-bearing integration must be audited for exchange-rate behavior, rounding, and aToken rebasing before production enablement.

### Wrong Strategy Or Malicious Adapter

Risk: UI routes deposits into an unapproved or malicious adapter.

Mitigation:

- `StrategyRegistry` allowlists strategy IDs and adapters.
- Adapter checks `registry.isStrategyAvailable(strategyId)` on deposit and withdrawal.
- Owner can disable or emergency-disable a strategy.
- Production config must pin registry and adapter addresses.

### External Protocol Address Risk

Risk: Aave Pool or aToken address is wrong.

Mitigation:

- Adapter constructor makes Pool/aToken immutable.
- Deploy script requires `AAVE_POOL_ADDRESS` and `AAVE_USDC_ATOKEN_ADDRESS`.
- Do not deploy production-facing adapter until addresses are independently verified.
- Before enabling in UI, smoke test bytecode and a small deposit/withdraw on Arc testnet.

### Approval Risk

Risk: users approve too much or approve the wrong contract.

Mitigation:

- UI should request exact-amount approvals where practical.
- Adapter only pulls from `msg.sender`.
- Adapter resets Aave approvals after supply/withdraw.
- Product copy should say "Grow this amount" rather than asking for broad DeFi permissions.

### Withdrawal Failure

Risk: Aave withdrawal fails because the user does not approve aTokens, market liquidity is insufficient, or strategy is disabled.

Mitigation:

- UI must check aToken balance and allowance before building the withdrawal transaction.
- Strategy emergency-disable blocks new actions through the adapter.
- Advanced/support flow can guide users to Aave directly because positions are user-owned.

### Reentrancy And Token Transfer Risk

Risk: external token/protocol calls reenter adapter.

Mitigation:

- Adapter uses `nonReentrant`.
- Adapter is stateless and keeps no user accounting.
- Token transfers use OpenZeppelin `SafeERC20`.

### Slippage And Exchange Risk

Risk: user receives less than expected because a strategy swaps assets.

Mitigation:

- First strategy does not swap; it supplies USDC to a lending market.
- Future adapters that swap must add min-out/slippage parameters and tests.

### Oracle Risk

Risk: strategy depends on price feeds.

Mitigation:

- First adapter does not use Teep-side price oracles.
- Any future leveraged, LP, or multi-asset strategy needs a separate oracle threat model.

### Emergency Exit

Risk: Teep UI must stop routing users into a broken strategy.

Mitigation:

- Registry has `setStrategyEmergencyDisabled` to stop new deposits.
- Strategy disablement does not block adapter exits; users should still be able to unwind through Teep's normal UX.
- Adapter has owner-only `pause` for severe adapter-level bugs where both deposits and adapter-routed withdrawals should stop.
- Because positions are user-owned, users can still recover directly through Aave if Teep disables its adapter.
- Adapter supports Aave's `uint256.max` withdraw-all convention.

## Required Before Real Funds

- Independent verification of Aave Arc Pool/aToken addresses.
- Prefer resolving the Aave Pool through `AAVE_POOL_ADDRESSES_PROVIDER.getPool()` and the USDC aToken through `AAVE_PROTOCOL_DATA_PROVIDER.getReserveTokensAddresses(USDC)` when Arc testnet exposes those contracts.
- Static analysis of new contracts.
- Small live Arc testnet deposit/withdraw smoke test.
- UI feature flag and testnet/mainnet copy review.
- Production owner/admin decision for registry and adapter pause control.
- If pooled mode is enabled: independent audit of `PooledTipsVault`, governance/admin policy, accounting review, liquidity exit policy, and explicit product copy that this is pooled custody.
- Mainnet liquidity/risk review when Arc mainnet exists.
