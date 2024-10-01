import { config, ethers } from "hardhat";
import { expect } from "chai";
import { takeSnapshot } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployContract, signPayload, ACTIONS, getSignersWithPrivateKeys, getPayloadForAction } from "./helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LombardConsortium } from "../typechain-types";
import { SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot";
import { keccak256 } from "ethers";

const EIP1271_MAGICVALUE = 0x1626ba7e;

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
      [signer3.address, signer1.address, signer2.address],
      2,
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

    it("should set the correct threshold", async function () {
      expect(await lombard.getThreshold(1)).to.equal(2);
    });

    it("should set the correct epoch", async function () {
      expect(await lombard.curEpoch()).to.equal(1);
    });
  });

  it("should set the new consortium correctly", async function () {
    const data = await signPayload(
      [signer3, signer1, signer2],
      [true, true, false],
      2,
      [
        [signer1.address, signer2.address],
        1,
      ],
      ACTIONS.SET_VALIDATORS
    );
    await expect(lombard.transferValidatorsOwnership([signer1.address, signer2.address], 1, data.proof))
    .to.emit(lombard, "ValidatorSetUpdated")
    .withArgs(2, [signer1.address, signer2.address]);

    expect(await lombard.getThreshold(2)).to.equal(1);
  });

  it("should fail if new consortium is not increasing", async function () {
    const data = await signPayload(
      [signer3, signer1, signer2],
      [true, true, false],
      2,
      [
        [signer2.address, signer1.address],
        1,
      ],
      ACTIONS.SET_VALIDATORS
    );
    await expect(lombard.transferValidatorsOwnership([signer2.address, signer1.address], 1, data.proof))
    .to.be.revertedWithCustomError(lombard, "NotIncreasingValidatorSet");
  });

  it("should fail if treshold is zero", async function () {
    const data = await signPayload(
      [signer3, signer1, signer2],
      [true, true, false],
      2,
      [
        [signer2.address, signer1.address],
        0,
      ],
      ACTIONS.SET_VALIDATORS
    );
    await expect(lombard.transferValidatorsOwnership([signer2.address, signer1.address], 0, data.proof))
    .to.be.revertedWithCustomError(lombard, "InvalidThreshold");
  });

  it("should fail if treshold is over the size of the consortium", async function () {
    const data = await signPayload(
      [signer3, signer1, signer2],
      [true, true, false],
      2,
      [
        [signer2.address, signer1.address],
        3,
      ],
      ACTIONS.SET_VALIDATORS
    );
    await expect(lombard.transferValidatorsOwnership([signer2.address, signer1.address], 3, data.proof))
    .to.be.revertedWithCustomError(lombard, "InvalidThreshold");
  });

  describe("Signature verification", function () {
    it("should validate correct signatures", async function () {
      const data = await signPayload(
        [signer3, signer1, signer2],
        [true, true, false],
        2,
        [
          signer1.address, //any address
          1,
          signer2.address, //any address
          1,
          signer3.address, //any address
          10,
          ethers.keccak256("0x0001"),
          0
        ],
        ACTIONS.BRIDGE
      );
      console.log("here");

      await lombard.checkProof(keccak256(data.payload), data.proof);
    });

    it("should revert on invalid signatures", async function () {
      const data = await signPayload(
        [signer3, signer1, signer2],
        [true, true, false],
        2,
        [
          signer1.address, //any address
          1,
          signer2.address, //any address
          1,
          signer3.address, //any address
          10,
          ethers.keccak256("0x0001"),
          0
        ],
        ACTIONS.BRIDGE
      );

      const payload = getPayloadForAction([
          signer1.address, //any address
          2,               // mismatched chain id
          signer2.address, //any address
          1,
          signer3.address, //any address
          10,
          ethers.keccak256("0x0001"),
          0
        ],
        ACTIONS.BRIDGE
      );

      await expect(lombard.checkProof(keccak256(payload), data.proof))
      .to.be.revertedWithCustomError(lombard, "SignatureVerificationFailed");
    });
  });
});
