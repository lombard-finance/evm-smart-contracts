import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { 
  LBTCMock, 
  Bascule, 
  LombardConsortium, 
  Bridge, 
  DefaultAdapter, 
  TokenPoolAdapter,
  CCIPRouterMock,
} from "../typechain-types";
import { takeSnapshot, SnapshotRestorer } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { getSignersWithPrivateKeys, deployContract, CHAIN_ID, getPayloadForAction, signPayload } from "./helpers";
import { ethers } from "hardhat";
import { expect } from "chai";
import { LBTCTokenPool } from "../typechain-types/contracts/bridge/adapters/TokenPool.sol";

describe("Bridge", function () {
  let deployer: HardhatEthersSigner,
    signer1: HardhatEthersSigner,
    signer2: HardhatEthersSigner,
    signer3: HardhatEthersSigner,
    treasury: HardhatEthersSigner,
    reporter: HardhatEthersSigner,
    admin: HardhatEthersSigner,
    pauser: HardhatEthersSigner;
  let lbtcSource: LBTCMock;
  let lbtcDestination: LBTCMock;
  let consortium: LombardConsortium;
  let bascule: Bascule;
  let bridgeSource: Bridge;
  let bridgeDestination: Bridge;
  let adapterSource: DefaultAdapter;
  let adapterDestination: DefaultAdapter;
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
    lbtcSource = await deployContract<LBTCMock>("LBTCMock", [await consortium.getAddress(), 100, deployer.address]);
    adapterSource = await deployContract<DefaultAdapter>("DefaultAdapter", [await lbtcSource.getAddress(), deployer.address], false);
    bridgeSource = await deployContract<Bridge>("Bridge", [await lbtcSource.getAddress(), treasury.address, await adapterSource.getAddress()]);
    bascule = await deployContract<Bascule>("Bascule", [admin.address, pauser.address, reporter.address, await lbtcSource.getAddress(), 100], false);
    await adapterSource.changeBridge(await bridgeSource.getAddress());
    await lbtcSource.changeBridge(await bridgeSource.getAddress());
    
    // chain 2
    lbtcDestination = await deployContract<LBTCMock>("LBTCMock", [await consortium.getAddress(), 100, deployer.address]);
    adapterDestination = await deployContract<DefaultAdapter>("DefaultAdapter", [await lbtcDestination.getAddress(), deployer.address], false);
    bridgeDestination = await deployContract<Bridge>("Bridge", [await lbtcDestination.getAddress(), treasury.address,  await adapterDestination.getAddress()]);
    await adapterDestination.changeBridge(await bridgeDestination.getAddress());
    await lbtcDestination.changeBridge(await bridgeDestination.getAddress());


    await lbtcSource.changeTreasuryAddress(treasury.address);
    await lbtcDestination.changeTreasuryAddress(treasury.address);

    snapshot = await takeSnapshot();
    snapshotTimestamp = (await ethers.provider.getBlock("latest"))!.timestamp;
  })

  afterEach(async function () {
    await snapshot.restore();
  })

  describe("Setters and Getters", () => {
    it("should return owner", async function () {
      expect(await bridgeSource.owner()).to.equal(deployer.address);
    });

    it("getDepositRelativeCommission", async function () {
      expect(
        await bridgeSource.getDepositRelativeCommission(ethers.zeroPadValue("0x", 32))
      ).to.equal(0);
    });

    it("getDepositAbsoluteCommission", async function () {
      expect(
        await bridgeSource.getDepositAbsoluteCommission(ethers.zeroPadValue("0x", 32))
      ).to.equal(0);
    });
  })

  describe("Actions/Flows", function () {
    const absoluteFee = 100n;

    beforeEach(async function () {
      await lbtcSource.mintTo(
        signer1.address,
        10000n
      );
      await bridgeSource.addDestination(
        CHAIN_ID,
        ethers.zeroPadValue(await bridgeDestination.getAddress(), 32),
        1000,
        0
      );
      await bridgeDestination.addDestination(
        CHAIN_ID,
        ethers.zeroPadValue(await bridgeSource.getAddress(), 32),
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
        await bridgeSource.getAddress(),
        CHAIN_ID,
        await bridgeDestination.getAddress(),
        receiver,
        amountWithoutFee,
        ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
      ], "burn");

      await lbtcSource.connect(signer1).approve(await bridgeSource.getAddress(), amount);
      await expect(bridgeSource.connect(signer1).deposit(
        CHAIN_ID,
        ethers.zeroPadValue(receiver, 32),
        amount
      ))
        .to.emit(bridgeSource, "DepositToBridge")
        .withArgs(
          signer1.address,
          ethers.zeroPadValue(receiver, 32),
          ethers.sha256(payload),
          payload
        );

      expect(await lbtcSource.balanceOf(signer1.address)).to.be.equal(0);
      expect(await lbtcSource.balanceOf(treasury.address)).to.be.equal(fee);
      expect((await lbtcSource.totalSupply()).toString()).to.be.equal(fee);
      
      expect(await lbtcDestination.balanceOf(signer2.address)).to.be.equal(0);
      expect(await lbtcDestination.totalSupply()).to.be.equal(0);

      const data1 = await signPayload(
        [signer1],
        [true],
        [
          CHAIN_ID,
          await bridgeSource.getAddress(),
          CHAIN_ID,
          await bridgeDestination.getAddress(),
          receiver,
          amountWithoutFee,
          ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
        ],
        CHAIN_ID,
        await lbtcDestination.getAddress(),
        await consortium.getAddress(),
        1,
        "burn"
      );

      await expect(bridgeDestination.connect(signer2).withdraw(data1.payload, data1.proof))
        .to.emit(lbtcDestination, "WithdrawFromBridge")
        .withArgs(
          receiver,
          ethers.sha256(data1.payload),
          data1.payload
        );
      expect((await lbtcDestination.totalSupply()).toString()).to.be.equal(amount - fee);
      expect((await lbtcDestination.balanceOf(signer2.address)).toString()).to.be.equal(
        amountWithoutFee
      );

      // bridge back

      amount = amountWithoutFee;

      fee = 1n + absoluteFee;
      amountWithoutFee = amount - fee;

      payload = getPayloadForAction([
        CHAIN_ID,
        await bridgeDestination.getAddress(),
        CHAIN_ID,
        await bridgeSource.getAddress(),
        receiver,
        amountWithoutFee,
        ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
      ], "burn");

      await lbtcDestination.connect(signer2).approve(await bridgeDestination.getAddress(), amount);
      await expect(bridgeDestination.connect(signer2).deposit(
        CHAIN_ID,
        ethers.zeroPadValue(receiver, 32),
        amount
      ))
        .to.emit(bridgeDestination, "DepositToBridge")
        .withArgs(
          signer2.address,
          ethers.zeroPadValue(receiver, 32),
          ethers.sha256(payload),
          payload
        );

      expect(await lbtcDestination.balanceOf(signer2.address)).to.be.equal(0);
      expect(await lbtcDestination.balanceOf(treasury.address)).to.be.equal(fee);
      expect(await lbtcDestination.totalSupply()).to.be.equal(fee);

      const data2 = await signPayload(
        [signer1],
        [true],
        [
          CHAIN_ID,
          await bridgeDestination.getAddress(),
          CHAIN_ID,
          await bridgeSource.getAddress(),
          receiver,
          amountWithoutFee,
          ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
        ],
        CHAIN_ID,
        await lbtcSource.getAddress(),
        await consortium.getAddress(),
        1,
        "burn"
      );

      await expect(bridgeSource.connect(signer2).withdraw(data2.payload, data2.proof))
        .to.emit(lbtcSource, "WithdrawFromBridge")
        .withArgs(
          receiver,
          ethers.sha256(data2.payload),
          data2.payload
        );
    });

    it("withdraw (with Bascule)", async () => {
      // Enable Bascule
      await lbtcSource.changeBascule(await bascule.getAddress());

      // Use the 2nd half of the full flow test to test the Bascule integration
      let amount = 10000n;;
      let receiver = signer3.address;

      const data = await signPayload(
        [signer1],
        [true],
        [
          CHAIN_ID,
          await bridgeDestination.getAddress(),
          CHAIN_ID,
          await bridgeSource.getAddress(),
          receiver,
          amount,
          ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
        ],
        CHAIN_ID,
        await lbtcSource.getAddress(),
        await consortium.getAddress(),
        1,
        "burn"
      );

      // withdraw without report fails
      await expect(bridgeSource.connect(signer2).withdraw(data.payload, data.proof))
        .to.be.revertedWithCustomError(bascule, "WithdrawalFailedValidation")
        .withArgs(ethers.sha256(data.proof), amount);

      // report deposit
      const reportId = ethers.zeroPadValue("0x01", 32);
      await bascule.connect(reporter).reportDeposits(reportId, [ethers.sha256(data.proof)]);

      // withdraw works
      await expect(
        bridgeSource.connect(signer2).withdraw(data.payload, data.proof)
      )
        .to.emit(lbtcSource, "WithdrawFromBridge")
        .withArgs(
          receiver,
          ethers.sha256(data.payload),
          data.payload
        );
    });

    describe("With Chainlink Adapter", function () {
      let routerSource: CCIPRouterMock;
      let routerDestination: CCIPRouterMock;
      let chainlinkAdapterSource: TokenPoolAdapter;
      let chainlinkAdapterDestination: TokenPoolAdapter;
      let tokenPoolSource: LBTCTokenPool;
      let tokenPoolDestination: LBTCTokenPool;
  
      beforeEach(async function () {
        /// configure source
        routerSource = await deployContract<CCIPRouterMock>("CCIPRouterMock", [], false);
        chainlinkAdapterSource = await deployContract<TokenPoolAdapter>("TokenPoolAdapter", 
          [await routerSource.getAddress(), await lbtcSource.getAddress(), deployer.address], 
          false
        );
        tokenPoolSource = await deployContract<LBTCTokenPool>("LBTCTokenPool", [
          await chainlinkAdapterSource.getAddress(), 
          await lbtcSource.getAddress(), 
          [], // no allowlist
          await routerSource.getAddress(), // will do work of rmn as well
          await routerSource.getAddress()
        ], false);
        await chainlinkAdapterSource.setTokenPool(await tokenPoolSource.getAddress());
        await chainlinkAdapterSource.changeBridge(await bridgeSource.getAddress());
  
        /// configure destination 
        routerDestination = await deployContract<CCIPRouterMock>("CCIPRouterMock", [], false);
        chainlinkAdapterDestination = await deployContract<TokenPoolAdapter>("TokenPoolAdapter", 
          [await routerDestination.getAddress(), await lbtcDestination.getAddress(), deployer.address], 
          false
        );
        tokenPoolDestination = await deployContract<LBTCTokenPool>("LBTCTokenPool", [
          await chainlinkAdapterDestination.getAddress(), 
          await lbtcDestination.getAddress(), 
          [], // no allowlist
          await routerDestination.getAddress(), // will do work of rmn as well
          await routerDestination.getAddress()
        ], false);
        await chainlinkAdapterDestination.setTokenPool(await tokenPoolDestination.getAddress());
        await chainlinkAdapterDestination.changeBridge(await bridgeDestination.getAddress());
  
        /// configure bridges
        await bridgeSource.changeAdapter(await chainlinkAdapterSource.getAddress());
        await bridgeDestination.changeAdapter(await chainlinkAdapterDestination.getAddress());


        /// configure router
        await routerSource.setTokenPool(await tokenPoolSource.getAddress());
        await routerDestination.setTokenPool(await tokenPoolDestination.getAddress());
        await routerSource.setDestinationRouter(await routerDestination.getAddress());
        await routerDestination.setDestinationRouter(await routerSource.getAddress());
        
        /// set token pools
        await tokenPoolSource.applyChainUpdates([{
          remoteChainSelector: CHAIN_ID,
          allowed: true,
          remotePoolAddress: await tokenPoolDestination.getAddress(),
          remoteTokenAddress: await lbtcDestination.getAddress(),
          inboundRateLimiterConfig: {
            isEnabled: false, 
            rate: 0, 
            capacity: 0
          },
          outboundRateLimiterConfig: {
            isEnabled: false, 
            rate: 0, 
            capacity: 0
          }
        }]);

        await tokenPoolDestination.applyChainUpdates([{
          remoteChainSelector: CHAIN_ID,
          allowed: true,
          remotePoolAddress: await tokenPoolSource.getAddress(),
          remoteTokenAddress: await lbtcSource.getAddress(),
          inboundRateLimiterConfig: {
            isEnabled: false, 
            rate: 0, 
            capacity: 0
          },
          outboundRateLimiterConfig: {
            isEnabled: false, 
            rate: 0, 
            capacity: 0
          }
        }]);

        await tokenPoolSource.setRemotePool(CHAIN_ID, ethers.zeroPadValue(await tokenPoolDestination.getAddress(), 32));
        await tokenPoolDestination.setRemotePool(CHAIN_ID, ethers.zeroPadValue(await tokenPoolSource.getAddress(), 32));
      })
  
      it("should route message", async function () {
        let amount = 10000n;
        let fee = amount / 10n;

        let amountWithoutFee = amount - fee;
        let receiver = signer2.address;

        let data = await signPayload(
          [signer1],  
          [true],
          [
            CHAIN_ID,
            await bridgeSource.getAddress(),
            CHAIN_ID,
            await bridgeDestination.getAddress(),
            receiver,
            amountWithoutFee,
            ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
          ], 
          CHAIN_ID,
          await lbtcDestination.getAddress(),
          await consortium.getAddress(),
          1,
          "burn"
        );

        routerSource.setOffchainData(data.payload, data.proof);

        await lbtcSource.connect(signer1).approve(await bridgeSource.getAddress(), amount);
        await expect(bridgeSource.connect(signer1).deposit(
          CHAIN_ID,
          ethers.zeroPadValue(receiver, 32),
          amount
        ))
          .to.emit(bridgeSource, "DepositToBridge")
          .withArgs(
            signer1.address,
            ethers.zeroPadValue(receiver, 32),
            ethers.sha256(data.payload),
            data.payload
          );
      })
    })
  });

  
})
