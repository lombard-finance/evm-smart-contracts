import { config, ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { takeSnapshot } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { signData } from "./helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LBTC } from "../typechain-types";
import { SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot";

async function init(owner: HardhatEthersSigner) {
  console.log("=== LBTC");
  const LBTC = await ethers.getContractFactory("LBTC");
  const lbtc = (await upgrades.deployProxy(LBTC, [owner.address])) as LBTC;
  await lbtc.waitForDeployment();
  return { lbtc };
}

describe("LBTC", function () {
  let owner: HardhatEthersSigner,
    signer1: HardhatEthersSigner,
    signer2: HardhatEthersSigner,
    signer3: HardhatEthersSigner;
  let signers;
  let lbtc: LBTC;
  let snapshot: SnapshotRestorer;

  before(async function () {
    [owner, signer1, signer2, signer3] = await ethers.getSigners();
    const signers = [owner, signer1, signer2, signer3];
    const mnemonic = ethers.Mnemonic.fromPhrase(
      config.networks.hardhat.accounts.mnemonic
    );
    for (let i = 0; i < signers.length; i++) {
      const wallet = ethers.HDNodeWallet.fromMnemonic(
        mnemonic,
        `m/44'/60'/0'/0/${i}`
      );
      if (wallet.address === signers[i].address) {
        signers[i].privateKey = wallet.privateKey;
      }
    }
    const result = await init(owner);
    lbtc = result.lbtc;
    snapshot = await takeSnapshot();
  });

  describe("Deployment", function () {
    before(async function () {
      await snapshot.restore();
    });

    it("Should set right consortium", async function () {
      expect(await lbtc.owner()).to.equal(owner.address);
    });
  });

  describe("Mint", function () {
    before(async function () {
      await snapshot.restore();
    });

    it("Should mint successfully", async function () {
      const amount = 100_000_000n; // 1 BTC
      const signedHH = await signData(owner.privateKey, {
        to: owner.address,
        amount,
      });

      await expect(lbtc.connect(owner).mint(signedHH.data, signedHH.signature))
        .to.emit(lbtc, "Transfer")
        .withArgs(ethers.ZeroAddress, owner.address, amount);

      console.log(await lbtc.balanceOf(owner.address));
    });
  });
});
