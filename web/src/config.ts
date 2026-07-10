const IS_PRODUCTION = import.meta.env.PROD;
const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");
const browserOrigin = typeof window !== "undefined" ? window.location.origin : "";
const configuredApiUrl = import.meta.env.VITE_API_URL;
const shouldUseSecureSameOriginApi =
  typeof window !== "undefined" &&
  window.location.protocol === "https:" &&
  /^http:\/\//i.test(configuredApiUrl || "");

export const API_BASE = shouldUseSecureSameOriginApi
  ? ""
  : configuredApiUrl ?? (IS_PRODUCTION ? "" : "http://localhost:3001");
const RAW_CHROME_STORE_URL = import.meta.env.VITE_CHROME_STORE_URL || "";
export const HAS_CHROME_STORE_LISTING = !!RAW_CHROME_STORE_URL && !/PLACEHOLDER|REPLACE_WITH_EXTENSION_ID/i.test(RAW_CHROME_STORE_URL);
export const CHROME_STORE_URL = HAS_CHROME_STORE_LISTING ? RAW_CHROME_STORE_URL : "/support";
/** Docs and social - optional for footer/nav */
export const DOCS_URL = import.meta.env.VITE_DOCS_URL || "#";
export const GITHUB_URL = import.meta.env.VITE_GITHUB_URL || "https://github.com";
export const TWITTER_URL = import.meta.env.VITE_TWITTER_URL || "https://x.com/teepxyz";
export const DISCORD_URL = import.meta.env.VITE_DISCORD_URL || "#";

/** Web app base URL (for redirects from extension) */
const configuredWebAppUrl = import.meta.env.VITE_WEB_APP_URL || "";
const configuredReceiptUrl = import.meta.env.VITE_RECEIPT_BASE_URL || "";
const shouldUseBrowserOrigin = (configuredUrl: string) =>
  !!browserOrigin &&
  window.location.protocol === "https:" &&
  /^http:\/\//i.test(configuredUrl);

export const WEB_APP_URL = trimTrailingSlash(
  shouldUseBrowserOrigin(configuredWebAppUrl)
    ? browserOrigin
    : configuredWebAppUrl || browserOrigin || "https://getteep.xyz",
);

/** Primary domain for receipt/tx links (e.g. when sharing tip on X). Use tipcoin.xyz in production. */
export const RECEIPT_BASE_URL = trimTrailingSlash(
  shouldUseBrowserOrigin(configuredReceiptUrl)
    ? browserOrigin
    : configuredReceiptUrl || browserOrigin || "https://getteep.xyz",
);

/** Privy - same app as extension for shared identity */
export const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || "cmoslas9401se0cjx2g6mk2a3";

/** Chain config - must match extension */
export const CHAIN_ID = 5_042_002; // Arc Testnet
export const CHAIN_NAME = "Arc Testnet";
export const EXPLORER_TX_URL = import.meta.env.VITE_EXPLORER_TX_URL || "https://testnet.arcscan.app/tx";
export const USDC_DECIMALS = 6;
export const USDC_ADDRESS = (import.meta.env.VITE_USDC_ADDRESS || "0x3600000000000000000000000000000000000000") as `0x${string}`;
export const FACTORY_ADDRESS = (import.meta.env.VITE_FACTORY_ADDRESS || "0xB53E8919627BcE6845eEee399E27A023D23C0dD4") as `0x${string}`;
export const TIP_CONTRACT_ADDRESS = (import.meta.env.VITE_TIP_CONTRACT_ADDRESS || "0xc4b18D3FB3aE76b37B6dfd69E5037c5865A47886") as `0x${string}`;
export const X_TIPPING_ROUTER_ADDRESS = (import.meta.env.VITE_X_TIPPING_ROUTER_ADDRESS || "") as `0x${string}`;
export const REFERRAL_REGISTRY_ADDRESS = (import.meta.env.VITE_REFERRAL_REGISTRY_ADDRESS || "0x967A2Bb3Ba05D1c0F3071C2c94C02950966c3655") as `0x${string}`;

/** Onramp / offramp URLs */
export const FUNDING_ENV = import.meta.env.VITE_FUNDING_ENV || "arcTestnet";
export const FAUCET_URL = import.meta.env.VITE_FAUCET_URL || "https://faucet.circle.com";
export const ONRAMP_URL = import.meta.env.VITE_ONRAMP_URL || "";
export const OFFRAMP_URL = import.meta.env.VITE_OFFRAMP_URL || "";
export const ENABLE_FIAT_ONRAMP = import.meta.env.VITE_ENABLE_FIAT_ONRAMP === "true";
export const ENABLE_FIAT_OFFRAMP = import.meta.env.VITE_ENABLE_FIAT_OFFRAMP === "true";
