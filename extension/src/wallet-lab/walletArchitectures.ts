import { CONFIG } from "../utils/config";

export type WalletArchitectureId = "privy-zerodev-arc";

export type WalletArchitecture = {
  id: WalletArchitectureId;
  label: string;
  chainId: number;
  chainName: string;
  privyAppId: string;
  factories: Array<{
    name: string;
    address: `0x${string}`;
    expected: "deployed" | "empty";
  }>;
};

export const WALLET_ARCHITECTURES: WalletArchitecture[] = [
  {
    id: "privy-zerodev-arc",
    label: "Privy + ZeroDev on Arc",
    chainId: CONFIG.CHAIN_ID,
    chainName: CONFIG.CHAIN_NAME,
    privyAppId: CONFIG.PRIVY_APP_ID,
    factories: [
      {
        name: "ZeroDev factory A",
        address: "0xd703aaE79538628d27099B8c4f621bE4CCd142d5",
        expected: "deployed",
      },
      {
        name: "ZeroDev factory B",
        address: "0xd6CEDDe84be40893d153Be9d467CD6aD37875b28",
        expected: "deployed",
      },
      {
        name: "Coinbase Smart Wallet factory",
        address: "0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842",
        expected: "empty",
      },
    ],
  },
];

export const DEFAULT_WALLET_ARCHITECTURE = WALLET_ARCHITECTURES[0];
