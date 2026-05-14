import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("Teep Contracts", function () {
  async function deployFixture() {
    const [deployer, attestSigner, tipper, creator, referrer, alternate, newSigner] = await ethers.getSigners();

    // Deploy a mock USDC (ERC-20 with 6 decimals)
    const MockERC20 = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockERC20.deploy();
    await usdc.waitForDeployment();

    // Deploy WalletFactory
    const WalletFactory = await ethers.getContractFactory("WalletFactory");
    const factory = await WalletFactory.deploy(attestSigner.address);
    await factory.waitForDeployment();

    // Deploy TipContract
    const TipContract = await ethers.getContractFactory("TipContract");
    const tipContract = await TipContract.deploy(
      await usdc.getAddress(),
      await factory.getAddress()
    );
    await tipContract.waitForDeployment();

    const ReferralRegistry = await ethers.getContractFactory("ReferralRegistry");
    const referralRegistry = await ReferralRegistry.deploy(
      deployer.address,
      500,
      3000,
      attestSigner.address
    );
    await referralRegistry.waitForDeployment();
    await factory.setReferralRegistry(await referralRegistry.getAddress());

    // Mint USDC to tipper
    const mintAmount = ethers.parseUnits("1000", 6); // 1000 USDC
    await usdc.mint(tipper.address, mintAmount);

    return { deployer, attestSigner, tipper, creator, referrer, alternate, newSigner, usdc, factory, tipContract, referralRegistry };
  }

  const withdrawalAuthorizationTypes = {
    WithdrawalAuthorization: [
      { name: "owner", type: "address" },
      { name: "token", type: "address" },
      { name: "destination", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };

  const setReferrerTypes = {
    SetReferrer: [
      { name: "owner", type: "address" },
      { name: "referrer", type: "address" },
      { name: "expiresAt", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };

  async function deployClaimWallet(factory: any, attestSigner: any, creator: any, authorId: bigint) {
    const timestamp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "bytes32"],
      [authorId, creator.address, timestamp, nonce]
    );
    const signature = await attestSigner.signMessage(ethers.getBytes(messageHash));
    await factory.deployClaimWallet(authorId, creator.address, timestamp, nonce, signature);

    const walletAddr = await factory.claimWallets(authorId);
    const ClaimWallet = await ethers.getContractFactory("ClaimWallet");
    return { walletAddr, wallet: ClaimWallet.attach(walletAddr) };
  }

  async function signWithdrawalAuthorization(
    signer: any,
    walletAddr: string,
    owner: string,
    token: string,
    destination: string,
    amount: bigint,
    expiresAt: bigint,
    nonce: string
  ) {
    const network = await ethers.provider.getNetwork();
    return signer.signTypedData(
      {
        name: "TeepClaimWallet",
        version: "1",
        chainId: network.chainId,
        verifyingContract: walletAddr,
      },
      withdrawalAuthorizationTypes,
      { owner, token, destination, amount, expiresAt, nonce }
    );
  }

  async function signSetReferrer(
    registryAddr: string,
    signer: any,
    owner: string,
    referrer: string,
    expiresAt: bigint,
    nonce: string
  ) {
    const network = await ethers.provider.getNetwork();
    return signer.signTypedData(
      {
        name: "TipcoinReferralRegistry",
        version: "1",
        chainId: network.chainId,
        verifyingContract: registryAddr,
      },
      setReferrerTypes,
      { owner, referrer, expiresAt, nonce }
    );
  }

  describe("WalletFactory", function () {
    it("should compute deterministic addresses", async function () {
      const { factory } = await loadFixture(deployFixture);
      const authorId = 12345n;

      const addr1 = await factory.computeClaimWallet(authorId);
      const addr2 = await factory.computeClaimWallet(authorId);

      expect(addr1).to.equal(addr2);
      expect(addr1).to.not.equal(ethers.ZeroAddress);
    });

    it("should compute different addresses for different authors", async function () {
      const { factory } = await loadFixture(deployFixture);

      const addr1 = await factory.computeClaimWallet(111n);
      const addr2 = await factory.computeClaimWallet(222n);

      expect(addr1).to.not.equal(addr2);
    });

    it("should deploy a claim wallet with valid attestation", async function () {
      const { factory, attestSigner, creator } = await loadFixture(deployFixture);
      const authorId = 12345n;

      // Create attestation
      const timestamp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
      const nonce = ethers.randomBytes(32);
      const nonceBytes32 = ethers.hexlify(nonce);

      const messageHash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "uint256", "bytes32"],
        [authorId, creator.address, timestamp, nonceBytes32]
      );
      const signature = await attestSigner.signMessage(ethers.getBytes(messageHash));

      // Deploy
      await expect(
        factory.deployClaimWallet(authorId, creator.address, timestamp, nonceBytes32, signature)
      ).to.emit(factory, "ClaimWalletDeployed");

      const walletAddr = await factory.claimWallets(authorId);
      expect(walletAddr).to.not.equal(ethers.ZeroAddress);
      expect(await factory.isDeployed(authorId)).to.be.true;
    });

    it("should reject duplicate deployment", async function () {
      const { factory, attestSigner, creator } = await loadFixture(deployFixture);
      const authorId = 12345n;

      const timestamp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
      const nonce1 = ethers.hexlify(ethers.randomBytes(32));

      const msg1 = ethers.solidityPackedKeccak256(
        ["uint256", "address", "uint256", "bytes32"],
        [authorId, creator.address, timestamp, nonce1]
      );
      const sig1 = await attestSigner.signMessage(ethers.getBytes(msg1));

      await factory.deployClaimWallet(authorId, creator.address, timestamp, nonce1, sig1);

      // Second deploy should fail
      const nonce2 = ethers.hexlify(ethers.randomBytes(32));
      const msg2 = ethers.solidityPackedKeccak256(
        ["uint256", "address", "uint256", "bytes32"],
        [authorId, creator.address, timestamp, nonce2]
      );
      const sig2 = await attestSigner.signMessage(ethers.getBytes(msg2));

      await expect(
        factory.deployClaimWallet(authorId, creator.address, timestamp, nonce2, sig2)
      ).to.be.revertedWith("Factory: already deployed");
    });

    it("should reject claim wallet attestations from too far in the future", async function () {
      const { factory, attestSigner, creator } = await loadFixture(deployFixture);
      const authorId = 12346n;
      const latest = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
      const timestamp = latest + 3600n;
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const messageHash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "uint256", "bytes32"],
        [authorId, creator.address, timestamp, nonce]
      );
      const signature = await attestSigner.signMessage(ethers.getBytes(messageHash));

      await expect(
        factory.deployClaimWallet(authorId, creator.address, timestamp, nonce, signature)
      ).to.be.revertedWith("Factory: attestation from future");
    });

    it("should inject the current withdrawal signer into an existing wallet", async function () {
      const { factory, attestSigner, creator, newSigner } = await loadFixture(deployFixture);
      const authorId = 555n;
      const { wallet } = await deployClaimWallet(factory, attestSigner, creator, authorId);

      expect(await wallet.withdrawalSigner()).to.equal(attestSigner.address);

      await factory.setAttestationSigner(newSigner.address);
      await expect(factory.injectWithdrawalSignerToWallet(authorId))
        .to.emit(wallet, "WithdrawalSignerUpdated")
        .withArgs(newSigner.address);

      expect(await wallet.withdrawalSigner()).to.equal(newSigner.address);
    });

    it("should restrict withdrawal signer injection to the factory owner", async function () {
      const { factory, attestSigner, creator, tipper } = await loadFixture(deployFixture);
      const authorId = 556n;
      await deployClaimWallet(factory, attestSigner, creator, authorId);

      await expect(factory.connect(tipper).injectWithdrawalSignerToWallet(authorId))
        .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount")
        .withArgs(tipper.address);
    });

    it("should reject zero referral registry updates", async function () {
      const { factory } = await loadFixture(deployFixture);

      await expect(factory.setReferralRegistry(ethers.ZeroAddress)).to.be.revertedWith("Factory: zero registry");
    });
  });

  describe("TipContract", function () {
    it("should accept a tip and forward USDC", async function () {
      const { tipContract, usdc, factory, tipper } = await loadFixture(deployFixture);
      const authorId = 99999n;
      const contentId = ethers.keccak256(
        ethers.toUtf8Bytes("x.com/99999/status/123456")
      );
      const tipAmount = ethers.parseUnits("5", 6); // 5 USDC

      // Approve
      await usdc.connect(tipper).approve(await tipContract.getAddress(), tipAmount);

      // Tip
      const claimAddr = await factory.computeClaimWallet(authorId);

      await expect(
        tipContract.connect(tipper).tip(contentId, authorId, tipAmount)
      )
        .to.emit(tipContract, "Tipped")
        .withArgs(contentId, authorId, tipper.address, claimAddr, tipAmount);

      // Check USDC arrived at claim wallet address (even if not deployed yet)
      expect(await usdc.balanceOf(claimAddr)).to.equal(tipAmount);
    });

    it("should reject tips below minimum", async function () {
      const { tipContract, usdc, tipper } = await loadFixture(deployFixture);
      const contentId = ethers.keccak256(ethers.toUtf8Bytes("x.com/1/status/1"));
      const tinyAmount = 100n; // 0.0001 USDC — below MIN_TIP of 10_000

      await usdc.connect(tipper).approve(await tipContract.getAddress(), tinyAmount);

      await expect(
        tipContract.connect(tipper).tip(contentId, 1n, tinyAmount)
      ).to.be.revertedWith("Tip: below minimum");
    });

    it("should support batch tips", async function () {
      const { tipContract, usdc, factory, tipper } = await loadFixture(deployFixture);
      const total = ethers.parseUnits("15", 6); // 15 USDC total

      await usdc.connect(tipper).approve(await tipContract.getAddress(), total);

      const contentIds = [
        ethers.keccak256(ethers.toUtf8Bytes("x.com/1/status/100")),
        ethers.keccak256(ethers.toUtf8Bytes("x.com/2/status/200")),
        ethers.keccak256(ethers.toUtf8Bytes("x.com/3/status/300")),
      ];
      const authorIds = [1n, 2n, 3n];
      const amounts = [
        ethers.parseUnits("5", 6),
        ethers.parseUnits("5", 6),
        ethers.parseUnits("5", 6),
      ];

      await tipContract.connect(tipper).tipBatch(contentIds, authorIds, amounts);

      // Verify each author's claim wallet received 5 USDC
      for (let i = 0; i < 3; i++) {
        const addr = await factory.computeClaimWallet(authorIds[i]);
        expect(await usdc.balanceOf(addr)).to.equal(amounts[i]);
      }
    });
  });

  describe("ClaimWallet", function () {
    it("should allow owner to withdraw USDC after claiming", async function () {
      const { factory, tipContract, usdc, attestSigner, tipper, creator } =
        await loadFixture(deployFixture);
      const authorId = 42n;
      const tipAmount = ethers.parseUnits("10", 6);

      // 1. Tip the author
      const contentId = ethers.keccak256(
        ethers.toUtf8Bytes("x.com/42/status/999")
      );
      await usdc.connect(tipper).approve(await tipContract.getAddress(), tipAmount);
      await tipContract.connect(tipper).tip(contentId, authorId, tipAmount);

      // 2. Deploy claim wallet (creator claims)
      const timestamp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const messageHash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "uint256", "bytes32"],
        [authorId, creator.address, timestamp, nonce]
      );
      const signature = await attestSigner.signMessage(ethers.getBytes(messageHash));
      await factory.deployClaimWallet(authorId, creator.address, timestamp, nonce, signature);

      // 3. Creator withdraws
      const walletAddr = await factory.claimWallets(authorId);
      const ClaimWallet = await ethers.getContractFactory("ClaimWallet");
      const wallet = ClaimWallet.attach(walletAddr);

      const balanceBefore = await usdc.balanceOf(creator.address);
      await wallet.connect(creator).withdraw(await usdc.getAddress(), creator.address, tipAmount);
      const balanceAfter = await usdc.balanceOf(creator.address);

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseUnits("9.5", 6));
    });

    it("should require authorization when withdrawing to a non-owner destination", async function () {
      const { factory, tipContract, usdc, attestSigner, tipper, creator } =
        await loadFixture(deployFixture);
      const authorId = 43n;
      const tipAmount = ethers.parseUnits("10", 6);
      const contentId = ethers.keccak256(ethers.toUtf8Bytes("x.com/43/status/999"));
      await usdc.connect(tipper).approve(await tipContract.getAddress(), tipAmount);
      await tipContract.connect(tipper).tip(contentId, authorId, tipAmount);

      const timestamp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
      const deployNonce = ethers.hexlify(ethers.randomBytes(32));
      const deployHash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "uint256", "bytes32"],
        [authorId, creator.address, timestamp, deployNonce]
      );
      const deploySig = await attestSigner.signMessage(ethers.getBytes(deployHash));
      await factory.deployClaimWallet(authorId, creator.address, timestamp, deployNonce, deploySig);

      const walletAddr = await factory.claimWallets(authorId);
      const ClaimWallet = await ethers.getContractFactory("ClaimWallet");
      const wallet = ClaimWallet.attach(walletAddr);

      await expect(
        wallet.connect(creator).withdrawWithFee(await usdc.getAddress(), tipper.address, tipAmount)
      ).to.be.revertedWith("ClaimWallet: destination authorization required");

      const network = await ethers.provider.getNetwork();
      const authNonce = ethers.hexlify(ethers.randomBytes(32));
      const expiresAt = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 600);
      const signature = await attestSigner.signTypedData(
        {
          name: "TeepClaimWallet",
          version: "1",
          chainId: network.chainId,
          verifyingContract: walletAddr,
        },
        {
          WithdrawalAuthorization: [
            { name: "owner", type: "address" },
            { name: "token", type: "address" },
            { name: "destination", type: "address" },
            { name: "amount", type: "uint256" },
            { name: "expiresAt", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        {
          owner: creator.address,
          token: await usdc.getAddress(),
          destination: tipper.address,
          amount: tipAmount,
          expiresAt,
          nonce: authNonce,
        }
      );

      const balanceBefore = await usdc.balanceOf(tipper.address);
      await wallet
        .connect(creator)
        .withdrawWithAuthorization(await usdc.getAddress(), tipper.address, tipAmount, expiresAt, authNonce, signature);
      const balanceAfter = await usdc.balanceOf(tipper.address);
      expect(balanceAfter - balanceBefore).to.equal(ethers.parseUnits("9.5", 6));

      await expect(
        wallet.connect(creator).withdrawWithAuthorization(await usdc.getAddress(), tipper.address, 1n, expiresAt, authNonce, signature)
      ).to.be.revertedWith("ClaimWallet: nonce used");
    });

    it("should reject expired withdrawal authorizations", async function () {
      const { factory, usdc, attestSigner, tipper, creator } = await loadFixture(deployFixture);
      const authorId = 44n;
      const tipAmount = ethers.parseUnits("10", 6);
      const { walletAddr, wallet } = await deployClaimWallet(factory, attestSigner, creator, authorId);
      await usdc.mint(walletAddr, tipAmount);

      const authNonce = ethers.hexlify(ethers.randomBytes(32));
      const expiresAt = 1n;
      const signature = await signWithdrawalAuthorization(
        attestSigner,
        walletAddr,
        creator.address,
        await usdc.getAddress(),
        tipper.address,
        tipAmount,
        expiresAt,
        authNonce
      );

      await expect(
        wallet.connect(creator).withdrawWithAuthorization(await usdc.getAddress(), tipper.address, tipAmount, expiresAt, authNonce, signature)
      ).to.be.revertedWith("ClaimWallet: authorization expired");
    });

    it("should reject wrong withdrawal authorization signers", async function () {
      const { factory, usdc, attestSigner, tipper, creator, alternate } = await loadFixture(deployFixture);
      const authorId = 45n;
      const tipAmount = ethers.parseUnits("10", 6);
      const { walletAddr, wallet } = await deployClaimWallet(factory, attestSigner, creator, authorId);
      await usdc.mint(walletAddr, tipAmount);

      const authNonce = ethers.hexlify(ethers.randomBytes(32));
      const expiresAt = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 600);
      const signature = await signWithdrawalAuthorization(
        alternate,
        walletAddr,
        creator.address,
        await usdc.getAddress(),
        tipper.address,
        tipAmount,
        expiresAt,
        authNonce
      );

      await expect(
        wallet.connect(creator).withdrawWithAuthorization(await usdc.getAddress(), tipper.address, tipAmount, expiresAt, authNonce, signature)
      ).to.be.revertedWith("ClaimWallet: invalid authorization");
    });

    it("should reject withdrawal authorizations signed for a different claim wallet", async function () {
      const { factory, usdc, attestSigner, tipper, creator } = await loadFixture(deployFixture);
      const tipAmount = ethers.parseUnits("10", 6);
      const { walletAddr, wallet } = await deployClaimWallet(factory, attestSigner, creator, 46n);
      const { walletAddr: otherWalletAddr } = await deployClaimWallet(factory, attestSigner, creator, 47n);
      await usdc.mint(walletAddr, tipAmount);

      const authNonce = ethers.hexlify(ethers.randomBytes(32));
      const expiresAt = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 600);
      const signature = await signWithdrawalAuthorization(
        attestSigner,
        otherWalletAddr,
        creator.address,
        await usdc.getAddress(),
        tipper.address,
        tipAmount,
        expiresAt,
        authNonce
      );

      await expect(
        wallet.connect(creator).withdrawWithAuthorization(await usdc.getAddress(), tipper.address, tipAmount, expiresAt, authNonce, signature)
      ).to.be.revertedWith("ClaimWallet: invalid authorization");
    });

    it("should reject withdrawal authorizations when signed fields are changed", async function () {
      const { factory, usdc, attestSigner, tipper, creator, alternate } = await loadFixture(deployFixture);
      const tipAmount = ethers.parseUnits("10", 6);
      const { walletAddr, wallet } = await deployClaimWallet(factory, attestSigner, creator, 48n);
      await usdc.mint(walletAddr, ethers.parseUnits("50", 6));

      const expiresAt = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 600);
      const token = await usdc.getAddress();
      const invalidCases = [
        {
          label: "owner",
          signedOwner: alternate.address,
          signedDestination: tipper.address,
          signedAmount: tipAmount,
          callDestination: tipper.address,
          callAmount: tipAmount,
        },
        {
          label: "destination",
          signedOwner: creator.address,
          signedDestination: alternate.address,
          signedAmount: tipAmount,
          callDestination: tipper.address,
          callAmount: tipAmount,
        },
        {
          label: "amount",
          signedOwner: creator.address,
          signedDestination: tipper.address,
          signedAmount: tipAmount - 1n,
          callDestination: tipper.address,
          callAmount: tipAmount,
        },
      ];

      for (const invalidCase of invalidCases) {
        const authNonce = ethers.hexlify(ethers.randomBytes(32));
        const signature = await signWithdrawalAuthorization(
          attestSigner,
          walletAddr,
          invalidCase.signedOwner,
          token,
          invalidCase.signedDestination,
          invalidCase.signedAmount,
          expiresAt,
          authNonce
        );

        await expect(
          wallet
            .connect(creator)
            .withdrawWithAuthorization(token, invalidCase.callDestination, invalidCase.callAmount, expiresAt, authNonce, signature),
          invalidCase.label
        ).to.be.revertedWith("ClaimWallet: invalid authorization");
      }
    });

    it("should allow direct owner withdrawal without backend authorization", async function () {
      const { factory, usdc, attestSigner, creator } = await loadFixture(deployFixture);
      const authorId = 49n;
      const tipAmount = ethers.parseUnits("10", 6);
      const { walletAddr, wallet } = await deployClaimWallet(factory, attestSigner, creator, authorId);
      await usdc.mint(walletAddr, tipAmount);

      const balanceBefore = await usdc.balanceOf(creator.address);
      await wallet.connect(creator).withdrawWithFee(await usdc.getAddress(), creator.address, tipAmount);
      const balanceAfter = await usdc.balanceOf(creator.address);

      expect(balanceAfter - balanceBefore).to.equal(ethers.parseUnits("9.5", 6));
    });

    it("should keep protocol and referral fee split on authorized non-owner withdrawals", async function () {
      const { factory, usdc, referralRegistry, attestSigner, tipper, creator, referrer, deployer } =
        await loadFixture(deployFixture);
      const authorId = 50n;
      const tipAmount = ethers.parseUnits("100", 6);
      const { walletAddr, wallet } = await deployClaimWallet(factory, attestSigner, creator, authorId);
      await usdc.mint(walletAddr, tipAmount);

      const referrerNonce = ethers.hexlify(ethers.randomBytes(32));
      const referrerExpiresAt = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 600);
      const referrerSig = await signSetReferrer(
        await referralRegistry.getAddress(),
        attestSigner,
        creator.address,
        referrer.address,
        referrerExpiresAt,
        referrerNonce
      );
      await referralRegistry.setReferrer(creator.address, referrer.address, referrerExpiresAt, referrerNonce, referrerSig);

      const authNonce = ethers.hexlify(ethers.randomBytes(32));
      const expiresAt = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 600);
      const signature = await signWithdrawalAuthorization(
        attestSigner,
        walletAddr,
        creator.address,
        await usdc.getAddress(),
        tipper.address,
        tipAmount,
        expiresAt,
        authNonce
      );

      const destinationBefore = await usdc.balanceOf(tipper.address);
      const treasuryBefore = await usdc.balanceOf(deployer.address);
      const referrerBefore = await usdc.balanceOf(referrer.address);

      await wallet
        .connect(creator)
        .withdrawWithAuthorization(await usdc.getAddress(), tipper.address, tipAmount, expiresAt, authNonce, signature);

      expect((await usdc.balanceOf(tipper.address)) - destinationBefore).to.equal(ethers.parseUnits("95", 6));
      expect((await usdc.balanceOf(deployer.address)) - treasuryBefore).to.equal(ethers.parseUnits("3.5", 6));
      expect((await usdc.balanceOf(referrer.address)) - referrerBefore).to.equal(ethers.parseUnits("1.5", 6));
    });

    it("should restrict direct withdrawal signer changes to the factory", async function () {
      const { factory, attestSigner, creator, newSigner } = await loadFixture(deployFixture);
      const { wallet } = await deployClaimWallet(factory, attestSigner, creator, 51n);

      await expect(wallet.connect(creator).setWithdrawalSigner(newSigner.address)).to.be.revertedWith(
        "ClaimWallet: not factory"
      );
    });

    it("should restrict native ETH recovery to the wallet owner destination", async function () {
      const { factory, attestSigner, deployer, creator, alternate } = await loadFixture(deployFixture);
      const { walletAddr, wallet } = await deployClaimWallet(factory, attestSigner, creator, 52n);
      const ethAmount = ethers.parseEther("0.01");
      await deployer.sendTransaction({ to: walletAddr, value: ethAmount });

      await expect(
        wallet.connect(creator).withdrawETH(alternate.address, ethAmount)
      ).to.be.revertedWith("ClaimWallet: destination authorization required");

      await expect(wallet.connect(creator).withdrawETH(creator.address, ethAmount)).to.changeEtherBalances(
        [wallet, creator],
        [-ethAmount, ethAmount]
      );
    });
  });

  describe("ReferralRegistry", function () {
    it("should validate constructor fee parameters and treasury", async function () {
      const { deployer, attestSigner } = await loadFixture(deployFixture);
      const ReferralRegistry = await ethers.getContractFactory("ReferralRegistry");

      await expect(ReferralRegistry.deploy(ethers.ZeroAddress, 500, 3000, attestSigner.address)).to.be.revertedWith(
        "Registry: zero treasury"
      );
      await expect(ReferralRegistry.deploy(deployer.address, 10001, 3000, attestSigner.address)).to.be.revertedWith(
        "Registry: fee too high"
      );
      await expect(ReferralRegistry.deploy(deployer.address, 500, 10001, attestSigner.address)).to.be.revertedWith(
        "Registry: share too high"
      );
    });

    it("should let the owner adjust referral fee parameters during beta", async function () {
      const { referralRegistry } = await loadFixture(deployFixture);

      await expect(referralRegistry.setFeeBps(750)).to.emit(referralRegistry, "FeeBpsUpdated").withArgs(750);
      await expect(referralRegistry.setReferrerShareBps(4000))
        .to.emit(referralRegistry, "ReferrerShareBpsUpdated")
        .withArgs(4000);

      expect(await referralRegistry.feeBps()).to.equal(750);
      expect(await referralRegistry.referrerShareBps()).to.equal(4000);
    });

    it("should reject non-owner referral fee parameter changes", async function () {
      const { referralRegistry, tipper } = await loadFixture(deployFixture);

      await expect(referralRegistry.connect(tipper).setFeeBps(750))
        .to.be.revertedWithCustomError(referralRegistry, "OwnableUnauthorizedAccount")
        .withArgs(tipper.address);
      await expect(referralRegistry.connect(tipper).setReferrerShareBps(4000))
        .to.be.revertedWithCustomError(referralRegistry, "OwnableUnauthorizedAccount")
        .withArgs(tipper.address);
    });

    it("should cap referral fee parameters at 100%", async function () {
      const { referralRegistry } = await loadFixture(deployFixture);

      await expect(referralRegistry.setFeeBps(10001)).to.be.revertedWith("Registry: fee too high");
      await expect(referralRegistry.setReferrerShareBps(10001)).to.be.revertedWith("Registry: share too high");
    });

    it("should reject zero treasury updates", async function () {
      const { referralRegistry } = await loadFixture(deployFixture);

      await expect(referralRegistry.setTreasury(ethers.ZeroAddress)).to.be.revertedWith("Registry: zero treasury");
    });

    it("should reject expired referrer signatures", async function () {
      const { referralRegistry, attestSigner, creator, referrer } = await loadFixture(deployFixture);
      const referrerNonce = ethers.hexlify(ethers.randomBytes(32));
      const expiredAt = 1n;
      const referrerSig = await signSetReferrer(
        await referralRegistry.getAddress(),
        attestSigner,
        creator.address,
        referrer.address,
        expiredAt,
        referrerNonce
      );

      await expect(
        referralRegistry.setReferrer(creator.address, referrer.address, expiredAt, referrerNonce, referrerSig)
      ).to.be.revertedWith("Registry: signature expired");
    });
  });
});
