import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import hre, { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { BigNumberish } from "ethers";
import secp256k1 from "secp256k1";

const signData = async (
  signer: SignerWithAddress,
  data: { to: string; amount: BigNumberish; chainId: BigNumberish }
): Promise<{
  data: any;
  signature: any;
}> => {
  const packed = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint64"],
    [data.chainId, data.to, data.amount]
  );
  const hash = ethers.keccak256(packed);

  const accounts = hre.config.networks.hardhat.accounts;
  const wallet1 = ethers.Wallet.fromPhrase(
    Array.isArray(accounts) ? "" : accounts.mnemonic
  );

  const signature = sign(wallet1.privateKey, hash);

  return {
    data: packed,
    signature,
  };
};

function sign(privateKey: string, data: string) {
  const { signature, recid } = secp256k1.ecdsaSign(
    ethers.getBytes(data),
    ethers.getBytes(privateKey)
  );
  return ethers.hexlify(signature) + (recid === 0 ? "1b" : "1c");
}

describe("LBTC", function () {
  async function deployFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await hre.ethers.getSigners();

    const lbtc = await upgrades.deployProxy(
      await ethers.getContractFactory("LBTC"),
      [await owner.getAddress()]
    );
    await lbtc.waitForDeployment();

    return { lbtc, owner, otherAccount };
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
