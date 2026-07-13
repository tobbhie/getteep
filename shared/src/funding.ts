export type FundingEnvironment = "arcTestnet" | "crossmintStaging" | "arcMainnet";
export type FundingProviderKind = "faucet" | "crypto_receive" | "fiat_onramp" | "fiat_offramp";

export interface FundingProvider {
  kind: FundingProviderKind;
  id: "circle_faucet" | "crypto_receive" | "crossmint_staging_onramp" | "crossmint_staging_offramp" | "crossmint_onramp" | "crossmint_offramp";
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
  if (value === "arcMainnet") return "arcMainnet";
  if (value === "crossmintStaging") return "crossmintStaging";
  return "arcTestnet";
}

function hasUrl(value?: string): value is string {
  return !!value && /^https?:\/\//i.test(value);
}

function replaceToken(value: string, token: string, replacement: string) {
  return value.split(token).join(replacement);
}

export function buildFundingPolicy(input: FundingPolicyInput = {}): FundingPolicy {
  const environment = normalizeEnvironment(input.environment);
  const isMainnet = environment === "arcMainnet";
  const isCrossmintStaging = environment === "crossmintStaging";
  const canUseFiatProvider = isMainnet || isCrossmintStaging;
  const faucetUrl = hasUrl(input.faucetUrl) ? input.faucetUrl : "https://faucet.circle.com";
  const fiatOnrampUrl = hasUrl(input.fiatOnrampUrl) ? input.fiatOnrampUrl : undefined;
  const fiatOfframpUrl = hasUrl(input.fiatOfframpUrl) ? input.fiatOfframpUrl : undefined;
  const fiatOnrampEnabled = canUseFiatProvider && !!input.enableFiatOnramp;
  const fiatOfframpEnabled = canUseFiatProvider && !!input.enableFiatOfframp;

  const testnetFiatReason = "Real card, bank, and cash-out flows stay disabled outside Crossmint staging or Arc mainnet.";
  const stagingCopy = "Crossmint staging is enabled for integration testing only. Do not use production payment methods or production user funds.";

  return {
    environment,
    modeLabel: isMainnet ? "Arc mainnet" : isCrossmintStaging ? "Crossmint staging" : "Arc testnet",
    realMoneyEnabled: isMainnet,
    testnetCopy: isMainnet
      ? "Real funding providers can be enabled behind launch flags."
      : isCrossmintStaging
        ? stagingCopy
      : "Faucet funds are for beta testing only and are not real money.",
    providers: {
      faucet: {
        kind: "faucet",
        id: "circle_faucet",
        label: "Add From Faucet",
        shortLabel: "Faucet",
        description: isMainnet
          ? "Faucet funding is disabled on mainnet."
          : "Copy your account address, then open the Circle testnet faucet.",
        enabled: environment === "arcTestnet",
        url: environment === "arcTestnet" ? faucetUrl : undefined,
        disabledReason: environment === "arcTestnet" ? undefined : "Faucets are only for Arc testnet.",
      },
      cryptoReceive: {
        kind: "crypto_receive",
        id: "crypto_receive",
        label: "Receive from Wallet",
        shortLabel: "Receive",
        description: "Copy your account address and receive supported funds directly.",
        enabled: true,
      },
      fiatOnramp: {
        kind: "fiat_onramp",
        id: isCrossmintStaging ? "crossmint_staging_onramp" : "crossmint_onramp",
        label: isCrossmintStaging ? "Add With Crossmint Staging" : "Add From Card/Bank",
        shortLabel: "Card/Bank",
        description: fiatOnrampEnabled
          ? isCrossmintStaging
            ? "Open Crossmint staging to test card or bank funding into your Teep account."
            : "Add funds through Crossmint."
          : canUseFiatProvider
            ? "Crossmint onramp is gated behind provider readiness and launch approval."
            : testnetFiatReason,
        enabled: fiatOnrampEnabled,
        url: fiatOnrampEnabled ? fiatOnrampUrl : undefined,
        disabledReason: fiatOnrampEnabled ? undefined : canUseFiatProvider ? "Crossmint onramp not enabled yet." : testnetFiatReason,
      },
      fiatOfframp: {
        kind: "fiat_offramp",
        id: isCrossmintStaging ? "crossmint_staging_offramp" : "crossmint_offramp",
        label: isCrossmintStaging ? "Cash Out With Crossmint Staging" : "Withdraw To Bank",
        shortLabel: "Bank/P2P",
        description: fiatOfframpEnabled
          ? isCrossmintStaging
            ? "Open Crossmint staging to test cash-out provider flows."
            : "Cash out through Crossmint."
          : canUseFiatProvider
            ? "Crossmint cash-out is gated behind provider readiness and launch approval."
            : testnetFiatReason,
        enabled: fiatOfframpEnabled,
        url: fiatOfframpEnabled ? fiatOfframpUrl : undefined,
        disabledReason: fiatOfframpEnabled ? undefined : canUseFiatProvider ? "Crossmint cash-out not enabled yet." : testnetFiatReason,
      },
    },
  };
}

export function resolveFundingUrl(urlTemplate: string | undefined, walletAddress?: string | null): string {
  if (!urlTemplate) return "";
  const wallet = walletAddress?.trim();
  if (!wallet) return urlTemplate;
  const encoded = encodeURIComponent(wallet);
  return [
    "{wallet}",
    "{walletAddress}",
    ":wallet",
    ":walletAddress",
    "WALLET_ADDRESS",
    "WALLET",
  ].reduce((url, token) => replaceToken(url, token, encoded), urlTemplate);
}

export const fundingProviderDecision = {
  primaryOnrampProvider: "Crossmint onramp, staged first with Crossmint staging before production payment methods are enabled.",
  primaryOfframpProvider: "Crossmint offramp, staged first with provider-side KYC/compliance and order management outside the web app confirmation flow.",
  currentBetaFundingPath: "Arc testnet uses Circle faucet plus direct wallet receive only; Crossmint staging is a separate pre-production integration mode.",
} as const;
