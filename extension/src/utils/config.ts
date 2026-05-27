/**
 * Extension configuration constants.
 * In production, these come from environment variables at build time.
 */
import { arcTestnet } from "./chains";

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";
const API_BASE_URL = process.env.API_BASE_URL || (IS_PRODUCTION ? "" : "http://127.0.0.1:3001");

export const CONFIG = {
  // Arc Testnet
  CHAIN: arcTestnet,
  CHAIN_ID: arcTestnet.id,
  CHAIN_NAME: arcTestnet.name,
  RPC_URL: process.env.RPC_URL || process.env.ARC_RPC_URL || arcTestnet.rpcUrls.default.http[0],
  EXPLORER_TX_URL: `${arcTestnet.blockExplorers.default.url}/tx`,

  // Contract addresses (set after Arc deployment)
  TIP_CONTRACT_ADDRESS: (process.env.TIP_CONTRACT_ADDRESS || "0xc4b18D3FB3aE76b37B6dfd69E5037c5865A47886") as `0x${string}`,
  WALLET_FACTORY_ADDRESS: (process.env.WALLET_FACTORY_ADDRESS || process.env.FACTORY_ADDRESS || "0xB53E8919627BcE6845eEee399E27A023D23C0dD4") as `0x${string}`,
  // ReferralRegistry for on-chain fee/referrer split (optional; when set, use withdrawWithFee and setReferrer)
  REFERRAL_REGISTRY_ADDRESS: (process.env.REFERRAL_REGISTRY_ADDRESS || "0x967A2Bb3Ba05D1c0F3071C2c94C02950966c3655") as `0x${string}`,
  // Arc Testnet ERC-20 USDC. Native gas is also USDC but uses 18 decimals; tipping token remains 6 decimals.
  USDC_ADDRESS: (process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000") as `0x${string}`,

  // Backend API
  API_BASE_URL,

  // Privy
  PRIVY_APP_ID: process.env.PRIVY_APP_ID || "cmoslas9401se0cjx2g6mk2a3",

  // USDC decimals
  USDC_DECIMALS: 6,

  // Minimum tip in USDC (display value)
  MIN_TIP_USDC: 0.01,

  // Demo mode: blur email address (set via env at build time)
  BLUR_EMAIL: process.env.BLUR_EMAIL === "true" || false,

  // Virality / MVP: web app base (for withdraw link, CTA redirect).
  // Production builds are guarded in webpack.config.js so this cannot ship empty.
  WEB_APP_URL: process.env.WEB_APP_URL || (IS_PRODUCTION ? "" : "http://localhost:5174"),

  // Primary domain for receipt/tx links when sharing tip on X (e.g. tipcoin.xyz)
  RECEIPT_BASE_URL: process.env.RECEIPT_BASE_URL || process.env.WEB_APP_URL || "https://tipcoin.xyz",

  // Funding / cash movement gates
  FUNDING_ENV: process.env.FUNDING_ENV || "arcTestnet",
  FAUCET_URL: process.env.FAUCET_URL || "https://faucet.circle.com",
  ENABLE_FIAT_ONRAMP: process.env.ENABLE_FIAT_ONRAMP === "true",
  ENABLE_FIAT_OFFRAMP: process.env.ENABLE_FIAT_OFFRAMP === "true",
  ONRAMP_URL: process.env.ONRAMP_URL || "",
  OFFRAMP_URL: process.env.OFFRAMP_URL || "",
} as const;

// Tip presets in USDC
export const TIP_PRESETS = [0.5, 1, 2, 5] as const;

// ABI fragments needed by the extension
export const TIP_CONTRACT_ABI = [
  {
    name: "tip",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "contentId", type: "bytes32" },
      { name: "authorId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "tipBatch",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "contentIds", type: "bytes32[]" },
      { name: "authorIds", type: "uint256[]" },
      { name: "amounts", type: "uint256[]" },
    ],
    outputs: [],
  },
] as const;

export const USDC_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const FACTORY_ABI = [
  {
    name: "computeClaimWallet",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_authorId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "deployClaimWallet",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_authorId", type: "uint256" },
      { name: "_owner", type: "address" },
      { name: "_timestamp", type: "uint256" },
      { name: "_nonce", type: "bytes32" },
      { name: "_signature", type: "bytes" },
    ],
    outputs: [{ name: "wallet", type: "address" }],
  },
  {
    name: "isDeployed",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_authorId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const CLAIM_WALLET_ABI = [
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "withdrawWithFee",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "destination", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "withdrawWithAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "destination", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "owner",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "referralRegistry",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "initialized",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const REFERRAL_REGISTRY_ABI = [
  {
    name: "setReferrer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "referrer", type: "address" },
      { name: "expiresAt", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
] as const;
