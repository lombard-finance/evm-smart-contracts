import { ethers, upgrades } from 'hardhat';
import { SnapshotRestorer, takeSnapshot, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  Addressable,
  deployContract,
  e18,
  encode,
  getPayloadForAction,
  getSignersWithPrivateKeys,
  MINT_SELECTOR,
  NEW_VALSET,
  randomBigInt,
  RATIO_UPDATE,
  Signer,
  signPayload
} from './helpers';
import { Consortium, StakedLBTC, StakedLBTCOracle } from '../typechain-types';
import { expect } from 'chai';

describe('StakedLBTCOracle', function () {
  let _: Signer, owner: Signer, treasury: Signer, notary1: Signer, notary2: Signer, signer1: Signer;

  let stakedLbtc: StakedLBTC & Addressable;
  const stLbtcDenomHash = ethers.sha256(ethers.toUtf8Bytes('uclbtc'));
  const defaultMaxAheadInterval = 86400;
  let consortium: Consortium & Addressable;
  let oracle: StakedLBTCOracle & Addressable;

  let defaultSwitchTime: number;
  const defaultNextRatio = e18 - 100n;

  let snapshot: SnapshotRestorer;

  before(async function () {
    [_, owner, treasury, notary1, notary2, signer1] = await getSignersWithPrivateKeys();

    consortium = await deployContract<Consortium & Addressable>('Consortium', [owner.address]);
    consortium.address = await consortium.getAddress();
    await consortium
      .connect(owner)
      .setInitialValidatorSet(
        getPayloadForAction([1, [notary1.publicKey, notary2.publicKey], [1, 1], 2, 1], NEW_VALSET)
      );

    stakedLbtc = await deployContract<StakedLBTC & Addressable>('StakedLBTC', [
      await consortium.getAddress(),
      treasury.address,
      owner.address
    ]);
    stakedLbtc.address = await stakedLbtc.getAddress();

    defaultSwitchTime = (await time.latest()) + 3600;
    const oracleFactory = await ethers.getContractFactory('StakedLBTCOracle');
    const oracleContract = await upgrades.deployProxy(
      oracleFactory,
      [
        owner.address,
        consortium.address,
        stakedLbtc.address,
        stLbtcDenomHash,
        defaultNextRatio,
        defaultSwitchTime,
        defaultMaxAheadInterval
      ],
      { initializer: 'initialize', unsafeAllow: ['constructor'] }
    );
    await oracleContract.waitForDeployment();
    oracle = (await oracleFactory.attach(await oracleContract.getAddress())) as StakedLBTCOracle & Addressable;
    oracle.address = await oracle.getAddress();

    snapshot = await takeSnapshot();
  });

  describe('Deployment params', function () {
    before(async function () {
      await snapshot.restore();
    });

    it('Owner', async function () {
      expect(await oracle.owner()).to.be.eq(owner.address);
    });

    it('Consortium', async function () {
      expect(await oracle.consortium()).to.be.eq(consortium.address);
    });

    it('maxAheadInterval', async function () {
      expect(await oracle.maxAheadInterval()).to.be.eq(defaultMaxAheadInterval);
    });

    it('Token', async function () {
      expect(await oracle.token()).to.be.eq(stakedLbtc.address);
    });

    it('Denom hash', async function () {
      expect(await oracle.denomHash()).to.be.eq(stLbtcDenomHash);
    });

    it('Ratio threshold', async function () {
      expect(await oracle.ratioThreshold()).to.be.eq(100000n);
    });

    it('Ratio', async function () {
      expect(await oracle.ratio()).to.be.eq(e18);
    });

    it('Next ratio', async function () {
      const [nextRatio, switchTime] = await oracle.nextRatio();
      expect(nextRatio).to.be.eq(defaultNextRatio);
      expect(switchTime).to.be.eq(defaultSwitchTime);
    });

    it('Get rate', async function () {
      expect(await oracle.getRate()).to.be.eq(e18);
    });

    it('Switch to the next ratio', async function () {
      await time.increaseTo(defaultSwitchTime + 1);
      expect(await oracle.ratio()).to.be.eq(defaultNextRatio);
      expect(await oracle.getRate()).to.be.closeTo((e18 * e18) / defaultNextRatio, 1n);

      const [nextRatio, switchTime] = await oracle.nextRatio();
      expect(nextRatio).to.be.eq(defaultNextRatio);
      expect(switchTime).to.be.eq(defaultSwitchTime);
    });
  });

  describe('Setters', function () {
    beforeEach(async function () {
      await snapshot.restore();
      console.log(await oracle.maxAheadInterval());
    });

    it('changeConsortium() only owner can', async function () {
      const newValue = ethers.Wallet.createRandom().address;
      await expect(oracle.connect(owner).changeConsortium(newValue))
        .to.emit(oracle, 'Oracle_ConsortiumChanged')
        .withArgs(consortium.address, newValue);
      expect(await oracle.consortium()).to.be.eq(newValue);
    });

    it('changeConsortium() reverts when called by not an owner', async function () {
      const newValue = ethers.Wallet.createRandom().address;
      await expect(oracle.connect(signer1).changeConsortium(newValue))
        .to.be.revertedWithCustomError(oracle, 'OwnableUnauthorizedAccount')
        .withArgs(signer1.address);
    });

    it('changeConsortium() reverts when zero address', async function () {
      const newValue = ethers.ZeroAddress;
      await expect(oracle.connect(owner).changeConsortium(newValue)).to.be.revertedWithCustomError(
        oracle,
        'ZeroAddress'
      );
    });

    it('changeMaxAheadInterval() only owner can', async function () {
      const newValue = randomBigInt(8);
      await expect(oracle.connect(owner).changeMaxAheadInterval(newValue))
        .to.emit(oracle, 'Oracle_MaxAheadIntervalChanged')
        .withArgs(defaultMaxAheadInterval, newValue);
      expect(await oracle.maxAheadInterval()).to.be.eq(newValue);
    });

    it('changeMaxAheadInterval() reverts when called by not an owner', async function () {
      const newValue = randomBigInt(8);
      await expect(oracle.connect(signer1).changeMaxAheadInterval(newValue))
        .to.be.revertedWithCustomError(oracle, 'OwnableUnauthorizedAccount')
        .withArgs(signer1.address);
    });

    it.skip('changeMaxAheadInterval() reverts when new value = 0', async function () {
      const newValue = 0n;
      await expect(oracle.connect(owner).changeMaxAheadInterval(newValue)).to.be.reverted;
    });

    it('updateRatioThreshold() only owner can', async function () {
      const newValue = randomBigInt(8);
      await expect(oracle.connect(owner).updateRatioThreshold(newValue))
        .to.emit(oracle, 'RatioThresholdUpdated')
        .withArgs(100000n, newValue);
      expect(await oracle.ratioThreshold()).to.be.eq(newValue);
    });

    it('updateRatioThreshold() reverts when called by not an owner', async function () {
      const newValue = randomBigInt(8);
      await expect(oracle.connect(signer1).updateRatioThreshold(newValue))
        .to.be.revertedWithCustomError(oracle, 'OwnableUnauthorizedAccount')
        .withArgs(signer1.address);
    });

    it('updateRatioThreshold() reverts when new value = 0', async function () {
      const newValue = 0n;
      await expect(oracle.connect(owner).updateRatioThreshold(newValue)).to.be.revertedWith(
        'new ratio threshold out of range'
      );
    });

    it('updateRatioThreshold() reverts when new value > MAX', async function () {
      const newValue = 100_000000;
      await expect(oracle.connect(owner).updateRatioThreshold(newValue)).to.be.revertedWith(
        'new ratio threshold out of range'
      );
    });
  });

  describe('Publish new ratio', function () {
    let stakedLbtcBytes: string;

    beforeEach(async function () {
      await snapshot.restore();
      stakedLbtcBytes = encode(['address'], [stakedLbtc.address]);
    });

    it('publishNewRatio() anyone can publish with valid proof', async function () {
      await time.increase(86400 - 600);
      const ratioBefore = await oracle.ratio();
      const newRatio = ratioBefore - randomBigInt(5);
      const newRatioSwitchTime = (await time.latest()) + 600;
      const payload = getPayloadForAction([stLbtcDenomHash, newRatio, newRatioSwitchTime], RATIO_UPDATE);
      const { proof } = await signPayload([notary1, notary2], [true, true], payload);
      await expect(oracle.connect(signer1).publishNewRatio(payload, proof))
        .to.emit(oracle, 'Oracle_RatioChanged')
        .withArgs(ratioBefore, newRatio, newRatioSwitchTime);

      const [nextRatio, switchTime] = await oracle.nextRatio();
      expect(nextRatio).to.be.eq(newRatio);
      expect(switchTime).to.be.eq(newRatioSwitchTime);

      await time.increaseTo(newRatioSwitchTime + 1);
      expect(await oracle.ratio()).to.be.eq(newRatio);
    });

    it('publishNewRatio() publish new ratio before the next one was applied', async function () {
      let newRatioSwitchTime = (await time.latest()) + 86400;
      const ratioBefore = await oracle.ratio();
      let payload = getPayloadForAction([stLbtcDenomHash, ratioBefore, newRatioSwitchTime], RATIO_UPDATE);
      let signed = await signPayload([notary1, notary2], [true, true], payload);
      await oracle.connect(signer1).publishNewRatio(payload, signed.proof);

      const newRatio = ratioBefore - randomBigInt(5);
      newRatioSwitchTime++;
      payload = getPayloadForAction([stLbtcDenomHash, newRatio, newRatioSwitchTime], RATIO_UPDATE);
      let { proof } = await signPayload([notary1, notary2], [true, true], payload);
      await expect(oracle.connect(signer1).publishNewRatio(payload, proof))
        .to.emit(oracle, 'Oracle_RatioChanged')
        .withArgs(ratioBefore, newRatio, newRatioSwitchTime);

      const [nextRatio, switchTime] = await oracle.nextRatio();
      expect(nextRatio).to.be.eq(newRatio);
      expect(switchTime).to.be.eq(newRatioSwitchTime);

      await time.increaseTo(newRatioSwitchTime + 1);
      expect(await oracle.ratio()).to.be.eq(newRatio);
    });

    it('publishNewRatio() publish many times', async function () {
      await time.increaseTo(defaultSwitchTime + 1);

      for (let i = 0; i < 10; i++) {
        await time.increase(86400 - 600);
        const ratioBefore = await oracle.ratio();
        const newRatio = (ratioBefore * 999n) / 1000n;
        const newRatioSwitchTime = (await time.latest()) + 600;
        const payload = getPayloadForAction([stLbtcDenomHash, newRatio, newRatioSwitchTime], RATIO_UPDATE);
        const { proof } = await signPayload([notary1, notary2], [true, true], payload);
        await expect(oracle.connect(signer1).publishNewRatio(payload, proof))
          .to.emit(oracle, 'Oracle_RatioChanged')
          .withArgs(ratioBefore, newRatio, newRatioSwitchTime);

        const [nextRatio, switchTime] = await oracle.nextRatio();
        expect(nextRatio).to.be.eq(newRatio);
        expect(switchTime).to.be.eq(newRatioSwitchTime);

        await time.increaseTo(newRatioSwitchTime + 1);
        expect(await oracle.ratio()).to.be.eq(newRatio);
      }
    });

    it('publishNewRatio() after 10 days of no activity', async function () {
      await time.increaseTo(defaultSwitchTime + 86400 * 10);
      console.log(await time.latest());

      const ratioBefore = await oracle.ratio();
      const newRatio = (ratioBefore * 99n) / 100n;
      const newRatioSwitchTime = (await time.latest()) + 600;
      const payload = getPayloadForAction([stLbtcDenomHash, newRatio, newRatioSwitchTime], RATIO_UPDATE);
      const { proof } = await signPayload([notary1, notary2], [true, true], payload);
      await expect(oracle.connect(signer1).publishNewRatio(payload, proof))
        .to.emit(oracle, 'Oracle_RatioChanged')
        .withArgs(ratioBefore, newRatio, newRatioSwitchTime);

      const [nextRatio, switchTime] = await oracle.nextRatio();
      expect(nextRatio).to.be.eq(newRatio);
      expect(switchTime).to.be.eq(newRatioSwitchTime);

      await time.increaseTo(newRatioSwitchTime + 1);
      expect(await oracle.ratio()).to.be.eq(newRatio);
    });

    it('publishNewRatio() when switch time is in the past', async function () {
      await time.increaseTo(defaultSwitchTime + 86400);

      const ratioBefore = await oracle.ratio();
      const newRatio = ratioBefore - randomBigInt(5);
      const newRatioSwitchTime = (await time.latest()) - 600;
      const payload = getPayloadForAction([stLbtcDenomHash, newRatio, newRatioSwitchTime], RATIO_UPDATE);
      const { proof } = await signPayload([notary1, notary2], [true, true], payload);
      await expect(oracle.connect(signer1).publishNewRatio(payload, proof))
        .to.emit(oracle, 'Oracle_RatioChanged')
        .withArgs(ratioBefore, newRatio, newRatioSwitchTime);

      expect(await oracle.ratio()).to.be.eq(newRatio);

      const [nextRatio, switchTime] = await oracle.nextRatio();
      expect(nextRatio).to.be.eq(newRatio);
      expect(switchTime).to.be.eq(newRatioSwitchTime);
    });

    const args = [
      {
        name: 'denom does not match',
        payload: async () =>
          getPayloadForAction(
            [ethers.sha256(ethers.toUtf8Bytes('ucbtc')), e18 - randomBigInt(7), defaultSwitchTime + 1],
            RATIO_UPDATE
          ),
        signature: async (payload: string) => await signPayload([notary1, notary2], [true, true], payload),
        customError: () => [oracle, 'WrongToken']
      },
      {
        name: 'new switch time is the same as current',
        payload: async () =>
          getPayloadForAction([stLbtcDenomHash, e18 - randomBigInt(7), defaultSwitchTime], RATIO_UPDATE),
        signature: async (payload: string) => await signPayload([notary1, notary2], [true, true], payload),
        customError: () => [oracle, 'WrongRatioSwitchTime']
      },
      {
        name: 'new switch time is before current',
        payload: async () =>
          getPayloadForAction([stLbtcDenomHash, e18 - randomBigInt(7), defaultSwitchTime], RATIO_UPDATE),
        signature: async (payload: string) => await signPayload([notary1, notary2], [true, true], payload),
        customError: () => [oracle, 'WrongRatioSwitchTime']
      },
      {
        name: 'new switch time is later than max ahead period',
        payload: async () =>
          getPayloadForAction(
            [stLbtcDenomHash, e18 - randomBigInt(7), defaultSwitchTime + defaultMaxAheadInterval + 10],
            RATIO_UPDATE
          ),
        signature: async (payload: string) => await signPayload([notary1, notary2], [true, true], payload),
        customError: () => [oracle, 'WrongRatioSwitchTime']
      },
      {
        name: 'new ratio is out of threshold',
        payload: async () =>
          getPayloadForAction([stLbtcDenomHash, (e18 * 999n) / 1000n, (await time.latest()) + 86400], RATIO_UPDATE),
        signature: async (payload: string) => await signPayload([notary1, notary2], [true, true], payload),
        customError: () => [oracle, 'TooBigRatioChange']
      },
      {
        name: 'new ratio greater than current',
        payload: async () =>
          getPayloadForAction([stLbtcDenomHash, (e18 * 1001n) / 1000n, (await time.latest()) + 86400], RATIO_UPDATE),
        signature: async (payload: string) => await signPayload([notary1, notary2], [true, true], payload),
        customError: () => [oracle, 'TooBigRatioChange']
      },
      {
        name: 'not enough signatures',
        payload: async () =>
          getPayloadForAction([stLbtcDenomHash, e18 - randomBigInt(7), defaultSwitchTime + 1], RATIO_UPDATE),
        signature: async (payload: string) => await signPayload([notary1, notary2], [true, false], payload),
        customError: () => [consortium, 'NotEnoughSignatures']
      },
      {
        name: 'invalid payload',
        payload: async () =>
          getPayloadForAction([stakedLbtcBytes, encode(['address'], [signer1.address]), 1000_000n], MINT_SELECTOR),
        signature: async (payload: string) => await signPayload([notary1, notary2], [true, true], payload),
        customError: () => [oracle, 'InvalidAction']
      },
      {
        name: 'proof does not match',
        payload: async () =>
          getPayloadForAction([stLbtcDenomHash, e18 - randomBigInt(7), defaultSwitchTime + 1], RATIO_UPDATE),
        signature: async (payload: string) =>
          await signPayload(
            [notary1, notary2],
            [true, true],
            getPayloadForAction([stLbtcDenomHash, e18 - randomBigInt(7), defaultSwitchTime + 2], RATIO_UPDATE)
          ),
        customError: () => [consortium, 'NotEnoughSignatures']
      }
    ];

    args.forEach(function (arg) {
      it(`publishNewRatio() reverts when ${arg.name}`, async function () {
        const payload = await arg.payload();
        const { proof } = await arg.signature(payload);

        await expect(oracle.connect(signer1).publishNewRatio(payload, proof))
          // @ts-ignore
          .to.be.revertedWithCustomError(...arg.customError());
      });
    });
  });
});
