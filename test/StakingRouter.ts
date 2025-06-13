import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { deployContract, getSignersWithPrivateKeys, Signer } from './helpers';
import { StakingRouter } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';

describe('StakingRouter', function () {
  let owner: Signer, signer1: Signer, signer2: Signer, signer3: Signer, mailboxAddress: Signer;
  let StakingRouter: StakingRouter;
  let snapshot: SnapshotRestorer;

  before(async function () {
    [signer3, signer1, signer2, owner, mailboxAddress] = await getSignersWithPrivateKeys();
    StakingRouter = await deployContract('StakingRouter', [owner.address, mailboxAddress.address]);
    snapshot = await takeSnapshot();
  });

  describe('Named Tokens', function () {
    const dummyToken1 = ethers.Wallet.createRandom().address;
    const dummyToken2 = ethers.Wallet.createRandom().address;
    const tokenName1 = ethers.keccak256(ethers.toUtf8Bytes('DummyToken1'));
    const tokenName2 = ethers.keccak256(ethers.toUtf8Bytes('DummyToken2'));

    it('setNamedToken() owner can set token name', async () => {
      await expect(StakingRouter.connect(owner).setNamedToken(tokenName1, dummyToken1))
        .to.emit(StakingRouter, 'NamedTokenSet')
        .withArgs(tokenName1, dummyToken1);
      expect(await StakingRouter.getNamedToken(tokenName1)).to.equal(dummyToken1);
    });

    it('should confirm presence of a named token', async function () {
      expect(await StakingRouter.containsNamedToken(tokenName1)).to.be.true;
    });

    it('should return all named token keys', async function () {
      expect(await StakingRouter.getNamedTokenKeys()).to.include(tokenName1);
    });

    it('setNamedToken() owner can set another named token', async () => {
      await expect(StakingRouter.connect(owner).setNamedToken(tokenName2, dummyToken2))
        .to.emit(StakingRouter, 'NamedTokenSet')
        .withArgs(tokenName2, dummyToken2);
      expect(await StakingRouter.getNamedToken(tokenName2)).to.equal(dummyToken2);
      expect([...(await StakingRouter.getNamedTokenKeys())]).to.have.members([tokenName1, tokenName2]);
    });

    it('setNamedToken() owner can change named token address', async () => {
      await expect(StakingRouter.connect(owner).setNamedToken(tokenName2, dummyToken1))
        .to.emit(StakingRouter, 'NamedTokenSet')
        .withArgs(tokenName2, dummyToken1);
      expect(await StakingRouter.getNamedToken(tokenName2)).to.equal(dummyToken1);
      expect([...(await StakingRouter.getNamedTokenKeys())]).to.have.members([tokenName1, tokenName2]);
    });

    it('setNamedToken() reverts when called by not an owner', async () => {
      await expect(StakingRouter.connect(signer1).setNamedToken(tokenName2, dummyToken1))
        .to.revertedWithCustomError(StakingRouter, 'OwnableUnauthorizedAccount')
        .withArgs(signer1);
    });
  });

  describe('Routes', function () {
    const fromToken = ethers.keccak256(ethers.toUtf8Bytes('TokenA'));
    const fromChainId = ethers.keccak256(ethers.toUtf8Bytes('Chain1'));
    const toToken = ethers.keccak256(ethers.toUtf8Bytes('TokenB'));
    const toChainId = ethers.keccak256(ethers.toUtf8Bytes('Chain2'));

    it('setRoute() owner can set route', async () => {
      await expect(StakingRouter.connect(owner).setRoute(fromToken, fromChainId, toToken, toChainId))
        .to.emit(StakingRouter, 'RouteSet')
        .withArgs(fromToken, fromChainId, toToken, toChainId);
      expect(await StakingRouter.getRoute(fromToken, toChainId)).to.equal(toToken);
    });

    it('setRoute() reverts when called by not an owner', async () => {
      await expect(StakingRouter.connect(signer1).setRoute(fromToken, fromChainId, toToken, toChainId))
        .to.revertedWithCustomError(StakingRouter, 'OwnableUnauthorizedAccount')
        .withArgs(signer1);
    });

    it('isAllowedRoute() is true when route is allowed', async () => {
      const isAllowed = await StakingRouter.isAllowedRoute(fromToken, toChainId, toToken);
      expect(isAllowed).to.be.true;
    });

    it('isAllowedRoute() when fromToken is unknown', async () => {
      const invalidToken = ethers.encodeBytes32String('Invalid');
      expect(await StakingRouter.isAllowedRoute(invalidToken, toChainId, toToken)).to.be.false;
    });

    it('isAllowedRoute() when toChainId is unknown', async () => {
      const invalidChain = ethers.encodeBytes32String('Invalid');
      expect(await StakingRouter.isAllowedRoute(fromToken, invalidChain, toToken)).to.be.false;
    });

    it('isAllowedRoute() when toToken is unknown', async () => {
      const invalidToken = ethers.encodeBytes32String('Invalid');
      expect(await StakingRouter.isAllowedRoute(fromToken, toChainId, invalidToken)).to.be.false;
    });
  });
});
