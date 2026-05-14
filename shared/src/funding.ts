export type FundingEnvironment = "arcTestnet" | "arcMainnet";
export type FundingProviderKind = "faucet" | "crypto_receive" | "fiat_onramp" | "fiat_offramp";

export interface FundingProvider {
  kind: FundingProviderKind;
  id: "circle_faucet" | "crypto_receive" | "dynamic_onramp" | "dynamic_offramp";
  label: string;
  shortLabel: string;
  description: string;
  enabled: boolean;
  url?: string;
  disabledReason?: string;
}

export interface FundingPolicy {
  environment: FundingEnvironment;
  modeLabel: string;
  realMoneyEnabled: boolean;
  testnetCopy: string;
  providers: {
    faucet: FundingProvider;
    cryptoReceive: FundingProvider;
    fiatOnramp: FundingProvider;
    fiatOfframp: FundingProvider;
  };
}

export interface FundingPolicyInput {
  environment?: string;
  faucetUrl?: string;
  fiatOnrampUrl?: string;
  fiatOfframpUrl?: string;
  enableFiatOnramp?: boolean;
  enableFiatOfframp?: boolean;
}

function normalizeEnvironment(value?: string): FundingEnvironment {
  return value === "arcMainnet" ? "arcMainnet" : "arcTestnet";
}

function hasUrl(value?: string): value is string {
  return !!value && /^https?:\/\//i.test(value);
}

export function buildFundingPolicy(input: FundingPolicyInput = {}): FundingPolicy {
  const environment = normalizeEnvironment(input.environment);
  const isMainnet = environment === "arcMainnet";
  const faucetUrl = hasUrl(input.faucetUrl) ? input.faucetUrl : "https://faucet.circle.com";
  const fiatOnrampUrl = hasUrl(input.fiatOnrampUrl) ? input.fiatOnrampUrl : undefined;
  const fiatOfframpUrl = hasUrl(input.fiatOfframpUrl) ? input.fiatOfframpUrl : undefined;
  const fiatOnrampEnabled = isMainnet && !!input.enableFiatOnramp && !!fiatOnrampUrl;
  const fiatOfframpEnabled = isMainnet && !!input.enableFiatOfframp && !!fiatOfframpUrl;

  const testnetFiatReason = "Real card, bank, and cash-out flows stay disabled until Arc mainnet exists.";

  return {
    environment,
    modeLabel: isMainnet ? "Arc mainnet" : "Arc testnet",
    realMoneyEnabled: isMainnet,
    testnetCopy: isMainnet
      ? "Real funding providers can be enabled behind launch flags."
      : "Arc is still testnet, so faucet funds are for beta testing only and are not real money.",
    providers: {
      faucet: {
        kind: "faucet",
        id: "circle_faucet",
        label: "Add From Faucet",
        shortLabel: "Faucet",
        description: isMainnet
          ? "Faucet funding is disabled on mainnet."
          : "Copy your wallet address, then open the Circle Arc testnet faucet.",
        enabled: !isMainnet,
        url: !isMainnet ? faucetUrl : undefined,
        disabledReason: isMainnet ? "Faucets are only for testnet." : undefined,
      },
      cryptoReceive: {
        kind: "crypto_receive",
        id: "crypto_receive",
        label: "Receive via Crypto",
        shortLabel: "Receive",
        description: "Copy your wallet address and receive supported USDC directly.",
        enabled: true,
      },
      fiatOnramp: {
        kind: "fiat_onramp",
        id: "dynamic_onramp",
        label: "Add From Card/Bank",
        shortLabel: "Card/Bank",
        description: fiatOnrampEnabled
          ? "Add funds through the configured fiat provider."
          : isMainnet
            ? "Mainnet onramp is gated behind provider readiness and launch approval."
            : testnetFiatReason,
        enabled: fiatOnrampEnabled,
        url: fiatOnrampEnabled ? fiatOnrampUrl : undefined,
        disabledReason: fiatOnrampEnabled ? undefined : isMainnet ? "Provider not enabled yet." : testnetFiatReason,
      },
      fiatOfframp: {
        kind: "fiat_offramp",
        id: "dynamic_offramp",
        label: "Withdraw To Bank",
        shortLabel: "Bank/P2P",
        description: fiatOfframpEnabled
          ? "Cash out through the configured fiat provider."
          : isMainnet
            ? "Mainnet cash-out is gated behind provider readiness and launch approval."
            : testnetFiatReason,
        enabled: fiatOfframpEnabled,
        url: fiatOfframpEnabled ? fiatOfframpUrl : undefined,
        disabledReason: fiatOfframpEnabled ? undefined : isMainnet ? "Provider not enabled yet." : testnetFiatReason,
      },
    },
  };
}

export const fundingProviderDecision = {
  primaryOnrampProvider: "Dynamic onramp when Arc mainnet is live, because it best matches Teep's wallet-abstraction goal.",
  primaryOfframpProvider: "Dynamic offramp when Arc mainnet is live, with provider-side compliance/KYC handled outside the extension popup.",
  currentBetaFundingPath: "Arc testnet uses Circle faucet plus direct crypto receive only.",
} as const;
