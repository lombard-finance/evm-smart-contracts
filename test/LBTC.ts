import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers, upgrades, config } from "hardhat";
import { signData } from "../scripts/helpers/crypto";

describe("LBTC", function () {
  async function deployFixture() {
    const [owner] = await ethers.getSigners();

    const accounts = config.networks.hardhat.accounts;
    // supports only mnemonic
    const rootWallet = ethers.Wallet.fromPhrase(
      Array.isArray(accounts) ? "" : accounts.mnemonic
    );
    const signer = rootWallet.deriveChild(999);

    const lbtc = await upgrades.deployProxy(
      await ethers.getContractFactory("LBTC"),
      [signer.address]
    );
    await lbtc.waitForDeployment();

    return { lbtc, owner, signer };
  }

  describe("Deployment", function () {
    it("Should set right owner (deployer)", async function () {
      const { lbtc, owner } = await loadFixture(deployFixture);

      expect(await lbtc.owner()).to.equal(await owner.getAddress());
    });

    it("Should set right consortium", async function () {
      const { lbtc, signer } = await loadFixture(deployFixture);

      expect(await lbtc.consortium()).to.equal(signer.address);
    });
  });

  describe("Mint", function () {
    describe("Signature", function () {
      it("Should mint successfully", async function () {
        const { lbtc, owner, signer } = await loadFixture(deployFixture);

        const amount = "100000000"; // 1 BTC

        const signed = await signData(signer, {
          to: await owner.getAddress(),
          amount,
          chainId: (await ethers.provider.getNetwork()).chainId,
        });

        expect(lbtc.mint(signed.data, signed.signature))
          .to.emit(lbtc, "Transfer")
          .withArgs(ethers.ZeroAddress, await owner.getAddress(), amount);
      });
    });
  });
});
