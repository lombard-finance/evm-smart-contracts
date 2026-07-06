import { ethers } from 'hardhat';
import { expect } from 'chai';
import { SnapshotRestorer, takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  Addressable,
  calculateStorageSlot,
  deployContract,
  encode,
  getSignersWithPrivateKeys,
  randomBigInt,
  Signer,
  UNLIMITED_MINTER_CONFIG
} from '../helpers';
import type { ShareToken } from '../../typechain-types';
import type { DeployProxyOptions } from '@openzeppelin/hardhat-upgrades/dist/utils';

const PROXY_DEPLOY_OPTS: DeployProxyOptions = {
  unsafeAllow: ['external-library-linking']
};

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const DAY = 86400;

describe('ShareToken', function () {
  let owner: Signer;
  let minter: Signer;
  let pauser: Signer;
  let mintBurnPauser: Signer;
  let signer1: Signer;
  let signer2: Signer;

  let shareToken: ShareToken & Addressable;
  let snapshot: SnapshotRestorer;

  before(async function () {
    [owner, minter, pauser, mintBurnPauser, signer1, signer2] = await getSignersWithPrivateKeys();

    shareToken = await deployContract<ShareToken & Addressable>(
      'ShareToken',
      ['Strategy Shares', 'sSHARE', 18, owner.address, 0n],
      true,
      PROXY_DEPLOY_OPTS
    );

    await shareToken.connect(owner).grantRole(await shareToken.MANAGER_ROLE(), owner.address);
    await shareToken.connect(owner).grantRole(await shareToken.MINTER_ROLE(), minter.address);
    await shareToken.connect(owner).setMinterLimit(minter.address, UNLIMITED_MINTER_CONFIG);
    await shareToken.connect(owner).grantRole(await shareToken.PAUSER_ROLE(), pauser.address);
    await shareToken.connect(owner).grantRole(await shareToken.MINT_BURN_PAUSER_ROLE(), mintBurnPauser.address);

    snapshot = await takeSnapshot();
  });

  describe('Deployment', function () {
    before(async function () {
      await snapshot.restore();
    });

    it('initializes name, symbol, decimals, and owner', async function () {
      expect(await shareToken.name()).to.equal('Strategy Shares');
      expect(await shareToken.symbol()).to.equal('sSHARE');
      expect(await shareToken.decimals()).to.equal(18n);
      expect(await shareToken.owner()).to.equal(owner.address);
    });

    it('mintBurnPaused is false by default', async function () {
      expect(await shareToken.mintBurnPaused()).to.be.false;
    });

    it('transfers are not paused by default', async function () {
      expect(await shareToken.paused()).to.be.false;
    });
  });

  describe('ERC-7201 namespaced storage', function () {
    before(async function () {
      await snapshot.restore();
    });

    it('lombardfinance.storage.BaseLBTC: mintBurnPaused word', async function () {
      const slot = calculateStorageSlot('lombardfinance.storage.BaseLBTC');
      expect(slot).to.equal(ethers.toBigInt('0xb916f9bd559884fff7955a8f87abe9b4ee4ee4202b8eb445cd8f820d3ee19000'));
      const word = await ethers.provider.getStorage(shareToken.address, slot);
      const paused = await shareToken.mintBurnPaused();
      expect(word).to.equal(encode(['uint256'], [paused ? 1n : 0n]));
    });

    it('lombardfinance.storage.ShareToken: decimals word', async function () {
      const slot = calculateStorageSlot('lombardfinance.storage.ShareToken');
      expect(slot).to.equal(ethers.toBigInt('0x93930c3a8d0bcac1539d1b8c6b0db66ea6a4a770e7037f2aaaab8672b3cb4f00'));
      const word = await ethers.provider.getStorage(shareToken.address, slot);
      expect(word).to.equal(encode(['uint256'], [await shareToken.decimals()]));
    });
  });

  describe('LBTC interface stubs', function () {
    before(async function () {
      await snapshot.restore();
    });

    const lbtcGetters = ['getAssetRouter', 'isNative', 'isRedeemsEnabled', 'getTreasury', 'getRedeemFee'] as const;

    for (const getter of lbtcGetters) {
      it(`${getter}() reverts with LbtcFeatureNotSupported`, async function () {
        await expect(shareToken[getter]()).to.be.revertedWithCustomError(shareToken, 'LbtcFeatureNotSupported');
      });
    }
  });

  describe('Mint and burn', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('mint() minter can mint to an account', async function () {
      const amount = randomBigInt(8);
      await expect(shareToken.connect(minter).mint(signer1.address, amount)).to.changeTokenBalance(
        shareToken,
        signer1,
        amount
      );
    });

    it('mint() reverts when caller lacks MINTER_ROLE', async function () {
      const amount = randomBigInt(8);
      await expect(shareToken.connect(signer1).mint(signer2.address, amount))
        .to.be.revertedWithCustomError(shareToken, 'AccessControlUnauthorizedAccount')
        .withArgs(signer1.address, await shareToken.MINTER_ROLE());
    });

    it('batchMint() minter can mint to many accounts', async function () {
      const amount1 = randomBigInt(8);
      const amount2 = randomBigInt(8);
      await expect(
        shareToken.connect(minter).batchMint([signer1.address, signer2.address], [amount1, amount2])
      ).to.changeTokenBalances(shareToken, [signer1, signer2], [amount1, amount2]);
    });

    it('batchMint() reverts on length mismatch', async function () {
      const amount = randomBigInt(8);
      await expect(
        shareToken.connect(minter).batchMint([signer1.address], [amount, amount])
      ).to.be.revertedWithCustomError(shareToken, 'NonEqualLength');
    });

    it('burn(uint256) holder can burn own balance', async function () {
      const balance = randomBigInt(8);
      const amount = balance / 3n;
      await shareToken.connect(minter).mint(signer1.address, balance);
      await expect(shareToken.connect(signer1)['burn(uint256)'](amount)).to.changeTokenBalance(
        shareToken,
        signer1,
        -amount
      );
    });

    it('burn(address,uint256) minter can burn from an account', async function () {
      const balance = randomBigInt(8);
      const amount = balance / 3n;
      await shareToken.connect(minter).mint(signer1.address, balance);
      await expect(shareToken.connect(minter)['burn(address,uint256)'](signer1.address, amount)).to.changeTokenBalance(
        shareToken,
        signer1,
        -amount
      );
    });

    it('burn(address,uint256) reverts when caller lacks MINTER_ROLE', async function () {
      const balance = randomBigInt(8);
      await shareToken.connect(minter).mint(signer1.address, balance);
      await expect(shareToken.connect(signer1)['burn(address,uint256)'](signer1.address, 1n))
        .to.be.revertedWithCustomError(shareToken, 'AccessControlUnauthorizedAccount')
        .withArgs(signer1.address, await shareToken.MINTER_ROLE());
    });
  });

  describe('Minter rate limits', function () {
    const mintLimit = 1_000_000n;
    const mintWindow = BigInt(DAY);
    const mintConfig = { limit: mintLimit, window: mintWindow };

    beforeEach(async function () {
      await snapshot.restore();
      await shareToken.connect(owner).setMinterLimit(minter.address, mintConfig);
    });

    it('getMinterLimit() returns configured state', async function () {
      const [limit, window, amountInFlight, remaining] = await shareToken.getMinterLimit(minter.address);
      expect(limit).to.equal(mintLimit);
      expect(window).to.equal(mintWindow);
      expect(amountInFlight).to.equal(0n);
      expect(remaining).to.equal(mintLimit);
    });

    it('mint() reverts when limit exceeded', async function () {
      await expect(shareToken.connect(minter).mint(signer1.address, mintLimit + 1n)).to.be.reverted;
    });

    it('setMinterLimit() reverts for non-manager', async function () {
      await expect(shareToken.connect(signer1).setMinterLimit(minter.address, mintConfig))
        .to.be.revertedWithCustomError(shareToken, 'AccessControlUnauthorizedAccount')
        .withArgs(signer1.address, await shareToken.MANAGER_ROLE());
    });
  });

  describe('Pause', function () {
    beforeEach(async function () {
      await snapshot.restore();
      await shareToken.connect(minter).mint(signer1.address, randomBigInt(8));
    });

    describe('Transfer pause', function () {
      it('pauseTransfers() blocks transfers and mint/burn via _update', async function () {
        await shareToken.connect(pauser).pauseTransfers();
        expect(await shareToken.paused()).to.be.true;

        const amount = randomBigInt(6);
        await expect(shareToken.connect(minter).mint(signer2.address, amount)).to.be.revertedWithCustomError(
          shareToken,
          'EnforcedPause'
        );
      });

      it('unpauseTransfers() restores transfers', async function () {
        await shareToken.connect(pauser).pauseTransfers();
        await shareToken.connect(owner).unpauseTransfers();
        expect(await shareToken.paused()).to.be.false;
      });
    });

    describe('Mint/burn pause', function () {
      it('pauseMintBurn() blocks mint and burn while transfers stay allowed', async function () {
        await shareToken.connect(mintBurnPauser).pauseMintBurn();
        expect(await shareToken.mintBurnPaused()).to.be.true;

        const amount = randomBigInt(6);
        await expect(shareToken.connect(minter).mint(signer2.address, amount)).to.be.revertedWithCustomError(
          shareToken,
          'MintBurnPaused'
        );
        await expect(shareToken.connect(signer1)['burn(uint256)'](1n)).to.be.revertedWithCustomError(
          shareToken,
          'MintBurnPaused'
        );
      });

      it('unpauseMintBurn() restores mint and burn', async function () {
        await shareToken.connect(mintBurnPauser).pauseMintBurn();
        await shareToken.connect(owner).unpauseMintBurn();

        const amount = randomBigInt(6);
        await expect(shareToken.connect(minter).mint(signer2.address, amount)).to.changeTokenBalance(
          shareToken,
          signer2,
          amount
        );
      });
    });
  });

  describe('Name and symbol', function () {
    before(async function () {
      await snapshot.restore();
    });

    it('changeNameAndSymbol() admin can rename token and updates EIP-712 domain', async function () {
      const newName = 'Renamed Shares';
      const newSymbol = 'rSHARE';

      await expect(shareToken.connect(owner).changeNameAndSymbol(newName, newSymbol))
        .to.emit(shareToken, 'NameAndSymbolChanged')
        .withArgs(newName, newSymbol);

      expect(await shareToken.name()).to.equal(newName);
      expect(await shareToken.symbol()).to.equal(newSymbol);

      const domain = await shareToken.eip712Domain();
      expect(domain.name).to.equal(newName);
    });

    it('changeNameAndSymbol() reverts for non-admin', async function () {
      await expect(shareToken.connect(signer1).changeNameAndSymbol('X', 'Y'))
        .to.be.revertedWithCustomError(shareToken, 'AccessControlUnauthorizedAccount')
        .withArgs(signer1.address, DEFAULT_ADMIN_ROLE);
    });
  });

  describe('Inherited BaseLBTC helpers', function () {
    before(async function () {
      await snapshot.restore();
    });

    it('getFeeDigest() returns a deterministic typed-data hash', async function () {
      const fee = 123n;
      const expiry = BigInt((await ethers.provider.getBlock('latest'))!.timestamp + DAY);
      const digest = await shareToken.getFeeDigest(fee, expiry);
      expect(digest).to.match(/^0x[0-9a-f]{64}$/i);
      expect(await shareToken.getFeeDigest(fee, expiry)).to.equal(digest);
    });
  });
});
