import { config, ethers, network } from 'hardhat';
import { expect } from 'chai';
import { SnapshotRestorer, takeSnapshot, time } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
  Addressable,
  BTC_STAKING_MODULE_ADDRESS,
  DefaultData,
  deployContract,
  e18,
  encode,
  generatePermitSignature,
  getFeeTypedMessage,
  getGMPPayload,
  getPayloadForAction,
  getSignersWithPrivateKeys,
  impersonateWithEth,
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
  BoringVault,
  Consortium,
  ERC4626VaultWrapper,
  IERC20,
  IRateProvider,
  ITeller,
  Mailbox,
  ProxyAdmin,
  RolesAuthority,
  StakeAndBake,
  StakedLBTC,
  TellerWithMultiAssetSupportMock
} from '../typechain-types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

const ONE_SHARE = 100000000n;
const CHAIN_ID: string = encode(['uint256'], [1]);
const DAY = 86400;

describe('StakeandBake_with_ERC4626VaultWrapper', function () {
  let _: Signer,
    owner: Signer,
    stakeAndBakeOwner: HardhatEthersSigner,
    lbtcOwner: HardhatEthersSigner,
    signer1: Signer,
    signer2: Signer,
    signer3: Signer,
    notary1: Signer,
    operator: Signer,
    claimer: Signer,
    pauser: Signer,
    minter: Signer,
    treasury: HardhatEthersSigner;
  let stakeAndBake: StakeAndBake & Addressable;
  let erc4626Wrapper: ERC4626VaultWrapper & Addressable;
  let teller: ITeller & Addressable;
  let vedavault: IERC20 & Addressable;
  let rateProvider: IRateProvider & Addressable;
  let wbtc: IERC20 & Addressable;
  let consortium: Consortium & Addressable;
  let mailbox: Mailbox & Addressable;
  let assetRouter: AssetRouter & Addressable;
  let assetRouterBytes: string;
  let stakedLbtc: StakedLBTC & Addressable;
  let stakedLbtcBytes: string;
  let snapshot: SnapshotRestorer;
  let snapshotTimestamp: number;
  let stakeAndBakeFee: bigint;

  before(async function () {
    await network.provider.send('hardhat_reset', [
      {
        forking: {
          jsonRpcUrl: config.networks.hardhat.forking?.url,
          blockNumber: config.networks.hardhat.forking?.blockNumber
        }
      }
    ]);
    const block = await ethers.provider.getBlockNumber();
    expect(block).to.be.gt(23000000, '-------- Please switch to eth fork --------');

    [_, owner, signer1, signer2, signer3, notary1, operator, claimer, pauser, minter] =
      await getSignersWithPrivateKeys();

    consortium = await deployContract<Consortium & Addressable>('Consortium', [owner.address]);
    consortium.address = await consortium.getAddress();
    await consortium
      .connect(owner)
      .setInitialValidatorSet(getPayloadForAction([1, [notary1.publicKey], [1], 1, 1], NEW_VALSET));

    //LBTC
    stakedLbtc = (await ethers.getContractAt(
      'StakedLBTC',
      '0x8236a87084f8B84306f72007F36F2618A5634494'
    )) as StakedLBTC & Addressable;
    stakedLbtc.address = '0x8236a87084f8B84306f72007F36F2618A5634494';
    stakedLbtcBytes = encode(['address'], [stakedLbtc.address]);
    // await stakedLbtc.on('Transfer', (from, to, amount) => {
    //   console.log(`LBTC transfer from (${from}) to (${to}) ${amount}`);
    // });
    lbtcOwner = await impersonateWithEth('0x055E84e7FE8955E2781010B866f10Ef6E1E77e59');
    await stakedLbtc.connect(lbtcOwner).changeOperator(operator.address);
    await stakedLbtc.connect(lbtcOwner).addMinter(minter);

    stakeAndBake = (await ethers.getContractAt(
      'StakeAndBake',
      '0xC8bbF6153D7Ba105f1399D992ebd32B0541996ef'
    )) as StakeAndBake & Addressable;
    stakeAndBake.address = '0xC8bbF6153D7Ba105f1399D992ebd32B0541996ef';
    stakeAndBakeOwner = await impersonateWithEth('0x251a604e8e8f6906d60f8dedc5aaeb8cd38f4892');
    treasury = stakeAndBakeOwner;
    stakeAndBakeFee = await stakeAndBake.getStakeAndBakeFee();
    await stakeAndBake.connect(stakeAndBakeOwner).grantRole(await stakeAndBake.CLAIMER_ROLE(), claimer.address);

    const stakeAndBakeImp = await deployContract<StakeAndBake & Addressable>('StakeAndBake', [], false);
    const stakeAndBakeProxyAdmin = (await ethers.getContractAt(
      'ProxyAdmin',
      '0xD9A3DF49e9FFa132Bd5b3b253f6DD8810Df31FFA'
    )) as ProxyAdmin & Addressable;
    const proxyAdmin = await impersonateWithEth('0x251a604E8E8f6906d60f8dedC5aAeb8CD38F4892', e18);
    await stakeAndBakeProxyAdmin
      .connect(proxyAdmin)
      .upgradeAndCall(stakeAndBake.address, await stakeAndBakeImp.getAddress(), '0x');

    mailbox = (await ethers.getContractAt('Mailbox', '0x964677F337d6528d659b1892D0045B8B27183fc0')) as Mailbox &
      Addressable;
    mailbox.address = '0x964677F337d6528d659b1892D0045B8B27183fc0';
    //Replace consortium
    const baseSlot = BigInt('0x0278229f5c76f980110e38383ce9a522090076c3f8b366b016a9b1421b307400');
    const consortiumSlot = baseSlot + 5n;
    await network.provider.send('hardhat_setStorageAt', [
      mailbox.address,
      '0x' + consortiumSlot.toString(16),
      '0x' + consortium.address.replace('0x', '').padStart(64, '0')
    ]);

    assetRouter = (await ethers.getContractAt(
      'AssetRouter',
      '0x9ece5fb1ab62d9075c4ec814b321e24d8ea021ac'
    )) as AssetRouter & Addressable;
    assetRouter.address = '0x9ece5fb1ab62d9075c4ec814b321e24d8ea021ac';
    assetRouterBytes = encode(['address'], [assetRouter.address]);
    await assetRouter.connect(lbtcOwner).changeBascule(ethers.ZeroAddress);

    teller = (await ethers.getContractAt('ITeller', '0x4E8f5128F473C6948127f9Cbca474a6700F99bab')) as ITeller &
      Addressable;
    teller.address = '0x4E8f5128F473C6948127f9Cbca474a6700F99bab';

    vedavault = (await ethers.getContractAt(
      '@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20',
      '0x5401b8620E5FB570064CA9114fd1e135fd77D57c'
    )) as unknown as IERC20 & Addressable;
    vedavault.address = '0x5401b8620E5FB570064CA9114fd1e135fd77D57c';

    rateProvider = (await ethers.getContractAt(
      'IRateProvider',
      '0x28634D0c5edC67CF2450E74deA49B90a4FF93dCE'
    )) as IRateProvider & Addressable;
    rateProvider.address = '0x28634D0c5edC67CF2450E74deA49B90a4FF93dCE';

    wbtc = (await ethers.getContractAt(
      '@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20',
      '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599'
    )) as unknown as IERC20 & Addressable;
    wbtc.address = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599';

    erc4626Wrapper = await deployContract<ERC4626VaultWrapper & Addressable>('ERC4626VaultWrapper', [
      owner.address,
      'Wrapper Token Name',
      'vLBTC',
      1n,
      pauser.address,
      teller.address
    ]);
    erc4626Wrapper.address = await erc4626Wrapper.getAddress();

    await expect(stakeAndBake.connect(stakeAndBakeOwner).setDepositor(erc4626Wrapper.address))
      .to.emit(stakeAndBake, 'DepositorSet')
      .withArgs(erc4626Wrapper.address);

    // The commented out code below is required only in case wrapper uses `bulkDeposit`
    // const superAdmin = await impersonateWithEth('0xb7cB7131FFc18f87eEc66991BECD18f2FF70d2af');
    // const auth = (await ethers.getContractAt(
    //   'RolesAuthority',
    //   '0xF3E03eF7df97511a52f31ea7a22329619db2bdF4'
    // )) as RolesAuthority;
    // await auth.connect(superAdmin).setUserRole(erc4626Wrapper.address, 12n, true);

    snapshot = await takeSnapshot();
    snapshotTimestamp = await time.latest();
  });

  async function getShares(amount: bigint, asset: string): Promise<bigint> {
    return (amount * ONE_SHARE) / (await rateProvider.getRateInQuoteSafe(asset));
  }

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

  describe('Setters and getters', function () {
    before(async function () {
      await snapshot.restore();
    });

    it('decimals same as for teller', async function () {
      expect(await erc4626Wrapper.decimals()).to.be.eq(8n);
    });

    it('addStakeAndBake only admin can', async function () {
      await expect(erc4626Wrapper.connect(owner).addStakeAndBake(stakeAndBake.address, stakedLbtc.address))
        .to.emit(erc4626Wrapper, 'StakeAndBakeAdded')
        .withArgs(stakeAndBake.address, stakedLbtc.address);
    });

    it('addStakeAndBake update token', async function () {
      const newToken = ethers.Wallet.createRandom().address;
      await expect(erc4626Wrapper.connect(owner).addStakeAndBake(stakeAndBake.address, newToken))
        .to.emit(erc4626Wrapper, 'StakeAndBakeAdded')
        .withArgs(stakeAndBake.address, newToken);
    });

    it('addStakeAndBake add another snb contract', async function () {
      const anotherSnb = ethers.Wallet.createRandom().address;
      const anotherToken = ethers.Wallet.createRandom().address;
      await expect(erc4626Wrapper.connect(owner).addStakeAndBake(anotherSnb, anotherToken))
        .to.emit(erc4626Wrapper, 'StakeAndBakeAdded')
        .withArgs(anotherSnb, anotherToken);
    });

    it('removeStakeAndBake only admin can', async function () {
      await expect(erc4626Wrapper.connect(owner).removeStakeAndBake(stakeAndBake.address))
        .to.emit(erc4626Wrapper, 'StakeAndBakeRemoved')
        .withArgs(stakeAndBake.address);

      //TODO: cannot user after remove
    });

    it('addStakeAndBake rejects when token is 0 address', async function () {
      const anotherSnb = ethers.Wallet.createRandom().address;
      const anotherToken = ethers.ZeroAddress;
      await expect(
        erc4626Wrapper.connect(owner).addStakeAndBake(anotherSnb, anotherToken)
      ).to.be.revertedWithCustomError(erc4626Wrapper, 'ZeroAddress');
    });

    it('addStakeAndBake rejects when called by not admin', async function () {
      await expect(
        erc4626Wrapper.connect(signer1).addStakeAndBake(stakeAndBake.address, stakedLbtc.address)
      ).to.be.revertedWithCustomError(erc4626Wrapper, 'AccessControlUnauthorizedAccount');
    });

    it('removeStakeAndBake rejects when called by not admin', async function () {
      await expect(
        erc4626Wrapper.connect(signer1).removeStakeAndBake(stakeAndBake.address)
      ).to.be.revertedWithCustomError(erc4626Wrapper, 'AccessControlUnauthorizedAccount');
    });

    it('changeTeller owner can when vault is the same', async function () {
      const oldTeller = teller.address;
      const vault = await teller.vault();
      const newTeller = await deployContract<TellerWithMultiAssetSupportMock & Addressable>(
        'TellerWithMultiAssetSupportMock',
        [await stakedLbtc.getAddress()],
        false
      );
      await newTeller.setVault(vault);
      newTeller.address = await teller.getAddress();

      await expect(erc4626Wrapper.connect(owner).changeTeller(newTeller))
        .to.emit(erc4626Wrapper, 'TellerChanged')
        .withArgs(oldTeller, newTeller);
    });

    it('changeTeller rejects when vault is different', async function () {
      const newTeller = await deployContract<TellerWithMultiAssetSupportMock & Addressable>(
        'TellerWithMultiAssetSupportMock',
        [await stakedLbtc.getAddress()],
        false
      );
      newTeller.address = await teller.getAddress();

      await expect(erc4626Wrapper.connect(owner).changeTeller(newTeller)).to.be.revertedWithCustomError(
        erc4626Wrapper,
        'VaultCannotBeChanged'
      );
    });

    it('changeTeller rejects when new teller is 0 address', async function () {
      const newTeller = ethers.ZeroAddress;
      await expect(erc4626Wrapper.connect(owner).changeTeller(newTeller)).to.be.revertedWithCustomError(
        erc4626Wrapper,
        'ZeroAddress'
      );
    });

    it('changeTeller rejects when called by not admin', async function () {
      const vault = await teller.vault();
      const newTeller = await deployContract<TellerWithMultiAssetSupportMock & Addressable>(
        'TellerWithMultiAssetSupportMock',
        [await stakedLbtc.getAddress()],
        false
      );
      await newTeller.setVault(vault);
      newTeller.address = await teller.getAddress();

      await expect(erc4626Wrapper.connect(signer1).changeTeller(newTeller)).to.be.revertedWithCustomError(
        erc4626Wrapper,
        'AccessControlUnauthorizedAccount'
      );
    });

    it('convertToAssets', async function () {
      console.log('assets', await erc4626Wrapper.convertToAssets(100000000));
    });

    it('eip712Domain', async function () {
      console.log('eip712Domain', await erc4626Wrapper.eip712Domain());
    });
  });

  describe('Pause', function () {
    before(async function () {
      await snapshot.restore();
      await erc4626Wrapper.connect(owner).addStakeAndBake(stakeAndBake.address, stakedLbtc.address);

      const amountToStake = randomBigInt(8);
      const expectedShares = await getShares(amountToStake, stakedLbtc.address);
      await stakedLbtc.connect(minter)['mint(address,uint256)'](signer1.address, amountToStake);
      await stakedLbtc.connect(signer1).approve(vedavault.address, amountToStake);
      await teller.connect(signer1).deposit(stakedLbtc.address, amountToStake, expectedShares);
    });

    it('pause: reverts when called by not a pauser', async function () {
      //TODO: add error
      await expect(erc4626Wrapper.connect(signer1).pause()).to.be.reverted;
    });

    it('pause: pauser can set on pause', async function () {
      await expect(erc4626Wrapper.connect(pauser).pause()).to.emit(erc4626Wrapper, 'Paused');
      expect(await erc4626Wrapper.paused()).to.be.true;
    });

    it('stakeAndBake: rejects when contract is paused', async function () {
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const expectedShares = await getShares(stakeAmount - stakeAndBakeFee, stakedLbtc.address);
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
      const depositPayload = encode(['uint256'], [expectedShares]);

      await expect(
        stakeAndBake.connect(claimer).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      ).to.be.revertedWithCustomError(erc4626Wrapper, 'EnforcedPause');
    });

    it('deposit lbtc: rejects when contract is paused', async function () {
      const amountToStake = 100000000n;
      const expectedShares = await getShares(amountToStake, stakedLbtc.address);

      await stakedLbtc.connect(minter)['mint(address,uint256)'](signer3.address, amountToStake);
      await stakedLbtc.connect(signer3).approve(erc4626Wrapper.address, amountToStake);

      await expect(
        erc4626Wrapper
          .connect(signer3)
          [
            'deposit(address,uint256,address,uint256)'
          ](stakedLbtc.address, amountToStake, signer3.address, expectedShares)
      ).to.be.revertedWithCustomError(erc4626Wrapper, 'EnforcedPause');
    });

    it('deposit LBTCv: rejects when contract is paused', async function () {
      const amount = await vedavault.balanceOf(signer1);
      await vedavault.connect(signer1).approve(erc4626Wrapper.address, amount);
      await expect(
        erc4626Wrapper.connect(signer1)['deposit(uint256,address)'](amount, signer1.address)
      ).to.be.revertedWithCustomError(erc4626Wrapper, 'EnforcedPause');
    });

    it('unpause: reverts when called by not an owner', async function () {
      await expect(erc4626Wrapper.connect(pauser).unpause()).to.be.reverted;
    });

    it('unpause: owner can turn off pause', async function () {
      await erc4626Wrapper.connect(owner).unpause();
      expect(await erc4626Wrapper.paused()).to.be.false;
    });
  });

  describe('Stake and Bake', function () {
    before(async function () {
      await snapshot.restore();
      await erc4626Wrapper.connect(owner).addStakeAndBake(stakeAndBake.address, stakedLbtc.address);
    });

    const args = [
      {
        name: 'staking amount = minting amount',
        mintAmount: 100000000n,
        stakeAmount: (a: bigint): bigint => a
      },
      {
        name: 'staking amount < minting amount',
        mintAmount: randomBigInt(8),
        stakeAmount: (a: bigint): bigint => a - 1000n
      },
      {
        name: 'decreased min vault tokens amount',
        mintAmount: randomBigInt(8),
        stakeAmount: (a: bigint): bigint => a
      }
    ];

    args.forEach(function (arg) {
      it(`stakeAndBake: when ${arg.name}`, async function () {
        const mintAmount = arg.mintAmount;
        const data = await defaultData(signer1, mintAmount);
        const stakeAmount = arg.stakeAmount(mintAmount);
        const expectedShares = await getShares(stakeAmount - stakeAndBakeFee, stakedLbtc.address);
        const deadline = (await time.latest()) + 100;
        const chainId = (await ethers.provider.getNetwork()).chainId;

        const { v, r, s } = await generatePermitSignature(
          stakedLbtc.address,
          signer1,
          stakeAndBake.address,
          stakeAmount,
          deadline,
          chainId,
          await stakedLbtc.nonces(signer1)
        );
        const permitPayload = encode(
          ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
          [stakeAmount, deadline, v, r, s]
        );
        const depositPayload = encode(['uint256'], [expectedShares]);

        const tx = await stakeAndBake.connect(claimer).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        });

        await expect(tx)
          .to.emit(vedavault, 'Transfer')
          .withArgs(ethers.ZeroAddress, erc4626Wrapper.address, expectedShares);
        await expect(tx)
          .to.emit(erc4626Wrapper, 'Transfer')
          .withArgs(ethers.ZeroAddress, signer1.address, expectedShares);
        await expect(tx).to.changeTokenBalance(erc4626Wrapper, signer1, expectedShares);
        await expect(tx).to.changeTokenBalance(vedavault, erc4626Wrapper, expectedShares);
        await expect(tx).to.changeTokenBalance(stakedLbtc, signer1, mintAmount - stakeAmount);
        await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, stakeAndBakeFee);
        await expect(tx).to.changeTokenBalance(stakedLbtc, vedavault, stakeAmount - stakeAndBakeFee);
      });

      it(`batchStakeAndBake: when ${arg.name}`, async function () {
        const mintAmount = arg.mintAmount;
        const stakeAmount = arg.stakeAmount(mintAmount);
        const expectedShares = await getShares(stakeAmount - stakeAndBakeFee, stakedLbtc.address);

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
          const depositPayload = encode(['uint256'], [expectedShares]);
          stakeAndBakeData.push({
            permitPayload: permitPayload,
            depositPayload: depositPayload,
            mintPayload: data.payload,
            proof: data.proof,
            amount: stakeAmount
          });
        }

        const tx = await stakeAndBake.connect(claimer).batchStakeAndBake(stakeAndBakeData);

        for (const signer of [signer2, signer3]) {
          await expect(tx).to.changeTokenBalance(erc4626Wrapper, signer, expectedShares);
          await expect(tx).to.changeTokenBalance(stakedLbtc, signer, mintAmount - stakeAmount);
          expect(await stakedLbtc.allowance(signer.address, stakeAndBake.address)).to.be.eq(mintAmount - stakeAmount);
        }
        await expect(tx).to.changeTokenBalance(vedavault, erc4626Wrapper, expectedShares * 2n);
        await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, stakeAndBakeFee * 2n);
        await expect(tx).to.changeTokenBalance(stakedLbtc, vedavault, (stakeAmount - stakeAndBakeFee) * 2n);
      });
    });

    const invalidArgs = [
      {
        name: 'staking amount exceeds amount in deposit payload',
        mintAmount: () => randomBigInt(8),
        permitAmount: (a: bigint): bigint => a + 1n,
        stakeAmount: (a: bigint): bigint => a + 1n,
        minVaultTokenAmount: async (a: bigint): Promise<bigint> => await getShares(a, stakedLbtc.address),
        customError: () => [stakedLbtc, 'ERC20InsufficientBalance']
      },
      {
        name: 'staking amount is 0 after fee',
        mintAmount: () => stakeAndBakeFee,
        permitAmount: (a: bigint): bigint => a,
        stakeAmount: (a: bigint): bigint => a,
        minVaultTokenAmount: async (a: bigint): Promise<bigint> => await getShares(a, stakedLbtc.address),
        customError: () => [stakeAndBake, 'ZeroDepositAmount']
      },
      {
        name: 'permit amount is not enough',
        mintAmount: () => randomBigInt(8),
        permitAmount: (a: bigint): bigint => a - 1n,
        stakeAmount: (a: bigint): bigint => a,
        minVaultTokenAmount: async (a: bigint): Promise<bigint> => await getShares(a, stakedLbtc.address),
        customError: () => [stakeAndBake, 'WrongAmount']
      },
      {
        name: 'vault minted less tokens than minimum',
        mintAmount: () => randomBigInt(8),
        permitAmount: (a: bigint): bigint => a,
        stakeAmount: (a: bigint): bigint => a,
        minVaultTokenAmount: async (a: bigint): Promise<bigint> => (await getShares(a, stakedLbtc.address)) + 10n,
        customError: () => [teller, 'TellerWithMultiAssetSupport__MinimumMintNotMet']
      }
    ];

    invalidArgs.forEach(function (arg) {
      it(`stakeAndBake: rejects when ${arg.name}`, async function () {
        await snapshot.restore();
        await erc4626Wrapper.connect(owner).addStakeAndBake(stakeAndBake.address, stakedLbtc.address);

        const mintAmount = arg.mintAmount();
        const permitAmount = arg.permitAmount(mintAmount);
        const stakeAmount = arg.stakeAmount(mintAmount);
        const minVaultTokenAmount = await arg.minVaultTokenAmount(stakeAmount - stakeAndBakeFee);
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
          stakeAndBake.connect(claimer).stakeAndBake({
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
      await erc4626Wrapper.connect(owner).addStakeAndBake(stakeAndBake.address, stakedLbtc.address);
      const extraAllowance = randomBigInt(10);
      await stakedLbtc.connect(signer1).approve(stakeAndBake.address, extraAllowance);

      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount / 2n;
      const stakeAmount = mintAmount;
      const expectedShares = await getShares(stakeAmount - stakeAndBakeFee, stakedLbtc.address);
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
      const depositPayload = encode(['uint256'], [expectedShares]);

      const tx = await stakeAndBake.connect(claimer).stakeAndBake({
        permitPayload: permitPayload,
        depositPayload: depositPayload,
        mintPayload: data.payload,
        proof: data.proof,
        amount: stakeAmount
      });

      await expect(tx)
        .to.emit(vedavault, 'Transfer')
        .withArgs(ethers.ZeroAddress, erc4626Wrapper.address, expectedShares);
      await expect(tx)
        .to.emit(erc4626Wrapper, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer1.address, expectedShares);
      await expect(tx).to.changeTokenBalance(vedavault, erc4626Wrapper, expectedShares);
      await expect(tx).to.changeTokenBalance(erc4626Wrapper, signer1, expectedShares);
      await expect(tx).to.changeTokenBalance(stakedLbtc, signer1, mintAmount - stakeAmount);
      expect(await stakedLbtc.allowance(signer1.address, stakeAndBake.address)).to.be.eq(extraAllowance - stakeAmount);
      expect(await stakedLbtc.nonces(signer1)).to.be.eq(0n);

      await expect(tx).to.changeTokenBalance(stakedLbtc, treasury, stakeAndBakeFee);
      await expect(tx).to.changeTokenBalance(stakedLbtc, vedavault, stakeAmount - stakeAndBakeFee);
    });

    it('stakeAndBake: rejects when stakeAndBake is not set on wrapper', async function () {
      await snapshot.restore();
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const expectedShares = await getShares(stakeAmount, stakedLbtc.address);
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
      const depositPayload = encode(['uint256'], [expectedShares]);

      await expect(
        stakeAndBake.connect(claimer).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      ).to.be.revertedWithCustomError(erc4626Wrapper, 'UnauthorizedAccount');
    });

    it('stakeAndBake: rejects when depositor is not set', async function () {
      await snapshot.restore();
      //Remove depositor from storage
      const baseSlot = BigInt('0xd0321c9642a0f7a5931cd62db04cb9e2c0d32906ef8824eece128a7ad5e4f500');
      const depositorSlot = baseSlot + 1n;
      await network.provider.send('hardhat_setStorageAt', [
        stakeAndBake.address,
        '0x' + depositorSlot.toString(16),
        '0x' + ethers.ZeroAddress.replace('0x', '').padStart(64, '0')
      ]);

      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const expectedShares = await getShares(stakeAmount, stakedLbtc.address);
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
      const depositPayload = encode(['uint256'], [expectedShares]);

      await expect(
        stakeAndBake.connect(claimer).stakeAndBake({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      ).to.be.revertedWithCustomError(stakeAndBake, 'NoDepositorSet');
    });

    it('stakeAndBakeInternal: rejects when called by not the contract itself', async function () {
      await snapshot.restore();
      await erc4626Wrapper.connect(owner).addStakeAndBake(stakeAndBake.address, stakedLbtc.address);
      const mintAmount = randomBigInt(8);
      const permitAmount = mintAmount;
      const stakeAmount = mintAmount;
      const expectedShares = await getShares(stakeAmount, stakedLbtc.address);
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
      const depositPayload = encode(['uint256'], [expectedShares]);

      await expect(
        stakeAndBake.connect(claimer).stakeAndBakeInternal({
          permitPayload: permitPayload,
          depositPayload: depositPayload,
          mintPayload: data.payload,
          proof: data.proof,
          amount: stakeAmount
        })
      )
        .to.be.revertedWithCustomError(stakeAndBake, 'CallerNotSelf')
        .withArgs(claimer.address);
    });
  });

  describe('Deposit with payload', function () {
    let stakeAndBakeMock: HardhatEthersSigner;
    before(async function () {
      await snapshot.restore();
      stakeAndBakeMock = signer3;
      await erc4626Wrapper.connect(owner).addStakeAndBake(stakeAndBakeMock.address, stakedLbtc.address);
    });

    it('Successful deposit as StakeAndBake contract', async function () {
      const staker = signer1;
      const amountToStake = randomBigInt(8);
      await stakedLbtc.connect(minter)['mint(address,uint256)'](stakeAndBakeMock.address, amountToStake);
      await stakedLbtc.connect(stakeAndBakeMock).approve(erc4626Wrapper.address, amountToStake);

      const expectedShares = await getShares(amountToStake, stakedLbtc.address);
      const depositPayload = encode(['uint256'], [expectedShares]);

      const tx = await erc4626Wrapper
        .connect(stakeAndBakeMock)
        ['deposit(address,uint256,bytes)'](staker, amountToStake, depositPayload);

      await expect(tx)
        .to.emit(vedavault, 'Transfer')
        .withArgs(ethers.ZeroAddress, erc4626Wrapper.address, expectedShares);
      await expect(tx).to.emit(erc4626Wrapper, 'Transfer').withArgs(ethers.ZeroAddress, staker.address, expectedShares);
      await expect(tx).to.changeTokenBalance(erc4626Wrapper, staker, expectedShares);
      await expect(tx).to.changeTokenBalance(vedavault, erc4626Wrapper, expectedShares);
      await expect(tx).to.changeTokenBalance(stakedLbtc, stakeAndBakeMock, -amountToStake);
      await expect(tx).to.changeTokenBalance(stakedLbtc, vedavault, amountToStake);
    });

    it('Deposit fails if asset balance is abnormal', async function () {
      const snapshotLocal = await takeSnapshot();
      const staker = signer1;
      const amountToStake = randomBigInt(8);
      await stakedLbtc.connect(minter)['mint(address,uint256)'](stakeAndBakeMock.address, amountToStake);
      await stakedLbtc.connect(stakeAndBakeMock).approve(erc4626Wrapper.address, amountToStake);

      const expectedShares = await getShares(amountToStake, stakedLbtc.address);
      const depositPayload = encode(['uint256'], [expectedShares]);

      const totalBalanceBefore = await vedavault.balanceOf(erc4626Wrapper.address);

      await changeAssetSupplyOnWrapper(1n);

      await expect(
        erc4626Wrapper
          .connect(stakeAndBakeMock)
          ['deposit(address,uint256,bytes)'](staker, amountToStake, depositPayload)
      )
        .to.be.revertedWithCustomError(erc4626Wrapper, 'UnexpectedAssetBalance')
        .withArgs(totalBalanceBefore + expectedShares, totalBalanceBefore - 1n + expectedShares);

      await snapshotLocal.restore();
    });
  });

  describe('Simple Deposit/Stake', function () {
    before(async function () {
      await snapshot.restore();
    });

    it('deposit LBTC token', async function () {
      const amountToStake = 100000000n;
      const expectedShares = await getShares(amountToStake, stakedLbtc.address);

      await stakedLbtc.connect(minter)['mint(address,uint256)'](signer3.address, amountToStake);
      await stakedLbtc.connect(signer3).approve(erc4626Wrapper.address, amountToStake);

      const tx = await erc4626Wrapper
        .connect(signer3)
        [
          'deposit(address,uint256,address,uint256)'
        ](stakedLbtc.address, amountToStake, signer3.address, expectedShares);

      await expect(tx)
        .to.emit(vedavault, 'Transfer')
        .withArgs(ethers.ZeroAddress, erc4626Wrapper.address, expectedShares);
      await expect(tx)
        .to.emit(erc4626Wrapper, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer3.address, expectedShares);
      await expect(tx).to.changeTokenBalance(vedavault, erc4626Wrapper, expectedShares);
      await expect(tx).to.changeTokenBalance(erc4626Wrapper, signer3, expectedShares);
      await expect(tx).to.changeTokenBalance(stakedLbtc, signer3, -amountToStake);
    });

    it('deposit different token', async function () {
      const amountToStake = randomBigInt(8);
      const expectedShares = await getShares(amountToStake, wbtc.address);

      const staker = await impersonateWithEth('0xe74b28c2eAe8679e3cCc3a94d5d0dE83CCB84705', 0n);
      await wbtc.connect(staker).approve(erc4626Wrapper.address, amountToStake);
      const tx = await erc4626Wrapper
        .connect(staker)
        ['deposit(address,uint256,address,uint256)'](wbtc.address, amountToStake, signer2.address, expectedShares);

      await expect(tx)
        .to.emit(vedavault, 'Transfer')
        .withArgs(ethers.ZeroAddress, erc4626Wrapper.address, expectedShares);
      await expect(tx)
        .to.emit(erc4626Wrapper, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer2.address, expectedShares);
      await expect(tx).to.changeTokenBalance(vedavault, erc4626Wrapper, expectedShares);
      await expect(tx).to.changeTokenBalance(erc4626Wrapper, signer2, expectedShares);
      await expect(tx).to.changeTokenBalance(wbtc, staker, -amountToStake);
    });

    it('deposit vault token LBTCv', async function () {
      const amountToStake = randomBigInt(8);
      const expectedShares = await getShares(amountToStake, stakedLbtc.address);

      await stakedLbtc.connect(minter)['mint(address,uint256)'](signer3.address, amountToStake);
      await stakedLbtc.connect(signer3).approve(vedavault.address, amountToStake);
      await teller.connect(signer3).deposit(stakedLbtc.address, amountToStake, expectedShares);

      await vedavault.connect(signer3).approve(erc4626Wrapper.address, expectedShares);
      const tx = await erc4626Wrapper.connect(signer3)['deposit(uint256,address)'](expectedShares, signer2.address);

      await expect(tx).to.emit(vedavault, 'Transfer').withArgs(signer3.address, erc4626Wrapper.address, expectedShares);
      await expect(tx)
        .to.emit(erc4626Wrapper, 'Transfer')
        .withArgs(ethers.ZeroAddress, signer2.address, expectedShares);
      await expect(tx).to.changeTokenBalance(vedavault, erc4626Wrapper, expectedShares);
      await expect(tx).to.changeTokenBalance(erc4626Wrapper, signer2, expectedShares);
      await expect(tx).to.changeTokenBalance(vedavault, signer3, -expectedShares);
    });

    it('deposit vault token LBTCv fails if asset balance is abnormal', async function () {
      const snapshotLocal = await takeSnapshot();
      const amountToStake = randomBigInt(8);
      const expectedShares = await getShares(amountToStake, stakedLbtc.address);

      const totalBalanceBefore = await vedavault.balanceOf(erc4626Wrapper.address);
      const balanceDeviation = 1n;

      await changeAssetSupplyOnWrapper(balanceDeviation);

      await stakedLbtc.connect(minter)['mint(address,uint256)'](signer3.address, amountToStake);
      await stakedLbtc.connect(signer3).approve(vedavault.address, amountToStake);
      await teller.connect(signer3).deposit(stakedLbtc.address, amountToStake, expectedShares);

      await vedavault.connect(signer3).approve(erc4626Wrapper.address, expectedShares);
      await expect(erc4626Wrapper.connect(signer3)['deposit(uint256,address)'](expectedShares, signer2.address))
        .to.be.revertedWithCustomError(erc4626Wrapper, 'UnexpectedAssetBalance')
        .withArgs(totalBalanceBefore + expectedShares, totalBalanceBefore - balanceDeviation + expectedShares);

      await snapshotLocal.restore();
    });

    it('redeem', async function () {
      const amountToStake = randomBigInt(8);
      const expectedShares = await getShares(amountToStake, stakedLbtc.address);

      await stakedLbtc.connect(minter)['mint(address,uint256)'](signer3.address, amountToStake);
      await stakedLbtc.connect(signer3).approve(vedavault.address, amountToStake);
      await teller.connect(signer3).deposit(stakedLbtc.address, amountToStake, expectedShares);

      await vedavault.connect(signer3).approve(erc4626Wrapper.address, expectedShares);
      await erc4626Wrapper.connect(signer3)['deposit(uint256,address)'](expectedShares, signer2.address);

      const tx = await erc4626Wrapper.connect(signer2).redeem(expectedShares, signer3, signer2);
      await expect(tx).to.changeTokenBalance(erc4626Wrapper, signer2, -expectedShares);
      await expect(tx).to.changeTokenBalance(vedavault, signer3, expectedShares);
    });

    it('redeem fails if asset balance is abnormal', async function () {
      const snapshotLocal = await takeSnapshot();
      const amountToStake = randomBigInt(8);
      const expectedShares = await getShares(amountToStake, stakedLbtc.address);

      await stakedLbtc.connect(minter)['mint(address,uint256)'](signer3.address, amountToStake);
      await stakedLbtc.connect(signer3).approve(vedavault.address, amountToStake);
      await teller.connect(signer3).deposit(stakedLbtc.address, amountToStake, expectedShares);

      await vedavault.connect(signer3).approve(erc4626Wrapper.address, expectedShares);
      await erc4626Wrapper.connect(signer3)['deposit(uint256,address)'](expectedShares, signer2.address);

      const assetBalance = await vedavault.balanceOf(erc4626Wrapper);
      const totalSupply = await erc4626Wrapper.totalSupply();
      const redeemAmount = (expectedShares * 2n) / 3n;

      await changeAssetSupplyOnWrapper(expectedShares - redeemAmount);

      await expect(erc4626Wrapper.connect(signer2).redeem(redeemAmount, signer3, signer2))
        .to.be.revertedWithCustomError(erc4626Wrapper, 'UnexpectedAssetBalance')
        .withArgs(totalSupply - redeemAmount, assetBalance - expectedShares);

      await snapshotLocal.restore();
    });
  });

  describe('Rescue ERC20', function () {
    let token: StakedLBTC & Addressable;
    let dummy: Signer;
    let amountToStakeAdd: bigint;
    let expectedSharesAdd: bigint;

    before(async function () {
      await snapshot.restore();
      const rndAddr = ethers.Wallet.createRandom();
      token = await initStakedLBTC(owner.address, rndAddr.address, rndAddr.address);
      dummy = signer2;
      await token.connect(owner).addMinter(owner);
      await token.connect(owner)['mint(address,uint256)'](dummy, e18);
    });

    it('Owner can transfer ERC20 from mailbox', async () => {
      const amount = randomBigInt(8);
      let tx = await token.connect(dummy).transfer(erc4626Wrapper, amount);
      await expect(tx).changeTokenBalance(token, erc4626Wrapper, amount);

      tx = await erc4626Wrapper.connect(owner).rescueERC20(token, dummy, amount);
      await expect(tx).changeTokenBalance(token, dummy, amount);
      await expect(tx).changeTokenBalance(token, erc4626Wrapper, -amount);
    });

    it('Reverts when called by not the owner', async () => {
      const amount = randomBigInt(8);
      const tx = await token.connect(dummy).transfer(erc4626Wrapper, amount);
      await expect(tx).changeTokenBalance(token, erc4626Wrapper, amount);

      await expect(erc4626Wrapper.connect(dummy).rescueERC20(token.address, dummy.address, amount))
        .to.revertedWithCustomError(erc4626Wrapper, 'AccessControlUnauthorizedAccount')
        .withArgs(dummy.address, await erc4626Wrapper.DEFAULT_ADMIN_ROLE());
    });

    it('Owner cannot transfer asset from mailbox if amount is too big', async () => {
      const amountToStake = 100000000n;
      const expectedShares = await getShares(amountToStake, stakedLbtc.address);

      await stakedLbtc.connect(minter)['mint(address,uint256)'](signer3.address, amountToStake);
      await stakedLbtc.connect(signer3).approve(erc4626Wrapper.address, amountToStake);

      await erc4626Wrapper
        .connect(signer3)
        [
          'deposit(address,uint256,address,uint256)'
        ](stakedLbtc.address, amountToStake, signer3.address, expectedShares);

      amountToStakeAdd = randomBigInt(8);
      expectedSharesAdd = await getShares(amountToStakeAdd, stakedLbtc.address);

      await stakedLbtc.connect(minter)['mint(address,uint256)'](signer3.address, amountToStakeAdd);
      await stakedLbtc.connect(signer3).approve(vedavault.address, amountToStakeAdd);
      await teller.connect(signer3).deposit(stakedLbtc.address, amountToStakeAdd, expectedSharesAdd);

      await vedavault.connect(signer3).transfer(erc4626Wrapper.address, expectedSharesAdd);

      await expect(
        erc4626Wrapper.connect(owner).rescueERC20(vedavault.address, dummy.address, expectedSharesAdd + 1n)
      ).to.revertedWithCustomError(erc4626Wrapper, 'RescueAssetAmountTooBig');
    });

    it('Owner can transfer asset from mailbox if amount is NOT too big', async () => {
      const tx = await erc4626Wrapper.connect(owner).rescueERC20(vedavault.address, dummy, expectedSharesAdd);
      await expect(tx).changeTokenBalance(vedavault, dummy, expectedSharesAdd);
      await expect(tx).changeTokenBalance(vedavault, erc4626Wrapper, -expectedSharesAdd);
    });
  });

  async function changeAssetSupplyOnWrapper(amount: bigint) {
    const superAdmin = await impersonateWithEth('0xb7cB7131FFc18f87eEc66991BECD18f2FF70d2af');
    const auth = (await ethers.getContractAt(
      'RolesAuthority',
      '0xF3E03eF7df97511a52f31ea7a22329619db2bdF4'
    )) as RolesAuthority;
    await auth.connect(superAdmin).setUserRole(owner.address, 3n, true);
    const vedavaultExt = (await ethers.getContractAt(
      'BoringVault',
      '0x5401b8620E5FB570064CA9114fd1e135fd77D57c'
    )) as BoringVault;
    await vedavaultExt.connect(owner).exit(owner.address, stakedLbtc.address, 0n, erc4626Wrapper.address, amount);
  }
});
