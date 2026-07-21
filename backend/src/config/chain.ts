import { defineChain } from "viem";
import { base, baseSepolia } from "viem/chains";

export const arcTestnet = defineChain({
  id: 5_042_002,
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

export const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000" as const;

export function getConfiguredChain() {
  const chainName = process.env.CHAIN || "arcTestnet";
  if (chainName === "base") return base;
  if (chainName === "baseSepolia") return baseSepolia;
  return arcTestnet;
}

export function getRpcUrl() {
  return (
    process.env.ARC_RPC_URL ||
    process.env.BASE_RPC_URL ||
    getConfiguredChain().rpcUrls.default.http[0]
  );
}

export function getChainId() {
  return Number(process.env.CHAIN_ID || getConfiguredChain().id);
}

