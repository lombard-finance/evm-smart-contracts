import { config, ethers } from "hardhat";
import { expect } from "chai";
import { takeSnapshot } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  enrichWithPrivateKeys,
  signBridgeDepositPayload,
  deployContract,
  createSignature,
} from "./helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LBTCMock, Bascule, LombardConsortium } from "../typechain-types";
import { SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot";
import { getRandomValues } from "crypto";
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
    ] = await ethers.getSigners();
    enrichWithPrivateKeys([deployer, signer1, signer2, signer3]);

    consortium = await deployContract<LombardConsortium>("LombardConsortium", [[signer1.address], deployer.address]);
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
          recipient: () => signer1.address,
          msgSender: () => signer2,
        },
        {
          name: "1 satoshi",
          amount: 1n,
          recipient: () => signer1.address,
          msgSender: () => signer2,
        },
      ];
      
      args.forEach(function (args) {
        it(`Mint ${args.name}`, async function () {
          const amount = args.amount;
          const recipient = args.recipient();
          const msgSender = args.msgSender();
          const balanceBefore = await lbtc.balanceOf(recipient);
          const totalSupplyBefore = await lbtc.totalSupply();
  
          const signature = await createSignature(
            [signer1], 
            "mint", 
            0, 
            (await ethers.provider.getBlock("latest"))!.timestamp + 100, 
            config.networks.hardhat.chainId, 
            await lbtc.getAddress(), 
            await consortium.getAddress(),
            [recipient, amount]
          );
  
          await expect(lbtc.connect(msgSender).mint(recipient, amount, signature))
            .to.emit(lbtc, "Transfer")
            .withArgs(ethers.ZeroAddress, recipient, amount);
  
          const balanceAfter = await lbtc.balanceOf(recipient);
          const totalSupplyAfter = await lbtc.totalSupply();
  
          expect(balanceAfter - balanceBefore).to.be.eq(amount);
          expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
        });
      });
  
      describe("With bascule", function () {
        beforeEach(async function () {
          // set bascule
          await lbtc.changeBascule(await bascule.getAddress());
        });
  
        args.forEach(function (args) {
          it(`Mint ${args.name}`, async function () {
            const amount = args.amount;
            const recipient = args.recipient();
            const msgSender = args.msgSender();
            const balanceBefore = await lbtc.balanceOf(recipient);
            const totalSupplyBefore = await lbtc.totalSupply();
    
            const signature = await createSignature(
              [signer1], 
              "mint", 
              0, 
              (await ethers.provider.getBlock("latest"))!.timestamp + 100, 
              config.networks.hardhat.chainId, 
              await lbtc.getAddress(), 
              await consortium.getAddress(),
              [recipient, amount]
            );
    
            // mint without report fails
            await expect(
              lbtc
                .connect(msgSender)
                .mint(recipient, amount, signature)
            ).to.be.revertedWithCustomError(bascule, "WithdrawalFailedValidation");
    
            // report deposit
            const reportId = ethers.zeroPadValue("0x01", 32);
            await expect(
              bascule
                .connect(reporter)
                .reportDeposits(reportId, [keccak256(signature)])
            )
              .to.emit(bascule, "DepositsReported")
              .withArgs(reportId, 1);
    
            // mint works
            await expect(
              lbtc
                .connect(msgSender)
                .mint(recipient, amount, signature)
            )
              .to.emit(lbtc, "Transfer")
              .withArgs(ethers.ZeroAddress, recipient, amount);
    
            const balanceAfter = await lbtc.balanceOf(recipient);
            const totalSupplyAfter = await lbtc.totalSupply();
    
            expect(balanceAfter - balanceBefore).to.be.eq(amount);
            expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(amount);
          });
        });
      });
    });

    describe("Negative cases", function () {
      let newConsortium: LombardConsortium;
      const defaultArgs = {
        signers: () => [signer1, signer2],
        mintRecipient: () => signer1.address,
        signatureRecipient: () => signer1.address,
        mintAmount: 100_000_000n,
        signatureAmount: 100_000_000n,
        nonce: 0,
        chainId: config.networks.hardhat.chainId,
        timestamp: () => snapshotTimestamp + 100,
        revertAt: () => newConsortium,
        targetContract: () => lbtc.getAddress(),
        validationContract: () => newConsortium.getAddress(),
        customError: "SignatureVerificationFailed",
      }
      let defaultSignature: string;
      
      beforeEach (async function () {
        // Use a bigger consortium to cover more cases
        newConsortium = await deployContract<LombardConsortium>(
          "LombardConsortium", 
          [[signer1.address, signer2.address], 
          deployer.address]
        );
        defaultSignature = await createSignature(
          defaultArgs.signers(), 
          "mint", 
          defaultArgs.nonce, 
          defaultArgs.timestamp(), 
          defaultArgs.chainId, 
          await defaultArgs.targetContract(), 
          await defaultArgs.validationContract(),
          [defaultArgs.signatureRecipient(), defaultArgs.signatureAmount]
        );
      })
  
      beforeEach(async function () {
        await lbtc.changeConsortium(await newConsortium.getAddress());
      })
  
      
      const args = [
        {
          ...defaultArgs,
          name: "not enough signatures",
          signers: () => [signer1],
          customError: "NotEnoughSignatures",
        },
        {
          ...defaultArgs,
          name: "chain is wrong",
          signers: () => [signer1, signer2],
          chainId: 1,
        },
        {
          ...defaultArgs,
          name: "amount is 0",
          mintAmount: 0,
          customError: "InvalidAmount",
          revertAt: () => lbtc
        },
        {
          ...defaultArgs,
          name: "recipient is 0 address",
          signers: () => [signer1, signer2],
          mintRecipient: () => ethers.ZeroAddress,
          customError: "ZeroAddress",
          revertAt: () => lbtc
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
          name: "Wrong signature amount",
          signatureAmount: 42,
        },
        {
          ...defaultArgs,
          name: "proof is expired",
          timestamp: () => snapshotTimestamp - 1,
          customError: "ProofExpired",
        },
        {
          ...defaultArgs,
          name: "unknown signer",
          signers: () => [signer1, deployer],
          customError: "PlayerNotFound",
        },
        {
          ...defaultArgs,
          name: "invalid target contract",
          targetContract: () => ethers.ZeroAddress,
        },
        {
          ...defaultArgs,
          name: "invalid validation contract",
          validationContract: () => ethers.ZeroAddress,
        },
      ];
      args.forEach(function (args) {
        it(`Reverts when ${args.name}`, async function () {
          const signature = await createSignature(
            args.signers(), 
            "mint", 
            args.nonce, 
            args.timestamp(), 
            args.chainId, 
            await args.targetContract(), 
            await args.validationContract(),
            [args.signatureRecipient(), args.signatureAmount]
          );
  
          await expect(
            lbtc.mint(args.mintRecipient(), args.mintAmount, signature)
          ).to.revertedWithCustomError(args.revertAt(), args.customError);
        });
      });
  
      it("Reverts when paused", async function () {
        await lbtc.transferPauserRole(deployer.address);
        await lbtc.pause();
        
        // try to use the same proof again
        await expect(
          lbtc.mint(defaultArgs.mintRecipient(), defaultArgs.mintAmount, defaultSignature)
        ).to.revertedWithCustomError(lbtc, "EnforcedPause");
      });
  
      describe("Wrong proof", function () {
        it("Reverts when proof already used", async function () {
          // use the proof
          await lbtc.mint(defaultArgs.mintRecipient(), defaultArgs.mintAmount, defaultSignature);
          // try to use the same proof again
          await expect(
            lbtc.mint(defaultArgs.mintRecipient(), defaultArgs.mintAmount, defaultSignature)
          ).to.revertedWithCustomError(lbtc, "ProofAlreadyUsed");
        });
    
        it("Reverts when signature and signers lenght mismatch", async function () {
          // Decode the signature to extract signers and signatures
          const [,,addrs,signatures] = ethers.AbiCoder.defaultAbiCoder().decode(
            ['uint256', 'uint256', 'address[]', 'bytes[]'],
            defaultSignature
          );
    
          // Re-encode the proof with mismatched lengths
          let mismatchedProof = ethers.AbiCoder.defaultAbiCoder().encode(
            ['uint256', 'uint256', 'address[]', 'bytes[]'],
            [defaultArgs.nonce, defaultArgs.timestamp(), [addrs[0]], signatures]
          );
    
          await expect(
            lbtc.mint(defaultArgs.mintRecipient(), defaultArgs.mintAmount, mismatchedProof)
          ).to.revertedWithCustomError(newConsortium, "LengthMismatch");
  
          mismatchedProof = ethers.AbiCoder.defaultAbiCoder().encode(
            ['uint256', 'uint256', 'address[]', 'bytes[]'],
            [defaultArgs.nonce, defaultArgs.timestamp(), addrs, [signatures[0]]]
          );
  
          await expect(
            lbtc.mint(defaultArgs.mintRecipient(), defaultArgs.mintAmount, mismatchedProof)
          ).to.revertedWithCustomError(newConsortium, "LengthMismatch");
        });
  
        it("Reverts when nonce is already used", async function () {
          // use the proof
          await lbtc.mint(defaultArgs.mintRecipient(), defaultArgs.mintAmount, defaultSignature);
  
          const signature = await createSignature(
            defaultArgs.signers(), 
            "mint", 
            defaultArgs.nonce, 
            defaultArgs.timestamp() + 1, // different expiry => different proof
            defaultArgs.chainId, 
            await lbtc.getAddress(),  
            await newConsortium.getAddress(),
            [defaultArgs.signatureRecipient(), defaultArgs.signatureAmount]
          );
          // try to use the same proof again
          await expect(
            lbtc.mint(defaultArgs.mintRecipient(), defaultArgs.mintAmount, signature)
          ).to.revertedWithCustomError(newConsortium, "NonceAlreadyUsed");
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
          ethers.zeroPadValue(signer2.address, 32),
          ethers.zeroPadValue(await lbtc2.getAddress(), 32),
          CHAIN_ID,
          amountWithoutFee
        );

      expect(await lbtc.balanceOf(signer1.address)).to.be.equal(0);
      expect(await lbtc.balanceOf(treasury.address)).to.be.equal(fee);
      expect((await lbtc.totalSupply()).toString()).to.be.equal(fee);
      
      expect(await lbtc2.balanceOf(signer2.address)).to.be.equal(0);
      expect(await lbtc2.totalSupply()).to.be.equal(0);

      let signature = await createSignature(
        [signer1],
        "withdrawFromBridge",
        0,
        snapshotTimestamp + 100,
        CHAIN_ID,
        await lbtc2.getAddress(),
        await consortium.getAddress(),
        [receiver, amountWithoutFee]
      );

      await expect(lbtc2.connect(signer2).withdrawFromBridge(receiver, amountWithoutFee, signature))
        .to.emit(lbtc2, "WithdrawFromBridge")
        .withArgs(
          receiver,
          amountWithoutFee,
          keccak256(signature)
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
        ethers.zeroPadValue(signer2.address, 32),
        amount
      ))
        .to.emit(lbtc2, "DepositToBridge")
        .withArgs(
          signer2.address,
          ethers.zeroPadValue(signer2.address, 32),
          ethers.zeroPadValue(await lbtc.getAddress(), 32),
          CHAIN_ID,
          amountWithoutFee
        );

      expect(await lbtc2.balanceOf(signer2.address)).to.be.equal(0);
      expect(await lbtc2.balanceOf(treasury.address)).to.be.equal(fee);
      expect(await lbtc2.totalSupply()).to.be.equal(fee);

      signature = await createSignature(
        [signer1],
        "withdrawFromBridge",
        1,
        snapshotTimestamp + 100,
        CHAIN_ID,
        await lbtc.getAddress(),
        await consortium.getAddress(),
        [receiver, amountWithoutFee]
      );

      await expect(lbtc.connect(signer2).withdrawFromBridge(receiver, amountWithoutFee, signature))
        .to.emit(lbtc, "WithdrawFromBridge")
        .withArgs(
          receiver,
          amountWithoutFee,
          keccak256(signature)
        );
    });

    it("withdrawFromBridge (with Bascule)", async () => {
      // Enable Bascule
      await lbtc.changeBascule(await bascule.getAddress());

      // Use the 2nd half of the full flow test to test the Bascule integration
      let amount = 10000n;;
      let receiver = signer3.address;

      let signature = await createSignature(
        [signer1],
        "withdrawFromBridge",
        1,
        snapshotTimestamp + 100,
        CHAIN_ID,
        await lbtc.getAddress(),
        await consortium.getAddress(),
        [receiver, amount]
      );

      // withdraw without report fails
      await expect(lbtc.connect(signer2).withdrawFromBridge(receiver, amount, signature))
        .to.be.revertedWithCustomError(bascule, "WithdrawalFailedValidation")
        .withArgs(keccak256(signature), amount);

      // report deposit
      const reportId = ethers.zeroPadValue("0x01", 32);
      await bascule.connect(reporter).reportDeposits(reportId, [keccak256(signature)]);

      // withdraw works
      await expect(
        lbtc.connect(signer2).withdrawFromBridge(receiver, amount, signature)
      )
        .to.emit(lbtc, "WithdrawFromBridge")
        .withArgs(
          receiver,
          amount,
          keccak256(signature)
        );
    });

    it("reverts: Non-consortium signing", async () => {
      let receiver = signer3.address;
      let amount = 1n;

      let signature = await createSignature(
        [signer2],
        "withdrawFromBridge",
        1,
        snapshotTimestamp + 100,
        CHAIN_ID,
        await lbtc.getAddress(),
        await consortium.getAddress(),
        [receiver, amount]
      );

      await expect(
        lbtc.connect(signer2).withdrawFromBridge(receiver, amount, signature)
      ).to.revertedWithCustomError(consortium, "PlayerNotFound")
        .withArgs(signer2.address);
    });
  });
});
