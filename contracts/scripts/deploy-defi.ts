import { ethers } from "hardhat";

const ARC_USDC = "0x3600000000000000000000000000000000000000";

const POOL_ADDRESSES_PROVIDER_ABI = [
  "function getPool() view returns (address)",
];

const PROTOCOL_DATA_PROVIDER_ABI = [
  "function getReserveTokensAddresses(address asset) view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)",
];

async function resolveAavePool(): Promise<string> {
  if (process.env.AAVE_POOL_ADDRESS) {
    return process.env.AAVE_POOL_ADDRESS;
  }

  const providerAddress = process.env.AAVE_POOL_ADDRESSES_PROVIDER;
  if (!providerAddress) {
    throw new Error("AAVE_POOL_ADDRESS or AAVE_POOL_ADDRESSES_PROVIDER is required");
  }

  const provider = await ethers.getContractAt(POOL_ADDRESSES_PROVIDER_ABI, providerAddress);
  const pool = await provider.getPool();
  if (!pool || pool === ethers.ZeroAddress) {
    throw new Error("AAVE_POOL_ADDRESSES_PROVIDER returned zero pool");
  }
  return pool;
}

async function resolveAaveAToken(usdcAddress: string): Promise<string> {
  if (process.env.AAVE_USDC_ATOKEN_ADDRESS) {
    return process.env.AAVE_USDC_ATOKEN_ADDRESS;
  }

  const dataProviderAddress = process.env.AAVE_PROTOCOL_DATA_PROVIDER;
  if (!dataProviderAddress) {
    throw new Error("AAVE_USDC_ATOKEN_ADDRESS or AAVE_PROTOCOL_DATA_PROVIDER is required");
  }

  const dataProvider = await ethers.getContractAt(PROTOCOL_DATA_PROVIDER_ABI, dataProviderAddress);
  const [aTokenAddress] = await dataProvider.getReserveTokensAddresses(usdcAddress);
  if (!aTokenAddress || aTokenAddress === ethers.ZeroAddress) {
    throw new Error("AAVE_PROTOCOL_DATA_PROVIDER returned zero aToken");
  }
  return aTokenAddress;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const usdcAddress = process.env.USDC_ADDRESS || ARC_USDC;
  const aavePoolAddress = await resolveAavePool();
  const aaveUsdcATokenAddress = await resolveAaveAToken(usdcAddress);
  const strategyId = ethers.keccak256(
    ethers.toUtf8Bytes(process.env.GROW_TIPS_AAVE_STRATEGY_ID || "AAVE_V3_ARC_TESTNET_USDC")
  );

  console.log("Deploying Grow Tips contracts with account:", deployer.address);
  console.log("USDC:", usdcAddress);
  console.log("Aave Pool:", aavePoolAddress);
  console.log("Aave USDC aToken:", aaveUsdcATokenAddress);
  if (process.env.AAVE_POOL_ADDRESSES_PROVIDER) {
    console.log("Aave PoolAddressesProvider:", process.env.AAVE_POOL_ADDRESSES_PROVIDER);
  }
  if (process.env.AAVE_PROTOCOL_DATA_PROVIDER) {
    console.log("Aave ProtocolDataProvider:", process.env.AAVE_PROTOCOL_DATA_PROVIDER);
  }
  console.log("Strategy ID:", strategyId);

  const StrategyRegistry = await ethers.getContractFactory("StrategyRegistry");
  const registry = await StrategyRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("StrategyRegistry deployed to:", registryAddress);

  const AaveV3SupplyAdapter = await ethers.getContractFactory("AaveV3SupplyAdapter");
  const adapter = await AaveV3SupplyAdapter.deploy(
    registryAddress,
    aavePoolAddress,
    strategyId,
    usdcAddress,
    aaveUsdcATokenAddress
  );
  await adapter.waitForDeployment();
  const adapterAddress = await adapter.getAddress();
  console.log("AaveV3SupplyAdapter deployed to:", adapterAddress);

  const tx = await registry.registerStrategy(strategyId, adapterAddress, "Aave Arc Testnet USDC", true);
  await tx.wait();
  console.log("Registered and enabled Aave Arc Testnet USDC strategy");

  console.log("\nSet these app/backend env values after deployment:");
  console.log("STRATEGY_REGISTRY_ADDRESS=", registryAddress);
  console.log("GROW_TIPS_AAVE_ADAPTER_ADDRESS=", adapterAddress);
  console.log("GROW_TIPS_AAVE_STRATEGY_ID=", strategyId);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
