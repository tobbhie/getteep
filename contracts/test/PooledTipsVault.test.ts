import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("PooledTipsVault", function () {
  const STRATEGY_ID = ethers.keccak256(ethers.toUtf8Bytes("AAVE_V3_ARC_TESTNET_USDC"));

  async function deployFixture() {
    const [deployer, user, allocator, other] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    const MockAToken = await ethers.getContractFactory("MockAToken");
    const aToken = await MockAToken.deploy();
    await aToken.waitForDeployment();

    const MockAavePool = await ethers.getContractFactory("MockAavePool");
    const pool = await MockAavePool.deploy(await usdc.getAddress(), await aToken.getAddress());
    await pool.waitForDeployment();
    await aToken.setPool(await pool.getAddress());

    const StrategyRegistry = await ethers.getContractFactory("StrategyRegistry");
    const registry = await StrategyRegistry.deploy();
    await registry.waitForDeployment();

    const AaveV3SupplyAdapter = await ethers.getContractFactory("AaveV3SupplyAdapter");
    const adapter = await AaveV3SupplyAdapter.deploy(
      await registry.getAddress(),
      await pool.getAddress(),
      STRATEGY_ID,
      await usdc.getAddress(),
      await aToken.getAddress()
    );
    await adapter.waitForDeployment();
    await registry.registerStrategy(STRATEGY_ID, await adapter.getAddress(), "Aave Arc Testnet USDC", true);

    const PooledTipsVault = await ethers.getContractFactory("PooledTipsVault");
    const vault = await PooledTipsVault.deploy(
      await usdc.getAddress(),
      "Teep Pooled Tips USDC",
      "tpUSDC",
      deployer.address
    );
    await vault.waitForDeployment();
    await vault.setAllocator(allocator.address);
    await vault.setStrategy(await adapter.getAddress());

    await usdc.mint(user.address, ethers.parseUnits("100", 6));

    return { deployer, user, allocator, other, usdc, aToken, registry, adapter, vault };
  }

  it("should accept pooled deposits and mint vault shares", async function () {
    const { user, usdc, vault } = await loadFixture(deployFixture);
    const amount = ethers.parseUnits("25", 6);

    await usdc.connect(user).approve(await vault.getAddress(), amount);
    await expect(vault.connect(user).deposit(amount, user.address))
      .to.emit(vault, "Deposit")
      .withArgs(user.address, user.address, amount, amount);

    expect(await vault.totalAssets()).to.equal(amount);
    expect(await vault.balanceOf(user.address)).to.equal(amount);
  });

  it("should allocate pooled idle assets to the configured strategy", async function () {
    const { user, allocator, usdc, aToken, adapter, vault } = await loadFixture(deployFixture);
    const depositAmount = ethers.parseUnits("100", 6);
    const allocation = ethers.parseUnits("50", 6);

    await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
    await vault.connect(user).deposit(depositAmount, user.address);

    await expect(vault.connect(allocator).allocateToStrategy(allocation))
      .to.emit(vault, "AllocatedToStrategy")
      .withArgs(await adapter.getAddress(), allocation);

    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(depositAmount - allocation);
    expect(await aToken.balanceOf(await vault.getAddress())).to.equal(allocation);
    expect(await vault.totalAssets()).to.equal(depositAmount);
  });

  it("should recall strategy assets and let users withdraw from the pool", async function () {
    const { user, allocator, usdc, vault } = await loadFixture(deployFixture);
    const depositAmount = ethers.parseUnits("100", 6);
    const allocation = ethers.parseUnits("70", 6);

    await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
    await vault.connect(user).deposit(depositAmount, user.address);
    await vault.connect(allocator).allocateToStrategy(allocation);
    await vault.connect(allocator).recallFromStrategy(ethers.MaxUint256);

    const userBefore = await usdc.balanceOf(user.address);
    await vault.connect(user).withdraw(depositAmount, user.address, user.address);

    expect((await usdc.balanceOf(user.address)) - userBefore).to.equal(depositAmount);
    expect(await vault.totalAssets()).to.equal(0);
  });

  it("should enforce strategy cap", async function () {
    const { user, allocator, usdc, vault } = await loadFixture(deployFixture);
    const depositAmount = ethers.parseUnits("100", 6);

    await vault.setStrategyCapBps(5000);
    await usdc.connect(user).approve(await vault.getAddress(), depositAmount);
    await vault.connect(user).deposit(depositAmount, user.address);

    await expect(vault.connect(allocator).allocateToStrategy(ethers.parseUnits("50", 6))).to.emit(
      vault,
      "AllocatedToStrategy"
    );
    await expect(vault.connect(allocator).allocateToStrategy(1)).to.be.revertedWith("Vault: strategy cap exceeded");
  });

  it("should restrict allocation and strategy controls", async function () {
    const { user, other, vault, adapter } = await loadFixture(deployFixture);

    await expect(vault.connect(user).allocateToStrategy(1)).to.be.revertedWith("Vault: not allocator");
    await expect(vault.connect(user).recallFromStrategy(1)).to.be.revertedWith("Vault: not allocator");
    await expect(vault.connect(user).setStrategy(await adapter.getAddress()))
      .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount")
      .withArgs(user.address);
    await expect(vault.connect(user).setAllocator(other.address))
      .to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount")
      .withArgs(user.address);
  });

  it("should pause deposits, withdrawals, and share transfers", async function () {
    const { user, other, usdc, vault } = await loadFixture(deployFixture);
    const amount = ethers.parseUnits("10", 6);

    await usdc.connect(user).approve(await vault.getAddress(), amount);
    await vault.connect(user).deposit(amount, user.address);

    await vault.pause();

    await expect(vault.connect(user).transfer(other.address, 1)).to.be.revertedWithCustomError(vault, "EnforcedPause");
    await expect(vault.connect(user).withdraw(1, user.address, user.address)).to.be.revertedWithCustomError(
      vault,
      "EnforcedPause"
    );
    await usdc.connect(user).approve(await vault.getAddress(), 1);
    await expect(vault.connect(user).deposit(1, user.address)).to.be.revertedWithCustomError(vault, "EnforcedPause");

    await vault.unpause();
    await expect(vault.connect(user).transfer(other.address, 1)).to.not.be.reverted;
  });
});
