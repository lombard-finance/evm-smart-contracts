import { config, ethers } from "hardhat";
import { expect } from "chai";
import { takeSnapshot } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployContract, signPayload, getSignersWithPrivateKeys, getPayloadForAction, CHAIN_ID } from "./helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LombardConsortium } from "../typechain-types";
import { SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot";

describe("LombardConsortium", function () {
  let deployer: HardhatEthersSigner,
    signer1: HardhatEthersSigner,
    signer2: HardhatEthersSigner,
    signer3: HardhatEthersSigner;
  let lombard: LombardConsortium;
  let snapshot: SnapshotRestorer;

  before(async function () {
    [deployer, signer1, signer2, signer3] = await getSignersWithPrivateKeys();
    lombard = await deployContract<LombardConsortium>("LombardConsortium", [
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
      await lombard.setInitalValidatorSet(
        [signer3.publicKey, signer1.publicKey, signer2.publicKey],
        [1, 1, 1],
        2,
        10
      );
    })

    it("should set the correct threshold", async function () {
      const validatorSet = await lombard.getValidatoSet(10);
      expect(validatorSet.threshold).to.equal(2);
      expect(validatorSet.weights).to.deep.equal([1, 1, 1]);
      expect(validatorSet.validators).to.deep.equal([signer3.address, signer1.address, signer2.address]);
    });

    it("should set the correct epoch", async function () {
      expect(await lombard.curEpoch()).to.equal(10);
    });

    it("should set the new consortium correctly", async function () {
      const data = await signPayload(
        [signer3, signer1, signer2],
        [true, true, false],
        [
          [signer1.publicKey, signer2.publicKey],
          [1, 2],
          3,
          11
        ],
        CHAIN_ID,
        await lombard.getAddress(),
        await lombard.getAddress(),
        10,
        "setValidators"
      );
      await expect(lombard.setNextValidatorSet(data.payload, data.proof))
      .to.emit(lombard, "ValidatorSetUpdated")
      .withArgs(11, [signer1.address, signer2.address], [1, 2], 3);

      const validatorSet = await lombard.getValidatoSet(11);
      expect(validatorSet.threshold).to.equal(3);
      expect(validatorSet.weights).to.deep.equal([1, 2]);
      expect(validatorSet.validators).to.deep.equal([signer1.address, signer2.address]);
    });

    it("should fail to set initial validator set", async function () {
      await expect(lombard.setInitalValidatorSet([signer1.publicKey], [1], 1, 11))
        .to.revertedWithCustomError(lombard, "ValidatorSetMustApprove");
    });

    it("should fail if epoch is not increasing", async function () {
      const data = await signPayload(
        [signer3, signer1, signer2],
        [true, true, false],
        [
          [signer1.publicKey, signer2.publicKey],
          [1, 1],
          1,
          10
        ],
        CHAIN_ID,
        await lombard.getAddress(),
        await lombard.getAddress(),
        10,
        "setValidators"
      );
      await expect(lombard.setNextValidatorSet(data.payload, data.proof))
      .to.be.revertedWithCustomError(lombard, "InvalidEpoch");
    });

    it("should fail if new consortium is not increasing", async function () {
      const data = await signPayload(
        [signer3, signer1, signer2],
        [true, true, false],
        [
          [signer2.publicKey, signer1.publicKey],
          [1, 1],
          1,
          11
        ],
        CHAIN_ID,
        await lombard.getAddress(),
        await lombard.getAddress(),
        10,
        "setValidators"
      );
      await expect(lombard.setNextValidatorSet(data.payload, data.proof))
      .to.be.revertedWithCustomError(lombard, "NotIncreasingValidatorSet");
    });

    it("should fail if treshold is zero", async function () {
      const data = await signPayload(
        [signer3, signer1, signer2],
        [true, true, false],
        [
          [signer2.publicKey, signer1.publicKey],
          [1, 1],
          0,
          11
        ],
        CHAIN_ID,
        await lombard.getAddress(),
        await lombard.getAddress(),
        10,
        "setValidators"
      );
      await expect(lombard.setNextValidatorSet(data.payload, data.proof))
      .to.be.revertedWithCustomError(lombard, "InvalidThreshold");
    });

    it("should fail if treshold is over the sum of weights", async function () {
      const data = await signPayload(
        [signer3, signer1, signer2],
        [true, true, false],
        [
          [signer2.publicKey, signer1.publicKey],
          [1, 1],
          3,
          11
        ],
        CHAIN_ID,
        await lombard.getAddress(),
        await lombard.getAddress(),
        10,
        "setValidators"
      );
      await expect(lombard.setNextValidatorSet(data.payload, data.proof))
      .to.be.revertedWithCustomError(lombard, "InvalidThreshold");
    });

    it("should fail if zero weights are used", async function () {
      const data = await signPayload(
        [signer3, signer1, signer2],
        [true, true, false],
        [
          [signer2.publicKey, signer1.publicKey],
          [1, 0],
          3,
          11
        ],
        CHAIN_ID,
        await lombard.getAddress(),
        await lombard.getAddress(),
        10,
        "setValidators"
      );
      await expect(lombard.setNextValidatorSet(data.payload, data.proof))
      .to.be.revertedWithCustomError(lombard, "ZeroWeight");
    });

    describe("Signature verification", function () {
      it("should validate correct signatures", async function () {
        const data = await signPayload(
          [signer3, signer1, signer2],
          [true, true, false],
          [
            1,
            signer1.address, //any address
            1,
            signer2.address, //any address
            signer3.address, //any address
            10,
            ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
          ],
          CHAIN_ID,
          deployer.address,
          await lombard.getAddress(),
          10,
          "bridge"
        );

        await lombard.checkProof(ethers.sha256(data.payload), data.proof);
      });

      it("should revert on invalid signatures", async function () {
        const data = await signPayload(
          [signer3, signer1, signer2],
          [true, true, false],
          [
            1,
            signer1.address, //any address
            1,
            signer2.address, //any address
            signer3.address, //any address
            10,
            ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
          ],
          CHAIN_ID,
          deployer.address,
          await lombard.getAddress(),
          1,
          "bridge"
        );

        const payload = getPayloadForAction([
            1,
            signer1.address, //any address
            2,               // mismatching chainId
            signer2.address, //any address
            signer3.address, //any address
            10,
            ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
          ],
          "bridge"
        );

        await expect(lombard.checkProof(ethers.sha256(payload), data.proof))
        .to.be.revertedWithCustomError(lombard, "SignatureVerificationFailed");
      });
    });
  });
});
