import { config, ethers } from "hardhat";
import { expect } from "chai";
import { takeSnapshot } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  enrichWithPrivateKeys,
  signOutputPayload,
  signBridgeDepositPayload,
  init, 
  deployBascule, 
  generatePermitSignature
} from "./helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LBTCMock, WBTCMock, Bascule } from "../typechain-types";
import { SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot";
import { getRandomValues } from "crypto";
import { Signer } from "ethers";

const CHAIN_ID = ethers.zeroPadValue("0x7A69", 32);

describe("LBTC", function () {
  let deployer: HardhatEthersSigner,
    consortium: HardhatEthersSigner,
    signer1: HardhatEthersSigner,
    signer2: HardhatEthersSigner,
    signer3: HardhatEthersSigner,
    treasury: HardhatEthersSigner,
    basculeReporter: HardhatEthersSigner,
    pauser: HardhatEthersSigner;
  let lbtc: LBTCMock;
  let lbtc2: LBTCMock;
  let snapshot: SnapshotRestorer;
  let wbtc: WBTCMock;
  let bascule: Bascule;

  before(async function () {
    [
      deployer,
      consortium,
      signer1,
      signer2,
      signer3,
      treasury,
      basculeReporter,
      pauser,
    ] = enrichWithPrivateKeys(await ethers.getSigners());
    const burnCommission = 1000;
    const result = await init(consortium, burnCommission);
    lbtc = result.lbtc;
    wbtc = result.wbtc;

    const result2 = await init(consortium, burnCommission);
    lbtc2 = result2.lbtc;

    await lbtc.changeTreasuryAddress(treasury);
    await lbtc2.changeTreasuryAddress(treasury);

    bascule = await deployBascule(basculeReporter, lbtc);

    snapshot = await takeSnapshot();
  });

  describe("Setters and getters", function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

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
      expect(await lbtc.consortium()).to.equal(consortium.address);
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

        const signedData = signOutputPayload(consortium.privateKey, {
          to: recipient.address,
          amount,
        });
        await expect(
          lbtc
            .connect(msgSender)
            ["mint(bytes,bytes)"](signedData.data, signedData.signature)
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
  describe("Mint positive cases (with Bascule)", function () {
    before(async function () {
      await snapshot.restore();
      await expect(lbtc.changeBascule(await bascule.getAddress()))
        .to.emit(lbtc, "BasculeChanged")
        .withArgs(ethers.ZeroAddress, await bascule.getAddress());
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

        const signedData = signOutputPayload(consortium.privateKey, {
          to: recipient.address,
          amount,
        });

        // mint without report fails
        await expect(
          lbtc
            .connect(msgSender)
            ["mint(bytes,bytes)"](signedData.data, signedData.signature)
        ).to.be.revertedWithCustomError(bascule, "WithdrawalFailedValidation");

        // report deposit
        const reportId = ethers.zeroPadValue("0x01", 32);
        await expect(
          bascule
            .connect(basculeReporter)
            .reportDeposits(reportId, [signedData.hash])
        )
          .to.emit(bascule, "DepositsReported")
          .withArgs(reportId, 1);

        // mint works
        await expect(
          lbtc
            .connect(msgSender)
            ["mint(bytes,bytes)"](signedData.data, signedData.signature)
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
        signOutputPayload,
        recipient: () => signer1.address,
        amount: 100_000_000n,
        chainId: config.networks.hardhat.chainId,
        customError: "SignatureVerificationFailed",
      },
      {
        name: "data does not match hash",
        signer: () => signer1,
        signOutputPayload: function (
          privateKey: string,
          data: { to: string; amount: bigint; chainId?: number }
        ): {
          data: string;
          hash: string;
          signature: string;
        } {
          const result1 = signOutputPayload(privateKey, data);
          const result2 = signOutputPayload(privateKey, {
            to: signer2.address,
            amount: 100_000_000n,
          });
          return {
            data: result1.data,
            hash: "",
            signature: result2.signature,
          };
        },
        recipient: () => signer1.address,
        amount: 100_000_000n,
        chainId: config.networks.hardhat.chainId,
        customError: "SignatureVerificationFailed",
      },
      {
        name: "chain is wrong",
        signer: () => consortium,
        signOutputPayload,
        recipient: () => signer1.address,
        amount: 100_000_000n,
        chainId: 1,
        customError: "BadChainId",
      },
      {
        name: "amount is 0",
        signer: () => consortium,
        signOutputPayload,
        recipient: () => signer1.address,
        amount: 0n,
        chainId: config.networks.hardhat.chainId,
        customError: "ZeroAmount",
      },
      {
        name: "recipient is 0 address",
        signer: () => consortium,
        signOutputPayload,
        recipient: () => ethers.ZeroAddress,
        amount: 100_000_000n,
        chainId: config.networks.hardhat.chainId,
        customError: "WrongAddressEncoding",
      },
    ];
    args.forEach(function (arg) {
      it(`Reverts when ${arg.name}`, async function () {
        const amount = arg.amount;
        const recipient = arg.recipient();
        const signer = arg.signer();
        const signedData = arg.signOutputPayload(signer.privateKey, {
          to: recipient,
          amount: amount,
          chainId: arg.chainId,
        });

        if (arg.customError) {
          await expect(
            lbtc["mint(bytes,bytes)"](signedData.data, signedData.signature)
          ).to.revertedWithCustomError(lbtc, arg.customError);
        } else if (arg.errorMessage) {
          await expect(
            lbtc["mint(bytes,bytes)"](signedData.data, signedData.signature)
          ).to.revertedWith(arg.errorMessage);
        } else {
          await expect(lbtc.mint(signedData.data, signedData.signature)).to.be
            .reverted;
        }
      });
    });

    it("Reverts when proof already used", async function () {
      const amount = 100_000_000n;
      const signedData = signOutputPayload(consortium.privateKey, {
        to: signer1.address,
        amount,
      });
      await lbtc["mint(bytes,bytes)"](signedData.data, signedData.signature);
      await expect(
        lbtc["mint(bytes,bytes)"](signedData.data, signedData.signature)
      ).to.revertedWithCustomError(lbtc, "ProofAlreadyUsed");
    });

    it("Reverts when paused", async function () {
      await lbtc.transferPauserRole(deployer.address);
      await lbtc.pause();
      const amount = 100_000_000n;
      const signedData = signOutputPayload(consortium.privateKey, {
        to: signer1.address,
        amount,
      });
      await expect(
        lbtc["mint(bytes,bytes)"](signedData.data, signedData.signature)
      ).to.revertedWithCustomError(lbtc, "EnforcedPause");
    });
  });

  describe("Burn positive cases", function () {
    beforeEach(async function () {
      await snapshot.restore();
      await lbtc.toggleWithdrawals();
    });

    it("Unstake half with P2WPKH", async () => {
      const amount = 100_000_000n;
      const halfAmount = amount / 2n;
      const p2wpkh = "0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03";

      const burnCommission = await lbtc.getBurnCommission();

      const expectedAmountAfterFee = halfAmount - BigInt(burnCommission);

      await lbtc["mint(address,uint256)"](await signer1.getAddress(), amount);
      await expect(lbtc.connect(signer1).redeem(p2wpkh, halfAmount))
        .to.emit(lbtc, "UnstakeRequest")
        .withArgs(await signer1.getAddress(), p2wpkh, expectedAmountAfterFee);
    });

    it("Unstake full with P2TR", async () => {
      const amount = 100_000_000n;
      const p2tr =
        "0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947";

      const burnCommission = await lbtc.getBurnCommission();

      const expectedAmountAfterFee = amount - BigInt(burnCommission);
      await lbtc["mint(address,uint256)"](await signer1.getAddress(), amount);
      await expect(lbtc.connect(signer1).redeem(p2tr, amount))
        .to.emit(lbtc, "UnstakeRequest")
        .withArgs(await signer1.getAddress(), p2tr, expectedAmountAfterFee);
    });

    it("Unstake with commission", async () => {
      const amount = 100_000_000n;
      const commission = 1_000_000n;
      const p2tr =
        "0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947";

      await expect(lbtc.changeBurnCommission(commission))
        .to.emit(lbtc, "BurnCommissionChanged")
        .withArgs(1000, commission);

      await lbtc["mint(address,uint256)"](await signer1.getAddress(), amount);

      await expect(lbtc.connect(signer1).redeem(p2tr, amount))
        .to.emit(lbtc, "UnstakeRequest")
        .withArgs(await signer1.getAddress(), p2tr, amount - commission);
    });

    it("Unstake full with P2WSH", async () => {
      const amount = 100_000_000n;
      const p2wsh =
        "0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3";
      await lbtc["mint(address,uint256)"](await signer1.getAddress(), amount);

      // Get the burn commission
      const burnCommission = await lbtc.getBurnCommission();

      // Calculate expected amount after fee
      const expectedAmountAfterFee = amount - BigInt(burnCommission);

      await expect(lbtc.connect(signer1).redeem(p2wsh, amount))
        .to.emit(lbtc, "UnstakeRequest")
        .withArgs(await signer1.getAddress(), p2wsh, expectedAmountAfterFee);
    });
  });

  describe("Burn negative cases", function () {
    beforeEach(async function () {
      await snapshot.restore();
      await lbtc.toggleWithdrawals();
    });

    it("Reverts when withdrawals off", async function () {
      await lbtc.toggleWithdrawals();
      const amount = 100_000_000n;
      await lbtc["mint(address,uint256)"](await signer1.getAddress(), amount);
      await expect(
        lbtc.redeem("0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03", amount)
      ).to.revertedWithCustomError(lbtc, "WithdrawalsDisabled");
    });

    it("Reverts if amount is less than burn commission", async function () {
      const burnCommission = await lbtc.getBurnCommission();
      const amountLessThanCommission = BigInt(burnCommission) - 1n;

      await lbtc["mint(address,uint256)"](
        await signer1.getAddress(),
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

      await lbtc["mint(address,uint256)"](
        await signer1.getAddress(),
        amountJustBelowDustLimit
      );

      await expect(
        lbtc.connect(signer1).redeem(p2wsh, amountJustBelowDustLimit)
      ).to.be.revertedWithCustomError(lbtc, "AmountBelowDustLimit");
    });

    it("Revert with P2SH", async () => {
      const amount = 100_000_000n;
      const p2sh = "0xa914aec38a317950a98baa9f725c0cb7e50ae473ba2f87";
      await lbtc["mint(address,uint256)"](await signer1.getAddress(), amount);
      await expect(
        lbtc.connect(signer1).redeem(p2sh, amount)
      ).to.be.revertedWithCustomError(lbtc, "ScriptPubkeyUnsupported");
    });

    it("Reverts with P2PKH", async () => {
      const amount = 100_000_000n;
      const p2pkh = "0x76a914aec38a317950a98baa9f725c0cb7e50ae473ba2f88ac";
      await lbtc["mint(address,uint256)"](await signer1.getAddress(), amount);
      await expect(
        lbtc.connect(signer1).redeem(p2pkh, amount)
      ).to.be.revertedWithCustomError(lbtc, "ScriptPubkeyUnsupported");
    });

    it("Reverts with P2PK", async () => {
      const amount = 100_000_000n;
      const p2pk =
        "0x4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac";
      await lbtc["mint(address,uint256)"](await signer1.getAddress(), amount);
      await expect(
        lbtc.connect(signer1).redeem(p2pk, amount)
      ).to.be.revertedWithCustomError(lbtc, "ScriptPubkeyUnsupported");
    });

    it("Reverts with P2MS", async () => {
      const amount = 100_000_000n;
      const p2ms =
        "0x524104d81fd577272bbe73308c93009eec5dc9fc319fc1ee2e7066e17220a5d47a18314578be2faea34b9f1f8ca078f8621acd4bc22897b03daa422b9bf56646b342a24104ec3afff0b2b66e8152e9018fe3be3fc92b30bf886b3487a525997d00fd9da2d012dce5d5275854adc3106572a5d1e12d4211b228429f5a7b2f7ba92eb0475bb14104b49b496684b02855bc32f5daefa2e2e406db4418f3b86bca5195600951c7d918cdbe5e6d3736ec2abf2dd7610995c3086976b2c0c7b4e459d10b34a316d5a5e753ae";
      await lbtc["mint(address,uint256)"](await signer1.getAddress(), amount);
      await expect(
        lbtc.connect(signer1).redeem(p2ms, amount)
      ).to.be.revertedWithCustomError(lbtc, "ScriptPubkeyUnsupported");
    });

    it("Reverts not enough to pay commission", async () => {
      const amount = 999_999n;
      const commission = 1_000_000n;
      const p2tr =
        "0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947";

      await expect(lbtc.changeBurnCommission(commission))
        .to.emit(lbtc, "BurnCommissionChanged")
        .withArgs(1000, commission);

      await lbtc["mint(address,uint256)"](await signer1.getAddress(), amount);

      await expect(lbtc.connect(signer1).redeem(p2tr, amount))
        .to.revertedWithCustomError(lbtc, "AmountLessThanCommission")
        .withArgs(commission);
    });
  });

  describe("Permit", function () {
    let timestamp: number;
    let chainId: bigint;

    before(async function () {
      const block = await ethers.provider.getBlock("latest");
      timestamp = block!.timestamp;  
      chainId = (await ethers.provider.getNetwork()).chainId; 
    });

    beforeEach(async function () {
      // Initialize the permit module
      await lbtc.reinitialize();      

      // Mint some tokens
      await lbtc["mint(address,uint256)"](signer1.address, 100_000_000n);
    });

    afterEach(async function () {
      await snapshot.restore();
    });

    it("should transfer funds with permit", async function () {
      // generate permit signature
      const { v, r, s } = await generatePermitSignature(lbtc, signer1, signer2.address, 10_000n, timestamp + 100, chainId, 0);
      
      await lbtc.permit(signer1.address, signer2.address, 10_000n, timestamp + 100, v, r, s);
      
      // check allowance
      expect(await lbtc.allowance(signer1.address, signer2.address)).to.equal(10_000n);

      // check transferFrom
      await lbtc.connect(signer2).transferFrom(signer1.address, signer3.address, 10_000n);
      expect(await lbtc.balanceOf(signer3.address)).to.equal(10_000n);

      // check nonce is incremented
      expect(await lbtc.nonces(signer1.address)).to.equal(1);
    });

    it("should fail if permit params don't match the signature", async function () {
      // generate permit signature
      const { v, r, s } = await generatePermitSignature(lbtc, signer1, signer2.address, 10_000n, timestamp + 100, chainId, 0);

      const params: [Signer, string, bigint, number][] = [
        [signer1, signer3.address, 10_000n, timestamp + 100],   // wrong spender
        [signer3, signer2.address, 10_000n, timestamp + 100],   // wrong signer
        [signer1, signer2.address, 10_000n, timestamp + 1],     // wrong deadline
        [signer1, signer2.address, 1n, timestamp + 100],        // wrong value
        [signer1, signer2.address, 10_000n, timestamp + 100],   // wrong chainId
      ];
      params.forEach(async ([signer, spender, value, deadline]) => {
        await expect(lbtc.permit(signer, spender, value, deadline, v, r, s))
          .to.be.revertedWithCustomError(lbtc, "ERC2612InvalidSigner");
      });
    });

    it("should fail if signature don't match permit params", async function () {
      // generate permit signature
      const signaturesData: [Signer, string, bigint, number, bigint, number][] = [
        [signer3, signer2.address, 10_000n, timestamp + 100, chainId, 0],   // wrong signer
        [signer1, signer3.address, 10_000n, timestamp + 100, chainId, 0],   // wrong spender
        [signer1, signer2.address, 1n, timestamp + 100, chainId, 0],        // wrong value
        [signer1, signer2.address, 10_000n, timestamp + 1, chainId, 0],     // wrong deadline
        [signer1, signer2.address, 10_000n, timestamp + 100, 1234n, 0],     // wrong chainId
        [signer1, signer2.address, 1n, timestamp + 100, chainId, 1]         // wrong nonce
      ];
      signaturesData.forEach(async ([signer, spender, value, deadline, chainId, nonce]) => {
        const { v, r, s } = await generatePermitSignature(lbtc, signer, spender, value, deadline, chainId, nonce);
        await expect(lbtc.permit(signer1, signer2.address, 10_000n, timestamp + 100, v, r, s))
          .to.be.revertedWithCustomError(lbtc, "ERC2612InvalidSigner");
      });
    });
  });

  describe("Bridge", function () {
    const absoluteFee = 100n;

    beforeEach(async function () {
      await snapshot.restore();

      await lbtc["mint(address,uint256)"](
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
      let amount = await lbtc.MAX_COMMISSION();

      let fee =
        (amount * (await lbtc.getDepositRelativeCommission(CHAIN_ID))) /
        (await lbtc.MAX_COMMISSION());

      let amountWithoutFee = amount - fee;

      let depositPromise = lbtc
        .connect(signer1)
        .depositToBridge(
          CHAIN_ID,
          ethers.zeroPadValue(signer2.address, 32),
          amount
        );
      await expect(depositPromise)
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

      let depositTx = await (await depositPromise).wait();
      if (!depositTx) {
        throw Error("deposit tx not confirmed");
      }

      const { data, hash, signature } = signBridgeDepositPayload(
        consortium.privateKey,
        ethers.zeroPadValue(await lbtc.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(await lbtc2.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(signer2.address, 32),
        amountWithoutFee,
        depositTx.hash,
        1
      );

      expect(await lbtc2.balanceOf(signer2.address)).to.be.equal(0);
      expect(await lbtc2.totalSupply()).to.be.equal(0);

      await expect(lbtc2.connect(signer2).withdrawFromBridge(data, signature))
        .to.emit(lbtc2, "WithdrawFromBridge")
        .withArgs(
          signer2.address,
          depositTx.hash,
          1,
          hash,
          ethers.zeroPadValue(await lbtc.getAddress(), 32),
          CHAIN_ID,
          amountWithoutFee
        );
      expect((await lbtc2.totalSupply()).toString()).to.be.equal(amount - fee);
      expect((await lbtc2.balanceOf(signer2.address)).toString()).to.be.equal(
        amountWithoutFee
      );

      // bridge back

      amount = amountWithoutFee;

      fee =
        (amount * (await lbtc2.getDepositRelativeCommission(CHAIN_ID))) /
        (await lbtc.MAX_COMMISSION());
      fee = (fee === 0n ? 1n : fee) + absoluteFee;

      amountWithoutFee = amount - fee;

      depositPromise = lbtc2
        .connect(signer2)
        .depositToBridge(
          CHAIN_ID,
          ethers.zeroPadValue(signer2.address, 32),
          amount
        );
      await expect(depositPromise)
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

      depositTx = await (await depositPromise).wait();
      if (!depositTx) {
        throw Error("deposit tx not confirmed");
      }

      const {
        data: data2,
        hash: hash2,
        signature: signature2,
      } = signBridgeDepositPayload(
        consortium.privateKey,
        ethers.zeroPadValue(await lbtc2.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(await lbtc.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(signer2.address, 32),
        amountWithoutFee,
        depositTx.hash,
        1
      );

      await expect(lbtc.connect(signer2).withdrawFromBridge(data2, signature2))
        .to.emit(lbtc, "WithdrawFromBridge")
        .withArgs(
          signer2.address,
          depositTx.hash,
          1,
          hash2,
          ethers.zeroPadValue(await lbtc2.getAddress(), 32),
          CHAIN_ID,
          amountWithoutFee
        );
    });

    it("withdrawFromBridge (with Bascule)", async () => {
      // Enable Bascule
      await expect(lbtc.changeBascule(await bascule.getAddress()))
        .to.emit(lbtc, "BasculeChanged")
        .withArgs(ethers.ZeroAddress, await bascule.getAddress());

      // Use the 2nd half of the full flow test to test the Bascule integration
      let amount = await lbtc.MAX_COMMISSION();

      let fee =
        (amount * (await lbtc.getDepositRelativeCommission(CHAIN_ID))) /
        (await lbtc.MAX_COMMISSION());

      let amountWithoutFee = amount - fee;

      // Since we don't perform the first half of the full flow (deposit on the
      // other chain), we just make up a random deposit tx hash
      const depositTxHash = `0x${Buffer.from(
        getRandomValues(new Uint8Array(32))
      ).toString("hex")}`;
      const {
        data: data2,
        hash: hash2,
        signature: signature2,
      } = signBridgeDepositPayload(
        consortium.privateKey,
        ethers.zeroPadValue(await lbtc2.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(await lbtc.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(signer2.address, 32),
        amountWithoutFee,
        depositTxHash,
        1
      );

      // withdraw without report fails
      await expect(
        lbtc.connect(signer2).withdrawFromBridge(data2, signature2)
      ).to.be.revertedWithCustomError(bascule, "WithdrawalFailedValidation");

      // report deposit
      const reportId = ethers.zeroPadValue("0x01", 32);
      await expect(
        bascule.connect(basculeReporter).reportDeposits(reportId, [hash2])
      )
        .to.emit(bascule, "DepositsReported")
        .withArgs(reportId, 1);

      // withdraw works
      await expect(lbtc.connect(signer2).withdrawFromBridge(data2, signature2))
        .to.emit(lbtc, "WithdrawFromBridge")
        .withArgs(
          signer2.address,
          depositTxHash,
          1,
          hash2,
          ethers.zeroPadValue(await lbtc2.getAddress(), 32),
          CHAIN_ID,
          amountWithoutFee
        );
    });

    it("reverts: Non-consortium signing", async () => {
      const block = await ethers.provider.getBlock("latest");
      if (!block || !block.hash) {
        throw Error("no block found");
      }

      const { data, signature } = signBridgeDepositPayload(
        signer1.privateKey,
        ethers.zeroPadValue(await lbtc.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(await lbtc2.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(signer2.address, 32),
        20_000n,
        block.hash,
        1
      );

      await expect(
        lbtc2.connect(signer2).withdrawFromBridge(data, signature)
      ).to.revertedWithCustomError(lbtc2, "SignatureVerificationFailed");
    });

    it("reverts: chain id from zero", async () => {
      const block = await ethers.provider.getBlock("latest");
      if (!block || !block.hash) {
        throw Error("no block found");
      }

      const { data, signature } = signBridgeDepositPayload(
        consortium.privateKey,
        ethers.zeroPadValue(await lbtc.getAddress(), 32),
        ethers.zeroPadValue("0x", 32),
        ethers.zeroPadValue(await lbtc2.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(signer2.address, 32),
        20_000n,
        block.hash,
        1
      );

      await expect(
        lbtc2.connect(signer2).withdrawFromBridge(data, signature)
      ).to.revertedWithCustomError(lbtc2, "ZeroChainId");
    });

    it("reverts: zero tx hash", async () => {
      const { data, signature } = signBridgeDepositPayload(
        consortium.privateKey,
        ethers.zeroPadValue(await lbtc.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(await lbtc2.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(signer2.address, 32),
        20_000n,
        ethers.zeroPadValue("0x", 32),
        1
      );

      await expect(
        lbtc2.connect(signer2).withdrawFromBridge(data, signature)
      ).to.revertedWithCustomError(lbtc2, "ZeroTxHash");
    });

    it("reverts: bad destination contract", async () => {
      const block = await ethers.provider.getBlock("latest");
      if (!block || !block.hash) {
        throw Error("no block found");
      }

      const { data, signature } = signBridgeDepositPayload(
        consortium.privateKey,
        ethers.zeroPadValue(await lbtc.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(signer2.address, 32),
        CHAIN_ID,
        ethers.zeroPadValue(signer2.address, 32),
        20_000n,
        block.hash,
        1
      );

      await expect(lbtc2.connect(signer2).withdrawFromBridge(data, signature))
        .to.revertedWithCustomError(lbtc2, "BadToContractAddress")
        .withArgs(await lbtc2.getAddress(), signer2.address);
    });

    it("reverts: bad destination contract", async () => {
      const block = await ethers.provider.getBlock("latest");
      if (!block || !block.hash) {
        throw Error("no block found");
      }

      const { data, signature } = signBridgeDepositPayload(
        consortium.privateKey,
        ethers.zeroPadValue(signer2.address, 32),
        CHAIN_ID,
        ethers.zeroPadValue(await lbtc.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(signer2.address, 32),
        20_000n,
        block.hash,
        1
      );

      await expect(
        lbtc2.connect(signer2).withdrawFromBridge(data, signature)
      ).to.revertedWithCustomError(lbtc2, "BadDestination");
    });

    it("reverts: bad destination chain id", async () => {
      const block = await ethers.provider.getBlock("latest");
      if (!block || !block.hash) {
        throw Error("no block found");
      }

      const { data, signature } = signBridgeDepositPayload(
        consortium.privateKey,
        ethers.zeroPadValue(await lbtc2.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(await lbtc.getAddress(), 32),
        ethers.zeroPadValue("0xCAFE", 32),
        ethers.zeroPadValue(signer2.address, 32),
        20_000n,
        block.hash,
        1
      );

      await expect(
        lbtc2.connect(signer2).withdrawFromBridge(data, signature)
      ).to.revertedWithCustomError(lbtc2, "BadDestination");
    });

    it("reverts: zero to address", async () => {
      const block = await ethers.provider.getBlock("latest");
      if (!block || !block.hash) {
        throw Error("no block found");
      }

      const { data, signature } = signBridgeDepositPayload(
        consortium.privateKey,
        ethers.zeroPadValue(await lbtc.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(await lbtc2.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(ethers.ZeroAddress, 32),
        20_000n,
        block.hash,
        1
      );

      await expect(
        lbtc2.connect(signer2).withdrawFromBridge(data, signature)
      ).to.revertedWithCustomError(lbtc2, "ZeroAddress");
    });

    it("reverts: zero amount", async () => {
      const block = await ethers.provider.getBlock("latest");
      if (!block || !block.hash) {
        throw Error("no block found");
      }

      const { data, signature } = signBridgeDepositPayload(
        consortium.privateKey,
        ethers.zeroPadValue(await lbtc.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue(await lbtc2.getAddress(), 32),
        CHAIN_ID,
        ethers.zeroPadValue("0xCAFE", 32),
        0n,
        block.hash,
        1
      );

      await expect(
        lbtc2.connect(signer2).withdrawFromBridge(data, signature)
      ).to.revertedWithCustomError(lbtc2, "ZeroAmount");
    });
  });
});
