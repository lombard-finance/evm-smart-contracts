import { config, ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { takeSnapshot } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { enrichWithPrivateKeys, signData } from "./helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LBTC } from "../typechain-types";
import { SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot";

async function init(consortium: HardhatEthersSigner) {
  console.log("=== LBTC");
  const LBTC = await ethers.getContractFactory("LBTC");
  const lbtc = (await upgrades.deployProxy(LBTC, [consortium.address])) as LBTC;
  await lbtc.waitForDeployment();
  return { lbtc };
}

describe("LBTC", function () {
  let deployer: HardhatEthersSigner,
    consortium: HardhatEthersSigner,
    signer1: HardhatEthersSigner,
    signer2: HardhatEthersSigner,
    signer3: HardhatEthersSigner;
  let signers;
  let lbtc: LBTC;
  let snapshot: SnapshotRestorer;

  before(async function () {
    [deployer, consortium, signer1, signer2, signer3] =
      await ethers.getSigners();
    signers = [deployer, consortium, signer1, signer2, signer3];
    await enrichWithPrivateKeys(signers);
    const result = await init(consortium);
    lbtc = result.lbtc;
    snapshot = await takeSnapshot();
  });

  describe("Setters and getters", function () {
    before(async function () {
      await snapshot.restore();
    });

    it("owner() is deployer", async function () {
      expect(await lbtc.owner()).to.equal(deployer.address);
    });

    it("consortium() set at initialization", async function () {
      expect(await lbtc.consortium()).to.equal(consortium.address);
    });

    it("decimals()", async function () {
      expect(await lbtc.decimals()).to.equal(8n);
    });



  });

  describe("Mint positive cases", function () {
    before(async function () {
      await snapshot.restore();
    });
    const args = [
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
    args.forEach(function (arg) {
      it(`Mint ${arg.name}`, async function () {
        const amount = arg.amount;
        const recipient = arg.recipient();
        const msgSender = arg.msgSender();
        const balanceBefore = await lbtc.balanceOf(recipient.address);
        const totalSupplyBefore = await lbtc.totalSupply();

        const signedData = await signData(consortium.privateKey, {
          to: recipient.address,
          amount,
        });
        await expect(
          lbtc.connect(msgSender).mint(signedData.data, signedData.signature)
        )
          .to.emit(lbtc, "Transfer")
          .withArgs(ethers.ZeroAddress, recipient.address, amount);

        const balanceAfter = await lbtc.balanceOf(recipient.address);
        const totalSupplyAfter = await lbtc.totalSupply();

        expect(balanceAfter - balanceBefore).to.be.eq(amount);
        expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
      });
    });
  });

  describe("Mint negative cases", function () {
    beforeEach(async function () {
      await snapshot.restore();
    });
    const args = [
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
        name: "data does not match hash",
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
            hash: "",
            signature: result2.signature
          };
        },
        recipient: () => signer1.address,
        amount: 100_000_000n,
        chainId: config.networks.hardhat.chainId,
        customError: "BadSignature",
      },
      {
        name: "chain is wrong",
        signer: () => consortium,
        signData: signData,
        recipient: () => signer1.address,
        amount: 100_000_000n,
        chainId: 1,
        customError: "BadChainId",
      },
      {
        name: "amount is 0",
        signer: () => consortium,
        signData: signData,
        recipient: () => signer1.address,
        amount: 0n,
        chainId: config.networks.hardhat.chainId,
        customError: "ZeroAmount",
      },
      {
        name: "recipient is 0 address",
        signer: () => consortium,
        signData: signData,
        recipient: () => ethers.ZeroAddress,
        amount: 100_000_000n,
        chainId: config.networks.hardhat.chainId,
        customError: "ERC20InvalidReceiver",
      },
    ];
    args.forEach(function (arg) {
      it(`Reverts when ${arg.name}`, async function () {
        const amount = arg.amount;
        const recipient = arg.recipient();
        const signer = arg.signer();
        const signedData = await arg.signData(signer.privateKey, {
          to: recipient,
          amount: amount,
          chainId: arg.chainId,
        });

        if (arg.customError) {
          await expect(
            lbtc.mint(signedData.data, signedData.signature)
          ).to.revertedWithCustomError(lbtc, arg.customError);
        } else if (arg.errorMessage) {
          await expect(
            lbtc.mint(signedData.data, signedData.signature)
          ).to.revertedWith(arg.errorMessage);
        } else {
          await expect(lbtc.mint(signedData.data, signedData.signature)).to.be
            .reverted;
        }
      });
    });

    it("Reverts when proof already used", async function () {
      const amount = 100_000_000n;
      const signedData = await signData(consortium.privateKey, {
        to: signer1.address,
        amount,
      });
      await lbtc.mint(signedData.data, signedData.signature);
      await expect(
        lbtc.mint(signedData.data, signedData.signature)
      ).to.revertedWithCustomError(lbtc, "ProofAlreadyUsed");
    });
  });
});
