import { defineChain } from "viem";

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
      http: [import.meta.env.VITE_ARC_RPC_URL || "https://rpc.testnet.arc.network"],
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

export const ARC_CHAIN_ID = arcTestnet.id;

export const KNOWN_FACTORIES = [
  {
    name: "ZeroDev factory A",
    address: "0xd703aaE79538628d27099B8c4f621bE4CCd142d5",
  },
  {
    name: "ZeroDev factory B",
    address: "0xd6CEDDe84be40893d153Be9d467CD6aD37875b28",
  },
  {
    name: "Coinbase Smart Wallet factory",
    address: "0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842",
  },
] as const;
