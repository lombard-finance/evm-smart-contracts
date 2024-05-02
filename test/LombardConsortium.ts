import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers, upgrades, config } from "hardhat";
import { signData } from "./helpers";

describe("LombardConsortium", function () {
  async function deployFixture() {
    const [deployer, owner, anotherAccount] = await ethers.getSigners();

    const accounts = config.networks.hardhat.accounts;
    // supports only mnemonic
    const rootWallet = ethers.Wallet.fromPhrase(
      Array.isArray(accounts) ? "" : accounts.mnemonic
    );
    const thresholdKey = rootWallet.deriveChild(9991);

    const consortium = await upgrades.deployProxy(
      await ethers.getContractFactory("LombardConsortium"),
      [await thresholdKey.getAddress(), await owner.getAddress()]
    );
    await consortium.waitForDeployment();

    return { consortium, owner, thresholdKey, anotherAccount };
  }

  describe("Deployment", function () {
    it("Should set right threshold key", async function () {
      const { consortium, owner } = await loadFixture(deployFixture);

      expect(await consortium.owner()).to.equal(await owner.getAddress());
    });

    it("Should set right threshold owner", async function () {
      const { consortium, thresholdKey } = await loadFixture(deployFixture);

      expect(await consortium.thresholdKey()).to.equal(
        await thresholdKey.getAddress()
      );
    });
  });

  describe("Signature", function () {
    it("Should verify signature successfully", async function () {
      const { consortium, thresholdKey, anotherAccount } = await loadFixture(
        deployFixture
      );
      const signed = await signData(thresholdKey.privateKey, {
        to: await anotherAccount.getAddress(),
        amount: 1,
        chainId: (await ethers.provider.getNetwork()).chainId,
      });

      await consortium.isValidSignature(signed.hash, signed.signature);
    });
  });
});
