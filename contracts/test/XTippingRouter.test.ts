import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("XTippingRouter", function () {
  async function deployFixture() {
    const [deployer, attestSigner, relayer, tipper, attacker] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    const WalletFactory = await ethers.getContractFactory("WalletFactory");
    const factory = await WalletFactory.deploy(attestSigner.address);
    await factory.waitForDeployment();

    const XTippingRouter = await ethers.getContractFactory("XTippingRouter");
    const router = await XTippingRouter.deploy(await usdc.getAddress(), await factory.getAddress(), relayer.address);
    await router.waitForDeployment();

    await usdc.mint(tipper.address, ethers.parseUnits("100", 6));

    return { deployer, relayer, tipper, attacker, usdc, factory, router };
  }

  function contentId(seed = "tweet-1") {
    return ethers.keccak256(ethers.toUtf8Bytes(seed));
  }

  function commandId(seed = "command-1") {
    return ethers.keccak256(ethers.toUtf8Bytes(seed));
  }

  it("relays an authorized X tip on-chain to the deterministic claim wallet", async function () {
    const { relayer, tipper, usdc, factory, router } = await loadFixture(deployFixture);
    const authorId = 12345n;
    const amount = ethers.parseUnits("5", 6);
    const claimWallet = await factory.computeClaimWallet(authorId);

    await router.connect(tipper).setPermission(true, amount, ethers.parseUnits("25", 6));
    await usdc.connect(tipper).approve(await router.getAddress(), ethers.parseUnits("25", 6));

    await expect(router.connect(relayer).tipFromX(tipper.address, commandId(), contentId(), authorId, amount))
      .to.emit(router, "Tipped")
      .withArgs(contentId(), authorId, tipper.address, claimWallet, amount);

    expect(await usdc.balanceOf(claimWallet)).to.equal(amount);
    expect(await usdc.balanceOf(tipper.address)).to.equal(ethers.parseUnits("95", 6));
  });

  it("rejects unapproved relayers", async function () {
    const { attacker, tipper, usdc, router } = await loadFixture(deployFixture);
    const amount = ethers.parseUnits("5", 6);
    await router.connect(tipper).setPermission(true, amount, ethers.parseUnits("25", 6));
    await usdc.connect(tipper).approve(await router.getAddress(), ethers.parseUnits("25", 6));

    await expect(router.connect(attacker).tipFromX(tipper.address, commandId(), contentId(), 12345n, amount))
      .to.be.revertedWith("XRouter: not relayer");
  });

  it("enforces user per-tip and daily limits on-chain", async function () {
    const { relayer, tipper, usdc, router } = await loadFixture(deployFixture);
    await router.connect(tipper).setPermission(true, ethers.parseUnits("5", 6), ethers.parseUnits("8", 6));
    await usdc.connect(tipper).approve(await router.getAddress(), ethers.parseUnits("100", 6));

    await expect(
      router.connect(relayer).tipFromX(tipper.address, commandId("too-large"), contentId("too-large"), 1n, ethers.parseUnits("6", 6))
    ).to.be.revertedWith("XRouter: above per-tip");

    await router.connect(relayer).tipFromX(tipper.address, commandId("one"), contentId("one"), 1n, ethers.parseUnits("5", 6));
    await expect(
      router.connect(relayer).tipFromX(tipper.address, commandId("two"), contentId("two"), 2n, ethers.parseUnits("4", 6))
    ).to.be.revertedWith("XRouter: above daily");
  });

  it("resets daily spend on a new UTC day bucket", async function () {
    const { relayer, tipper, usdc, router } = await loadFixture(deployFixture);
    const amount = ethers.parseUnits("5", 6);
    await router.connect(tipper).setPermission(true, amount, amount);
    await usdc.connect(tipper).approve(await router.getAddress(), ethers.parseUnits("100", 6));

    await router.connect(relayer).tipFromX(tipper.address, commandId("day-1"), contentId("day-1"), 1n, amount);
    await expect(router.connect(relayer).tipFromX(tipper.address, commandId("same-day"), contentId("same-day"), 1n, amount))
      .to.be.revertedWith("XRouter: above daily");

    await time.increase(24 * 60 * 60);

    await expect(router.connect(relayer).tipFromX(tipper.address, commandId("day-2"), contentId("day-2"), 1n, amount))
      .to.emit(router, "Tipped");
  });

  it("prevents replaying the same command id", async function () {
    const { relayer, tipper, usdc, router } = await loadFixture(deployFixture);
    const amount = ethers.parseUnits("5", 6);
    const id = commandId("same-command");
    await router.connect(tipper).setPermission(true, amount, ethers.parseUnits("25", 6));
    await usdc.connect(tipper).approve(await router.getAddress(), ethers.parseUnits("25", 6));

    await router.connect(relayer).tipFromX(tipper.address, id, contentId("one"), 1n, amount);
    await expect(router.connect(relayer).tipFromX(tipper.address, id, contentId("two"), 1n, amount))
      .to.be.revertedWith("XRouter: command used");
  });
});
