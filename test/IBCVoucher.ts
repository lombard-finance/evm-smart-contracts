import { ethers } from "hardhat";
import { expect } from "chai";
import { takeSnapshot } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployContract, init, Signer } from "./helpers";
import { IBCVoucher, LBTCMock } from "../typechain-types";
import { SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot";

describe("IBCVoucher", function () {
  this.timeout(15_000);

  let deployer: Signer,
    signer1: Signer,
    signer2: Signer,
    admin: Signer,
    relayer: Signer,
    operator: Signer,
    pauser: Signer,
    treasury: Signer;
  let ibcVoucher: IBCVoucher;
  let lbtc: LBTCMock;
  let snapshot: SnapshotRestorer;
  const fee = 10;
  const amount = 100;

  before(async function () {
    [deployer, signer1, signer2, admin, relayer, operator, pauser, treasury] = await ethers.getSigners();

    const burnCommission = 1000;
    const result = await init(burnCommission, treasury.address, admin.address);
    lbtc = result.lbtc;

    ibcVoucher = await deployContract<IBCVoucher>("IBCVoucher", [
      await lbtc.getAddress(),
      admin.address,
      fee,
      treasury.address,
    ]);

    // set deployer as minter
    await lbtc.connect(admin).addMinter(admin.address);
    // IBC Voucher needs to be minter
    await lbtc.connect(admin).addMinter(await ibcVoucher.getAddress());

    // Initialize the permit module
    await lbtc.connect(admin).reinitialize();
    await ibcVoucher.connect(admin).grantRole(await ibcVoucher.RELAYER_ROLE(), relayer.address);
    await ibcVoucher.connect(admin).grantRole(await ibcVoucher.OPERATOR_ROLE(), operator.address);
    await ibcVoucher.connect(admin).grantRole(await ibcVoucher.PAUSER_ROLE(), pauser.address);

    snapshot = await takeSnapshot();
  });

  describe("Setters", function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it("Name", async function () {
      expect(await ibcVoucher.name()).to.be.eq("IBC compatible LBTC Voucher");
    });

    it("Symbol", async function () {
      expect(await ibcVoucher.symbol()).to.be.eq("iLBTCv");
    });

    it("Decimals", async function () {
      expect(await ibcVoucher.decimals()).to.be.eq(8n);
    });

    it("should allow admin to set treasury", async function () {
      await expect(ibcVoucher.connect(admin).setTreasuryAddress(signer1.address))
        .to.emit(ibcVoucher, "TreasuryUpdated")
        .withArgs(signer1.address);
      expect(await ibcVoucher.getTreasury()).to.be.eq(signer1.address);
    });

    it("should not allow anyone else to set treasury", async function () {
      await expect(ibcVoucher.connect(signer1).setTreasuryAddress(signer1.address)).to.be.revertedWithCustomError(
        ibcVoucher,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should allow admin to set fee", async function () {
      await expect(ibcVoucher.connect(admin).setFee(200)).to.emit(ibcVoucher, "FeeUpdated").withArgs(200);
      expect(await ibcVoucher.getFee()).to.be.eq(200);
    });

    it("should not allow anyone else to set fee", async function () {
      await expect(ibcVoucher.connect(signer1).setFee(200)).to.be.revertedWithCustomError(
        ibcVoucher,
        "AccessControlUnauthorizedAccount",
      );
    });
  });

  describe("Wrapping", function () {
    beforeEach(async function () {
      await snapshot.restore();
      await lbtc.connect(admin)["mint(address, uint256)"](relayer.address, amount);
      await lbtc.connect(relayer).approve(await ibcVoucher.getAddress(), amount);
    });

    it("should allow a relayer to wrap LBTC", async function () {
      await expect(ibcVoucher.connect(relayer).wrap(amount))
        .to.emit(lbtc, "Transfer")
        .withArgs(relayer.address, await ibcVoucher.getAddress(), amount)
        .to.emit(lbtc, "Transfer")
        .withArgs(await ibcVoucher.getAddress(), treasury.address, fee)
        .to.emit(lbtc, "Transfer")
        .withArgs(await ibcVoucher.getAddress(), ethers.ZeroAddress, amount - fee)
        .to.emit(ibcVoucher, "Transfer")
        .withArgs(ethers.ZeroAddress, relayer.address, amount - fee)
        .to.emit(ibcVoucher, "VoucherMinted")
        .withArgs(relayer.address, relayer.address, fee, amount - fee);

      expect(await lbtc.balanceOf(relayer.address)).to.be.equal(0);
      expect(await lbtc.balanceOf(treasury.address)).to.be.equal(fee);
      expect(await ibcVoucher.balanceOf(relayer.address)).to.be.equal(amount - fee);
      expect(await ibcVoucher.totalSupply()).to.be.eq(amount - fee);
    });

    it("should allow a relayer to wrap LBTC to a given address", async function () {
      await expect(ibcVoucher.connect(relayer).wrapTo(signer1.address, amount))
        .to.emit(lbtc, "Transfer")
        .withArgs(relayer.address, await ibcVoucher.getAddress(), amount)
        .to.emit(lbtc, "Transfer")
        .withArgs(await ibcVoucher.getAddress(), treasury.address, fee)
        .to.emit(lbtc, "Transfer")
        .withArgs(await ibcVoucher.getAddress(), ethers.ZeroAddress, amount - fee)
        .to.emit(ibcVoucher, "Transfer")
        .withArgs(ethers.ZeroAddress, signer1.address, amount - fee)
        .to.emit(ibcVoucher, "VoucherMinted")
        .withArgs(relayer.address, signer1.address, fee, amount - fee);

      expect(await lbtc.balanceOf(relayer.address)).to.be.equal(0);
      expect(await lbtc.balanceOf(treasury.address)).to.be.equal(fee);
      expect(await ibcVoucher.balanceOf(signer1.address)).to.be.equal(amount - fee);
      expect(await ibcVoucher.totalSupply()).to.be.eq(amount - fee);
    });

    it("should not allow to wrap with amount equal to or below fee amount", async function () {
      await expect(ibcVoucher.connect(relayer).wrap(fee)).to.be.revertedWithCustomError(ibcVoucher, "AmountTooLow");
    });

    it("should not allow to wrapTo with amount equal to or below fee amount", async function () {
      await expect(ibcVoucher.connect(relayer).wrapTo(signer1.address, fee)).to.be.revertedWithCustomError(
        ibcVoucher,
        "AmountTooLow",
      );
    });
  });

  describe("Spending", function () {
    beforeEach(async function () {
      await snapshot.restore();
      await lbtc.connect(admin)["mint(address, uint256)"](relayer.address, amount + fee);
      await lbtc.connect(relayer).approve(await ibcVoucher.getAddress(), amount + fee);
      await ibcVoucher.connect(relayer).wrapTo(signer1.address, amount + fee);
    });

    it("should allow anyone to spend voucher", async function () {
      await expect(ibcVoucher.connect(signer1).spend(amount))
        .to.emit(ibcVoucher, "Transfer")
        .withArgs(signer1.address, ethers.ZeroAddress, amount)
        .to.emit(lbtc, "Transfer")
        .withArgs(ethers.ZeroAddress, signer1.address, amount)
        .to.emit(ibcVoucher, "VoucherSpent")
        .withArgs(signer1.address, signer1.address, amount);

      expect(await lbtc.balanceOf(signer1.address)).to.be.equal(amount);
      expect(await ibcVoucher.balanceOf(signer1.address)).to.be.equal(0);
      expect(await ibcVoucher.totalSupply()).to.be.eq(0);
    });

    it("should allow anyone to spend voucher to a given address", async function () {
      await expect(ibcVoucher.connect(signer1).spendTo(signer2.address, amount))
        .to.emit(ibcVoucher, "Transfer")
        .withArgs(signer1.address, ethers.ZeroAddress, amount)
        .to.emit(lbtc, "Transfer")
        .withArgs(ethers.ZeroAddress, signer2.address, amount)
        .to.emit(ibcVoucher, "VoucherSpent")
        .withArgs(signer1.address, signer2.address, amount);

      expect(await lbtc.balanceOf(signer2.address)).to.be.equal(amount);
      expect(await ibcVoucher.balanceOf(signer1.address)).to.be.equal(0);
      expect(await ibcVoucher.totalSupply()).to.be.eq(0);
    });

    it("should allow operator to spendFrom voucher", async function () {
      await expect(ibcVoucher.connect(operator).spendFrom(signer1.address, amount))
        .to.emit(ibcVoucher, "Transfer")
        .withArgs(signer1.address, ethers.ZeroAddress, amount)
        .to.emit(lbtc, "Transfer")
        .withArgs(ethers.ZeroAddress, signer1.address, amount)
        .to.emit(ibcVoucher, "VoucherSpent")
        .withArgs(signer1.address, signer1.address, amount);

      expect(await lbtc.balanceOf(signer1.address)).to.be.equal(amount);
      expect(await ibcVoucher.balanceOf(signer1.address)).to.be.equal(0);
    });

    it("should allow operator to spendFromTo voucher", async function () {
      await expect(ibcVoucher.connect(operator).spendFromTo(signer1.address, signer2.address, amount))
        .to.emit(ibcVoucher, "Transfer")
        .withArgs(signer1.address, ethers.ZeroAddress, amount)
        .to.emit(lbtc, "Transfer")
        .withArgs(ethers.ZeroAddress, signer2.address, amount)
        .to.emit(ibcVoucher, "VoucherSpent")
        .withArgs(signer1.address, signer2.address, amount);

      expect(await lbtc.balanceOf(signer2.address)).to.be.equal(amount);
      expect(await ibcVoucher.balanceOf(signer1.address)).to.be.equal(0);
    });
  });

  describe("Access control", function () {
    beforeEach(async function () {
      await snapshot.restore();
      await lbtc.connect(admin)["mint(address, uint256)"](relayer.address, amount + fee);
      await lbtc.connect(admin)["mint(address, uint256)"](signer1.address, amount);
      await lbtc.connect(relayer).approve(await ibcVoucher.getAddress(), amount + fee);
      await ibcVoucher.connect(relayer).wrapTo(signer1.address, amount + fee);

      expect(await lbtc.balanceOf(signer1.address)).to.be.equal(amount);
      expect(await ibcVoucher.balanceOf(signer1.address)).to.be.equal(amount);
    });

    it("should not allow just anyone to wrap LBTC", async function () {
      await expect(ibcVoucher.connect(signer1).wrap(amount)).to.be.revertedWithCustomError(
        ibcVoucher,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should not allow just anyone to wrap LBTC to a given address", async function () {
      await expect(ibcVoucher.connect(signer1).wrapTo(signer2.address, amount)).to.be.revertedWithCustomError(
        ibcVoucher,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should not allow just anyone to spendFrom LBTC", async function () {
      await expect(ibcVoucher.connect(signer1).spendFrom(signer1.address, amount)).to.be.revertedWithCustomError(
        ibcVoucher,
        "AccessControlUnauthorizedAccount",
      );
    });

    it("should not allow just anyone to spendFromTo LBTC", async function () {
      await expect(
        ibcVoucher.connect(signer1).spendFromTo(signer1.address, signer2.address, amount),
      ).to.be.revertedWithCustomError(ibcVoucher, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Pausing", function () {
    before(async function () {
      await lbtc.connect(admin)["mint(address, uint256)"](relayer.address, amount);
      await lbtc.connect(relayer).approve(await ibcVoucher.getAddress(), amount);
    });

    it("pauser can pause", async function () {
      await expect(ibcVoucher.connect(pauser).pause()).to.emit(ibcVoucher, "Paused").withArgs(pauser.address);
      expect(await ibcVoucher.paused()).to.be.true;
    });

    it("should disallow `wrap` when paused", async function () {
      await expect(ibcVoucher.connect(relayer).wrap(amount)).to.be.revertedWithCustomError(ibcVoucher, "EnforcedPause");
    });

    it("should disallow `wrapTo` when paused", async function () {
      await expect(ibcVoucher.connect(relayer).wrapTo(signer1.address, amount)).to.be.revertedWithCustomError(
        ibcVoucher,
        "EnforcedPause",
      );
    });

    it("should disallow `spend` when paused", async function () {
      await expect(ibcVoucher.spend(amount)).to.be.revertedWithCustomError(ibcVoucher, "EnforcedPause");
    });

    it("should disallow `spendTo` when paused", async function () {
      await expect(ibcVoucher.spendTo(signer1.address, amount)).to.be.revertedWithCustomError(
        ibcVoucher,
        "EnforcedPause",
      );
    });

    it("pauser can not unpause", async function () {
      await expect(ibcVoucher.connect(pauser).unpause()).to.be.rejectedWith("AccessControlUnauthorizedAccount");
    });

    it("admin can unpause", async function () {
      await expect(ibcVoucher.connect(admin).unpause()).to.emit(ibcVoucher, "Unpaused").withArgs(admin.address);
      expect(await ibcVoucher.paused()).to.be.false;

      await ibcVoucher.connect(relayer).wrap(amount);
    });
  });
});
