import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { deployContract, getSignersWithPrivateKeys, Signer } from './helpers';
import { SwapRouter } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';

describe('SwapRouter', function () {
  let owner: Signer, signer1: Signer, signer2: Signer, signer3: Signer;
  let swapRouter: SwapRouter;
  let snapshot: SnapshotRestorer;
  let dummyToken: string;
  const tokenName = ethers.keccak256(ethers.toUtf8Bytes('DummyToken'));

  before(async function () {
    [signer3, signer1, signer2, owner] = await getSignersWithPrivateKeys();
    swapRouter = await deployContract('SwapRouter', [owner.address]);
    dummyToken = '0x000000000000000000000000000000000000dEaD'; // dummy token address
    snapshot = await takeSnapshot();
  });

  describe('Named Tokens', function () {
    it('should allow owner to set and get a named token', async () => {
      await expect(swapRouter.connect(owner).setNamedToken(tokenName, dummyToken))
        .to.emit(swapRouter, 'NamedTokenSet')
        .withArgs(tokenName, dummyToken);
      const result = await swapRouter.getNamedToken(tokenName);
      expect(result).to.equal(dummyToken);
    });

    it('should confirm presence of a named token', async function () {
      const result = await swapRouter.containsNamedToken(tokenName);
      expect(result).to.be.true;
    });

    it('should return all named token keys', async function () {
      const keys = await swapRouter.getNamedTokenKeys();
      expect(keys).to.include(tokenName);
    });
  });

  describe('Routes', function () {
    const fromToken = ethers.keccak256(ethers.toUtf8Bytes('TokenA'));
    const fromChainId = ethers.keccak256(ethers.toUtf8Bytes('Chain1'));
    const toToken = ethers.keccak256(ethers.toUtf8Bytes('TokenB'));
    const toChainId = ethers.keccak256(ethers.toUtf8Bytes('Chain2'));

    it('should get the correct route toToken', async () => {
      await expect(swapRouter.connect(owner).setRoute(fromToken, fromChainId, toToken, toChainId))
        .to.emit(swapRouter, 'RouteSet')
        .withArgs(fromToken, fromChainId, toToken, toChainId);
      const result = await swapRouter.getRoute(fromToken, toChainId);
      expect(result).to.equal(toToken);
    });

    it('should validate allowed route correctly', async () => {
      const isAllowed = await swapRouter.isAllowedRoute(fromToken, toChainId, toToken);
      expect(isAllowed).to.be.true;
    });

    it('should return false for incorrect route validation', async () => {
      const invalidToken = ethers.encodeBytes32String('Invalid');
      const isAllowed = await swapRouter.isAllowedRoute(fromToken, toChainId, invalidToken);
      expect(isAllowed).to.be.false;
    });
  });
});
