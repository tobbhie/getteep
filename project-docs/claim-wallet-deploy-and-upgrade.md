# ClaimWallet deploy and upgrade

How deployment works and how to apply the “no-referrer → fee to treasury” fix.

---

## Does deploying ClaimWallet auto-sync with other contracts?

**No.** Claim wallets do **not** auto-sync when you deploy a new ClaimWallet or change its code.

Reason:

- **WalletFactory** does **not** use a separate “implementation” contract. It embeds **ClaimWallet’s creation bytecode** at **compile time**. When you run `deployClaimWallet(...)`, the factory deploys a **full copy** of the ClaimWallet contract (CREATE2). So:
  - Deploying a **standalone** ClaimWallet contract does nothing for the system — the factory never points at it.
  - Changing `ClaimWallet.sol` and deploying only ClaimWallet has **no effect** on existing or future claim wallets. The factory’s bytecode (and thus the code of every wallet it deploys) only changes when you **recompile and redeploy the WalletFactory**.
- Each **already deployed** claim wallet is its own contract at a fixed address. Updating the factory or the ClaimWallet source does **not** change those deployed instances. There is no proxy/upgrade; they keep their old code forever.

So:

- **New ClaimWallet code** (e.g. the no-referrer fix) only applies to **new** claim wallets deployed by a **new** factory.
- **Existing** claim wallets keep the old behavior until you migrate (see below).

---

## How to apply the fix (full redeploy)

To get the updated ClaimWallet logic (e.g. no-referrer fee → treasury) into the system you need a **full redeploy**: new factory (with updated ClaimWallet bytecode) and new TipContract (pointing at the new factory).

### 1. Code

- Ensure **ClaimWallet.sol** contains the fix (when `ref == address(0)`, add referrer share to protocol and send full fee to treasury).

### 2. Deploy

From the contracts package, with env set (e.g. `ATTESTATION_SIGNER_ADDRESS`, `PROTOCOL_TREASURY_ADDRESS`, optional referral env):

```bash
cd contracts
npm run deploy -- --network baseSepolia
# or: npx hardhat run scripts/deploy.ts --network baseSepolia
```

This deploys:

- **WalletFactory** (with **current** ClaimWallet creation code baked in)
- **ReferralRegistry**
- **TipContract** (with `factory` set to the **new** factory)

So **new** claim wallets created by this factory will have the fixed ClaimWallet code.

### 3. Point app to new contracts

- Update **backend** (and any indexer) with the new addresses from `contracts/deployed-addresses.json`:
  - `TIP_CONTRACT_ADDRESS` → new TipContract
  - `WALLET_FACTORY_ADDRESS` → new WalletFactory
  - `REFERRAL_REGISTRY_ADDRESS` → new ReferralRegistry (if you redeploy it too; otherwise keep existing)
- Update **extension** config (and web) so `TIP_CONTRACT_ADDRESS`, `WALLET_FACTORY_ADDRESS`, and referral registry match.

After that, **new** tips use the new TipContract and new factory; **new** claim wallets get the fix. Existing claim wallets are unchanged.

---

## Existing claim wallets (already deployed)

- They were deployed by the **old** factory with the **old** ClaimWallet bytecode. Their code **cannot** be changed.
- Tips that already went to those old addresses still sit there; the new TipContract sends **new** tips to the **new** factory’s `computeClaimWallet(authorId)` (different addresses for the same authorId).

Practical options:

1. **Leave old wallets as-is**  
   Creators can keep using the old claim wallet (with the old bug: if they have no referrer, the 30% stays in the wallet). They withdraw as today. No code change for them.

2. **Migrate**  
   - Creators withdraw from the **old** claim wallet (to their EOA or elsewhere).  
   - They use the app with the **new** contracts; when they “deploy” or use the new flow, the **new** factory deploys a **new** claim wallet at a **new** address (with the fix).  
   - From then on, new tips go to the new wallet. You may need a one-off flow or copy of attestation so the new factory can deploy their new wallet.

So: **no auto-sync**. Deploying only ClaimWallet does nothing; you must redeploy factory (and TipContract and point the app to them). Existing claim wallets keep old code; only new deployments get the fix.

---

## Product-facing abstraction note

This is an internal/operator concern. Do not expose "factory", "bytecode", or "not upgradeable" language in normal user flows.

Preferred user-facing framing:

> Older received tips remain claimable. New tips use the latest Teep account system.

Support and ops should know the underlying detail: new tips use the latest TipContract and latest WalletFactory, while older claim wallets remain standalone contracts with their original code.
