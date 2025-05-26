import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  deployContract,
  getSignersWithPrivateKeys,
  CHAIN_ID,
  generatePermitSignature,
  NEW_VALSET,
  getPayloadForAction,
  Signer,
  initNativeLBTC,
  signDepositBtcV1Payload,
  DEFAULT_LBTC_DUST_FEE_RATE
} from './helpers';
import { Bascule, Consortium, NativeLBTC } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';

describe('NativeLBTC', function () {
  let deployer: Signer,
    signer1: Signer,
    signer2: Signer,
    signer3: Signer,
    treasury: Signer,
    reporter: Signer,
    admin: Signer,
    pauser: Signer;
  let nativeLbtc: NativeLBTC;
  let nativeLbtc2: NativeLBTC;
  let bascule: Bascule;
  let snapshot: SnapshotRestorer;
  let snapshotTimestamp: number;
  let consortium: Consortium;
  let consortium2: Consortium;

  before(async function () {
    [deployer, signer1, signer2, signer3, treasury, admin, pauser, reporter] = await getSignersWithPrivateKeys();

    const burnCommission = 1000;

    const result = await initNativeLBTC(burnCommission, treasury.address, deployer.address);
    nativeLbtc = result.lbtc;
    consortium = result.consortium;

    const result2 = await initNativeLBTC(burnCommission, treasury.address, deployer.address);
    nativeLbtc2 = result2.lbtc;
    consortium2 = result2.consortium;

    bascule = await deployContract<Bascule>(
      'Bascule',
      [admin.address, pauser.address, reporter.address, await nativeLbtc.getAddress(), 100],
      false
    );

    // set deployer as minter for lbtc
    await nativeLbtc.grantRole(await nativeLbtc.MINTER_ROLE(), deployer.address);
    await nativeLbtc2.grantRole(await nativeLbtc.MINTER_ROLE(), deployer.address);

    // set deployer as claimer for nativeLbtc
    await nativeLbtc.grantRole(await nativeLbtc.CLAIMER_ROLE(), deployer.address);
    await nativeLbtc2.grantRole(await nativeLbtc.CLAIMER_ROLE(), deployer.address);

    // set deployer as operator for nativeLbtc
    await nativeLbtc.grantRole(await nativeLbtc.OPERATOR_ROLE(), deployer.address);
    await nativeLbtc2.grantRole(await nativeLbtc.OPERATOR_ROLE(), deployer.address);

    snapshot = await takeSnapshot();
    snapshotTimestamp = (await ethers.provider.getBlock('latest'))!.timestamp;
  });

  afterEach(async function () {
    // clean the state after each test
    await snapshot.restore();
  });

  describe('Setters and getters', function () {
    it('treasury() is set', async function () {
      expect(await nativeLbtc.getTreasury()).to.equal(treasury.address);
      expect(await nativeLbtc2.getTreasury()).to.equal(treasury.address);
    });

    it('owner() is deployer', async function () {
      expect(await nativeLbtc.hasRole(await nativeLbtc.DEFAULT_ADMIN_ROLE(), deployer.address)).to.equal(true);
    });

    it('decimals()', async function () {
      expect(await nativeLbtc.decimals()).to.equal(8n);
    });

    it('consortium()', async function () {
      expect(await nativeLbtc.consortium()).to.equal(await consortium.getAddress());
      expect(await nativeLbtc2.consortium()).to.equal(await consortium2.getAddress());
    });

    it('Bascule() unset', async function () {
      expect(await nativeLbtc.Bascule()).to.be.equal(ethers.ZeroAddress);
    });

    it('pause() turns on enforced pause', async function () {
      expect(await nativeLbtc.paused()).to.be.false;
      expect(await nativeLbtc.grantRole(await nativeLbtc.PAUSER_ROLE(), pauser.address));
      await expect(nativeLbtc.connect(pauser).pause()).to.emit(nativeLbtc, 'Paused').withArgs(pauser.address);
      expect(await nativeLbtc.paused()).to.be.true;
    });

    it('pause() reverts when called by not an pauser', async function () {
      await expect(nativeLbtc.connect(signer1).pause())
        .to.revertedWithCustomError(nativeLbtc, 'AccessControlUnauthorizedAccount')
        .withArgs(signer1.address, await nativeLbtc.PAUSER_ROLE());
    });

    it('unpause() turns off enforced pause', async function () {
      await expect(nativeLbtc.grantRole(await nativeLbtc.PAUSER_ROLE(), pauser.address));

      await nativeLbtc.connect(pauser).pause();
      expect(await nativeLbtc.paused()).to.be.true;
      await expect(nativeLbtc.connect(deployer).unpause()).to.emit(nativeLbtc, 'Unpaused').withArgs(deployer);
      expect(await nativeLbtc.paused()).to.be.false;
    });

    it('unpause() reverts when called by not an pauser', async function () {
      await expect(nativeLbtc.grantRole(await nativeLbtc.PAUSER_ROLE(), pauser.address));
      await nativeLbtc.connect(pauser).pause();
      expect(await nativeLbtc.paused()).to.be.true;
      await expect(nativeLbtc.connect(signer1).unpause())
        .to.revertedWithCustomError(nativeLbtc, 'AccessControlUnauthorizedAccount')
        .withArgs(signer1.address, await nativeLbtc.DEFAULT_ADMIN_ROLE());
    });

    it('toggleWithdrawals() enables or disables burn', async function () {
      await expect(nativeLbtc.toggleWithdrawals()).to.emit(nativeLbtc, 'WithdrawalsEnabled').withArgs(true);

      await expect(nativeLbtc.toggleWithdrawals()).to.emit(nativeLbtc, 'WithdrawalsEnabled').withArgs(false);
    });

    it('toggleWithdrawals() reverts when called by not an owner', async function () {
      await expect(nativeLbtc.connect(signer1).toggleWithdrawals()).to.revertedWithCustomError(
        nativeLbtc,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('changeBascule', async function () {
      await expect(nativeLbtc.changeBascule(await bascule.getAddress()))
        .to.emit(nativeLbtc, 'BasculeChanged')
        .withArgs(ethers.ZeroAddress, await bascule.getAddress());
      await expect(nativeLbtc.changeBascule(ethers.ZeroAddress))
        .to.emit(nativeLbtc, 'BasculeChanged')
        .withArgs(await bascule.getAddress(), ethers.ZeroAddress);
    });

    it('should set mint fee by operator', async function () {
      await expect(nativeLbtc.setMintFee(1234)).to.emit(nativeLbtc, 'FeeChanged').withArgs(0, 1234);
      expect(await nativeLbtc.getMintFee()).to.be.equal(1234);
    });

    it('should fail to set mint fee if not operator', async function () {
      await expect(nativeLbtc.connect(signer1).setMintFee(1))
        .to.revertedWithCustomError(nativeLbtc, 'AccessControlUnauthorizedAccount')
        .withArgs(signer1.address, await nativeLbtc.OPERATOR_ROLE());
    });

    it('changeTreasuryAddres() fails if not owner', async function () {
      await expect(nativeLbtc.connect(signer1).changeTreasuryAddress(signer1.address)).to.revertedWithCustomError(
        nativeLbtc,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('changeTreasuryAddres() fails if setting treasury to zero address', async function () {
      await expect(nativeLbtc.changeTreasuryAddress(ethers.ZeroAddress)).to.revertedWithCustomError(
        nativeLbtc,
        'ZeroAddress'
      );
    });

    it('should get the default dust fee rate', async function () {
      expect(await nativeLbtc.getDustFeeRate()).to.be.equal(DEFAULT_LBTC_DUST_FEE_RATE);
    });

    it('changeDustFeeRate() fails if not owner', async function () {
      await expect(nativeLbtc.connect(signer1).changeDustFeeRate(BigInt(1000))).to.revertedWithCustomError(
        nativeLbtc,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('changeDustFeeRate() fails if setting to 0', async function () {
      await expect(nativeLbtc.changeDustFeeRate(0)).to.revertedWithCustomError(nativeLbtc, 'InvalidDustFeeRate');
    });

    it('changeDustFeeRate() succeeds with non zero dust fee', async function () {
      let defaultDustFeeRate = await nativeLbtc.getDustFeeRate();
      let newDustFeeRate = defaultDustFeeRate + BigInt(1000);
      await expect(nativeLbtc.changeDustFeeRate(newDustFeeRate))
        .to.emit(nativeLbtc, 'DustFeeRateChanged')
        .withArgs(defaultDustFeeRate, newDustFeeRate);
      // restore for next tests
      await nativeLbtc.changeDustFeeRate(defaultDustFeeRate);
    });
  });

  describe('Mint V1', function () {
    describe('Negative cases', function () {
      let newConsortium: Consortium;
      const defaultTxId = ethers.hexlify(ethers.randomBytes(32));
      const defaultArgs = {
        signers: () => [signer1, signer2],
        signatures: [true, true],
        threshold: 2,
        mintRecipient: () => signer1,
        signatureRecipient: () => signer1,
        mintAmount: 100_000_000n,
        signatureAmount: 100_000_000n,
        destinationContract: () => nativeLbtc.getAddress(),
        signatureDestinationContract: () => nativeLbtc.getAddress(),
        chainId: CHAIN_ID,
        signatureChainId: CHAIN_ID,
        executionChain: CHAIN_ID,
        caller: () => nativeLbtc.getAddress(),
        verifier: () => newConsortium.getAddress(),
        epoch: 1,
        txId: defaultTxId,
        signatureTxId: defaultTxId,
        interface: () => newConsortium,
        customError: 'NotEnoughSignatures',
        params: () => []
      };
      let defaultProof: string;
      let defaultPayload: string;

      beforeEach(async function () {
        // Use a bigger consortium to cover more cases
        newConsortium = await deployContract<Consortium>('Consortium', [deployer.address]);
        const valset = getPayloadForAction([1, [signer1.publicKey, signer2.publicKey], [1, 1], 2, 1], NEW_VALSET);
        await newConsortium.setInitialValidatorSet(valset);
        const data = await signDepositBtcV1Payload(
          defaultArgs.signers(),
          defaultArgs.signatures,
          defaultArgs.signatureChainId,
          defaultArgs.signatureRecipient().address,
          defaultArgs.signatureAmount,
          defaultArgs.signatureTxId,
          await nativeLbtc.getAddress()
        );
        defaultProof = data.proof;
        defaultPayload = data.payload;

        await nativeLbtc.changeConsortium(await newConsortium.getAddress());
      });
    });
  });

  describe('Burn', function () {
    beforeEach(async function () {
      await nativeLbtc.toggleWithdrawals();
    });

    describe('Positive cases', function () {
      it('Unstake half with P2WPKH', async () => {
        const amount = 100_000_000n;
        const halfAmount = amount / 2n;
        const p2wpkh = '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03';

        const burnCommission = await nativeLbtc.getBurnCommission();

        const expectedAmountAfterFee = halfAmount - BigInt(burnCommission);

        await nativeLbtc.connect(deployer)['mint(address,uint256)'](signer1.address, amount);
        await expect(nativeLbtc.connect(signer1).redeem(p2wpkh, halfAmount))
          .to.emit(nativeLbtc, 'UnstakeRequest')
          .withArgs(signer1.address, p2wpkh, expectedAmountAfterFee);
      });

      it('Unstake full with P2TR', async () => {
        const amount = 100_000_000n;
        const p2tr = '0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947';

        const burnCommission = await nativeLbtc.getBurnCommission();

        const expectedAmountAfterFee = amount - BigInt(burnCommission);
        await nativeLbtc.connect(deployer)['mint(address,uint256)'](signer1.address, amount);
        await expect(nativeLbtc.connect(signer1).redeem(p2tr, amount))
          .to.emit(nativeLbtc, 'UnstakeRequest')
          .withArgs(signer1.address, p2tr, expectedAmountAfterFee);
      });

      it('Unstake with commission', async () => {
        const amount = 100_000_000n;
        const commission = 1_000_000n;
        const p2tr = '0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947';

        await nativeLbtc.changeBurnCommission(commission);

        await nativeLbtc.connect(deployer)['mint(address,uint256)'](signer1.address, amount);

        await expect(nativeLbtc.connect(signer1).redeem(p2tr, amount))
          .to.emit(nativeLbtc, 'UnstakeRequest')
          .withArgs(signer1.address, p2tr, amount - commission);
      });

      it('Unstake full with P2WSH', async () => {
        const amount = 100_000_000n;
        const p2wsh = '0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3';
        await nativeLbtc.connect(deployer)['mint(address,uint256)'](signer1.address, amount);

        // Get the burn commission
        const burnCommission = await nativeLbtc.getBurnCommission();

        // Calculate expected amount after fee
        const expectedAmountAfterFee = amount - BigInt(burnCommission);

        await expect(nativeLbtc.connect(signer1).redeem(p2wsh, amount))
          .to.emit(nativeLbtc, 'UnstakeRequest')
          .withArgs(signer1.address, p2wsh, expectedAmountAfterFee);
      });
    });

    describe('Negative cases', function () {
      it('Reverts when withdrawals off', async function () {
        await nativeLbtc.toggleWithdrawals();
        const amount = 100_000_000n;
        await nativeLbtc.connect(deployer)['mint(address,uint256)'](signer1.address, amount);
        await expect(
          nativeLbtc.redeem('0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amount)
        ).to.revertedWithCustomError(nativeLbtc, 'WithdrawalsDisabled');
      });

      it('Reverts if amount is less than burn commission', async function () {
        const burnCommission = await nativeLbtc.getBurnCommission();
        const amountLessThanCommission = BigInt(burnCommission) - 1n;

        await nativeLbtc.connect(deployer)['mint(address,uint256)'](signer1.address, amountLessThanCommission);

        await expect(
          nativeLbtc.connect(signer1).redeem('0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03', amountLessThanCommission)
        )
          .to.be.revertedWithCustomError(nativeLbtc, 'AmountLessThanCommission')
          .withArgs(burnCommission);
      });

      it('Reverts when amount is below dust limit for P2WSH', async () => {
        const p2wsh = '0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3';
        const burnCommission = await nativeLbtc.getBurnCommission();

        // Start with a very small amount
        let amount = burnCommission + 1n;
        let isAboveDust = false;

        // Incrementally increase the amount until we find the dust limit
        while (!isAboveDust) {
          amount += 1n;
          [, isAboveDust] = await nativeLbtc.calcUnstakeRequestAmount(p2wsh, amount);
        }

        // Now 'amount' is just above the dust limit. Let's use an amount 1 less than this.
        const amountJustBelowDustLimit = amount - 1n;

        await nativeLbtc.connect(deployer)['mint(address,uint256)'](signer1.address, amountJustBelowDustLimit);

        await expect(nativeLbtc.connect(signer1).redeem(p2wsh, amountJustBelowDustLimit)).to.be.revertedWithCustomError(
          nativeLbtc,
          'AmountBelowDustLimit'
        );
      });

      it('Revert with P2SH', async () => {
        const amount = 100_000_000n;
        const p2sh = '0xa914aec38a317950a98baa9f725c0cb7e50ae473ba2f87';
        await nativeLbtc.connect(deployer)['mint(address,uint256)'](signer1.address, amount);
        await expect(nativeLbtc.connect(signer1).redeem(p2sh, amount)).to.be.revertedWithCustomError(
          nativeLbtc,
          'ScriptPubkeyUnsupported'
        );
      });

      it('Reverts with P2PKH', async () => {
        const amount = 100_000_000n;
        const p2pkh = '0x76a914aec38a317950a98baa9f725c0cb7e50ae473ba2f88ac';
        await nativeLbtc.connect(deployer)['mint(address,uint256)'](signer1.address, amount);
        await expect(nativeLbtc.connect(signer1).redeem(p2pkh, amount)).to.be.revertedWithCustomError(
          nativeLbtc,
          'ScriptPubkeyUnsupported'
        );
      });

      it('Reverts with P2PK', async () => {
        const amount = 100_000_000n;
        const p2pk =
          '0x4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac';
        await nativeLbtc.connect(deployer)['mint(address,uint256)'](signer1.address, amount);
        await expect(nativeLbtc.connect(signer1).redeem(p2pk, amount)).to.be.revertedWithCustomError(
          nativeLbtc,
          'ScriptPubkeyUnsupported'
        );
      });

      it('Reverts with P2MS', async () => {
        const amount = 100_000_000n;
        const p2ms =
          '0x524104d81fd577272bbe73308c93009eec5dc9fc319fc1ee2e7066e17220a5d47a18314578be2faea34b9f1f8ca078f8621acd4bc22897b03daa422b9bf56646b342a24104ec3afff0b2b66e8152e9018fe3be3fc92b30bf886b3487a525997d00fd9da2d012dce5d5275854adc3106572a5d1e12d4211b228429f5a7b2f7ba92eb0475bb14104b49b496684b02855bc32f5daefa2e2e406db4418f3b86bca5195600951c7d918cdbe5e6d3736ec2abf2dd7610995c3086976b2c0c7b4e459d10b34a316d5a5e753ae';
        await nativeLbtc.connect(deployer)['mint(address,uint256)'](signer1.address, amount);
        await expect(nativeLbtc.connect(signer1).redeem(p2ms, amount)).to.be.revertedWithCustomError(
          nativeLbtc,
          'ScriptPubkeyUnsupported'
        );
      });

      it('Reverts not enough to pay commission', async () => {
        const amount = 999_999n;
        const commission = 1_000_000n;
        const p2tr = '0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947';

        await nativeLbtc.changeBurnCommission(commission);

        await nativeLbtc.connect(deployer)['mint(address,uint256)'](signer1.address, amount);

        await expect(nativeLbtc.connect(signer1).redeem(p2tr, amount))
          .to.revertedWithCustomError(nativeLbtc, 'AmountLessThanCommission')
          .withArgs(commission);
      });
    });
  });

  describe('Permit', function () {
    let timestamp: number;
    let chainId: bigint;

    before(async function () {
      const block = await ethers.provider.getBlock('latest');
      timestamp = block!.timestamp;
      chainId = (await ethers.provider.getNetwork()).chainId;
    });

    beforeEach(async function () {
      // Mint some tokens
      await nativeLbtc['mint(address,uint256)'](signer1.address, 100_000_000n);
    });

    afterEach(async function () {
      await snapshot.restore();
    });

    it('should transfer funds with permit', async function () {
      // generate permit signature
      const { v, r, s } = await generatePermitSignature(
        nativeLbtc,
        signer1,
        signer2.address,
        10_000n,
        timestamp + 100,
        chainId,
        0,
        (await nativeLbtc.eip712Domain()).name
      );

      await nativeLbtc.permit(signer1.address, signer2.address, 10_000n, timestamp + 100, v, r, s);

      // check allowance
      expect(await nativeLbtc.allowance(signer1.address, signer2.address)).to.equal(10_000n);

      // check transferFrom
      await nativeLbtc.connect(signer2).transferFrom(signer1.address, signer3.address, 10_000n);
      expect(await nativeLbtc.balanceOf(signer3.address)).to.equal(10_000n);

      // check nonce is incremented
      expect(await nativeLbtc.nonces(signer1.address)).to.equal(1);
    });

    describe("fail if permit params don't match the signature", function () {
      let v: number;
      let r: string;
      let s: string;

      before(async function () {
        // generate permit signature
        const signature = await generatePermitSignature(
          nativeLbtc,
          signer1,
          signer2.address,
          10_000n,
          timestamp + 100,
          chainId,
          0
        );
        v = signature.v;
        r = signature.r;
        s = signature.s;
      });

      const params: [() => string, () => string, bigint, () => number, string][] = [
        [() => signer1.address, () => signer3.address, 10_000n, () => timestamp + 100, 'is sensitive to wrong spender'],
        [() => signer3.address, () => signer2.address, 10_000n, () => timestamp + 100, 'is sensitive to wrong signer'],
        [
          () => signer1.address,
          () => signer2.address,
          10_000n,
          () => timestamp + 200,
          'is sensitive to wrong deadline'
        ],
        [() => signer1.address, () => signer2.address, 1n, () => timestamp + 100, 'is sensitive to wrong value']
      ];

      params.forEach(async function ([signer, spender, value, deadline, label]) {
        it(label, async function () {
          await expect(
            nativeLbtc.permit(signer(), spender(), value, deadline(), v, r, s)
          ).to.be.revertedWithCustomError(nativeLbtc, 'ERC2612InvalidSigner');
        });
      });
    });

    describe("fail if signature don't match permit params", function () {
      // generate permit signature
      const signaturesData: [() => Signer, () => string, bigint, () => number, () => bigint, number, string][] = [
        [
          () => signer3,
          () => signer2.address,
          10_000n,
          () => timestamp + 100,
          () => chainId,
          0,
          'is sensitive to wrong signer'
        ],
        [
          () => signer1,
          () => signer3.address,
          10_000n,
          () => timestamp + 100,
          () => chainId,
          0,
          'is sensitive to wrong spender'
        ],
        [
          () => signer1,
          () => signer2.address,
          1n,
          () => timestamp + 100,
          () => chainId,
          0,
          'is sensitive to wrong value'
        ],
        [
          () => signer1,
          () => signer2.address,
          10_000n,
          () => timestamp + 1,
          () => chainId,
          0,
          'is sensitive to wrong deadline'
        ],
        [
          () => signer1,
          () => signer2.address,
          10_000n,
          () => timestamp + 100,
          () => 1234n,
          0,
          'is sensitive to wrong chainId'
        ],
        [
          () => signer1,
          () => signer2.address,
          1n,
          () => timestamp + 100,
          () => chainId,
          1,
          'is sensitive to wrong nonce'
        ]
      ];
      signaturesData.forEach(async ([signer, spender, value, deadline, chainId, nonce, label]) => {
        it(label, async () => {
          const { v, r, s } = await generatePermitSignature(
            nativeLbtc,
            signer(),
            spender(),
            value,
            deadline(),
            chainId(),
            nonce
          );
          await expect(
            nativeLbtc.permit(signer1, signer2.address, 10_000n, timestamp + 100, v, r, s)
          ).to.be.revertedWithCustomError(nativeLbtc, 'ERC2612InvalidSigner');
        });
      });
    });
  });
});
