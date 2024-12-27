import { loadFixture } from '@nomicfoundation/hardhat-toolbox/network-helpers';

import { DepositNotarizationBlacklist } from '../typechain-types';

import { deployContract } from './helpers';

import { expect } from 'chai';
import hre from 'hardhat';

describe('DepositNotarizationBlacklist', function () {
    // We define a fixture to reuse the same setup in every test.
    // We use loadFixture to run this setup once, snapshot that state,
    // and reset Hardhat Network to that snapshot in every test.
    async function deployBlacklist() {
        const [owner] = await hre.ethers.getSigners();
        const blacklist = await deployContract<DepositNotarizationBlacklist>(
            'DepositNotarizationBlacklist',
            [owner.address],
            true
        );

        return { blacklist, owner };
    }

    describe('Initialization', function () {
        it('Should set the right owner', async function () {
            const { blacklist, owner } = await loadFixture(deployBlacklist);
            expect(await blacklist.owner()).to.equal(owner.address);
        });
    });

    describe('Blacklist', function () {
        it('Should set an UTXO by its transaction Id and output index', async function () {
            const { blacklist } = await loadFixture(deployBlacklist);

            const blockTxId = hre.ethers.sha256(new Uint8Array([1]));
            const blockVout = 1;

            const legitTxId = hre.ethers.sha256(new Uint8Array([2]));
            const legitVout = 0;

            await expect(blacklist.addToBlacklist(blockTxId, [blockVout]))
                .to.emit(blacklist, 'Blacklisted')
                .withArgs(blockTxId, blockVout);

            // Make sure the new entry is correctly blacklisted when queried
            expect(await blacklist.isBlacklisted(blockTxId, blockVout)).to.be
                .true;

            // Make sure the new entry did not affect unrelated UTXOs
            expect(await blacklist.isBlacklisted(blockTxId, legitVout)).to.be
                .false;
            expect(await blacklist.isBlacklisted(legitTxId, legitVout)).to.be
                .false;
            expect(await blacklist.isBlacklisted(legitTxId, blockVout)).to.be
                .false;
        });
    });
});
