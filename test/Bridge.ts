import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LBTCMock, Bascule, LombardConsortium, Bridge, DefaultAdapter } from "../typechain-types";
import { takeSnapshot, SnapshotRestorer } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { getSignersWithPrivateKeys, deployContract, CHAIN_ID, getPayloadForAction, signPayload } from "./helpers";
import { ethers } from "hardhat";
import { expect } from "chai";

describe("Bridge", function () {
  let deployer: HardhatEthersSigner,
    signer1: HardhatEthersSigner,
    signer2: HardhatEthersSigner,
    signer3: HardhatEthersSigner,
    treasury: HardhatEthersSigner,
    reporter: HardhatEthersSigner,
    admin: HardhatEthersSigner,
    pauser: HardhatEthersSigner;
  let lbtc1: LBTCMock;
  let lbtc2: LBTCMock;
  let consortium: LombardConsortium;
  let bascule: Bascule;
  let bridge1: Bridge;
  let bridge2: Bridge;
  let adapter1: DefaultAdapter;
  let adapter2: DefaultAdapter;
  let snapshot: SnapshotRestorer;
  let snapshotTimestamp: number;

  before(async function () {
    [
      deployer,
      signer1,
      signer2,
      signer3,
      treasury,
      admin,
      pauser,
      reporter,
    ] = await getSignersWithPrivateKeys();

    // for both chains
    consortium = await deployContract<LombardConsortium>("LombardConsortium", [deployer.address]);
    await consortium.setInitalValidatorSet([signer1.publicKey], [1], 1, 1);

    // chain 1
    lbtc1 = await deployContract<LBTCMock>("LBTCMock", [await consortium.getAddress(), 100, deployer.address]);
    adapter1 = await deployContract<DefaultAdapter>("DefaultAdapter", [await lbtc1.getAddress(), deployer.address], false);
    bridge1 = await deployContract<Bridge>("Bridge", [await lbtc1.getAddress(), treasury.address, await adapter1.getAddress()]);
    bascule = await deployContract<Bascule>("Bascule", [admin.address, pauser.address, reporter.address, await lbtc1.getAddress(), 100], false);
    await adapter1.changeBridge(await bridge1.getAddress());
    await lbtc1.changeBridge(await bridge1.getAddress());
    
    // chain 2
    lbtc2 = await deployContract<LBTCMock>("LBTCMock", [await consortium.getAddress(), 100, deployer.address]);
    adapter2 = await deployContract<DefaultAdapter>("DefaultAdapter", [await lbtc2.getAddress(), deployer.address], false);
    bridge2 = await deployContract<Bridge>("Bridge", [await lbtc2.getAddress(), treasury.address,  await adapter2.getAddress()]);
    await adapter2.changeBridge(await bridge2.getAddress());
    await lbtc2.changeBridge(await bridge2.getAddress());


    await lbtc1.changeTreasuryAddress(treasury.address);
    await lbtc2.changeTreasuryAddress(treasury.address);

    snapshot = await takeSnapshot();
    snapshotTimestamp = (await ethers.provider.getBlock("latest"))!.timestamp;
  })

  afterEach(async function () {
    await snapshot.restore();
  })

  describe("Setters and Getters", () => {
    it("should return owner", async function () {
      expect(await bridge1.owner()).to.equal(deployer.address);
    });

    it("getDepositRelativeCommission", async function () {
      expect(
        await bridge1.getDepositRelativeCommission(ethers.zeroPadValue("0x", 32))
      ).to.equal(0);
    });

    it("getDepositAbsoluteCommission", async function () {
      expect(
        await bridge1.getDepositAbsoluteCommission(ethers.zeroPadValue("0x", 32))
      ).to.equal(0);
    });
  })

  describe("Actions/Flows", function () {
    const absoluteFee = 100n;

    beforeEach(async function () {
      await lbtc1.mintTo(
        signer1.address,
        10000n
      );
      await bridge1.addDestination(
        CHAIN_ID,
        ethers.zeroPadValue(await bridge2.getAddress(), 32),
        1000,
        0
      );
      await bridge2.addDestination(
        CHAIN_ID,
        ethers.zeroPadValue(await bridge1.getAddress(), 32),
        1,
        absoluteFee
      );
    });

    it("full flow", async () => {
      let amount = 10000n;
      let fee = amount / 10n;

      let amountWithoutFee = amount - fee;
      let receiver = signer2.address;

      let payload = getPayloadForAction([
        CHAIN_ID,
        await bridge1.getAddress(),
        CHAIN_ID,
        await bridge2.getAddress(),
        receiver,
        amountWithoutFee,
        ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
      ], "burn");

      await lbtc1.connect(signer1).approve(await bridge1.getAddress(), amount);
      await expect(bridge1.connect(signer1).deposit(
        CHAIN_ID,
        ethers.zeroPadValue(receiver, 32),
        amount
      ))
        .to.emit(bridge1, "DepositToBridge")
        .withArgs(
          signer1.address,
          ethers.zeroPadValue(receiver, 32),
          ethers.sha256(payload),
          payload
        );

      expect(await lbtc1.balanceOf(signer1.address)).to.be.equal(0);
      expect(await lbtc1.balanceOf(treasury.address)).to.be.equal(fee);
      expect((await lbtc1.totalSupply()).toString()).to.be.equal(fee);
      
      expect(await lbtc2.balanceOf(signer2.address)).to.be.equal(0);
      expect(await lbtc2.totalSupply()).to.be.equal(0);

      const data1 = await signPayload(
        [signer1],
        [true],
        [
          CHAIN_ID,
          await bridge1.getAddress(),
          CHAIN_ID,
          await bridge2.getAddress(),
          receiver,
          amountWithoutFee,
          ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
        ],
        CHAIN_ID,
        await lbtc2.getAddress(),
        await consortium.getAddress(),
        1,
        "burn"
      );

      await expect(bridge2.connect(signer2).withdraw(data1.payload, data1.proof))
        .to.emit(lbtc2, "WithdrawFromBridge")
        .withArgs(
          receiver,
          ethers.sha256(data1.payload),
          data1.payload
        );
      expect((await lbtc2.totalSupply()).toString()).to.be.equal(amount - fee);
      expect((await lbtc2.balanceOf(signer2.address)).toString()).to.be.equal(
        amountWithoutFee
      );

      // bridge back

      amount = amountWithoutFee;

      fee = 1n + absoluteFee;
      amountWithoutFee = amount - fee;

      payload = getPayloadForAction([
        CHAIN_ID,
        await bridge2.getAddress(),
        CHAIN_ID,
        await bridge1.getAddress(),
        receiver,
        amountWithoutFee,
        ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
      ], "burn");

      await lbtc2.connect(signer2).approve(await bridge2.getAddress(), amount);
      await expect(bridge2.connect(signer2).deposit(
        CHAIN_ID,
        ethers.zeroPadValue(receiver, 32),
        amount
      ))
        .to.emit(bridge2, "DepositToBridge")
        .withArgs(
          signer2.address,
          ethers.zeroPadValue(receiver, 32),
          ethers.sha256(payload),
          payload
        );

      expect(await lbtc2.balanceOf(signer2.address)).to.be.equal(0);
      expect(await lbtc2.balanceOf(treasury.address)).to.be.equal(fee);
      expect(await lbtc2.totalSupply()).to.be.equal(fee);

      const data2 = await signPayload(
        [signer1],
        [true],
        [
          CHAIN_ID,
          await bridge2.getAddress(),
          CHAIN_ID,
          await bridge1.getAddress(),
          receiver,
          amountWithoutFee,
          ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
        ],
        CHAIN_ID,
        await lbtc1.getAddress(),
        await consortium.getAddress(),
        1,
        "burn"
      );

      await expect(bridge1.connect(signer2).withdraw(data2.payload, data2.proof))
        .to.emit(lbtc1, "WithdrawFromBridge")
        .withArgs(
          receiver,
          ethers.sha256(data2.payload),
          data2.payload
        );
    });

    it("withdraw (with Bascule)", async () => {
      // Enable Bascule
      await lbtc1.changeBascule(await bascule.getAddress());

      // Use the 2nd half of the full flow test to test the Bascule integration
      let amount = 10000n;;
      let receiver = signer3.address;

      const data = await signPayload(
        [signer1],
        [true],
        [
          CHAIN_ID,
          await bridge2.getAddress(),
          CHAIN_ID,
          await bridge1.getAddress(),
          receiver,
          amount,
          ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
        ],
        CHAIN_ID,
        await lbtc1.getAddress(),
        await consortium.getAddress(),
        1,
        "burn"
      );

      // withdraw without report fails
      await expect(bridge1.connect(signer2).withdraw(data.payload, data.proof))
        .to.be.revertedWithCustomError(bascule, "WithdrawalFailedValidation")
        .withArgs(ethers.sha256(data.proof), amount);

      // report deposit
      const reportId = ethers.zeroPadValue("0x01", 32);
      await bascule.connect(reporter).reportDeposits(reportId, [ethers.sha256(data.proof)]);

      // withdraw works
      await expect(
        bridge1.connect(signer2).withdraw(data.payload, data.proof)
      )
        .to.emit(lbtc1, "WithdrawFromBridge")
        .withArgs(
          receiver,
          ethers.sha256(data.payload),
          data.payload
        );
    });
  });

})
