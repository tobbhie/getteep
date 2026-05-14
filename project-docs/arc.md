Porting From Base to Arc Chain

Yes — **Privy can likely work on Arc for embedded wallets**, but **Privy’s built-in gas sponsorship / native AA flow does not look officially supported on Arc yet**.

The distinction matters:

## 1. Privy on Arc: wallet support vs AA support

Privy docs say embedded wallets can support **any EVM-compatible chain**, including custom EVM networks configured through `viem.defineChain`. Arc is EVM-compatible, so you should be able to configure Arc Testnet manually in Privy. ([docs.privy.io][1])

But Privy’s official gas sponsorship list currently includes chains like Sepolia, Base Sepolia, OP Sepolia, Arbitrum Sepolia, Monad Testnet, Tempo Testnet, etc. **Arc Testnet is not listed there**. ([docs.privy.io][2])

So the answer is:

> **Privy embedded wallets: yes, likely.
> Privy-native sponsored gas / Privy-managed AA on Arc: not confirmed from Privy docs right now.**

Arc’s own docs list **Privy** under account abstraction providers, and Arc says it supports **ERC-4337**, meaning you can use compatible bundlers, paymasters, and smart-wallet SDKs on Arc. ([docs.arc.network][3])

So the practical route is:

> Use Privy for auth + embedded wallet signer, then use Arc-compatible ERC-4337 infra for smart accounts, bundling, and paymaster flow.

---

## 2. Arc gas abstraction is different from Base

On Base, your Teep UX probably depends on “user does not need ETH.” On Arc, this gets cleaner because **USDC is the native gas token**. Arc Testnet uses USDC for gas, chain ID `5042002`, RPC `https://rpc.testnet.arc.network`, and explorer `https://testnet.arcscan.app`. ([docs.arc.network][4])

Arc’s docs say gas accounting uses **USDC with 18 decimals for native gas**, while the ERC-20 USDC interface uses **6 decimals**. This is a major footgun. Your app must not mix native gas units with ERC-20 token transfer units. ([docs.arc.network][5])

So for Teep:

```ts
// Native gas display/accounting: 18 decimals
// ERC20 USDC transfer/tipping balance: 6 decimals
```

That needs to be handled explicitly in your formatter, DB, indexer, dashboard, and analytics.

---

## 3. Circle Paymaster: useful, but check chain support carefully

Circle Paymaster lets ERC-4337 wallets pay gas fees using USDC instead of native tokens, and it works with any ERC-4337-compliant wallet. ([developers.circle.com][6])

But the current Circle Paymaster docs list supported chains as:

* ERC-4337 v0.7: Arbitrum and Base
* ERC-4337 v0.8: Arbitrum, Avalanche, Base, Ethereum, Optimism, Polygon, and Unichain

**Arc is not listed on that Circle Paymaster page right now.** ([developers.circle.com][6])

However, Arc itself already uses USDC as native gas, so the “pay gas in USDC” problem is partly solved at chain level. The remaining abstraction problem is:

> Who fronts or funds the user’s initial Arc USDC gas balance?

That can be solved by one of these:

1. **User-funded model:** user receives/bridges USDC to Arc, then pays gas directly.
2. **App-sponsored model:** your backend/paymaster sponsors transactions.
3. **Smart-account model:** use Pimlico/ZeroDev/Biconomy/Thirdweb/etc. with ERC-4337 if they support Arc.
4. **Circle Wallets/Gas Station model:** maybe cleanest if you go deeper into Circle infra, but it may reduce your Privy dependency.

---

## 4. Recommended Teep architecture on Arc

I would structure it like this:

```txt
Privy
  └── Auth + embedded EOA signer

Arc Testnet
  └── Native gas = USDC
  └── ERC-20 USDC = tipping asset

Smart Account Layer
  └── Kernel / Safe / ERC-4337 account
  └── Bundler: Pimlico / ZeroDev / Biconomy / Thirdweb / Circle Wallets
  └── Paymaster: Arc-compatible provider or your own sponsor service

Teep Contracts
  └── TipRouter
  └── CreatorBalanceVault
  └── ReferralFeeManager
  └── WithdrawalVerifier
  └── Optional DeFi vault adapter

Indexer
  └── Tip events
  └── Creator balances
  └── Post-level tips
  └── Referral revenue
  └── DeFi position/yield events
```

The key change is that **Privy should become the identity/wallet-signing layer, not necessarily the full AA/gas-abstraction layer**.

---

## 5. Technicalities you should account for

### A. Custom Arc chain config in Privy

Since Arc may not be in your installed `viem/chains` version yet, define it manually:

```ts
import { defineChain } from "viem";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.network"],
      webSocket: ["wss://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: "https://testnet.arcscan.app",
    },
  },
  testnet: true,
});
```

Then:

```tsx
<PrivyProvider
  appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
  config={{
    defaultChain: arcTestnet,
    supportedChains: [arcTestnet],
    embeddedWallets: {
      createOnLogin: "users-without-wallets",
    },
  }}
>
  {children}
</PrivyProvider>
```

Privy docs say embedded wallets can be initialized to a default chain and restricted to supported chains. ([docs.privy.io][1])

---

### B. Decimals issue: this is the biggest Arc-specific bug risk

Arc native gas uses USDC with **18 decimals**, but ERC-20 USDC uses **6 decimals**. ([docs.arc.network][5])

So your code should treat them as two separate accounting domains:

```ts
const ARC_NATIVE_GAS_DECIMALS = 18;
const ARC_USDC_TOKEN_DECIMALS = 6;
```

For Teep, this affects:

* tip amount input
* creator balance
* protocol fee
* referral fee
* vault deposits
* withdrawal amount
* gas cost display
* dashboard analytics
* indexed event normalization

Never assume “USDC = 6 decimals everywhere” on Arc.

---

### C. Re-deploy contracts, don’t just “port frontend”

Your Base contracts need redeployment to Arc. Check:

* USDC token address on Arc Testnet
* chain ID checks
* EIP-712 domain separator
* trusted forwarder / paymaster assumptions
* contract addresses stored in backend
* event indexer network config
* explorer links
* webhook/indexer URLs
* subgraph support, if any
* CCTP/bridge assumptions

Circle’s USDC contract address table lists **Arc Testnet USDC as `0x3600000000000000000000000000000000000000`**. ([developers.circle.com][7])

---

### D. Your “tip” flow may actually get simpler

On Base:

```txt
Need ETH/native gas OR paymaster sponsorship
Need USDC for tip
```

On Arc:

```txt
Need USDC for gas
Need USDC for tip
```

This is cleaner for Teep because the creator finance story becomes:

> One unit of account, one chain, one balance language: USDC.

That fits Teep way better than Base from a consumer UX perspective.

---

### E. But initial funding becomes the main UX bottleneck

Even if gas is USDC, the user still needs Arc USDC.

For testnet, Circle provides a faucet. Arc docs link to the Circle faucet and say testnet USDC is required for gas and contract interactions. ([docs.arc.network][5])

For mainnet later, you need to think about:

* onramp to Arc USDC
* CCTP from Base/Ethereum/Arbitrum/etc.
* creator withdrawal to external chains
* whether your Teep balance is Arc-only or omnichain
* how non-crypto users get their first spendable USDC
* whether your protocol fronts the first transaction

For Teep, I’d strongly consider:

```txt
User receives first tip → can re-tip without onboarding fully
User wants to withdraw → complete Privy/email verification + bridge/offramp
User wants to tip first → card/onramp or sponsor tiny first tx
```

---

### F. DeFi layer needs Arc-native liquidity reality check

Because Teep has a DeFi side, you need to verify what DeFi primitives are actually live on Arc testnet/mainnet:

* lending markets
* stable pools
* vault protocols
* DEX liquidity
* yield sources
* oracle availability
* LP token standards
* CCTP support
* Circle-native FX assets like EURC

Arc is positioned for stablecoin finance and supports USDC/EURC-style use cases, but your Teep DeFi layer should start with conservative adapters:

```txt
VaultAdapter interface
  deposit(creator, amount)
  withdraw(creator, amount)
  getBalance(creator)
  getYield(creator)
  emergencyWithdraw()
```

Do not hardwire one DeFi protocol into Teep core. Keep DeFi as adapters.

---

## My take

Porting Teep from Base to Arc makes strategic sense **if your thesis is creator finance, USDC-native flows, and programmable social money**.

But do not assume “Privy supports AA on Arc” in the same plug-and-play way it may work on Base. The safer assumption is:

> **Privy handles login + embedded wallet. Arc handles USDC-native gas. ERC-4337 infra handles AA. Your app or an Arc-compatible provider handles sponsorship/paymaster UX.**

I’d build the migration in this order:

1. Get Privy embedded wallet signing on Arc Testnet.
2. Send a normal USDC tip transaction from Privy wallet.
3. Deploy Teep TipRouter + balance contracts on Arc.
4. Add event indexing for tips and withdrawals.
5. Add smart-account/paymaster flow.
6. Add DeFi vault adapter after the basic tip loop works.
7. Add bridge/offramp abstraction last.

The biggest things to watch are **Privy AA support gap, Arc USDC decimal differences, initial Arc USDC funding, and whether your chosen bundler/paymaster provider actually supports Arc testnet today**.

[1]: https://docs.privy.io/basics/react/advanced/configuring-evm-networks "Configuring EVM networks - Privy Docs"
[2]: https://docs.privy.io/wallets/gas-and-asset-management/gas/overview "Overview - Privy Docs"
[3]: https://docs.arc.network/arc/tools/account-abstraction "Account abstraction - Arc Docs"
[4]: https://docs.arc.network/arc/references/connect-to-arc?utm_source=chatgpt.com "Connect to Arc"
[5]: https://docs.arc.network/arc/references/gas-and-fees "Gas and fees - Arc Docs"
[6]: https://developers.circle.com/paymaster "Paymaster - Circle Docs"
[7]: https://developers.circle.com/stablecoins/usdc-contract-addresses?utm_source=chatgpt.com "USDC Contract Addresses"
