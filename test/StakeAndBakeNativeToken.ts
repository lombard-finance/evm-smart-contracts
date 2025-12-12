import { ethers, network } from 'hardhat';
import { expect } from 'chai';
import { SnapshotRestorer, takeSnapshot, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  Addressable,
  CHAIN_ID,
  DefaultData,
  deployContract,
  encode,
  generatePermitSignature,
  getFeeTypedMessage,
  getPayloadForAction,
  getSignersWithPrivateKeys,
  initNativeLBTC,
  NEW_VALSET,
  randomBigInt,
  rawSign,
  signDepositBtcV1Payload,
  Signer
} from './helpers';
import {
  Consortium,
  ERC4626Depositor,
  ERC4626Mock,
  NativeLBTC,
  StakeAndBakeNativeToken,
  TellerWithMultiAssetSupportDepositor,
  TellerWithMultiAssetSupportMock
} from '../typechain-types';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';

const DAY = 86400;

describe('StakeAndBakeForNativeToken', function () {
  let _: Signer,
    owner: Signer,
    signer1: Signer,
    signer2: Signer,
    signer3: Signer,
    notary1: Signer,
    operator: Signer,
    pauser: Signer,
    treasury: Signer,
    trustedSigner: Signer;
  let stakeAndBakeForNativeToken: StakeAndBakeNativeToken & Addressable;
  let erc4626Depositor: ERC4626Depositor & Addressable;
  let vault: ERC4626Mock & Addressable;
  let consortium: Consortium & Addressable;
  let nativeLbtc: NativeLBTC & Addressable;
  let nativeLbtcBytes: string;
  let snapshot: SnapshotRestorer;
  let snapshotTimestamp: number;

  const toNativeCommission = 1000n;
  const fee = 1n;

  before(async function () {
    await network.provider.request({ method: 'hardhat_reset', params: [] });

    [_, owner, signer1, signer2, signer3, notary1, operator, pauser, treasury, trustedSigner] =
      await getSignersWithPrivateKeys();

    consortium = await deployContract<Consortium & Addressable>('Consortium', [owner.address]);
    consortium.address = await consortium.getAddress();
    await consortium
      .connect(owner)
      .setInitialValidatorSet(getPayloadForAction([1, [notary1.publicKey], [1], 1, 1], NEW_VALSET));

    nativeLbtc = await initNativeLBTC(owner.address, treasury.address, consortium.address);
    nativeLbtcBytes = encode(['address'], [nativeLbtc.address]);
    await nativeLbtc.connect(owner).grantRole(await nativeLbtc.OPERATOR_ROLE(), operator);

    stakeAndBakeForNativeToken = await deployContract<StakeAndBakeNativeToken & Addressable>(
      'StakeAndBakeNativeToken',
      [
        nativeLbtc.address,
        nativeLbtc.address,
        owner.address,
        operator.address,
        1,
        owner.address,
        pauser.address,
        1_000_000
      ]
    );
    stakeAndBakeForNativeToken.address = await stakeAndBakeForNativeToken.getAddress();

    vault = await deployContract<ERC4626Mock & Addressable>('ERC4626Mock', [nativeLbtc.address], false);
    vault.address = await vault.getAddress();

    erc4626Depositor = await deployContract<ERC4626Depositor & Addressable>(
      'ERC4626Depositor',
      [await vault.getAddress(), nativeLbtc.address, await stakeAndBakeForNativeToken.getAddress()],
      false
    );
    erc4626Depositor.address = await erc4626Depositor.getAddress();
    await expect(stakeAndBakeForNativeToken.connect(owner).setDepositor(erc4626Depositor.address))
      .to.emit(stakeAndBakeForNativeToken, 'DepositorSet')
      .withArgs(erc4626Depositor.address);

    snapshot = await takeSnapshot();
    snapshotTimestamp = await time.latest();
  });

  async function defaultData(
    recipient: Signer = signer1,
    amount: bigint = randomBigInt(8),
    feeApprove: bigint = 1n,
    cutV: boolean = false
  ): Promise<DefaultData> {
    const { payload, payloadHash, proof } = await signDepositBtcV1Payload(
      [notary1],
      [true],
      CHAIN_ID,
      recipient.address,
      amount,
      encode(['uint256'], [randomBigInt(8)]), //txId
      nativeLbtc.address
    );
    const feeApprovalPayload = getPayloadForAction([feeApprove, snapshotTimestamp + DAY], 'feeApproval');
    const userSignature = await getFeeTypedMessage(recipient, nativeLbtc, feeApprove, snapshotTimestamp + DAY);
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
      feeApprovalPayload,
      userSignature,
      depositId,
      cubistProof
    } as unknown as DefaultData;
  }

  describe('Setters', function () {
    beforeEach(async function () {
      await snapshot.restore();
    });

    it('setDepositor: admin can set', async function () {
      const newValue = ethers.Wallet.createRandom().address;
      await expect(stakeAndBakeForNativeToken.connect(owner).setDepositor(newValue))
        .to.emit(stakeAndBakeForNativeToken, 'DepositorSet')
        .withArgs(newValue);
      expect(await stakeAndBakeForNativeToken.getStakeAndBakeDepositor()).to.be.eq(newValue);
    });

    it('setDepositor: reverts when address is zero', async function () {
      await expect(
        stakeAndBakeForNativeToken.connect(owner).setDepositor(ethers.ZeroAddress)
      ).to.be.revertedWithCustomError(stakeAndBakeForNativeToken, 'ZeroAddress');
    });

    it('setDepositor: reverts when called by not an admin', async function () {
      await expect(
        stakeAndBakeForNativeToken.connect(signer1).setDepositor(erc4626Depositor.address)
      ).to.be.revertedWithCustomError(stakeAndBakeForNativeToken, 'AccessControlUnauthorizedAccount');
    });

    it('setFee: operator can change fee', async function () {
      const newValue = randomBigInt(3);
      await expect(stakeAndBakeForNativeToken.connect(operator).setFee(newValue))
        .to.emit(stakeAndBakeForNativeToken, 'FeeChanged')
        .withArgs(newValue);
      expect(await stakeAndBakeForNativeToken.getStakeAndBakeFee()).to.be.eq(newValue);
    });

    it('setFee: rejects when fee is greater than max', async function () {
      const newValue = (await stakeAndBakeForNativeToken.MAXIMUM_FEE()) + 1n;
      await expect(stakeAndBakeForNativeToken.connect(operator).setFee(newValue)).revertedWithCustomError(
        stakeAndBakeForNativeToken,
        'FeeGreaterThanMaximum'
      );
    });

    it('setFee: rejects when called by not an operator', async function () {
      await expect(stakeAndBakeForNativeToken.connect(signer1).setFee(randomBigInt(3))).revertedWithCustomError(
        stakeAndBakeForNativeToken,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('setGasLimit: admin can change gas limit for batch staking', async function () {
      const newValue = randomBigInt(3);
      await expect(stakeAndBakeForNativeToken.connect(owner).setGasLimit(newValue))
        .to.emit(stakeAndBakeForNativeToken, 'GasLimitChanged')
        .withArgs(newValue);
    });

    it('setGasLimit: rejects when called by not an admin', async function () {
      await expect(stakeAndBakeForNativeToken.connect(signer1).setGasLimit(2)).revertedWithCustomError(
        stakeAndBakeForNativeToken,
        'AccessControlUnauthorizedAccount'
      );
    });
  });

  describe('Pause', function () {
    before(async function () {
      await snapshot.restore();
      await stakeAndBakeForNativeToken.connect(owner).setDepositor(erc4626Depositor.address);
    });

    it('pause: reverts when called by not a pauser', async function () {
      await expect(stakeAndBakeForNativeToken.connect(signer2).pause()).to.be.reverted;
    });

    it('pause: pauser can set on pause', async function () {
      await stakeAndBakeForNativeToken.connect(pauser).pause();
      expect(await stakeAndBakeForNativeToken.paused()).to.be.true;
    });

    it('stakeAndBake: rejects when contract is paused', async function () {
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = stakeAmount - fee;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        nativeLbtc.address,
        signer2,
        stakeAndBakeForNativeToken.address,
        permitAmount,
        deadline,
        chainId,
        0,
        `Native LBTC`
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBakeForNativeToken.connect(owner).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      ).to.be.revertedWithCustomError(stakeAndBakeForNativeToken, 'EnforcedPause');
    });

    it('should not allow batchStakeAndBake when paused', async function () {
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = stakeAmount - fee;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        nativeLbtc.address,
        signer2,
        stakeAndBakeForNativeToken.address,
        permitAmount,
        deadline,
        chainId,
        0,
        `Native LBTC`
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBakeForNativeToken.connect(owner).batchStakeAndBake([
          {
            permitPayload: permitPayload,
            depositPayload: depositPayload,
            mintPayload: data.payload,
            proof: data.proof,
            amount: stakeAmount
          }
        ])
      ).to.be.revertedWithCustomError(stakeAndBakeForNativeToken, 'EnforcedPause');
    });

    it('unpause: reverts when called by not an owner', async function () {
      await expect(stakeAndBakeForNativeToken.connect(signer2).unpause()).to.be.reverted;
    });

    it('unpause: owner can turn off pause', async function () {
      await stakeAndBakeForNativeToken.connect(owner).unpause();
      expect(await stakeAndBakeForNativeToken.paused()).to.be.false;
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
        const deadline = (await time.latest()) + 100;
        const chainId = (await ethers.provider.getNetwork()).chainId;

        const { v, r, s } = await generatePermitSignature(
          nativeLbtc.address,
          signer1,
          stakeAndBakeForNativeToken.address,
          mintAmount,
          deadline,
          chainId,
          await nativeLbtc.nonces(signer1),
          `Native LBTC`
        );
        const permitPayload = encode(
          ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
          [mintAmount, deadline, v, r, s]
        );
        const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

        const tx = await stakeAndBakeForNativeToken.connect(owner).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        });

        await expect(tx)
          .to.emit(vault, 'Transfer')
          .withArgs(ethers.ZeroAddress, signer1.address, expectedMinVaultTokenAmount);
        await expect(tx).to.changeTokenBalance(vault, signer1, expectedMinVaultTokenAmount);
        await expect(tx).to.changeTokenBalance(nativeLbtc, signer1, mintAmount - stakeAmount);
        expect(await nativeLbtc.allowance(signer1.address, stakeAndBakeForNativeToken.address)).to.be.eq(
          mintAmount - stakeAmount
        );

        await expect(tx).to.changeTokenBalance(nativeLbtc, treasury, fee);
        await expect(tx).to.changeTokenBalance(nativeLbtc, vault, stakeAmount - fee);
      });

      it(`batchStakeAndBake: when ${arg.name}`, async function () {
        const mintAmount = arg.mintAmount;
        const stakeAmount = arg.stakeAmount(mintAmount);
        const minVaultTokenAmount = arg.minVaultTokenAmount(stakeAmount - fee);
        const expectedMinVaultTokenAmount = stakeAmount - fee;

        const stakeAndBakeData = [];
        for (const signer of [signer2, signer3]) {
          const data = await defaultData(signer, mintAmount);
          const deadline = (await time.latest()) + 100;
          const chainId = (await ethers.provider.getNetwork()).chainId;

          const { v, r, s } = await generatePermitSignature(
            nativeLbtc.address,
            signer,
            stakeAndBakeForNativeToken.address,
            mintAmount,
            deadline,
            chainId,
            await nativeLbtc.nonces(signer),
            `Native LBTC`
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

        const tx = await stakeAndBakeForNativeToken.connect(owner).batchStakeAndBake(stakeAndBakeData);

        for (const signer of [signer2, signer3]) {
          await expect(tx).to.changeTokenBalance(vault, signer, expectedMinVaultTokenAmount);
          await expect(tx).to.changeTokenBalance(nativeLbtc, signer, mintAmount - stakeAmount);
          expect(await nativeLbtc.allowance(signer.address, stakeAndBakeForNativeToken.address)).to.be.eq(
            mintAmount - stakeAmount
          );
        }
        await expect(tx).to.changeTokenBalance(nativeLbtc, treasury, fee * 2n);
        await expect(tx).to.changeTokenBalance(nativeLbtc, vault, (stakeAmount - fee) * 2n);
      });
    });

    const invalidArgs = [
      {
        name: 'staking amount exceeds amount in deposit payload',
        mintAmount: randomBigInt(8),
        permitAmount: (a: bigint): bigint => a + 1n,
        stakeAmount: (a: bigint): bigint => a + 1n,
        minVaultTokenAmount: (a: bigint): bigint => a - fee,
        customError: () => [nativeLbtc, 'ERC20InsufficientBalance']
      },
      {
        name: 'staking amount is 0 after fee',
        mintAmount: fee,
        permitAmount: (a: bigint): bigint => a,
        stakeAmount: (a: bigint): bigint => a,
        minVaultTokenAmount: (a: bigint): bigint => a - fee,
        customError: () => [stakeAndBakeForNativeToken, 'ZeroDepositAmount']
      },
      {
        name: 'permit amount is not enough',
        mintAmount: randomBigInt(8),
        permitAmount: (a: bigint): bigint => a - 1n,
        stakeAmount: (a: bigint): bigint => a,
        minVaultTokenAmount: (a: bigint): bigint => a - fee,
        customError: () => [stakeAndBakeForNativeToken, 'WrongAmount']
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
          nativeLbtc.address,
          signer2,
          stakeAndBakeForNativeToken.address,
          permitAmount,
          deadline,
          chainId,
          0n,
          `Native LBTC`
        );
        const permitPayload = encode(
          ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
          [permitAmount, deadline, v, r, s]
        );
        const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

        await expect(
          stakeAndBakeForNativeToken.connect(owner).stakeAndBake({
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
      await nativeLbtc.connect(signer1).approve(stakeAndBakeForNativeToken.address, extraAllowance);

      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount / 2n;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = stakeAmount - fee;
      const expectedMinVaultTokenAmount = stakeAmount - fee;
      const data = await defaultData(signer1, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        nativeLbtc.address,
        signer1,
        stakeAndBakeForNativeToken.address,
        permitAmount,
        deadline,
        chainId,
        0n,
        `Native LBTC`
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      const tx = await stakeAndBakeForNativeToken.connect(owner).stakeAndBake({
        permitPayload: permitPayload,
        depositPayload: depositPayload,
        mintPayload: data.payload,
        proof: data.proof,
        amount: stakeAmount
      });

      await expect(tx)
        .to.emit(vault, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer1.address, expectedMinVaultTokenAmount);
      await expect(tx).to.changeTokenBalance(vault, signer1, expectedMinVaultTokenAmount);
      await expect(tx).to.changeTokenBalance(nativeLbtc, signer1, mintAmount - stakeAmount);
      expect(await nativeLbtc.allowance(signer1.address, stakeAndBakeForNativeToken.address)).to.be.eq(
        extraAllowance - stakeAmount
      );
      expect(await nativeLbtc.nonces(signer1)).to.be.eq(0n);

      await expect(tx).to.changeTokenBalance(nativeLbtc, treasury, fee);
      await expect(tx).to.changeTokenBalance(nativeLbtc, vault, stakeAmount - fee);
    });

    it('stakeAndBake: rejects when permit has expired', async function () {
      await snapshot.restore();
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = stakeAmount - fee;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        nativeLbtc.address,
        signer2,
        stakeAndBakeForNativeToken.address,
        permitAmount,
        deadline,
        chainId,
        0n,
        `Native LBTC`
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await time.increase(101);

      await expect(
        stakeAndBakeForNativeToken.connect(owner).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      ).to.be.revertedWithCustomError(nativeLbtc, 'ERC2612ExpiredSignature');
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

        const { v, r, s } = await generatePermitSignature(
          nativeLbtc.address,
          signer,
          stakeAndBakeForNativeToken.address,
          permitAmount[i],
          deadline,
          chainId,
          0n,
          `Native LBTC`
        );
        const permitPayload = encode(
          ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
          [permitAmount[i], deadline, v, r, s]
        );
        const depositPayload = encode(['uint256'], [minVaultTokenAmount]);
        stakeAndBakeData.push({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount[i]
        });
        i++;
      }
      stakeAndBakeData[0].proof = stakeAndBakeData[1].proof;
      const tx = await stakeAndBakeForNativeToken.connect(owner).batchStakeAndBake(stakeAndBakeData);

      expect(await tx)
        .to.emit(stakeAndBakeForNativeToken, 'BatchStakeAndBakeReverted')
        .withArgs(0, anyValue, anyValue);

      await expect(tx).to.changeTokenBalance(vault, signer3, expectedMinVaultTokenAmount);
      await expect(tx).to.changeTokenBalance(nativeLbtc, signer3, mintAmount[1] - stakeAmount[1]);
      expect(await nativeLbtc.allowance(signer3.address, stakeAndBakeForNativeToken.address)).to.be.eq(
        mintAmount[1] - stakeAmount[1]
      );
      await expect(tx).to.changeTokenBalance(nativeLbtc, treasury, fee);
      await expect(tx).to.changeTokenBalance(nativeLbtc, vault, stakeAmount[1] - fee);
    });

    it('stakeAndBake: rejects when signature does not match', async function () {
      await snapshot.restore();
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = stakeAmount - fee;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        nativeLbtc.address,
        signer2,
        nativeLbtc.address,
        permitAmount,
        deadline,
        chainId,
        0n,
        `Native LBTC`
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBakeForNativeToken.connect(owner).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      ).to.be.revertedWithCustomError(nativeLbtc, 'ERC2612InvalidSigner');
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

      const { v, r, s } = await generatePermitSignature(
        nativeLbtc.address,
        signer2,
        stakeAndBakeForNativeToken.address,
        permitAmount,
        deadline,
        chainId,
        0n,
        `Native LBTC`
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBakeForNativeToken.connect(signer2).stakeAndBake({
          permitPayload: permitPayload,
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
        nativeLbtc.address,
        nativeLbtc.address,
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
        [await nativeLbtc.getAddress()],
        false
      );
      teller.address = await teller.getAddress();

      const tellerWithMultiAssetSupportDepositor = await deployContract<
        TellerWithMultiAssetSupportDepositor & Addressable
      >(
        'TellerWithMultiAssetSupportDepositor',
        [teller.address, await nativeLbtc.getAddress(), stakeAndBake.address],
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

      const { v, r, s } = await generatePermitSignature(
        nativeLbtc.address,
        signer2,
        stakeAndBake.address,
        permitAmount,
        deadline,
        chainId,
        0n,
        `Native LBTC`
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
      const minVaultTokenAmount = stakeAmount - fee;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        nativeLbtc.address,
        signer2,
        stakeAndBakeForNativeToken.address,
        permitAmount,
        deadline,
        chainId,
        0n,
        `Native LBTC`
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBakeForNativeToken.connect(signer2).batchStakeAndBake([
          {
            permitPayload: permitPayload,
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
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const minVaultTokenAmount = stakeAmount - fee;
      const data = await defaultData(signer2, mintAmount);
      const deadline = (await time.latest()) + 100;
      const chainId = (await ethers.provider.getNetwork()).chainId;

      const { v, r, s } = await generatePermitSignature(
        nativeLbtc.address,
        signer2,
        stakeAndBakeForNativeToken.address,
        permitAmount,
        deadline,
        chainId,
        0n,
        `Native LBTC`
      );
      const permitPayload = encode(
        ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
        [permitAmount, deadline, v, r, s]
      );
      const depositPayload = encode(['uint256'], [minVaultTokenAmount]);

      await expect(
        stakeAndBakeForNativeToken.connect(owner).stakeAndBakeInternal({
          permitPayload: permitPayload,
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
