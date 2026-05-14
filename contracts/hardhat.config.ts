import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "0x" + "0".repeat(64);
const ARC_TESTNET_RPC = process.env.ARC_RPC_URL || process.env.RPC_URL || "https://rpc.testnet.arc.network";
const BASE_RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const BASE_SEPOLIA_RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {},
    arcTestnet: {
      url: ARC_TESTNET_RPC,
      accounts: [PRIVATE_KEY],
      chainId: 5042002,
    },
    baseSepolia: {
      url: BASE_SEPOLIA_RPC,
      accounts: [PRIVATE_KEY],
      chainId: 84532,
    },
    base: {
      url: BASE_RPC,
      accounts: [PRIVATE_KEY],
      chainId: 8453,
    },
  },
  etherscan: {
    apiKey: {
      baseSepolia: BASESCAN_API_KEY,
      base: BASESCAN_API_KEY,
    },
    customChains: [
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
};

export default config;
