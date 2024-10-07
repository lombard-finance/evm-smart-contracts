import { config, ethers } from "hardhat";
import { expect } from "chai";
import { takeSnapshot } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  signPayload,
  deployContract,
  getSignersWithPrivateKeys,
  getPayloadForAction,
  ERRORS_IFACE
} from "./helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LBTCMock, Bascule, LombardConsortium } from "../typechain-types";
import { SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot";
import { keccak256 } from "ethers";

const CHAIN_ID = ethers.zeroPadValue("0x7A69", 32);

describe("LBTC", function () {
  let deployer: HardhatEthersSigner,
    signer1: HardhatEthersSigner,
    signer2: HardhatEthersSigner,
    signer3: HardhatEthersSigner,
    treasury: HardhatEthersSigner,
    reporter: HardhatEthersSigner,
    admin: HardhatEthersSigner,
    pauser: HardhatEthersSigner;
  let lbtc: LBTCMock;
  let lbtc2: LBTCMock;
  let bascule: Bascule;
  let consortium: LombardConsortium;
  let snapshot: SnapshotRestorer;
  let snapshotTimestamp: number;

  before(async function () {
    [
      deployer,
      signer1,
      signer2,
      signer3,
      treasury,
      admin,
      pauser,
      reporter,
    ] = await getSignersWithPrivateKeys();

    consortium = await deployContract<LombardConsortium>("LombardConsortium", [[signer1.address], 1, deployer.address]);
    lbtc = await deployContract<LBTCMock>("LBTCMock", [await consortium.getAddress(), 100]);
    lbtc2 = await deployContract<LBTCMock>("LBTCMock", [await consortium.getAddress(), 100]);
    bascule = await deployContract<Bascule>("Bascule", [admin.address, pauser.address, reporter.address, await lbtc.getAddress(), 100], false);

    await lbtc.changeTreasuryAddress(treasury.address);
    await lbtc2.changeTreasuryAddress(treasury.address);

    snapshot = await takeSnapshot();
    snapshotTimestamp = (await ethers.provider.getBlock("latest"))!.timestamp;
  });

  afterEach(async function () {
    // clean the state after each test
    await snapshot.restore();
  });

  describe("Setters and getters", function () {
    // TODO: check treasury

    it("owner() is deployer", async function () {
      expect(await lbtc.owner()).to.equal(deployer.address);
    });

    it("getDepositRelativeCommission", async function () {
      expect(
        await lbtc.getDepositRelativeCommission(ethers.zeroPadValue("0x", 32))
      ).to.equal(0);
    });

    it("getDepositAbsoluteCommission", async function () {
      expect(
        await lbtc.getDepositAbsoluteCommission(ethers.zeroPadValue("0x", 32))
      ).to.equal(0);
    });

    it("consortium() set at initialization", async function () {
      expect(await lbtc.consortium()).to.equal(await consortium.getAddress());
    });

    it("decimals()", async function () {
      expect(await lbtc.decimals()).to.equal(8n);
    });

    it("Bascule() unset", async function () {
      expect(await lbtc.Bascule()).to.be.equal(ethers.ZeroAddress);
    });

    it("pause() turns on enforced pause", async function () {
      expect(await lbtc.paused()).to.be.false;
      await expect(lbtc.transferPauserRole(pauser.address))
        .to.emit(lbtc, "PauserRoleTransferred")
        .withArgs(ethers.ZeroAddress, pauser.address);
      await expect(lbtc.connect(pauser).pause())
        .to.emit(lbtc, "Paused")
        .withArgs(pauser.address);
      expect(await lbtc.paused()).to.be.true;
    });

    it("pause() reverts when called by not an pauser", async function () {
      await expect(lbtc.connect(signer1).pause())
        .to.revertedWithCustomError(lbtc, "UnauthorizedAccount")
        .withArgs(signer1.address);
    });

    it("unpause() turns off enforced pause", async function () {
      await expect(lbtc.transferPauserRole(pauser.address))
        .to.emit(lbtc, "PauserRoleTransferred")
        .withArgs(ethers.ZeroAddress, pauser.address);

      await lbtc.connect(pauser).pause();
      expect(await lbtc.paused()).to.be.true;
      await expect(lbtc.connect(pauser).unpause())
        .to.emit(lbtc, "Unpaused")
        .withArgs(pauser.address);
      expect(await lbtc.paused()).to.be.false;
    });

    it("unpause() reverts when called by not an pauser", async function () {
      await expect(lbtc.transferPauserRole(pauser.address))
        .to.emit(lbtc, "PauserRoleTransferred")
        .withArgs(ethers.ZeroAddress, pauser.address);
      await lbtc.connect(pauser).pause();
      expect(await lbtc.paused()).to.be.true;
      await expect(lbtc.connect(signer1).unpause())
        .to.revertedWithCustomError(lbtc, "UnauthorizedAccount")
        .withArgs(signer1.address);
    });

    it("changeNameAndSymbol", async function () {
      const newName = "NEW_NAME";
      const newSymbol = "NEW_SYMBOL";
      await expect(lbtc.changeNameAndSymbol(newName, newSymbol))
        .to.emit(lbtc, "NameAndSymbolChanged")
        .withArgs(newName, newSymbol);
      expect(await lbtc.name()).to.be.eq(newName);
      expect(await lbtc.symbol()).to.be.eq(newSymbol);
    });

    it("toggleWithdrawals() enables or disables burn", async function () {
      await expect(lbtc.toggleWithdrawals())
        .to.emit(lbtc, "WithdrawalsEnabled")
        .withArgs(true);

      await expect(lbtc.toggleWithdrawals())
        .to.emit(lbtc, "WithdrawalsEnabled")
        .withArgs(false);
    });

    it("toggleWithdrawals() reverts when called by not an owner", async function () {
      await expect(
        lbtc.connect(signer1).toggleWithdrawals()
      ).to.revertedWithCustomError(lbtc, "OwnableUnauthorizedAccount");
    });

    it("changeBascule", async function () {
      await expect(lbtc.changeBascule(await bascule.getAddress()))
        .to.emit(lbtc, "BasculeChanged")
        .withArgs(ethers.ZeroAddress, await bascule.getAddress());
      await expect(lbtc.changeBascule(ethers.ZeroAddress))
        .to.emit(lbtc, "BasculeChanged")
        .withArgs(await bascule.getAddress(), ethers.ZeroAddress);
    });
  });

  describe("Mint", function () {
    describe("Positive cases", function () {
      const args = [
        {
          name: "1 BTC",
          amount: 100_000_000n,
          recipient: () => signer2.address,
          msgSender: () => signer1,
        },
        {
          name: "1 satoshi",
          amount: 1n,
          recipient: () => signer3.address,
          msgSender: () => signer2,
        }
      ];
      
      args.forEach(async function (args) {        
        it(`Mint ${args.name}`, async function () {
          const balanceBefore = await lbtc.balanceOf(args.recipient());
          const totalSupplyBefore = await lbtc.totalSupply();
  
          const data = await signPayload(
            [signer1], 
            [true],
            1,
            [
              CHAIN_ID,
              await lbtc.getAddress(),
              args.recipient(), 
              args.amount, 
              ethers.hexlify(ethers.randomBytes(42)), // extra data, irrelevant
            ],
            "mint",
          );
  
          await expect(lbtc.connect(args.msgSender()).mint(data.payload, data.proof))
            .to.emit(lbtc, "Transfer")
            .withArgs(ethers.ZeroAddress, args.recipient(), args.amount);
  
          const balanceAfter = await lbtc.balanceOf(args.recipient());
          const totalSupplyAfter = await lbtc.totalSupply();
  
          expect(balanceAfter - balanceBefore).to.be.eq(args.amount);
          expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(args.amount);
        });
      });
  
      describe("With bascule", function () {
        beforeEach(async function () {
          // set bascule
          await lbtc.changeBascule(await bascule.getAddress());
        });
  
        args.forEach(function (args) {
          it(`Mint ${args.name}`, async function () {
            const balanceBefore = await lbtc.balanceOf(args.recipient());
            const totalSupplyBefore = await lbtc.totalSupply();
    
            const data = await signPayload(
              [signer1], 
              [true],
              1,
              [ 
                CHAIN_ID, 
                await lbtc.getAddress(),
                args.recipient(), 
                args.amount, 
                ethers.hexlify(ethers.randomBytes(12)), // extra data, irrelevant
              ],
              "mint",
            );
    
            // mint without report fails
            await expect(
              lbtc
                .connect(args.msgSender())
                .mint(data.payload, data.proof)
            ).to.be.revertedWithCustomError(bascule, "WithdrawalFailedValidation");
    
            // report deposit
            const reportId = ethers.zeroPadValue("0x01", 32);
            await expect(
              bascule
                .connect(reporter)
                .reportDeposits(reportId, [keccak256(data.proof)])
            )
              .to.emit(bascule, "DepositsReported")
              .withArgs(reportId, 1);
    
            // mint works
            await expect(
              lbtc
                .connect(args.msgSender())
                .mint(data.payload, data.proof)
            )
              .to.emit(lbtc, "Transfer")
              .withArgs(ethers.ZeroAddress, args.recipient(), args.amount);
    
            const balanceAfter = await lbtc.balanceOf(args.recipient());
            const totalSupplyAfter = await lbtc.totalSupply();
    
            expect(balanceAfter - balanceBefore).to.be.eq(args.amount);
            expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(args.amount);
          });
        });
      });
    });

    describe("Negative cases", function () {
      let newConsortium: LombardConsortium;
      const defaultExtraData = ethers.hexlify(ethers.randomBytes(4));
      const defaultArgs = {
        signers: () => [signer1, signer2],
        weights: [true, true],
        threshold: 2,
        mintRecipient: () => signer1.address,
        signatureRecipient: () => signer1.address,
        mintAmount: 100_000_000n,
        signatureAmount: 100_000_000n,
        destinationContract: () => lbtc,
        signatureDestinationContract: () => lbtc,
        chainId: config.networks.hardhat.chainId,
        signatureChainId: config.networks.hardhat.chainId,
        extraData: defaultExtraData,
        signatureExtraData: defaultExtraData,
        interface: () => newConsortium,
        customError: "SignatureVerificationFailed",
        params: () => []
      }
      let defaultProof: string;
      let defaultPayload: string;
      
      beforeEach (async function () {
        // Use a bigger consortium to cover more cases
        newConsortium = await deployContract<LombardConsortium>(
          "LombardConsortium", 
          [
            [signer1.address, signer2.address],
            2,
            deployer.address
          ]
        );
        const {proof, payload} = await signPayload(
          defaultArgs.signers(), 
          defaultArgs.weights,
          defaultArgs.threshold,
          [
            defaultArgs.signatureChainId,
            await defaultArgs.signatureDestinationContract().getAddress(),
            defaultArgs.signatureRecipient(), 
            defaultArgs.signatureAmount, 
            defaultArgs.signatureExtraData,
          ],
          "mint",
        );
        defaultProof = proof;
        defaultPayload = payload;

        await lbtc.changeConsortium(await newConsortium.getAddress());
      })
      
      const args = [
        {
          ...defaultArgs,
          name: "not enough signatures",
          weights: [true, false],
          customError: "NotEnoughSignatures",
        },
        {
          ...defaultArgs,
          name: "executed in wrong chain",
          customError: "WrongChainId",
          chainId: 1,
          interface: () => lbtc
        },
        {
          ...defaultArgs,
          name: "destination chain missmatch",
          signatureChainId: defaultArgs.chainId + 1,
        },
        {
          ...defaultArgs,
          name: "recipient is 0 address",
          mintRecipient: () => ethers.ZeroAddress,
          signatureRecipient: () => ethers.ZeroAddress,
          customError: "ZeroAddress",
          interface: () => lbtc
        },
        {
          ...defaultArgs,
          name: "extra data signature mismatch",
          signatureExtraData: ethers.randomBytes(5),
        },
        {
          ...defaultArgs,
          name: "extra data mismatch",
          extraData: ethers.randomBytes(5),
        },
        {
          ...defaultArgs,
          name: "amount is 0",
          mintAmount: 0,
          signatureAmount: 0,
          customError: "ZeroAmount",
          interface: () => lbtc
        },
        {
          ...defaultArgs,
          name: "Wrong signature recipient",
          signatureRecipient: () => signer2.address,
        },
        {
          ...defaultArgs,
          name: "Wrong mint recipient",
          mintRecipient: () => signer2.address,
        },
        {
          ...defaultArgs,
          name: "Wrong amount",
          mintAmount: 1,
        },
        {
          ...defaultArgs,
          name: "unknown validator set",
          signers: () => [signer1, deployer],
          customError: "InvalidEpochForValidatorSet",
          params: () => [0]
        },
      ];
      args.forEach(function (args) {
        it(`Reverts when ${args.name}`, async function () {
          const signature = (await signPayload(
            args.signers(), 
            args.weights,
            args.threshold,
            [
              args.signatureChainId, 
              await args.signatureDestinationContract().getAddress(), 
              args.signatureRecipient(), 
              args.signatureAmount, 
              args.signatureExtraData
            ],
            "mint",
          )).proof;
          const payload = getPayloadForAction(
            [
              args.chainId, 
              await args.destinationContract().getAddress(), 
              args.mintRecipient(), 
              args.mintAmount, 
              args.extraData
            ],
            "mint",
          );
  
          await expect(
            lbtc.mint(payload, signature)
          ).to.revertedWithCustomError(args.interface(), args.customError);
        });
      });
  
      it("Reverts when paused", async function () {
        await lbtc.transferPauserRole(deployer.address);
        await lbtc.pause();
        
        // try to use the same proof again
        await expect(
          lbtc.mint(defaultPayload, defaultProof)
        ).to.revertedWithCustomError(lbtc, "EnforcedPause");
      });
  
      describe("Wrong proof", function () {
        it("Reverts when proof already used", async function () {
          // use the proof
          await lbtc.mint(defaultPayload, defaultProof);
          // try to use the same proof again
          await expect(
            lbtc.mint(defaultPayload, defaultProof)
          ).to.revertedWithCustomError(lbtc, "ProofAlreadyUsed");
        });
    
        it("Reverts when signature, weights & signers lenght mismatch", async function () {
          // Decode the signature to extract signers and signatures
          const [addrs,,,signatures] = ethers.AbiCoder.defaultAbiCoder().decode(
            ['address[]', 'uint256[]', 'uint256', 'bytes[]'],
            defaultProof
          );
    
          // Re-encode the proof with mismatched lengths
          let mismatchedProof = ethers.AbiCoder.defaultAbiCoder().encode(
            ['address[]', 'uint256[]', 'uint256', 'bytes[]'],
            [[addrs[0]], defaultArgs.weights.map(Number), defaultArgs.threshold, signatures]
          );
    
          await expect(
            lbtc.mint(defaultPayload, mismatchedProof)
          ).to.revertedWithCustomError(newConsortium, "LengthMismatch");
  
          mismatchedProof = ethers.AbiCoder.defaultAbiCoder().encode(
            ['address[]', 'uint256[]', 'uint256', 'bytes[]'],
            [addrs, defaultArgs.weights.map(Number), defaultArgs.threshold, [signatures[0]]]
          );
  
          await expect(
            lbtc.mint(defaultPayload, mismatchedProof)
          ).to.revertedWithCustomError(newConsortium, "LengthMismatch");

          mismatchedProof = ethers.AbiCoder.defaultAbiCoder().encode(
            ['address[]', 'uint256[]', 'uint256', 'bytes[]'],
            [addrs, [Number(defaultArgs.weights[0])], defaultArgs.threshold, signatures]
          );
  
          await expect(
            lbtc.mint(defaultPayload, mismatchedProof)
          ).to.revertedWithCustomError(newConsortium, "LengthMismatch");
        });
      })
    });
  });
  
  describe("Burn", function () {
    beforeEach(async function () {
      await lbtc.toggleWithdrawals();
    });

    describe("Positive cases", function () {
      it("Unstake half with P2WPKH", async () => {
        const amount = 100_000_000n;
        const halfAmount = amount / 2n;
        const p2wpkh = "0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03";
  
        const burnCommission = await lbtc.getBurnCommission();
  
        const expectedAmountAfterFee = halfAmount - BigInt(burnCommission);
  
        await lbtc.mintTo(signer1.address, amount);
        await expect(lbtc.connect(signer1).redeem(p2wpkh, halfAmount))
          .to.emit(lbtc, "UnstakeRequest")
          .withArgs(signer1.address, p2wpkh, expectedAmountAfterFee);
      });
  
      it("Unstake full with P2TR", async () => {
        const amount = 100_000_000n;
        const p2tr =
          "0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947";
  
        const burnCommission = await lbtc.getBurnCommission();
  
        const expectedAmountAfterFee = amount - BigInt(burnCommission);
        await lbtc.mintTo(signer1.address, amount);
        await expect(lbtc.connect(signer1).redeem(p2tr, amount))
          .to.emit(lbtc, "UnstakeRequest")
          .withArgs(signer1.address, p2tr, expectedAmountAfterFee);
      });
  
      it("Unstake with commission", async () => {
        const amount = 100_000_000n;
        const commission = 1_000_000n;
        const p2tr =
          "0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947";
  
        await lbtc.changeBurnCommission(commission);
  
        await lbtc.mintTo(signer1.address, amount);
  
        await expect(lbtc.connect(signer1).redeem(p2tr, amount))
          .to.emit(lbtc, "UnstakeRequest")
          .withArgs(signer1.address, p2tr, amount - commission);
      });
  
      it("Unstake full with P2WSH", async () => {
        const amount = 100_000_000n;
        const p2wsh =
          "0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3";
        await lbtc.mintTo(signer1.address, amount);
  
        // Get the burn commission
        const burnCommission = await lbtc.getBurnCommission();
  
        // Calculate expected amount after fee
        const expectedAmountAfterFee = amount - BigInt(burnCommission);
  
        await expect(lbtc.connect(signer1).redeem(p2wsh, amount))
          .to.emit(lbtc, "UnstakeRequest")
          .withArgs(signer1.address, p2wsh, expectedAmountAfterFee);
      });
    });

    describe("Negative cases", function () {
      it("Reverts when withdrawals off", async function () {
        await lbtc.toggleWithdrawals();
        const amount = 100_000_000n;
        await lbtc.mintTo(signer1.address, amount);
        await expect(
          lbtc.redeem("0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03", amount)
        ).to.revertedWithCustomError(lbtc, "WithdrawalsDisabled");
      });
  
      it("Reverts if amount is less than burn commission", async function () {
        const burnCommission = await lbtc.getBurnCommission();
        const amountLessThanCommission = BigInt(burnCommission) - 1n;
  
        await lbtc.mintTo(
          signer1.address,
          amountLessThanCommission
        );
  
        await expect(
          lbtc
            .connect(signer1)
            .redeem(
              "0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03",
              amountLessThanCommission
            )
        )
          .to.be.revertedWithCustomError(lbtc, "AmountLessThanCommission")
          .withArgs(burnCommission);
      });
  
      it("Reverts when amount is below dust limit for P2WSH", async () => {
        const p2wsh =
          "0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3";
        const burnCommission = await lbtc.getBurnCommission();
  
        // Start with a very small amount
        let amount = burnCommission + 1n;
        let isAboveDust = false;
  
        // Incrementally increase the amount until we find the dust limit
        while (!isAboveDust) {
          amount += 1n;
          [, isAboveDust] = await lbtc.calcUnstakeRequestAmount(p2wsh, amount);
        }
  
        // Now 'amount' is just above the dust limit. Let's use an amount 1 less than this.
        const amountJustBelowDustLimit = amount - 1n;
  
        await lbtc.mintTo(
          signer1.address,
          amountJustBelowDustLimit
        );
  
        await expect(
          lbtc.connect(signer1).redeem(p2wsh, amountJustBelowDustLimit)
        ).to.be.revertedWithCustomError(lbtc, "AmountBelowDustLimit");
      });
  
      it("Revert with P2SH", async () => {
        const amount = 100_000_000n;
        const p2sh = "0xa914aec38a317950a98baa9f725c0cb7e50ae473ba2f87";
        await lbtc.mintTo(signer1.address, amount);
        await expect(
          lbtc.connect(signer1).redeem(p2sh, amount)
        ).to.be.revertedWithCustomError(lbtc, "ScriptPubkeyUnsupported");
      });
  
      it("Reverts with P2PKH", async () => {
        const amount = 100_000_000n;
        const p2pkh = "0x76a914aec38a317950a98baa9f725c0cb7e50ae473ba2f88ac";
        await lbtc.mintTo(signer1.address, amount);
        await expect(
          lbtc.connect(signer1).redeem(p2pkh, amount)
        ).to.be.revertedWithCustomError(lbtc, "ScriptPubkeyUnsupported");
      });
  
      it("Reverts with P2PK", async () => {
        const amount = 100_000_000n;
        const p2pk =
          "0x4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac";
        await lbtc.mintTo(signer1.address, amount);
        await expect(
          lbtc.connect(signer1).redeem(p2pk, amount)
        ).to.be.revertedWithCustomError(lbtc, "ScriptPubkeyUnsupported");
      });
  
      it("Reverts with P2MS", async () => {
        const amount = 100_000_000n;
        const p2ms =
          "0x524104d81fd577272bbe73308c93009eec5dc9fc319fc1ee2e7066e17220a5d47a18314578be2faea34b9f1f8ca078f8621acd4bc22897b03daa422b9bf56646b342a24104ec3afff0b2b66e8152e9018fe3be3fc92b30bf886b3487a525997d00fd9da2d012dce5d5275854adc3106572a5d1e12d4211b228429f5a7b2f7ba92eb0475bb14104b49b496684b02855bc32f5daefa2e2e406db4418f3b86bca5195600951c7d918cdbe5e6d3736ec2abf2dd7610995c3086976b2c0c7b4e459d10b34a316d5a5e753ae";
        await lbtc.mintTo(signer1.address, amount);
        await expect(
          lbtc.connect(signer1).redeem(p2ms, amount)
        ).to.be.revertedWithCustomError(lbtc, "ScriptPubkeyUnsupported");
      });
  
      it("Reverts not enough to pay commission", async () => {
        const amount = 999_999n;
        const commission = 1_000_000n;
        const p2tr =
          "0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947";
  
        await lbtc.changeBurnCommission(commission);
  
        await lbtc.mintTo(signer1.address, amount);
  
        await expect(lbtc.connect(signer1).redeem(p2tr, amount))
          .to.revertedWithCustomError(lbtc, "AmountLessThanCommission")
          .withArgs(commission);
      });
    });
  });

  describe("Bridge", function () {
    const absoluteFee = 100n;

    beforeEach(async function () {
      await lbtc.mintTo(
        signer1.address,
        await lbtc.MAX_COMMISSION()
      );
      await lbtc.addDestination(
        CHAIN_ID,
        ethers.zeroPadValue(await lbtc2.getAddress(), 32),
        1000,
        0
      );
      await lbtc2.addDestination(
        CHAIN_ID,
        ethers.zeroPadValue(await lbtc.getAddress(), 32),
        1,
        absoluteFee
      );
    });

    it("full flow", async () => {
      let amount = 10000n;
      let fee = amount / 10n;
      let amountWithoutFee = amount - fee;
      let receiver = signer2.address;

      await expect(lbtc.connect(signer1).depositToBridge(
        CHAIN_ID,
        ethers.zeroPadValue(receiver, 32),
        amount
      ))
        .to.emit(lbtc, "DepositToBridge")
        .withArgs(
          signer1.address,
          ethers.zeroPadValue(receiver, 32),
          ethers.zeroPadValue(await lbtc2.getAddress(), 32),
          CHAIN_ID,
          amountWithoutFee,
          ethers.keccak256(
            getPayloadForAction([
              CHAIN_ID,
              await lbtc.getAddress(),
              CHAIN_ID,
              await lbtc2.getAddress(),
              receiver,
              amountWithoutFee,
              ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
            ], "burn")
          )
        );

      expect(await lbtc.balanceOf(signer1.address)).to.be.equal(0);
      expect(await lbtc.balanceOf(treasury.address)).to.be.equal(fee);
      expect((await lbtc.totalSupply()).toString()).to.be.equal(fee);
      
      expect(await lbtc2.balanceOf(signer2.address)).to.be.equal(0);
      expect(await lbtc2.totalSupply()).to.be.equal(0);

      const data1 = await signPayload(
        [signer1],
        [true],
        1,
        [
          CHAIN_ID,
          await lbtc.getAddress(),
          CHAIN_ID,
          await lbtc2.getAddress(),
          receiver,
          amountWithoutFee,
          ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
        ],
        "burn"
      );

      await expect(lbtc2.connect(signer2).withdrawFromBridge(data1.payload, data1.proof))
        .to.emit(lbtc2, "WithdrawFromBridge")
        .withArgs(
          receiver,
          amountWithoutFee,
          keccak256(data1.proof)
        );
      expect((await lbtc2.totalSupply()).toString()).to.be.equal(amount - fee);
      expect((await lbtc2.balanceOf(signer2.address)).toString()).to.be.equal(
        amountWithoutFee
      );

      // bridge back

      amount = amountWithoutFee;

      fee = 1n + absoluteFee;
      amountWithoutFee = amount - fee;

      await expect(lbtc2.connect(signer2).depositToBridge(
        CHAIN_ID,
        ethers.zeroPadValue(receiver, 32),
        amount
      ))
        .to.emit(lbtc2, "DepositToBridge")
        .withArgs(
          signer2.address,
          ethers.zeroPadValue(receiver, 32),
          ethers.zeroPadValue(await lbtc.getAddress(), 32),
          CHAIN_ID,
          amountWithoutFee,
          ethers.keccak256(
            getPayloadForAction([
              CHAIN_ID,
              await lbtc2.getAddress(),
              CHAIN_ID,
              await lbtc.getAddress(),
              receiver,
              amountWithoutFee,
              ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
            ], "burn")
          )
        );

      expect(await lbtc2.balanceOf(signer2.address)).to.be.equal(0);
      expect(await lbtc2.balanceOf(treasury.address)).to.be.equal(fee);
      expect(await lbtc2.totalSupply()).to.be.equal(fee);

      const data2 = await signPayload(
        [signer1],
        [true],
        1,
        [
          CHAIN_ID,
          await lbtc2.getAddress(),
          CHAIN_ID,
          await lbtc.getAddress(),
          receiver,
          amountWithoutFee,
          ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
        ],
        "burn"
      );

      await expect(lbtc.connect(signer2).withdrawFromBridge(data2.payload, data2.proof))
        .to.emit(lbtc, "WithdrawFromBridge")
        .withArgs(
          receiver,
          amountWithoutFee,
          keccak256(data2.proof)
        );
    });

    it("withdrawFromBridge (with Bascule)", async () => {
      // Enable Bascule
      await lbtc.changeBascule(await bascule.getAddress());

      // Use the 2nd half of the full flow test to test the Bascule integration
      let amount = 10000n;;
      let receiver = signer3.address;

      const data = await signPayload(
        [signer1],
        [true],
        1,
        [
          CHAIN_ID,
          await lbtc2.getAddress(),
          CHAIN_ID,
          await lbtc.getAddress(),
          receiver,
          amount,
          ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
        ],
        "burn"
      );

      // withdraw without report fails
      await expect(lbtc.connect(signer2).withdrawFromBridge(data.payload, data.proof))
        .to.be.revertedWithCustomError(bascule, "WithdrawalFailedValidation")
        .withArgs(keccak256(data.proof), amount);

      // report deposit
      const reportId = ethers.zeroPadValue("0x01", 32);
      await bascule.connect(reporter).reportDeposits(reportId, [keccak256(data.proof)]);

      // withdraw works
      await expect(
        lbtc.connect(signer2).withdrawFromBridge(data.payload, data.proof)
      )
        .to.emit(lbtc, "WithdrawFromBridge")
        .withArgs(
          receiver,
          amount,
          keccak256(data.proof)
        );
    });

    it("reverts: Non-consortium signing", async () => {
      let receiver = signer3.address;
      let amount = 1n;

      const data = await signPayload(
        [signer2],
        [true],
        1,
        [
          CHAIN_ID,
          await lbtc2.getAddress(),
          CHAIN_ID,
          await lbtc.getAddress(),
          receiver,
          amount,
          ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [0])
        ],
        "burn"
      );

      await expect(
        lbtc.connect(signer2).withdrawFromBridge(data.payload, data.proof)
      ).to.revertedWithCustomError(consortium, "InvalidEpochForValidatorSet")
        .withArgs(0);
    });
  });
});
