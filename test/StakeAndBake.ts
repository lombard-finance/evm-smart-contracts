import { ethers } from 'hardhat';
import { expect } from 'chai';
import { SnapshotRestorer, takeSnapshot, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  Addressable,
  BITCOIN_CHAIN_ID,
  BTC_STAKING_MODULE_ADDRESS,
  CHAIN_ID,
  DefaultData,
  deployContract,
  encode,
  generatePermitSignature,
  getFeeTypedMessage,
  getGMPPayload,
  getPayloadForAction,
  getSignersWithPrivateKeys,
  initStakedLBTC,
  LEDGER_CHAIN_ID,
  LEDGER_MAILBOX,
  MINT_SELECTOR,
  NEW_VALSET,
  randomBigInt,
  Signer,
  signPayload
} from './helpers';
import {
  AssetRouter,
  Consortium,
  Mailbox,
  RatioFeedMock,
  StakeAndBake,
  StakedLBTC,
  TellerWithMultiAssetSupportDepositor,
  TellerWithMultiAssetSupportMock
} from '../typechain-types';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';

const DAY = 86400;

describe('TellerWithMultiAssetSupportDepositor', function () {
  let _: Signer,
    owner: Signer,
    signer1: Signer,
    signer2: Signer,
    signer3: Signer,
    notary1: Signer,
    operator: Signer,
    pauser: Signer,
    treasury: Signer;
  let stakeAndBake: StakeAndBake & Addressable;
  let tellerWithMultiAssetSupportDepositor: TellerWithMultiAssetSupportDepositor & Addressable;
  let teller: TellerWithMultiAssetSupportMock & Addressable;
  let consortium: Consortium & Addressable;
  let mailbox: Mailbox & Addressable;
  let ratioFeed: RatioFeedMock & Addressable;
  let assetRouter: AssetRouter & Addressable;
  let assetRouterBytes: string;
  let stakedLbtc: StakedLBTC & Addressable;
  let stakedLbtcBytes: string;
  let snapshot: SnapshotRestorer;
  let snapshotTimestamp: number;

  const toNativeCommission = 1000n;
  const fee = 1n;
  const vaultFee = 100n; // vault fee 1%

  before(async function () {
    [_, owner, signer1, signer2, signer3, notary1, operator, pauser, treasury] = await getSignersWithPrivateKeys();

    consortium = await deployContract<Consortium & Addressable>('Consortium', [owner.address]);
    consortium.address = await consortium.getAddress();
    await consortium
      .connect(owner)
      .setInitialValidatorSet(getPayloadForAction([1, [notary1.publicKey], [1], 1, 1], NEW_VALSET));

    stakedLbtc = await initStakedLBTC(owner.address, treasury.address);
    stakedLbtcBytes = encode(['address'], [stakedLbtc.address]);
    await stakedLbtc.connect(owner).changeOperator(operator.address);

    stakeAndBake = await deployContract<StakeAndBake & Addressable>('StakeAndBake', [
      stakedLbtc.address,
      owner.address,
      operator.address,
      1,
      owner.address,
      pauser.address,
      1_000_000
    ]);
    stakeAndBake.address = await stakeAndBake.getAddress();

    // Mailbox
    mailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address, 0n, 0n]);
    mailbox.address = await mailbox.getAddress();
    await mailbox.connect(owner).grantRole(await mailbox.TREASURER_ROLE(), treasury);
    await mailbox.connect(owner).grantRole(await mailbox.PAUSER_ROLE(), pauser);
    await mailbox.connect(owner).enableMessagePath(LEDGER_CHAIN_ID, LEDGER_MAILBOX, 3);

    // Ratio feed
    ratioFeed = (await ethers.deployContract('RatioFeedMock', [])) as RatioFeedMock & Addressable;
    ratioFeed.address = await ratioFeed.getAddress();

    // AssetRouter
    assetRouter = await deployContract<AssetRouter & Addressable>('AssetRouter', [
      owner.address,
      0n,
      LEDGER_CHAIN_ID,
      BITCOIN_CHAIN_ID,
      mailbox.address,
      ethers.ZeroAddress
    ]);
    assetRouter.address = await assetRouter.getAddress();
    assetRouterBytes = encode(['address'], [assetRouter.address]);
    await assetRouter.connect(owner).changeOracle(stakedLbtc.address, ratioFeed.address);
    await assetRouter.connect(owner).changeToNativeCommission(stakedLbtc.address, toNativeCommission);
    // Roles
    await assetRouter.connect(owner).grantRole(await assetRouter.CALLER_ROLE(), owner);
    await assetRouter.connect(owner).grantRole(await assetRouter.OPERATOR_ROLE(), operator);

    await mailbox.connect(owner).setSenderConfig(assetRouter.address, 516, true);
    await stakedLbtc.connect(owner).changeAssetRouter(assetRouter.address);
    await stakedLbtc.connect(owner).addMinter(assetRouter.address);

    teller = await deployContract<TellerWithMultiAssetSupportMock & Addressable>(
      'TellerWithMultiAssetSupportMock',
      [await stakedLbtc.getAddress()],
      false
    );
    teller.address = await teller.getAddress();

    tellerWithMultiAssetSupportDepositor = await deployContract<TellerWithMultiAssetSupportDepositor & Addressable>(
      'TellerWithMultiAssetSupportDepositor',
      [teller.address, await stakedLbtc.getAddress(), stakeAndBake.address],
      false
    );
    tellerWithMultiAssetSupportDepositor.address = await tellerWithMultiAssetSupportDepositor.getAddress();
    await expect(stakeAndBake.connect(owner).setDepositor(tellerWithMultiAssetSupportDepositor.address))
      .to.emit(stakeAndBake, 'DepositorSet')
      .withArgs(tellerWithMultiAssetSupportDepositor.address);

    // Initialize the permit module
    await stakedLbtc.connect(owner).reinitialize();

    snapshot = await takeSnapshot();
    snapshotTimestamp = await time.latest();
  });

  async function defaultData(
    recipient: Signer = signer1,
    amount: bigint = randomBigInt(8),
    feeApprove: bigint = 1n
  ): Promise<DefaultData> {
    const body = getPayloadForAction(
      [stakedLbtcBytes, encode(['address'], [recipient.address]), amount],
      MINT_SELECTOR
    );
    const payload = getGMPPayload(
      LEDGER_MAILBOX,
      LEDGER_CHAIN_ID,
      CHAIN_ID,
      Number(randomBigInt(8)),
      BTC_STAKING_MODULE_ADDRESS,
      assetRouterBytes,
      assetRouterBytes,
      body
    );
    const { payloadHash, proof } = await signPayload([notary1], [true], payload);
    const feeApprovalPayload = getPayloadForAction([feeApprove, snapshotTimestamp + DAY], 'feeApproval');
    const userSignature = await getFeeTypedMessage(recipient, stakedLbtc, feeApprove, snapshotTimestamp + DAY);
    return {
      payload,
      payloadHash,
      proof,
      amount,
      tokenRecipient: recipient,
      feeApprovalPayload,
      userSignature
    } as unknown as DefaultData;
  }

  describe('Setters', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('setDepositor: admin can set', async function () {
      const newValue = ethers.Wallet.createRandom().address;
      await expect(stakeAndBake.connect(owner).setDepositor(newValue))
        .to.emit(stakeAndBake, 'DepositorSet')
        .withArgs(newValue);
      expect(await stakeAndBake.getStakeAndBakeDepositor()).to.be.eq(newValue);
    });

    it('setDepositor: reverts when address is zero', async function () {
      await expect(stakeAndBake.connect(owner).setDepositor(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        stakeAndBake,
        'ZeroAddress'
      );
    });

    it('setDepositor: reverts when called by not an admin', async function () {
      await expect(
        stakeAndBake.connect(signer1).setDepositor(tellerWithMultiAssetSupportDepositor.address)
      ).to.be.revertedWithCustomError(stakeAndBake, 'AccessControlUnauthorizedAccount');
    });

    it('setFee: operator can change fee', async function () {
      const newValue = randomBigInt(3);
      await expect(stakeAndBake.connect(operator).setFee(newValue))
        .to.emit(stakeAndBake, 'FeeChanged')
        .withArgs(newValue);
      expect(await stakeAndBake.getStakeAndBakeFee()).to.be.eq(newValue);
    });

    it('setFee: rejects when fee is greater than max', async function () {
      const newValue = (await stakeAndBake.MAXIMUM_FEE()) + 1n;
      await expect(stakeAndBake.connect(operator).setFee(newValue)).revertedWithCustomError(
        stakeAndBake,
        'FeeGreaterThanMaximum'
      );
    });

    it('setFee: rejects when called by not an operator', async function () {
      await expect(stakeAndBake.connect(signer1).setFee(randomBigInt(3))).revertedWithCustomError(
        stakeAndBake,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('setGasLimit: admin can change gas limit for batch staking', async function () {
      const newValue = randomBigInt(3);
      await expect(stakeAndBake.connect(owner).setGasLimit(newValue))
        .to.emit(stakeAndBake, 'GasLimitChanged')
        .withArgs(newValue);
    });

    it('setGasLimit: rejects when called by not an admin', async function () {
      await expect(stakeAndBake.connect(signer1).setGasLimit(2)).revertedWithCustomError(
        stakeAndBake,
        'AccessControlUnauthorizedAccount'
      );
    });
  });

  describe('Pause', function () {
    before(async function () {
      await snapshot.restore();
      await stakeAndBake.connect(owner).setDepositor(tellerWithMultiAssetSupportDepositor.address);
    });

    it('pause: reverts when called by not a pauser', async function () {
      await expect(stakeAndBake.connect(signer2).pause()).to.be.reverted;
    });

    it('pause: pauser can set on pause', async function () {
      await stakeAndBake.connect(pauser).pause();
      expect(await stakeAndBake.paused()).to.be.true;
    });

    it('stakeAndBake: rejects when contract is paused', async function () {
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = ((stakeAmount - fee) * (10000n - vaultFee)) / 10000n;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        stakedLbtc.address,
        signer2,
        stakeAndBake.address,
        permitAmount,
        deadline,
        chainId,
        0
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBake.connect(owner).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      ).to.be.revertedWithCustomError(stakeAndBake, 'EnforcedPause');
    });

    it('should not allow batchStakeAndBake when paused', async function () {
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = ((stakeAmount - fee) * (10000n - vaultFee)) / 10000n;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        stakedLbtc.address,
        signer2,
        stakeAndBake.address,
        permitAmount,
        deadline,
        chainId,
        0
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBake.connect(owner).batchStakeAndBake([
          {
            permitPayload: permitPayload,
            depositPayload: depositPayload,
            mintPayload: data.payload,
            proof: data.proof,
            amount: stakeAmount
          }
        ])
      ).to.be.revertedWithCustomError(stakeAndBake, 'EnforcedPause');
    });

    it('unpause: reverts when called by not an owner', async function () {
      await expect(stakeAndBake.connect(signer2).unpause()).to.be.reverted;
    });

    it('unpause: owner can turn off pause', async function () {
      await stakeAndBake.connect(owner).unpause();
      expect(await stakeAndBake.paused()).to.be.false;
    });
  });

  describe('Stake and Bake', function () {
    before(async function () {
      await snapshot.restore();
    });

    const args = [
      {
        name: 'staking amount = minting amount',
        mintAmount: randomBigInt(8),
        stakeAmount: (a: bigint): bigint => a,
        minVaultTokenAmount: (a: bigint): bigint => (a * (10000n - vaultFee)) / 10000n
      },
      {
        name: 'staking amount < minting amount',
        mintAmount: randomBigInt(8),
        stakeAmount: (a: bigint): bigint => a - 1n,
        minVaultTokenAmount: (a: bigint): bigint => (a * (10000n - vaultFee)) / 10000n
      },
      {
        name: 'decreased min vault tokens amount',
        mintAmount: randomBigInt(8),
        stakeAmount: (a: bigint): bigint => a,
        minVaultTokenAmount: (a: bigint): bigint => (a * (10000n - vaultFee * 2n)) / 10000n
      }
    ];

    args.forEach(function (arg) {
      it(`stakeAndBake: when ${arg.name}`, async function () {
        const mintAmount = arg.mintAmount;
        const stakeAmount = arg.stakeAmount(mintAmount);
        const minVaultTokenAmount = arg.minVaultTokenAmount(stakeAmount - fee);
        const expectedMinVaultTokenAmount = ((stakeAmount - fee) * (10000n - vaultFee)) / 10000n;
        const data = await defaultData(signer1, mintAmount);
        const deadline = (await time.latest()) + 100;
        const chainId = (await ethers.provider.getNetwork()).chainId;

        const { v, r, s } = await generatePermitSignature(
          stakedLbtc.address,
          signer1,
          stakeAndBake.address,
          mintAmount,
          deadline,
          chainId,
          await stakedLbtc.nonces(signer1)
        );
        const permitPayload = encode(
          ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
          [mintAmount, deadline, v, r, s]
        );
        const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

        const tx = await stakeAndBake.connect(owner).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        });

        await expect(tx)
          .to.emit(teller, 'Transfer')
          .withArgs(ethers.ZeroAddress, signer1.address, expectedMinVaultTokenAmount);
        await expect(tx).to.changeTokenBalance(teller, signer1, expectedMinVaultTokenAmount);
        await expect(tx).to.changeTokenBalance(stakedLbtc, signer1, mintAmount - stakeAmount);
        expect(await stakedLbtc.allowance(signer1.address, stakeAndBake.address)).to.be.eq(mintAmount - stakeAmount);

        await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, fee);
        await expect(tx).to.changeTokenBalance(stakedLbtc, teller, stakeAmount - fee);
      });

      it(`batchStakeAndBake: when ${arg.name}`, async function () {
        const mintAmount = arg.mintAmount;
        const stakeAmount = arg.stakeAmount(mintAmount);
        const minVaultTokenAmount = arg.minVaultTokenAmount(stakeAmount - fee);
        const expectedMinVaultTokenAmount = ((stakeAmount - fee) * (10000n - vaultFee)) / 10000n;

        const stakeAndBakeData = [];
        for (const signer of [signer2, signer3]) {
          const data = await defaultData(signer, mintAmount);
          const deadline = (await time.latest()) + 100;
          const chainId = (await ethers.provider.getNetwork()).chainId;

          const { v, r, s } = await generatePermitSignature(
            stakedLbtc.address,
            signer,
            stakeAndBake.address,
            mintAmount,
            deadline,
            chainId,
            await stakedLbtc.nonces(signer)
          );
          const permitPayload = encode(
            ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
            [mintAmount, deadline, v, r, s]
          );
          const depositPayload = encode(['uint256'], [minVaultTokenAmount]);
          stakeAndBakeData.push({
            permitPayload: permitPayload,
            depositPayload: depositPayload,
            mintPayload: data.payload,
            proof: data.proof,
            amount: stakeAmount
          });
        }

        const tx = await stakeAndBake.connect(owner).batchStakeAndBake(stakeAndBakeData);

        for (const signer of [signer2, signer3]) {
          await expect(tx).to.changeTokenBalance(teller, signer, expectedMinVaultTokenAmount);
          await expect(tx).to.changeTokenBalance(stakedLbtc, signer, mintAmount - stakeAmount);
          expect(await stakedLbtc.allowance(signer.address, stakeAndBake.address)).to.be.eq(mintAmount - stakeAmount);
        }
        await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, fee * 2n);
        await expect(tx).to.changeTokenBalance(stakedLbtc, teller, (stakeAmount - fee) * 2n);
      });
    });

    const invalidArgs = [
      {
        name: 'staking amount exceeds amount in deposit payload',
        mintAmount: randomBigInt(8),
        permitAmount: (a: bigint): bigint => a + 1n,
        stakeAmount: (a: bigint): bigint => a + 1n,
        minVaultTokenAmount: (a: bigint): bigint => ((a - fee) * (10000n - vaultFee)) / 10000n,
        customError: () => [stakedLbtc, 'ERC20InsufficientBalance']
      },
      {
        name: 'staking amount is 0 after fee',
        mintAmount: fee,
        permitAmount: (a: bigint): bigint => a,
        stakeAmount: (a: bigint): bigint => a,
        minVaultTokenAmount: (a: bigint): bigint => ((a - fee) * (10000n - vaultFee)) / 10000n,
        customError: () => [stakeAndBake, 'ZeroDepositAmount']
      },
      {
        name: 'permit amount is not enough',
        mintAmount: randomBigInt(8),
        permitAmount: (a: bigint): bigint => a - 1n,
        stakeAmount: (a: bigint): bigint => a,
        minVaultTokenAmount: (a: bigint): bigint => ((a - fee) * (10000n - vaultFee)) / 10000n,
        customError: () => [stakeAndBake, 'WrongAmount']
      },
      {
        name: 'vault minted less tokens than minimum',
        mintAmount: randomBigInt(8),
        permitAmount: (a: bigint): bigint => a,
        stakeAmount: (a: bigint): bigint => a,
        minVaultTokenAmount: (a: bigint): bigint => ((a - fee) * (10000n - vaultFee)) / 10000n + 1n,
        customError: () => [teller, 'AmountBelowMinimumMint']
      }
    ];

    invalidArgs.forEach(function (arg) {
      it(`stakeAndBake: rejects when ${arg.name}`, async function () {
        await snapshot.restore();

        const mintAmount = arg.mintAmount;
        const permitAmount = arg.permitAmount(mintAmount);
        const stakeAmount = arg.stakeAmount(mintAmount);
        const minVaultTokenAmount = arg.minVaultTokenAmount(stakeAmount);
        const data = await defaultData(signer2, mintAmount);
        const deadline = (await time.latest()) + 100;
        const chainId = (await ethers.provider.getNetwork()).chainId;

        const { v, r, s } = await generatePermitSignature(
          stakedLbtc.address,
          signer2,
          stakeAndBake.address,
          permitAmount,
          deadline,
          chainId,
          0n
        );
        const permitPayload = encode(
          ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
          [permitAmount, deadline, v, r, s]
        );
        const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

        await expect(
          stakeAndBake.connect(owner).stakeAndBake({
            permitPayload: permitPayload,
            depositPayload: depositPayload,
            mintPayload: data.payload,
            proof: data.proof,
            amount: stakeAmount
          })
          // @ts-ignore
        ).to.be.revertedWithCustomError(...arg.customError());
      });
    });

    it('stakeAndBake: does not spent permit if allowance is enough', async function () {
      await snapshot.restore();
      const extraAllowance = randomBigInt(10);
      await stakedLbtc.connect(signer1).approve(stakeAndBake.address, extraAllowance);

      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount / 2n;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = ((stakeAmount - fee) * (10000n - vaultFee)) / 10000n;
      const expectedMinVaultTokenAmount = ((stakeAmount - fee) * (10000n - vaultFee)) / 10000n;
      const data = await defaultData(signer1, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        stakedLbtc.address,
        signer1,
        stakeAndBake.address,
        permitAmount,
        deadline,
        chainId,
        0n
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      const tx = await stakeAndBake.connect(owner).stakeAndBake({
        permitPayload: permitPayload,
        depositPayload: depositPayload,
        mintPayload: data.payload,
        proof: data.proof,
        amount: stakeAmount
      });

      await expect(tx)
        .to.emit(teller, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer1.address, expectedMinVaultTokenAmount);
      await expect(tx).to.changeTokenBalance(teller, signer1, expectedMinVaultTokenAmount);
      await expect(tx).to.changeTokenBalance(stakedLbtc, signer1, mintAmount - stakeAmount);
      expect(await stakedLbtc.allowance(signer1.address, stakeAndBake.address)).to.be.eq(extraAllowance - stakeAmount);
      expect(await stakedLbtc.nonces(signer1)).to.be.eq(0n);

      await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, fee);
      await expect(tx).to.changeTokenBalance(stakedLbtc, teller, stakeAmount - fee);
    });

    it('stakeAndBake: rejects when permit has expired', async function () {
      await snapshot.restore();
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = ((stakeAmount - fee) * (10000n - vaultFee)) / 10000n;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        stakedLbtc.address,
        signer2,
        stakeAndBake.address,
        permitAmount,
        deadline,
        chainId,
        0n
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await time.increase(101);

      await expect(
        stakeAndBake.connect(owner).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      ).to.be.revertedWithCustomError(stakedLbtc, 'ERC2612ExpiredSignature');
    });

    it('batchStakeAndBake: skips invalid payloads', async function () {
      await snapshot.restore();
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = ((stakeAmount - fee) * (10000n - vaultFee)) / 10000n;
      const expectedMinVaultTokenAmount = ((stakeAmount - fee) * (10000n - vaultFee)) / 10000n;

      const stakeAndBakeData = [];
      for (const signer of [signer2, signer3]) {
        const data = await defaultData(signer, mintAmount);
        const deadline = (await time.latest()) + 100;
        const chainId = (await ethers.provider.getNetwork()).chainId;

        const { v, r, s } = await generatePermitSignature(
          stakedLbtc.address,
          signer,
          stakeAndBake.address,
          permitAmount,
          deadline,
          chainId,
          0n
        );
        const permitPayload = encode(
          ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
          [permitAmount, deadline, v, r, s]
        );
        const depositPayload = encode(['uint256'], [minVaultTokenAmount]);
        stakeAndBakeData.push({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        });
      }
      stakeAndBakeData[0].proof = stakeAndBakeData[1].proof;
      const tx = await stakeAndBake.connect(owner).batchStakeAndBake(stakeAndBakeData);

      await expect(tx).to.emit(stakeAndBake, 'BatchStakeAndBakeReverted').withArgs(0, anyValue, anyValue);

      await expect(tx).to.changeTokenBalance(teller, signer3, expectedMinVaultTokenAmount);
      await expect(tx).to.changeTokenBalance(stakedLbtc, signer3, mintAmount - stakeAmount);
      expect(await stakedLbtc.allowance(signer3.address, stakeAndBake.address)).to.be.eq(mintAmount - stakeAmount);
      await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, fee);
      await expect(tx).to.changeTokenBalance(stakedLbtc, teller, stakeAmount - fee);
    });

    it('stakeAndBake: rejects when signature does not match', async function () {
      await snapshot.restore();
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = ((stakeAmount - fee) * (10000n - vaultFee)) / 10000n;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        stakedLbtc.address,
        signer2,
        stakedLbtc.address,
        permitAmount,
        deadline,
        chainId,
        0n
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBake.connect(owner).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      ).to.be.revertedWithCustomError(stakedLbtc, 'ERC2612InvalidSigner');
    });

    it('stakeAndBake: rejects when called by not a claimer', async function () {
      await snapshot.restore();
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = ((stakeAmount - fee) * (10000n - vaultFee)) / 10000n;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        stakedLbtc.address,
        signer2,
        stakeAndBake.address,
        permitAmount,
        deadline,
        chainId,
        0n
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBake.connect(signer2).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      ).to.be.revertedWithCustomError(stakeAndBake, 'AccessControlUnauthorizedAccount');
    });

    it('stakeAndBake: rejects when depositor is not set', async function () {
      await snapshot.restore();
      const stakeAndBake = await deployContract<StakeAndBake & Addressable>('StakeAndBake', [
        stakedLbtc.address,
        owner.address,
        operator.address,
        1,
        owner.address,
        pauser.address,
        1_000_000
      ]);
      stakeAndBake.address = await stakeAndBake.getAddress();

      const teller = await deployContract<TellerWithMultiAssetSupportMock & Addressable>(
        'TellerWithMultiAssetSupportMock',
        [await stakedLbtc.getAddress()],
        false
      );
      teller.address = await teller.getAddress();

      const tellerWithMultiAssetSupportDepositor = await deployContract<
        TellerWithMultiAssetSupportDepositor & Addressable
      >(
        'TellerWithMultiAssetSupportDepositor',
        [teller.address, await stakedLbtc.getAddress(), stakeAndBake.address],
        false
      );
      tellerWithMultiAssetSupportDepositor.address = await tellerWithMultiAssetSupportDepositor.getAddress();

      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = ((stakeAmount - fee) * (10000n - vaultFee)) / 10000n;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        stakedLbtc.address,
        signer2,
        stakeAndBake.address,
        permitAmount,
        deadline,
        chainId,
        0n
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBake.connect(owner).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      ).to.be.revertedWithCustomError(stakeAndBake, 'NoDepositorSet');

      await expect(
        stakeAndBake.connect(owner).batchStakeAndBake([
          {
            permitPayload: permitPayload,
            depositPayload: depositPayload,
            mintPayload: data.payload,
            proof: data.proof,
            amount: stakeAmount
          }
        ])
      ).to.be.revertedWithCustomError(stakeAndBake, 'NoDepositorSet');
    });

    it('batchStakeAndBake: rejects when called by not a claimer', async function () {
      await snapshot.restore();
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = ((stakeAmount - fee) * (10000n - vaultFee)) / 10000n;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        stakedLbtc.address,
        signer2,
        stakeAndBake.address,
        permitAmount,
        deadline,
        chainId,
        0n
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBake.connect(signer2).batchStakeAndBake([
          {
            permitPayload: permitPayload,
            depositPayload: depositPayload,
            mintPayload: data.payload,
            proof: data.proof,
            amount: stakeAmount
          }
        ])
      ).to.be.revertedWithCustomError(stakeAndBake, 'AccessControlUnauthorizedAccount');
    });

    it('stakeAndBakeInternal: rejects when called by not the contract itself', async function () {
      await snapshot.restore();
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = ((stakeAmount - fee) * (10000n - vaultFee)) / 10000n;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        stakedLbtc.address,
        signer2,
        stakeAndBake.address,
        permitAmount,
        deadline,
        chainId,
        0n
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBake.connect(owner).stakeAndBakeInternal({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      )
        .to.be.revertedWithCustomError(stakeAndBake, 'CallerNotSelf')
        .withArgs(owner.address);
    });
  });
});
