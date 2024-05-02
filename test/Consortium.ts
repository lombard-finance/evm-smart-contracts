import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers, upgrades, config } from "hardhat";

describe("LBTC", function () {
  async function deployFixture() {
    // First account reserved as owner
    const [_, owner] = await ethers.getSigners();

    const accounts = config.networks.hardhat.accounts;
    const wallet1 = ethers.Wallet.fromPhrase(
      Array.isArray(accounts) ? "" : accounts.mnemonic
    );

    const lbtc = await upgrades.deployProxy(
      await ethers.getContractFactory("LBTC"),
      [await owner.getAddress()]
    );
    await lbtc.waitForDeployment();

    return { lbtc, owner, signer };
  }

  describe("Deployment", function () {
    it("Should set right consortium", async function () {
      const { lbtc, owner } = await loadFixture(deployFixture);

      expect(await lbtc.owner()).to.equal(await owner.getAddress());
    });
  });

  describe("Mint", function () {
    describe("Signature", function () {
      it("Should mint successfully", async function () {
        const { lbtc, owner } = await loadFixture(deployFixture);

        const amount = "100000000"; // 1 BTC

        const signed = await signData(owner, {
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
