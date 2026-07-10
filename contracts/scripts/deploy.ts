import { ethers } from "hardhat";
import hre from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = hre.network.name;
  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log("Deploying with account:", deployer.address);
  console.log("Network:", network, `(chainId: ${chainId})`);

  // Configuration
  const ATTESTATION_SIGNER = process.env.ATTESTATION_SIGNER_ADDRESS;
  if (!ATTESTATION_SIGNER) throw new Error("ATTESTATION_SIGNER_ADDRESS not set");

  const TREASURY = process.env.PROTOCOL_TREASURY_ADDRESS || deployer.address;
  const FEE_BPS = parseInt(process.env.WITHDRAWAL_FEE_BPS || "500", 10);
  const REFERRER_SHARE_BPS = parseInt(process.env.REFERRER_SHARE_BPS || "3000", 10);
  const REFERRER_SIGNER = process.env.REFERRAL_SIGNER_ADDRESS || ATTESTATION_SIGNER;
  const X_TIPPING_RELAYER = process.env.X_TIPPING_RELAYER_ADDRESS || deployer.address;

  // Determine USDC address based on network
  let usdcAddress: string;

  if (process.env.USDC_ADDRESS) {
    usdcAddress = process.env.USDC_ADDRESS;
    console.log("\n0. Using configured USDC:", usdcAddress);
  } else if (network === "arcTestnet") {
    usdcAddress = "0x3600000000000000000000000000000000000000";
    console.log("\n0. Using Arc Testnet USDC:", usdcAddress);
  } else if (network === "base") {
    // Base mainnet — use real USDC
    usdcAddress = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    console.log("\n0. Using mainnet USDC:", usdcAddress);
  } else {
    // Testnet or local — deploy MockUSDC
    console.log("\n0. Deploying MockUSDC (testnet)...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUsdc = await MockUSDC.deploy();
    await mockUsdc.waitForDeployment();
    usdcAddress = await mockUsdc.getAddress();
    console.log("   MockUSDC deployed to:", usdcAddress);

    // Mint some test USDC to deployer (10,000 USDC)
    const mintAmount = ethers.parseUnits("10000", 6);
    await mockUsdc.mint(deployer.address, mintAmount);
    console.log("   Minted 10,000 USDC to deployer");
  }

  // 1. Deploy WalletFactory
  console.log("\n1. Deploying WalletFactory...");
  const WalletFactory = await ethers.getContractFactory("WalletFactory");
  const factory = await WalletFactory.deploy(ATTESTATION_SIGNER);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("   WalletFactory deployed to:", factoryAddress);

  // 2. Deploy ReferralRegistry (fee/referrer config + EIP-712 setReferrer)
  console.log("\n2. Deploying ReferralRegistry...");
  const ReferralRegistry = await ethers.getContractFactory("ReferralRegistry");
  const registry = await ReferralRegistry.deploy(
    TREASURY,
    FEE_BPS,
    REFERRER_SHARE_BPS,
    REFERRER_SIGNER
  );
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("   ReferralRegistry deployed to:", registryAddress);
  console.log("   Treasury:", TREASURY, "| FeeBps:", FEE_BPS, "| ReferrerShareBps:", REFERRER_SHARE_BPS);

  // 3. Point factory at registry (new claim wallets get it; use injectRegistryToWallet for existing)
  console.log("\n3. Setting referral registry on WalletFactory...");
  const tx = await factory.setReferralRegistry(registryAddress);
  await tx.wait();
  console.log("   Factory.setReferralRegistry(", registryAddress, ") done");

  // 4. Deploy TipContract
  console.log("\n4. Deploying TipContract...");
  const TipContract = await ethers.getContractFactory("TipContract");
  const tipContract = await TipContract.deploy(usdcAddress, factoryAddress);
  await tipContract.waitForDeployment();
  const tipAddress = await tipContract.getAddress();
  console.log("   TipContract deployed to:", tipAddress);

  // 5. Deploy XTippingRouter
  console.log("\n5. Deploying XTippingRouter...");
  const XTippingRouter = await ethers.getContractFactory("XTippingRouter");
  const xTippingRouter = await XTippingRouter.deploy(usdcAddress, factoryAddress, X_TIPPING_RELAYER);
  await xTippingRouter.waitForDeployment();
  const xTippingRouterAddress = await xTippingRouter.getAddress();
  console.log("   XTippingRouter deployed to:", xTippingRouterAddress);
  console.log("   X tipping relayer:", X_TIPPING_RELAYER);

  // Summary
  console.log("\n=== Deployment Summary ===");
  console.log("Network:          ", network);
  console.log("Chain ID:        ", chainId.toString());
  console.log("USDC:            ", usdcAddress, network === "base" || network === "arcTestnet" || process.env.USDC_ADDRESS ? "(configured)" : "(MockUSDC)");
  console.log("WalletFactory:   ", factoryAddress);
  console.log("ReferralRegistry:", registryAddress);
  console.log("TipContract:     ", tipAddress);
  console.log("XTippingRouter:  ", xTippingRouterAddress);
  console.log("Att. Signer:     ", ATTESTATION_SIGNER);
  console.log("==========================\n");

  // Write addresses to file for other packages to consume
  const fs = require("fs");
  const addresses = {
    network,
    chainId: chainId.toString(),
    usdc: usdcAddress,
    walletFactory: factoryAddress,
    referralRegistry: registryAddress,
    tipContract: tipAddress,
    xTippingRouter: xTippingRouterAddress,
    xTippingRelayer: X_TIPPING_RELAYER,
    attestationSigner: ATTESTATION_SIGNER,
    isTestnet: network !== "base",
    deployedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    "deployed-addresses.json",
    JSON.stringify(addresses, null, 2)
  );
  console.log("Addresses written to deployed-addresses.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
