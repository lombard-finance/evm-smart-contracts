import { config, ethers } from "hardhat";
import { expect } from "chai";
import { takeSnapshot } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  deployContract,
  signPayload,
  getSignersWithPrivateKeys,
  getPayloadForAction,
  CHAIN_ID,
  NEW_VALSET, ACTIONS, DEPOSIT_BRIDGE_ACTION, signDepositBridgePayload, encode, signNewValSetPayload
} from "./helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { Consortium } from "../typechain-types";
import { SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot";

describe("Consortium", function () {
  let deployer: HardhatEthersSigner,
    signer1: HardhatEthersSigner,
    signer2: HardhatEthersSigner,
    signer3: HardhatEthersSigner;
  let lombard: Consortium;
  let snapshot: SnapshotRestorer;

  before(async function () {
    [deployer, signer1, signer2, signer3] = await getSignersWithPrivateKeys();
    lombard = await deployContract<Consortium>("Consortium", [
      deployer.address,
    ]);
    snapshot = await takeSnapshot();
  });

  afterEach(async function () {
    await snapshot.restore();
  });

  describe("Setters and getters", function () {
    it("should set the correct owner", async function () {
      expect(await lombard.owner()).to.equal(deployer.address);
    });
  });

  it("should revert if not validator set is set", async function () {
    // Empty proof should bypass check if not properly handled
    // Message is not relevant for this test
    await expect(lombard.checkProof(ethers.randomBytes(32), "0x")) 
      .to.be.revertedWithCustomError(lombard, "NoValidatorSet");
  })

  describe("With Initial ValidatorSet", function () {
    beforeEach(async function () {
      const initialValset = getPayloadForAction([
        10,
          [signer3.publicKey, signer1.publicKey, signer2.publicKey],
        [1, 1, 1],
        2,
        1
      ], NEW_VALSET)

      await lombard.setInitalValidatorSet(initialValset);
    })

    it("should set the correct threshold", async function () {
      const validatorSet = await lombard.getValidatoSet(10);
      expect(validatorSet.weightThreshold).to.equal(2);
      expect(validatorSet.weights).to.deep.equal([1, 1, 1]);
      expect(validatorSet.validators).to.deep.equal([signer3.address, signer1.address, signer2.address]);
    });

    it("should set the correct epoch", async function () {
      expect(await lombard.curEpoch()).to.equal(10);
    });

    it("should set the new consortium correctly", async function () {
      const data = await signNewValSetPayload(
        [signer3, signer1, signer2],
        [true, true, false],
        11,
        [signer1.publicKey, signer2.publicKey],
        [1, 2],
        3,
        1
      );
      await expect(lombard.setNextValidatorSet(data.payload, data.proof))
      .to.emit(lombard, "ValidatorSetUpdated")
      .withArgs(11, [signer1.address, signer2.address], [1, 2], 3);

      const validatorSet = await lombard.getValidatoSet(11);
      expect(validatorSet.weightThreshold).to.equal(3);
      expect(validatorSet.weights).to.deep.equal([1, 2]);
      expect(validatorSet.validators).to.deep.equal([signer1.address, signer2.address]);
    });

    it("should fail to set initial validator set", async function () {
      const payload = getPayloadForAction([
        11, [signer1.publicKey], [1], 1, 1
      ], NEW_VALSET)
      await expect(lombard.setInitalValidatorSet(payload))
        .to.revertedWithCustomError(lombard, "ValSetAlreadySet");
    });

    it("should fail if epoch is not increasing", async function () {
      const data = await signNewValSetPayload(
        [signer3, signer1, signer2],
        [true, true, false],
        10,
        [signer1.publicKey, signer2.publicKey],
        [1, 1],
        1,
        1
      );
      await expect(lombard.setNextValidatorSet(data.payload, data.proof))
      .to.be.revertedWithCustomError(lombard, "InvalidEpoch");
    });

    it("should fail if new consortium is not increasing", async function () {
      const data = await signNewValSetPayload(
        [signer3, signer1, signer2],
        [true, true, false],
        11,
        [signer2.publicKey, signer1.publicKey],
        [1, 1],
        1,
        1,
      );
      await expect(lombard.setNextValidatorSet(data.payload, data.proof))
      .to.be.revertedWithCustomError(lombard, "NotIncreasingValidatorSet");
    });

    it("should fail if treshold is zero", async function () {
      const data = await signNewValSetPayload(
        [signer3, signer1, signer2],
        [true, true, false],
        11,
        [signer2.publicKey, signer1.publicKey],
        [1, 1],
        0,
        1,
      );
      await expect(lombard.setNextValidatorSet(data.payload, data.proof))
      .to.be.revertedWithCustomError(lombard, "InvalidThreshold");
    });

    it("should fail if treshold is over the sum of weights", async function () {
      const data = await signNewValSetPayload(
        [signer3, signer1, signer2],
        [true, true, false],
        11,
        [signer2.publicKey, signer1.publicKey],
        [1, 1],
        3,
        1,
      );
      await expect(lombard.setNextValidatorSet(data.payload, data.proof))
      .to.be.revertedWithCustomError(lombard, "InvalidThreshold");
    });

    it("should fail if zero weights are used", async function () {
      const data = await signNewValSetPayload(
        [signer3, signer1, signer2],
        [true, true, false],
        11,
        [signer2.publicKey, signer1.publicKey],
        [1, 0],
        3,
        1,
      );
      await expect(lombard.setNextValidatorSet(data.payload, data.proof))
      .to.be.revertedWithCustomError(lombard, "ZeroWeight");
    });

    describe("Signature verification", function () {
      it("should validate correct signatures", async function () {
        const data = await signDepositBridgePayload(
          [signer3, signer1, signer2],
          [true, true, false],
          1n,
          signer1.address,
          1n,
          signer2.address,
          signer3.address,
          10,
        );

        await lombard.checkProof(data.payloadHash, data.proof);
      });

      it("should revert on invalid signatures", async function () {

        const data = await signDepositBridgePayload(
          [signer3, signer1, signer2],
          [true, true, false],
          1n,
          signer1.address,
          1n,
          signer2.address,
          signer3.address,
          10,
        );

        const payload = getPayloadForAction([
          ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [1]),
          ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer1.address]), //any address
          ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [2]), // // mismatching chainId
          ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer2.address]), //any address
          ethers.AbiCoder.defaultAbiCoder().encode(["address"], [signer3.address]), //any address
          ethers.AbiCoder.defaultAbiCoder().encode(["uint64"], [10]),
          ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0]),
          ],
          DEPOSIT_BRIDGE_ACTION
        );

        await expect(lombard.checkProof(ethers.sha256(payload), data.proof))
        .to.be.revertedWithCustomError(lombard, "SignatureVerificationFailed");
      });
    });
  });
});
