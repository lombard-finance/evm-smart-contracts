import { config, ethers } from "hardhat";
import { expect } from "chai";
import { takeSnapshot } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { deployContract, createSignature, buildFullMessage, encodeMessage } from "./helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LombardConsortium } from "../typechain-types";
import { SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot";

const EIP1271_MAGICVALUE = 0x1626ba7e;

describe("LombardConsortium", function () {
  let deployer: HardhatEthersSigner,
    signer1: HardhatEthersSigner,
    signer2: HardhatEthersSigner,
    signer3: HardhatEthersSigner;
  let lombard: LombardConsortium;
  let snapshot: SnapshotRestorer;

  before(async function () {
    [deployer, signer1, signer2, signer3] = await ethers.getSigners();
    lombard = await deployContract<LombardConsortium>("LombardConsortium", [
      [signer1.address, signer2.address, signer3.address],
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

    it("should set the correct consortium address", async function () {
      // Assuming there is a function consortium() to get the consortium address
      expect(await lombard.getPlayers()).to.include.members([signer1.address, signer2.address, signer3.address]);
    });
  });

  describe("Players management", function () {
    it("should correctly add a player", async function () {
      const newPlayer = ethers.Wallet.createRandom();
      
      const signature = await createSignature(
        [signer1, signer2, signer3],
        "addPlayer",
        0,
        10000000000n,
        config.networks.hardhat.chainId,
        await lombard.getAddress(),
        [newPlayer.address],
      );

      await expect(lombard.addPlayer(newPlayer.address, signature))
        .to.emit(lombard, "PlayerAdded")
        .withArgs(newPlayer.address);

      expect(await lombard.getPlayers()).to.include(newPlayer.address);
    });

    it("should correctly remove a player", async function () {
      const signature = await createSignature(
        [signer1, signer2, signer3],
        "removePlayer",
        0,
        10000000000n,
        config.networks.hardhat.chainId,
        await lombard.getAddress(),
        [signer3.address],
      );

      await expect(lombard.removePlayer(signer3.address, signature))
        .to.emit(lombard, "PlayerRemoved")
        .withArgs(signer3.address);

      expect(await lombard.getPlayers()).to.not.include(signer3.address);
    });

    it("should revert when adding an existing player", async function () {
      const signature = await createSignature(
        [signer1, signer2, signer3],
        "addPlayer",
        0,
        10000000000n,
        config.networks.hardhat.chainId,
        await lombard.getAddress(),
        [signer1.address],
      );

      await expect(lombard.addPlayer(signer1.address, signature))
        .to.be.revertedWithCustomError(lombard, "PlayerAlreadyExists");
    });

    it("should revert when removing a non-existent player", async function () {
      const signature = await createSignature(
        [signer1, signer2, signer3],
        "removePlayer",
        0,
        10000000000n,
        config.networks.hardhat.chainId,
        await lombard.getAddress(),
        [deployer.address],
      );

      await expect(lombard.removePlayer(deployer.address, signature))
        .to.be.revertedWithCustomError(lombard, "PlayerNotFound");
    });
  });

  describe("Signature verification", function () {
    it("should validate correct signatures", async function () {
      const signature = await createSignature(
        [signer1, signer2, signer3],
        "removePlayer",
        0,
        10000000000n,
        config.networks.hardhat.chainId,
        await deployer.getAddress(),
        [deployer.address],
      );

      const message = encodeMessage(
        "removePlayer",
        [deployer.address],
      );

      await lombard.checkProof(message, signature);
    });

    it("should revert on invalid signatures", async function () {
      const signature = await createSignature(
        [signer1, signer2, signer3],
        "removePlayer",
        0,
        10000000000n,
        config.networks.hardhat.chainId,
        await signer1.getAddress(), // wrong target
        [deployer.address],
      );

      const message = encodeMessage(
        "removePlayer",
        [deployer.address],
      );

      await expect(lombard.checkProof(message, signature))
      .to.be.revertedWithCustomError(lombard, "SignatureVerificationFailed");
    });
  });
});
