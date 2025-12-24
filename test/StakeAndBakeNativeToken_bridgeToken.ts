import { ethers, network } from 'hardhat';
import { expect } from 'chai';
import { SnapshotRestorer, takeSnapshot, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  Addressable,
  CHAIN_ID,
  DefaultData,
  deployContract,
  encode,
  getPayloadForAction,
  getSignersWithPrivateKeys,
  NEW_VALSET,
  randomBigInt,
  rawSign,
  signDepositBtcV1Payload,
  Signer
} from './helpers';
import {
  BridgeTokenAdapter,
  BridgeTokenMock,
  Consortium,
  ERC4626Depositor,
  ERC4626Mock,
  StakeAndBakeNativeToken,
  TellerWithMultiAssetSupportDepositor,
  TellerWithMultiAssetSupportMock
} from '../typechain-types';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { Addressable as EthersAddressable } from 'ethers';

describe('StakeAndBakeNativeToken_with_bridge_token_adapter', function () {
  let _: Signer,
    owner: Signer,
    signer1: Signer,
    signer2: Signer,
    signer3: Signer,
    notary1: Signer,
    notary2: Signer,
    operator: Signer,
    pauser: Signer,
    treasury: Signer,
    trustedSigner: Signer;
  let bridgeToken: BridgeTokenMock & Addressable;
  let bridgeTokenAdapter: BridgeTokenAdapter & Addressable;
  let stakeAndBakeForNativeToken: StakeAndBakeNativeToken & Addressable;
  let erc4626Depositor: ERC4626Depositor & Addressable;
  let vault: ERC4626Mock & Addressable;
  let consortium: Consortium & Addressable;
  let snapshot: SnapshotRestorer;

  const toNativeCommission = 1000n;
  const fee = 1n;

  before(async function () {
    await network.provider.request({ method: 'hardhat_reset', params: [] });

    [_, owner, signer1, signer2, signer3, notary1, notary2, operator, pauser, treasury, trustedSigner] =
      await getSignersWithPrivateKeys();

    consortium = await deployContract<Consortium & Addressable>('Consortium', [owner.address]);
    consortium.address = await consortium.getAddress();
    await consortium
      .connect(owner)
      .setInitialValidatorSet(
        getPayloadForAction([1, [notary1.publicKey, notary2.publicKey], [1, 1], 2, 1], NEW_VALSET)
      );

    bridgeToken = await deployContract<BridgeTokenMock & Addressable>('BridgeTokenMock', [], false);
    bridgeToken.address = await bridgeToken.getAddress();
    bridgeTokenAdapter = await deployContract<BridgeTokenAdapter & Addressable>('BridgeTokenAdapter', [
      await consortium.getAddress(),
      treasury.address,
      owner.address,
      0n, //owner delay
      await bridgeToken.getAddress()
    ]);
    bridgeTokenAdapter.address = await bridgeTokenAdapter.getAddress();
    await bridgeToken.migrateBridgeRole(bridgeTokenAdapter);

    stakeAndBakeForNativeToken = await deployContract<StakeAndBakeNativeToken & Addressable>(
      'StakeAndBakeNativeToken',
      [
        bridgeToken.address,
        bridgeTokenAdapter.address,
        owner.address,
        operator.address,
        1,
        owner.address,
        pauser.address,
        1_000_000
      ]
    );
    stakeAndBakeForNativeToken.address = await stakeAndBakeForNativeToken.getAddress();

    vault = await deployContract<ERC4626Mock & Addressable>('ERC4626Mock', [bridgeToken.address], false);
    vault.address = await vault.getAddress();

    erc4626Depositor = await deployContract<ERC4626Depositor & Addressable>(
      'ERC4626Depositor',
      [await vault.getAddress(), bridgeToken.address, await stakeAndBakeForNativeToken.getAddress()],
      false
    );
    erc4626Depositor.address = await erc4626Depositor.getAddress();
    await expect(stakeAndBakeForNativeToken.connect(owner).setDepositor(erc4626Depositor.address))
      .to.emit(stakeAndBakeForNativeToken, 'DepositorSet')
      .withArgs(erc4626Depositor.address);

    snapshot = await takeSnapshot();
  });

  async function defaultData(
    recipient: EthersAddressable = signer1,
    amount: bigint = randomBigInt(8),
    cutV: boolean = false
  ): Promise<DefaultData> {
    const txid = encode(['uint256'], [randomBigInt(8)]);
    const { payload, payloadHash, proof } = await signDepositBtcV1Payload(
      [notary1, notary2],
      [true, true],
      CHAIN_ID,
      await recipient.getAddress(),
      amount,
      txid,
      bridgeTokenAdapter.address
    );
    const depositId = ethers.keccak256('0x' + payload.slice(10));
    let cubistProof = rawSign(trustedSigner, depositId);
    if (cutV) {
      cubistProof = cubistProof.slice(0, 130); // remove V from each sig to follow real consortium
    }
    return {
      payload,
      payloadHash,
      proof,
      amount,
      tokenRecipient: recipient,
      depositId,
      cubistProof,
      txid
    } as unknown as DefaultData;
  }

  describe('Stake and Bake', function () {
    before(async function () {
      await snapshot.restore();
    });

    const args = [
      {
        name: 'staking amount = minting amount',
        mintAmount: randomBigInt(8),
        stakeAmount: (a: bigint): bigint => a,
        minVaultTokenAmount: (a: bigint): bigint => a
      },
      {
        name: 'staking amount < minting amount',
        mintAmount: randomBigInt(8),
        stakeAmount: (a: bigint): bigint => a - 1n,
        minVaultTokenAmount: (a: bigint): bigint => a
      },
      {
        name: 'decreased min vault tokens amount',
        mintAmount: randomBigInt(8),
        stakeAmount: (a: bigint): bigint => a,
        minVaultTokenAmount: (a: bigint): bigint => a - 1n
      }
    ];

    args.forEach(function (arg) {
      it(`stakeAndBake: when ${arg.name}`, async function () {
        const mintAmount = arg.mintAmount;
        const stakeAmount = arg.stakeAmount(mintAmount);
        const minVaultTokenAmount = arg.minVaultTokenAmount(stakeAmount - fee);
        const expectedMinVaultTokenAmount = stakeAmount - fee;
        const data = await defaultData(signer1, mintAmount);

        const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

        await bridgeToken.connect(signer1).approve(stakeAndBakeForNativeToken.address, mintAmount);

        const tx = await stakeAndBakeForNativeToken.connect(owner).stakeAndBake({
          permitPayload: '0x00',
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        });

        await expect(tx)
          .to.emit(vault, 'Transfer')
          .withArgs(ethers.ZeroAddress, signer1.address, expectedMinVaultTokenAmount);
        await expect(tx).to.changeTokenBalance(vault, signer1, expectedMinVaultTokenAmount);
        await expect(tx).to.changeTokenBalance(bridgeToken, signer1, mintAmount - stakeAmount);
        expect(await bridgeToken.allowance(signer1.address, stakeAndBakeForNativeToken.address)).to.be.eq(
          mintAmount - stakeAmount
        );

        await expect(tx).to.changeTokenBalance(bridgeToken, treasury, fee);
        await expect(tx).to.changeTokenBalance(bridgeToken, vault, stakeAmount - fee);
      });

      it(`batchStakeAndBake: when ${arg.name}`, async function () {
        const mintAmount = arg.mintAmount;
        const stakeAmount = arg.stakeAmount(mintAmount);
        const minVaultTokenAmount = arg.minVaultTokenAmount(stakeAmount - fee);
        const expectedMinVaultTokenAmount = stakeAmount - fee;

        const stakeAndBakeData = [];
        for (const signer of [signer2, signer3]) {
          const data = await defaultData(signer, mintAmount);

          const depositPayload = encode(['uint256'], [minVaultTokenAmount]);
          stakeAndBakeData.push({
            permitPayload: '0x00',
            depositPayload: depositPayload,
            mintPayload: data.payload,
            proof: data.proof,
            amount: stakeAmount
          });

          await bridgeToken.connect(signer).approve(stakeAndBakeForNativeToken.address, mintAmount);
        }

        const tx = await stakeAndBakeForNativeToken.connect(owner).batchStakeAndBake(stakeAndBakeData);

        for (const signer of [signer2, signer3]) {
          await expect(tx).to.changeTokenBalance(vault, signer, expectedMinVaultTokenAmount);
          await expect(tx).to.changeTokenBalance(bridgeToken, signer, mintAmount - stakeAmount);
          expect(await bridgeToken.allowance(signer.address, stakeAndBakeForNativeToken.address)).to.be.eq(
            mintAmount - stakeAmount
          );
        }
        await expect(tx).to.changeTokenBalance(bridgeToken, treasury, fee * 2n);
        await expect(tx).to.changeTokenBalance(bridgeToken, vault, (stakeAmount - fee) * 2n);
      });
    });

    const invalidArgs = [
      {
        name: 'staking amount exceeds amount in deposit payload',
        mintAmount: randomBigInt(8),
        stakeAmount: (a: bigint): bigint => a + 1n,
        approveAmount: (a: bigint): bigint => a + 1n,
        minVaultTokenAmount: (a: bigint): bigint => a - fee,
        customError: () => [bridgeToken, 'ERC20InsufficientBalance']
      },
      {
        name: 'staking amount is 0 after fee',
        mintAmount: fee,
        stakeAmount: (a: bigint): bigint => a,
        approveAmount: (a: bigint): bigint => a,
        minVaultTokenAmount: (a: bigint): bigint => a - fee,
        customError: () => [stakeAndBakeForNativeToken, 'ZeroDepositAmount']
      },
      {
        name: 'allowance is not sufficient',
        mintAmount: fee,
        stakeAmount: (a: bigint): bigint => a,
        approveAmount: (a: bigint): bigint => a - 1n,
        minVaultTokenAmount: (a: bigint): bigint => a - fee,
        customError: () => [stakeAndBakeForNativeToken, 'InvalidPermitPayload']
      }
    ];

    invalidArgs.forEach(function (arg) {
      it(`stakeAndBake: rejects when ${arg.name}`, async function () {
        await snapshot.restore();

        const mintAmount = arg.mintAmount;
        const stakeAmount = arg.stakeAmount(mintAmount);
        const approveAmount = arg.approveAmount(mintAmount);
        const minVaultTokenAmount = arg.minVaultTokenAmount(stakeAmount);
        const data = await defaultData(signer2, mintAmount);
        const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

        await bridgeToken.connect(signer2).approve(stakeAndBakeForNativeToken.address, approveAmount);

        await expect(
          stakeAndBakeForNativeToken.connect(owner).stakeAndBake({
            permitPayload: '0x00',
            depositPayload: depositPayload,
            mintPayload: data.payload,
            proof: data.proof,
            amount: stakeAmount
          })
          // @ts-ignore
        ).to.be.revertedWithCustomError(...arg.customError());
      });
    });

    it('batchStakeAndBake: skips invalid payloads', async function () {
      await snapshot.restore();
      const amt = randomBigInt(8);
      // const mintAmount = [randomBigInt(8), randomBigInt(8)];
      const mintAmount = [amt, amt];
      const permitAmount = [mintAmount[0], mintAmount[1]];
      const stakeAmount = [mintAmount[0], mintAmount[1]];
      const minVaultTokenAmount = stakeAmount[1] - fee;
      const expectedMinVaultTokenAmount = stakeAmount[1] - fee;

      const stakeAndBakeData = [];
      let i = 0;
      for (const signer of [signer2, signer3]) {
        const data = await defaultData(signer, mintAmount[i]);
        const deadline = (await time.latest()) + 100;
        const chainId = (await ethers.provider.getNetwork()).chainId;

        const depositPayload = encode(['uint256'], [minVaultTokenAmount]);
        stakeAndBakeData.push({
          permitPayload: '0x00',
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount[i]
        });
        await bridgeToken.connect(signer).approve(stakeAndBakeForNativeToken.address, mintAmount[i]);
        i++;
      }
      stakeAndBakeData[0].proof = stakeAndBakeData[1].proof;
      const tx = await stakeAndBakeForNativeToken.connect(owner).batchStakeAndBake(stakeAndBakeData);

      expect(await tx)
        .to.emit(stakeAndBakeForNativeToken, 'BatchStakeAndBakeReverted')
        .withArgs(0, anyValue, anyValue);

      await expect(tx).to.changeTokenBalance(vault, signer3, expectedMinVaultTokenAmount);
      await expect(tx).to.changeTokenBalance(bridgeToken, signer3, mintAmount[1] - stakeAmount[1]);
      expect(await bridgeToken.allowance(signer3.address, stakeAndBakeForNativeToken.address)).to.be.eq(
        mintAmount[1] - stakeAmount[1]
      );
      await expect(tx).to.changeTokenBalance(bridgeToken, treasury, fee);
      await expect(tx).to.changeTokenBalance(bridgeToken, vault, stakeAmount[1] - fee);
    });

    it('stakeAndBake: rejects when called by not a claimer', async function () {
      await snapshot.restore();
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = stakeAmount - fee;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBakeForNativeToken.connect(signer2).stakeAndBake({
          permitPayload: '0x00',
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      ).to.be.revertedWithCustomError(stakeAndBakeForNativeToken, 'AccessControlUnauthorizedAccount');
    });

    it('stakeAndBake: rejects when depositor is not set', async function () {
      await snapshot.restore();
      const stakeAndBake = await deployContract<StakeAndBakeNativeToken & Addressable>('StakeAndBakeNativeToken', [
        bridgeToken.address,
        bridgeTokenAdapter.address,
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
        [await bridgeToken.getAddress()],
        false
      );
      teller.address = await teller.getAddress();

      const tellerWithMultiAssetSupportDepositor = await deployContract<
        TellerWithMultiAssetSupportDepositor & Addressable
      >(
        'TellerWithMultiAssetSupportDepositor',
        [teller.address, await bridgeToken.getAddress(), stakeAndBake.address],
        false
      );
      tellerWithMultiAssetSupportDepositor.address = await tellerWithMultiAssetSupportDepositor.getAddress();

      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = stakeAmount - fee;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBake.connect(owner).stakeAndBake({
          permitPayload: '0x00',
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      ).to.be.revertedWithCustomError(stakeAndBake, 'NoDepositorSet');

      await expect(
        stakeAndBake.connect(owner).batchStakeAndBake([
          {
            permitPayload: '0x00',
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
      const minVaultTokenAmount = stakeAmount - fee;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBakeForNativeToken.connect(signer2).batchStakeAndBake([
          {
            permitPayload: '0x00',
            depositPayload: depositPayload,
            mintPayload: data.payload,
            proof: data.proof,
            amount: stakeAmount
          }
        ])
      ).to.be.revertedWithCustomError(stakeAndBakeForNativeToken, 'AccessControlUnauthorizedAccount');
    });

    it('stakeAndBakeInternal: rejects when called by not the contract itself', async function () {
      await snapshot.restore();
      const mintAmount = randomBigInt(8);
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = stakeAmount - fee;
      const data = await defaultData(signer2, mintAmount);

      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBakeForNativeToken.connect(owner).stakeAndBakeInternal({
          permitPayload: '0x00',
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      )
        .to.be.revertedWithCustomError(stakeAndBakeForNativeToken, 'CallerNotSelf')
        .withArgs(owner.address);
    });
  });
});
