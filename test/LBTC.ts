import {ethers, upgrades} from "hardhat";
import {expect} from "chai";
import {takeSnapshot} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {signData} from "./helpers";
import type {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
import {LBTC} from "../typechain-types";
import {SnapshotRestorer} from "@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot";

async function init(owner: HardhatEthersSigner) {
  console.log("=== LBTC");
  const LBTC = await ethers.getContractFactory("LBTC");
  const lbtc = (await upgrades.deployProxy(LBTC, [owner.address])) as LBTC;
  await lbtc.waitForDeployment();
  return {lbtc};
}

describe("LBTC", function () {

  let owner: HardhatEthersSigner, signer1: HardhatEthersSigner, signer2: HardhatEthersSigner, signer3: HardhatEthersSigner;
  let lbtc: LBTC;
  let snapshot: SnapshotRestorer;

  before(async function() {
    [owner, signer1, signer2, signer3] = await ethers.getSigners();
    const result = await init(owner);
    lbtc = result.lbtc;
    snapshot = await takeSnapshot();
  })

  describe("Deployment", function () {
    before(async function(){
      await snapshot.restore();
    })

    it("Should set right consortium", async function () {
      expect(await lbtc.owner()).to.equal(owner.address);
    });
  });

  describe("Mint", function () {
    before(async function(){
      await snapshot.restore();
    })

    it("Should mint successfully", async function () {
      const amount = 100_000_000n; // 1 BTC

      const signed = await signData(owner, {to: owner.address, amount});

      expect(lbtc.mint(signed.data, signed.signature))
          .to.emit(lbtc, "Transfer")
          .withArgs(ethers.ZeroAddress, owner.address, amount);
    });
  });
});
