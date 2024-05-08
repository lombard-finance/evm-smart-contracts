import { config, ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { takeSnapshot } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { enrichWithPrivateKeys, signData } from "./helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LombardConsortium } from "../typechain-types";
import { SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot";

async function init(
  threshold: HardhatEthersSigner,
  owner: HardhatEthersSigner
) {
  console.log("=== LombardConsortium");
  const LombardConsortium = await ethers.getContractFactory(
    "LombardConsortium"
  );
  const lombard = (await upgrades.deployProxy(LombardConsortium, [
    threshold.address,
    owner.address,
  ])) as LombardConsortium;
  await lombard.waitForDeployment();
  return { lombard };
}

describe("LombardConsortium", function () {
  let deployer: HardhatEthersSigner,
    threshold: HardhatEthersSigner,
    signer1: HardhatEthersSigner,
    signer2: HardhatEthersSigner,
    signer3: HardhatEthersSigner;
  let signers;
  let lombard: LombardConsortium;
  let snapshot: SnapshotRestorer;

  before(async function () {
    [deployer, threshold, signer1, signer2, signer3] =
      await ethers.getSigners();
    signers = [deployer, threshold, signer1, signer2, signer3];
    await enrichWithPrivateKeys(signers);
    const result = await init(threshold, deployer);
    lombard = result.lombard;
    snapshot = await takeSnapshot();
  });

  describe("Setters and getters", function () {
    beforeEach(async function () {
      await snapshot.restore();
    });
    it("Should set right threshold key", async function () {
      expect(await lombard.owner()).to.equal(deployer.address);
    });
    it("Should set right threshold owner", async function () {
      expect(await lombard.thresholdAddr()).to.equal(threshold.address);
    });
    it("changeThresholdAdrr()", async function () {
      const prevValue = await lombard.thresholdAddr();
      const newValue = signer1.address;
      await expect(lombard.changeThresholdAddr(newValue))
        .to.emit(lombard, "ThresholdAddrChanged")
        .withArgs(prevValue, newValue);
      expect(await lombard.thresholdAddr()).to.be.eq(newValue);

      //Validate with new key
      const amount = 100_000_000n;
      const signedData = await signData(signer1.privateKey, {
        to: signer2.address,
        amount,
      });
      expect(
        BigInt(
          await lombard.isValidSignature(signedData.hash, signedData.signature)
        )
      ).to.be.gt(1n);
    });

    it("changeThresholdAddr() reverts when called by not an owner", async function () {
      await expect(
        lombard.connect(signer1).changeThresholdAddr(signer1.address)
      ).to.revertedWithCustomError(lombard, "OwnableUnauthorizedAccount");
    });
  });

  describe("Signature", function () {
    const valid = [
      {
        name: "1 BTC",
        amount: 100_000_000n,
        recipient: () => signer1,
        msgSender: () => signer2,
      },
      {
        name: "1 satoshi",
        amount: 1n,
        recipient: () => signer1,
        msgSender: () => signer2,
      },
    ];
    valid.forEach(function (arg) {
      it(`Mint ${arg.name}`, async function () {
        const amount = arg.amount;
        const recipient = arg.recipient();
        const signedData = await signData(threshold.privateKey, {
          to: recipient.address,
          amount,
        });
        expect(
          BigInt(
            await lombard.isValidSignature(
              signedData.hash,
              signedData.signature
            )
          )
        ).to.be.gt(1n);
      });
    });

    const invalid = [
      {
        name: "signer is not a consortium",
        signer: () => signer1,
        signData: signData,
        recipient: () => signer1.address,
        amount: 100_000_000n,
        chainId: config.networks.hardhat.chainId,
        customError: "BadSignature",
      },
      {
        name: "hash does not match signature",
        signer: () => signer1,
        signData: async function (
          privateKey: string,
          data: { to: string; amount: bigint; chainId?: number }
        ): Promise<{
          data: string;
          hash: string;
          signature: string;
        }> {
          const result1 = await signData(privateKey, data);
          const result2 = await signData(privateKey, {
            to: signer2.address,
            amount: 100_000_000n,
          });
          return {
            data: result1.data,
            hash: result1.hash,
            signature: result2.signature,
          };
        },
        recipient: () => signer1.address,
        amount: 100_000_000n,
        chainId: config.networks.hardhat.chainId,
        customError: "BadSignature",
      },
    ];
    invalid.forEach(function (arg) {
      it(`Reverts when ${arg.name}`, async function () {
        const amount = arg.amount;
        const recipient = arg.recipient();
        const signer = arg.signer();
        const signedData = await arg.signData(signer.privateKey, {
          to: recipient,
          amount: amount,
          chainId: arg.chainId,
        });
        await expect(
          lombard.isValidSignature(signedData.hash, signedData.signature)
        ).to.revertedWithCustomError(lombard, arg.customError);
      });
    });
  });
});
