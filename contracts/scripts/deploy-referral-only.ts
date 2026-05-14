/**
 * Deploy only ReferralRegistry and set it on an existing WalletFactory.
 * Use when factory + tip contract are already deployed and you just add referral/fee config.
 *
 * Requires in .env:
 *   FACTORY_ADDRESS (existing)
 *   PROTOCOL_TREASURY_ADDRESS
 *   ATTESTATION_SIGNER_ADDRESS (or REFERRAL_SIGNER_ADDRESS)
 *   WITHDRAWAL_FEE_BPS, REFERRER_SHARE_BPS (optional)
 *
 * Run: npx hardhat run scripts/deploy-referral-only.ts --network baseSepolia
 */

import { ethers } from "hardhat";
import hre from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  const FACTORY_ADDRESS = process.env.FACTORY_ADDRESS;
  if (!FACTORY_ADDRESS) throw new Error("FACTORY_ADDRESS not set (existing factory)");

  const ATTESTATION_SIGNER = process.env.ATTESTATION_SIGNER_ADDRESS;
  if (!ATTESTATION_SIGNER) throw new Error("ATTESTATION_SIGNER_ADDRESS not set");

  const TREASURY = process.env.PROTOCOL_TREASURY_ADDRESS || deployer.address;
  const FEE_BPS = parseInt(process.env.WITHDRAWAL_FEE_BPS || "500", 10);
  const REFERRER_SHARE_BPS = parseInt(process.env.REFERRER_SHARE_BPS || "3000", 10);
  const REFERRER_SIGNER = process.env.REFERRAL_SIGNER_ADDRESS || ATTESTATION_SIGNER;

  console.log("Deploying ReferralRegistry with account:", deployer.address);
  console.log("Network:", network, "| ChainId:", chainId.toString());
  console.log("Existing factory:", FACTORY_ADDRESS);

  const ReferralRegistry = await ethers.getContractFactory("ReferralRegistry");
  const registry = await ReferralRegistry.deploy(
    TREASURY,
    FEE_BPS,
    REFERRER_SHARE_BPS,
    REFERRER_SIGNER
  );
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("ReferralRegistry deployed to:", registryAddress);

  // Only call setReferralRegistry if the factory was deployed with the new bytecode (has this function).
  // The existing factory at 0x14b96... was deployed before referral support, so it reverts.
  try {
    const factory = await ethers.getContractAt("WalletFactory", FACTORY_ADDRESS);
    const tx = await factory.setReferralRegistry(registryAddress);
    await tx.wait();
    console.log("Factory.setReferralRegistry(registry) done");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("Factory.setReferralRegistry failed (existing factory may be old bytecode):", msg);
    console.warn("ReferralRegistry is still deployed at", registryAddress);
    console.warn("Set REFERRAL_REGISTRY_ADDRESS in backend/env. New claim wallets will get the registry only after a full deploy (new WalletFactory).");
  }

  const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
  let addresses: Record<string, unknown> = {};
  if (fs.existsSync(addressesPath)) {
    addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  }
  addresses.referralRegistry = registryAddress;
  addresses.network = network;
  addresses.chainId = chainId.toString();
  addresses.deployedAt = new Date().toISOString();
  fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
  console.log("Updated deployed-addresses.json with referralRegistry:", registryAddress);
  console.log("\nNext: set REFERRAL_REGISTRY_ADDRESS in backend .env and CHAIN_ID=" + chainId.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
