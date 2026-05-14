import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("Grow Tips DeFi contracts", function () {
  const STRATEGY_ID = ethers.keccak256(ethers.toUtf8Bytes("AAVE_V3_ARC_TESTNET_USDC"));

  async function deployFixture() {
    const [deployer, user, beneficiary, other] = await ethers.getSigners();

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

    const amount = ethers.parseUnits("25", 6);
    await usdc.mint(user.address, ethers.parseUnits("100", 6));

    return { deployer, user, beneficiary, other, usdc, aToken, pool, registry, adapter, amount };
  }

  describe("StrategyRegistry", function () {
    it("should register and expose an enabled strategy", async function () {
      const { registry, adapter, usdc, aToken } = await loadFixture(deployFixture);

      expect(await registry.strategyCount()).to.equal(1);
      expect(await registry.getStrategyIds()).to.deep.equal([STRATEGY_ID]);
      expect(await registry.isStrategyAvailable(STRATEGY_ID)).to.equal(true);

      const strategy = await registry.getStrategy(STRATEGY_ID);
      expect(strategy.adapter).to.equal(await adapter.getAddress());
      expect(strategy.asset).to.equal(await usdc.getAddress());
      expect(strategy.positionToken).to.equal(await aToken.getAddress());
      expect(strategy.enabled).to.equal(true);
      expect(strategy.emergencyDisabled).to.equal(false);
      expect(strategy.label).to.equal("Aave Arc Testnet USDC");
    });

    it("should reject non-owner strategy administration", async function () {
      const { registry, user } = await loadFixture(deployFixture);

      await expect(registry.connect(user).setStrategyEnabled(STRATEGY_ID, false))
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
        .withArgs(user.address);
      await expect(registry.connect(user).setStrategyEmergencyDisabled(STRATEGY_ID, true))
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
        .withArgs(user.address);
    });

    it("should support emergency strategy disablement", async function () {
      const { registry } = await loadFixture(deployFixture);

      await expect(registry.setStrategyEmergencyDisabled(STRATEGY_ID, true))
        .to.emit(registry, "StrategyEmergencyDisabled")
        .withArgs(STRATEGY_ID, true);

      expect(await registry.isStrategyAvailable(STRATEGY_ID)).to.equal(false);

      await registry.setStrategyEmergencyDisabled(STRATEGY_ID, false);
      expect(await registry.isStrategyAvailable(STRATEGY_ID)).to.equal(true);
    });
  });

  describe("AaveV3SupplyAdapter", function () {
    it("should deposit into Aave-style pool and mint position tokens to the beneficiary", async function () {
      const { user, beneficiary, usdc, aToken, pool, adapter, amount } = await loadFixture(deployFixture);

      await usdc.connect(user).approve(await adapter.getAddress(), amount);

      await expect(adapter.connect(user).deposit(amount, beneficiary.address))
        .to.emit(adapter, "Deposited")
        .withArgs(user.address, beneficiary.address, await usdc.getAddress(), amount);

      expect(await usdc.balanceOf(await adapter.getAddress())).to.equal(0);
      expect(await aToken.balanceOf(await adapter.getAddress())).to.equal(0);
      expect(await usdc.balanceOf(await pool.getAddress())).to.equal(amount);
      expect(await aToken.balanceOf(beneficiary.address)).to.equal(amount);
    });

    it("should withdraw by redeeming caller-owned position tokens directly to the recipient", async function () {
      const { user, beneficiary, other, usdc, aToken, adapter, amount } = await loadFixture(deployFixture);

      await usdc.connect(user).approve(await adapter.getAddress(), amount);
      await adapter.connect(user).deposit(amount, beneficiary.address);

      await aToken.connect(beneficiary).approve(await adapter.getAddress(), amount);

      const recipientBefore = await usdc.balanceOf(other.address);
      await expect(adapter.connect(beneficiary).withdraw(amount, other.address))
        .to.emit(adapter, "Withdrawn")
        .withArgs(beneficiary.address, other.address, await usdc.getAddress(), amount);

      expect((await usdc.balanceOf(other.address)) - recipientBefore).to.equal(amount);
      expect(await aToken.balanceOf(beneficiary.address)).to.equal(0);
      expect(await usdc.balanceOf(await adapter.getAddress())).to.equal(0);
      expect(await aToken.balanceOf(await adapter.getAddress())).to.equal(0);
    });

    it("should reject deposits but still allow exits when the registry disables the strategy", async function () {
      const { user, beneficiary, usdc, aToken, registry, adapter, amount } = await loadFixture(deployFixture);

      await registry.setStrategyEnabled(STRATEGY_ID, false);
      await usdc.connect(user).approve(await adapter.getAddress(), amount);

      await expect(adapter.connect(user).deposit(amount, beneficiary.address)).to.be.revertedWith(
        "Adapter: strategy unavailable"
      );

      await registry.setStrategyEnabled(STRATEGY_ID, true);
      await adapter.connect(user).deposit(amount, beneficiary.address);
      await registry.setStrategyEmergencyDisabled(STRATEGY_ID, true);
      await aToken.connect(beneficiary).approve(await adapter.getAddress(), amount);

      await expect(adapter.connect(beneficiary).withdraw(amount, user.address)).to.emit(adapter, "Withdrawn");
    });

    it("should support Aave-style max withdrawal through the adapter", async function () {
      const { user, beneficiary, usdc, aToken, adapter, amount } = await loadFixture(deployFixture);

      await usdc.connect(user).approve(await adapter.getAddress(), amount);
      await adapter.connect(user).deposit(amount, beneficiary.address);
      await aToken.connect(beneficiary).approve(await adapter.getAddress(), amount);

      const recipientBefore = await usdc.balanceOf(user.address);
      await adapter.connect(beneficiary).withdraw(ethers.MaxUint256, user.address);

      expect((await usdc.balanceOf(user.address)) - recipientBefore).to.equal(amount);
      expect(await aToken.balanceOf(beneficiary.address)).to.equal(0);
    });

    it("should reject zero-value or zero-address operations", async function () {
      const { user, usdc, adapter, amount } = await loadFixture(deployFixture);

      await usdc.connect(user).approve(await adapter.getAddress(), amount);

      await expect(adapter.connect(user).deposit(0, user.address)).to.be.revertedWith("Adapter: zero amount");
      await expect(adapter.connect(user).deposit(amount, ethers.ZeroAddress)).to.be.revertedWith(
        "Adapter: zero beneficiary"
      );
      await expect(adapter.connect(user).withdraw(0, user.address)).to.be.revertedWith("Adapter: zero amount");
      await expect(adapter.connect(user).withdraw(amount, ethers.ZeroAddress)).to.be.revertedWith(
        "Adapter: zero recipient"
      );
    });

    it("should support adapter pause as a local emergency brake", async function () {
      const { user, usdc, adapter, amount } = await loadFixture(deployFixture);

      await adapter.pause();
      await usdc.connect(user).approve(await adapter.getAddress(), amount);

      await expect(adapter.connect(user).deposit(amount, user.address)).to.be.revertedWithCustomError(
        adapter,
        "EnforcedPause"
      );

      await adapter.unpause();
      await expect(adapter.connect(user).deposit(amount, user.address)).to.emit(adapter, "Deposited");
    });

    it("should restrict adapter pause controls to the owner", async function () {
      const { adapter, user } = await loadFixture(deployFixture);

      await expect(adapter.connect(user).pause())
        .to.be.revertedWithCustomError(adapter, "OwnableUnauthorizedAccount")
        .withArgs(user.address);
    });
  });
});
