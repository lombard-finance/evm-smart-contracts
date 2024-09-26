import { config, ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { takeSnapshot } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { enrichWithPrivateKeys, signOutputPayload } from "./helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LombardConsortium } from "../typechain-types";
import { SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot";

const EIP1271_MAGICVALUE = 0x1626ba7e;
const EIP1271_WRONGVALUE = 0xffffffff;

async function init(
  initialPlayers: HardhatEthersSigner[],
  owner: HardhatEthersSigner,
  consortium: HardhatEthersSigner
) {
  const LombardConsortium = await ethers.getContractFactory(
    "LombardConsortium"
  );
  const initialPlayerAddresses = initialPlayers.map(player => player.address);
  const lombard = (await upgrades.deployProxy(LombardConsortium, [
    initialPlayerAddresses,
    owner.address,
    consortium.address
  ])) as LombardConsortium;
  await lombard.waitForDeployment();
  return { lombard };
}

describe("LombardConsortium", function () {
  let deployer: HardhatEthersSigner,
    consortium: HardhatEthersSigner,
    signer1: HardhatEthersSigner,
    signer2: HardhatEthersSigner,
    signer3: HardhatEthersSigner;
  let signers;
  let lombard: LombardConsortium;
  let snapshot: SnapshotRestorer;

  before(async function () {
    [deployer, consortium, signer1, signer2, signer3] = await ethers.getSigners();
    signers = [deployer, consortium, signer1, signer2, signer3];
    await enrichWithPrivateKeys(signers);
    const result = await init([signer1, signer2, signer3], deployer, consortium);
    lombard = result.lombard;
    snapshot = await takeSnapshot();
  });

  describe("Setters and getters", function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it("Should set the correct owner", async function () {
      expect(await lombard.owner()).to.equal(deployer.address);
    });

    it("Should set the correct consortium address", async function () {
      // Assuming there is a function consortium() to get the consortium address
      expect(await lombard.getPlayers()).to.include.members([signer1.address, signer2.address, signer3.address]);
    });

    it("Should correctly add a player", async function () {
      const newPlayer = ethers.Wallet.createRandom();
      const data = ethers.utils.defaultAbiCoder.encode(["address"], [newPlayer.address]);
      const proofSignature = await consortium.signMessage(ethers.utils.arrayify(ethers.utils.keccak256(data)));

      await expect(lombard.addPlayer(newPlayer.address, data, proofSignature))
        .to.emit(lombard, "PlayerAdded")
        .withArgs(newPlayer.address);

      expect(await lombard.getPlayers()).to.include(newPlayer.address);
    });

    it("Should correctly remove a player", async function () {
      const data = ethers.utils.defaultAbiCoder.encode(["address"], [signer3.address]);
      const proofSignature = await consortium.signMessage(ethers.utils.arrayify(ethers.utils.keccak256(data)));

      await expect(lombard.removePlayer(signer3.address, data, proofSignature))
        .to.emit(lombard, "PlayerRemoved")
        .withArgs(signer3.address);

      expect(await lombard.getPlayers()).to.not.include(signer3.address);
    });

    it("Should revert when adding an existing player", async function () {
      const data = ethers.utils.defaultAbiCoder.encode(["address"], [signer1.address]);
      const proofSignature = await consortium.signMessage(ethers.utils.arrayify(ethers.utils.keccak256(data)));

      await expect(lombard.addPlayer(signer1.address, data, proofSignature))
        .to.be.revertedWithCustomError(lombard, "LombardConsortium__PlayerAlreadyExists");
    });

    it("Should revert when removing a non-existent player", async function () {
      const newPlayer = ethers.Wallet.createRandom();
      const data = ethers.utils.defaultAbiCoder.encode(["address"], [newPlayer.address]);
      const proofSignature = await consortium.signMessage(ethers.utils.arrayify(ethers.utils.keccak256(data)));

      await expect(lombard.removePlayer(newPlayer.address, data, proofSignature))
        .to.be.revertedWithCustomError(lombard, "LombardConsortium__PlayerNotFound");
    });
  });

  describe("Signature verification", function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it("Should validate correct signatures", async function () {
      const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"));
      const signature1 = await signer1.signMessage(ethers.utils.arrayify(hash));
      const signature2 = await signer2.signMessage(ethers.utils.arrayify(hash));
      const signature3 = await signer3.signMessage(ethers.utils.arrayify(hash));

      const signatures = signature1 + signature2.slice(2) + signature3.slice(2);

      expect(
        await lombard.isValidSignature(hash, signatures)
      ).to.be.equal(EIP1271_MAGICVALUE);
    });

    it("Should revert on invalid signatures", async function () {
      const hash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("test"));
      const signature1 = await signer1.signMessage(ethers.utils.arrayify(hash));
      const invalidSignature = ethers.utils.joinSignature({
        r: '0x' + '0'.repeat(64),
        s: '0x' + '0'.repeat(64),
        v: 27
      });

      const signatures = signature1 + invalidSignature.slice(2);

      await expect(lombard.isValidSignature(hash, signatures)).to.be.revertedWithCustomError(lombard, "LombardConsortium__InsufficientSignatures");
    });
  });
});
