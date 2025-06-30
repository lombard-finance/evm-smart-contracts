import { ethers } from 'hardhat';
import { expect } from 'chai';
import { BytesLike } from 'ethers';
import { takeSnapshot, SnapshotRestorer } from '@nomicfoundation/hardhat-toolbox/network-helpers';
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
  let stakeAndBake: StakeAndBake;
  let tellerWithMultiAssetSupportDepositor: TellerWithMultiAssetSupportDepositor;
  let teller: TellerWithMultiAssetSupportMock;
  let consortium: Consortium & Addressable;
  let mailbox: Mailbox & Addressable;
  let ratioFeed: RatioFeedMock & Addressable;
  let assetRouter: AssetRouter & Addressable;
  let assetRouterBytes: string;
  let stakedLbtc: StakedLBTC & Addressable;
  let stakedLbtcBytes: string;
  let snapshot: SnapshotRestorer;
  let snapshotTimestamp: number;
  let data: DefaultData;
  let permitPayload: BytesLike;
  let depositPayload: BytesLike;
  let data2: DefaultData;
  let permitPayload2: BytesLike;
  let depositPayload2: BytesLike;

  const toNativeCommission = 1000n;
  const value = 10001n;
  const fee = 1n;
  const premium = 100n;
  const depositValue = 9900n;

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

    stakeAndBake = await deployContract<StakeAndBake>('StakeAndBake', [
      stakedLbtc.address,
      owner.address,
      operator.address,
      1,
      owner.address,
      pauser.address,
      1_000_000
    ]);

    // Mailbox
    mailbox = await deployContract<Mailbox & Addressable>('Mailbox', [owner.address, consortium.address, 0n, 0n]);
    mailbox.address = await mailbox.getAddress();
    await mailbox.connect(owner).grantRole(await mailbox.TREASURER_ROLE(), treasury);
    await mailbox.connect(owner).grantRole(await mailbox.PAUSER_ROLE(), pauser);
    await mailbox.connect(owner).enableMessagePath(LEDGER_CHAIN_ID, LEDGER_MAILBOX);

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
      ratioFeed.address,
      ethers.ZeroAddress,
      toNativeCommission
    ]);
    assetRouter.address = await assetRouter.getAddress();
    assetRouterBytes = encode(['address'], [assetRouter.address]);
    // Roles
    await assetRouter.connect(owner).grantRole(await assetRouter.CALLER_ROLE(), owner);
    await assetRouter.connect(owner).grantRole(await assetRouter.OPERATOR_ROLE(), operator);

    await mailbox.connect(owner).setSenderConfig(assetRouter.address, 516, true);
    await stakedLbtc.connect(owner).changeAssetRouter(assetRouter.address);
    await stakedLbtc.connect(owner).addMinter(assetRouter.address);

    teller = await deployContract<TellerWithMultiAssetSupportMock>(
      'TellerWithMultiAssetSupportMock',
      [await stakedLbtc.getAddress()],
      false
    );

    tellerWithMultiAssetSupportDepositor = await deployContract<TellerWithMultiAssetSupportDepositor>(
      'TellerWithMultiAssetSupportDepositor',
      [await teller.getAddress(), await stakedLbtc.getAddress(), await stakeAndBake.getAddress()],
      false
    );

    // Initialize the permit module
    await stakedLbtc.reinitialize();

    snapshot = await takeSnapshot();
    snapshotTimestamp = (await ethers.provider.getBlock('latest'))!.timestamp;

    data = await defaultData(signer2, value);

    // create permit payload
    const block = await ethers.provider.getBlock('latest');
    const timestamp = block!.timestamp;
    const deadline = timestamp + 100;
    const chainId = (await ethers.provider.getNetwork()).chainId;
    {
      const { v, r, s } = await generatePermitSignature(
        stakedLbtc.address,
        signer2,
        await stakeAndBake.getAddress(),
        value,
        deadline,
        chainId,
        0
      );

      permitPayload = encode(['uint256', 'uint256', 'uint8', 'uint256', 'uint256'], [value, deadline, v, r, s]);
    }

    // make a deposit payload for the boringvault
    depositPayload = encode(['uint256'], [depositValue]);

    // NB for some reason trying to do this in a loop and passing around arrays of parameters
    // makes the test fail, so i'm doing it the ugly way here
    data2 = await defaultData(signer3, value);

    {
      // create permit payload
      const { v, r, s } = await generatePermitSignature(
        stakedLbtc.address,
        signer3,
        await stakeAndBake.getAddress(),
        value,
        deadline,
        chainId,
        0
      );

      permitPayload2 = encode(['uint256', 'uint256', 'uint8', 'uint256', 'uint256'], [value, deadline, v, r, s]);
    }

    // make a deposit payload for the boringvault
    depositPayload2 = encode(['uint256'], [depositValue]);
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

  afterEach(async function () {
    // clean the state after each test
    await snapshot.restore();
  });

  describe('Setters', function () {
    it('should not allow calling stakeAndBake without a set depositor', async function () {
      await expect(
        stakeAndBake.connect(owner).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof
        })
      ).to.be.revertedWithCustomError(stakeAndBake, 'NoDepositorSet');
    });

    it('should allow admin to set depositor', async function () {
      await expect(stakeAndBake.connect(owner).setDepositor(await tellerWithMultiAssetSupportDepositor.getAddress()))
        .to.emit(stakeAndBake, 'DepositorSet')
        .withArgs(await tellerWithMultiAssetSupportDepositor.getAddress());
    });

    it('should not allow anyone else to set depositor', async function () {
      await expect(stakeAndBake.connect(signer1).setDepositor(await tellerWithMultiAssetSupportDepositor.getAddress()))
        .to.be.reverted;
    });
  });

  describe('Stake and Bake', function () {
    beforeEach(async function () {
      // set depositor to stake and bake
      await expect(stakeAndBake.connect(owner).setDepositor(await tellerWithMultiAssetSupportDepositor.getAddress()))
        .to.emit(stakeAndBake, 'DepositorSet')
        .withArgs(await tellerWithMultiAssetSupportDepositor.getAddress());
    });

    it('should not allow non-claimer to call stakeAndBake', async function () {
      await expect(
        stakeAndBake.connect(signer2).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof
        })
      ).to.be.reverted;
    });

    it('should not allow non-claimer to call batchStakeAndBake', async function () {
      await expect(
        stakeAndBake.connect(signer2).batchStakeAndBake([
          {
            permitPayload: permitPayload,
            depositPayload: depositPayload,
            mintPayload: data.payload,
            proof: data.proof
          },
          {
            permitPayload: permitPayload2,
            depositPayload: depositPayload2,
            mintPayload: data2.payload,
            proof: data2.proof
          }
        ])
      ).to.be.reverted;
    });

    it('should not allow non-pauser to pause', async function () {
      await expect(stakeAndBake.connect(signer2).pause()).to.be.reverted;
    });

    it('should not allow non-pauser to unpause', async function () {
      await stakeAndBake.connect(pauser).pause();
      await expect(stakeAndBake.connect(signer2).unpause()).to.be.reverted;
    });

    it('should allow operator to change the fee', async function () {
      await expect(stakeAndBake.connect(operator).setFee(2)).to.emit(stakeAndBake, 'FeeChanged').withArgs(2);
    });

    it('should not allow anyone else to change the fee', async function () {
      await expect(stakeAndBake.setFee(2)).to.be.reverted;
    });

    it('should allow admin to set a depositor', async function () {
      await expect(stakeAndBake.connect(owner).setDepositor(signer1.address))
        .to.emit(stakeAndBake, 'DepositorSet')
        .withArgs(signer1.address);
    });

    it('should not allow anyone else to set a depositor', async function () {
      await expect(stakeAndBake.connect(signer1).setDepositor(signer1.address)).to.be.reverted;
    });

    it('should allow pauser to pause', async function () {
      await stakeAndBake.connect(pauser).pause();
      expect(await stakeAndBake.paused()).to.be.true;
    });

    it('should allow admin to unpause', async function () {
      await stakeAndBake.connect(pauser).pause();
      await stakeAndBake.connect(owner).unpause();
      expect(await stakeAndBake.paused()).to.be.false;
    });

    it('should stake and bake properly with the correct setup', async function () {
      await expect(
        stakeAndBake.connect(owner).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof
        })
      )
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer2.address, value)
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(signer2.address, await stakeAndBake.getAddress(), value)
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(await stakeAndBake.getAddress(), treasury.address, fee)
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(
          await stakeAndBake.getAddress(),
          await tellerWithMultiAssetSupportDepositor.getAddress(),
          depositValue + premium
        )
        .to.emit(teller, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer2.address, depositValue);
    });

    it('should work with allowance', async function () {
      await stakedLbtc.connect(signer2).approve(await stakeAndBake.getAddress(), value);
      await expect(
        stakeAndBake.connect(owner).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof
        })
      )
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer2.address, value)
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(signer2.address, await stakeAndBake.getAddress(), value)
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(await stakeAndBake.getAddress(), treasury.address, fee)
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(
          await stakeAndBake.getAddress(),
          await tellerWithMultiAssetSupportDepositor.getAddress(),
          depositValue + premium
        )
        .to.emit(teller, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer2.address, depositValue);
    });

    it('should batch stake and bake properly with the correct setup', async function () {
      await expect(
        stakeAndBake.connect(owner).batchStakeAndBake([
          {
            permitPayload: permitPayload,
            depositPayload: depositPayload,
            mintPayload: data.payload,
            proof: data.proof
          },
          {
            permitPayload: permitPayload2,
            depositPayload: depositPayload2,
            mintPayload: data2.payload,
            proof: data2.proof
          }
        ])
      )
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer2.address, value)
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(signer2.address, await stakeAndBake.getAddress(), value)
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(await stakeAndBake.getAddress(), treasury.address, fee)
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(
          await stakeAndBake.getAddress(),
          await tellerWithMultiAssetSupportDepositor.getAddress(),
          depositValue + premium
        )
        .to.emit(teller, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer2.address, depositValue)
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer3.address, value)
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(signer3.address, await stakeAndBake.getAddress(), value)
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(await stakeAndBake.getAddress(), treasury.address, fee)
        .to.emit(stakedLbtc, 'Transfer')
        .withArgs(
          await stakeAndBake.getAddress(),
          await tellerWithMultiAssetSupportDepositor.getAddress(),
          depositValue + premium
        )
        .to.emit(teller, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer2.address, depositValue);
    });

    it('should revert when a zero depositor address is set', async function () {
      await expect(stakeAndBake.connect(owner).setDepositor(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        stakeAndBake,
        'ZeroAddress'
      );
    });

    it('should revert when remaining amount is zero', async function () {
      await stakeAndBake.connect(operator).setFee(10001);
      await expect(
        stakeAndBake.connect(owner).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof
        })
      ).to.be.revertedWithCustomError(stakeAndBake, 'ZeroDepositAmount');
    });

    it('should not allow stakeAndBake when paused', async function () {
      await stakeAndBake.connect(pauser).pause();
      await expect(
        stakeAndBake.connect(owner).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof
        })
      ).to.be.reverted;
    });

    it('should not allow batchStakeAndBake when paused', async function () {
      await stakeAndBake.connect(pauser).pause();
      await expect(
        stakeAndBake.connect(owner).batchStakeAndBake([
          {
            permitPayload: permitPayload,
            depositPayload: depositPayload,
            mintPayload: data.payload,
            proof: data.proof
          },
          {
            permitPayload: permitPayload2,
            depositPayload: depositPayload2,
            mintPayload: data2.payload,
            proof: data2.proof
          }
        ])
      ).to.be.reverted;
    });
  });
});
