import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
    deployContract,
    getSignersWithPrivateKeys,
    CHAIN_ID,
    NEW_VALSET,
    DEPOSIT_BTC_ACTION,
    encode,
    getPayloadForAction,
    Signer,
    init,
} from './helpers';
import {
    PartnerVault,
    LBTCMock,
    LockedFBTCMock,
    WBTCMock,
} from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';

describe('PartnerVault', function () {
    let deployer: Signer,
        signer1: Signer,
        signer2: Signer,
        signer3: Signer,
        treasury: Signer;
    let partnerVault: PartnerVault;
    let lockedFbtc: LockedFBTCMock;
    let fbtc: WBTCMock;
    let lbtc: LBTCMock;
    let snapshot: SnapshotRestorer;
    let snapshotTimestamp: number;

    before(async function () {
        [deployer, signer1, signer2, signer3, treasury] =
            await getSignersWithPrivateKeys();

        const burnCommission = 1000;
        const result = await init(burnCommission, deployer.address);
        lbtc = result.lbtc;

        fbtc = await deployContract<WBTCMock>('WBTCMock', []);

        partnerVault = await deployContract<PartnerVault>('PartnerVault', [
            deployer.address,
            await fbtc.getAddress(),
            await lbtc.getAddress(),
            deployer.address,
        ]);

        lockedFbtc = await deployContract<LockedFBTCMock>(
            'LockedFBTCMock',
            [await fbtc.getAddress()],
            false
        );

        await lbtc.changeTreasuryAddress(treasury.address);

        // set partner vault as minter for lbtc
        await lbtc.addMinter(await partnerVault.getAddress());

        // Initialize the permit module
        await lbtc.reinitialize();

        // Set lockedFbtc contract on partner vault
        partnerVault.setLockedFbtc(await lockedFbtc.getAddress());

        snapshot = await takeSnapshot();
        snapshotTimestamp = (await ethers.provider.getBlock('latest'))!
            .timestamp;
    });

    afterEach(async function () {
        // clean the state after each test
        await snapshot.restore();
    });

    describe('Setters and getters', function () {
        it('should be able to set the locked fbtc contract as admin', async function () {});
        it('should not be able to set the locked fbtc contract as anyone else', async function () {});
        it('should be able to set a stake limit as operator', async function () {});
        it('should not be able to set a stake limit as anyone else', async function () {});
        it('should be able to pause the contract as pauser', async function () {});
        it('should not be able to pause the contract as anyone else', async function () {});
        it('should be able to unpause the contract as admin', async function () {});
        it('should not be able to unpause the contract as anyone else', async function () {});
        it('should be able to retrieve the stake limit', async function () {});
        it('should be able to retrieve the remaining stake', async function () {});
    });
    describe('FBTC locking', function () {
        it('should be able to mint LBTC on depositing FBTC', async function () {});
        it('should not be able to mint LBTC without depositing', async function () {});
        it('should not be able to mint 0 LBTC', async function () {});
        it('should not be able to go over the stake limit', async function () {});
    });
    describe('FBTC unlocking', function () {
        it('should be able to burn LBTC and unlock FBTC to the user', async function () {});
        it('should be able to burn less LBTC than was minted', async function () {});
        it('should be able to burn minted LBTC in multiple attempts', async function () {});
        it('should not be able to burn LBTC if none was minted', async function () {});
        it('should not be able to burn more LBTC than was minted', async function () {});
        it('should not be able to finalize a burn without initiating one', async function () {});
    });
});
