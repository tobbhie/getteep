/**
 * Deploy only XTippingRouter against an existing USDC token and WalletFactory.
 *
 * Requires:
 *   USDC_ADDRESS
 *   FACTORY_ADDRESS
 *   X_TIPPING_RELAYER_ADDRESS
 *
 * Run:
 *   npx hardhat run scripts/deploy-x-tipping-router-only.ts --network arcTestnet
 */

import { ethers } from "hardhat";
import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  const USDC_ADDRESS = process.env.USDC_ADDRESS;
  const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
  const X_TIPPING_RELAYER_ADDRESS = process.env.X_TIPPING_RELAYER_ADDRESS;

  if (!USDC_ADDRESS) throw new Error("USDC_ADDRESS not set");
  if (!FACTORY_ADDRESS) throw new Error("FACTORY_ADDRESS not set");
  if (!X_TIPPING_RELAYER_ADDRESS) throw new Error("X_TIPPING_RELAYER_ADDRESS not set");

  console.log("Deploying XTippingRouter with account:", deployer.address);
  console.log("Network:", network, "| ChainId:", chainId.toString());
  console.log("USDC:", USDC_ADDRESS);
  console.log("WalletFactory:", FACTORY_ADDRESS);
  console.log("X tipping relayer:", X_TIPPING_RELAYER_ADDRESS);

  const XTippingRouter = await ethers.getContractFactory("XTippingRouter");
  const router = await XTippingRouter.deploy(USDC_ADDRESS, FACTORY_ADDRESS, X_TIPPING_RELAYER_ADDRESS);
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();

  console.log("XTippingRouter deployed to:", routerAddress);

  const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
  let addresses: Record<string, unknown> = {};
  if (fs.existsSync(addressesPath)) {
    addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  }
  addresses.network = network;
  addresses.chainId = chainId.toString();
  addresses.usdc = USDC_ADDRESS;
  addresses.walletFactory = FACTORY_ADDRESS;
  addresses.xTippingRouter = routerAddress;
  addresses.xTippingRelayer = X_TIPPING_RELAYER_ADDRESS;
  addresses.deployedAt = new Date().toISOString();
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));

  console.log("Updated deployed-addresses.json");
  console.log("\nSet these env vars:");
  console.log("Backend: X_TIPPING_ROUTER_ADDRESS=" + routerAddress);
  console.log("Web:     VITE_X_TIPPING_ROUTER_ADDRESS=" + routerAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
