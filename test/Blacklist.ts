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
        const [defaultAdmin, blacklistAdder, blacklistRemover, otherAccount] =
            await hre.ethers.getSigners();
        const blacklist = await deployContract<DepositNotarizationBlacklist>(
            'DepositNotarizationBlacklist',
            [defaultAdmin.address],
            true
        );

        await blacklist.grantRole(
            await blacklist.ADD_BLACKLIST_ROLE(),
            blacklistAdder.address
        );
        await blacklist.grantRole(
            await blacklist.REMOVE_BLACKLIST_ROLE(),
            blacklistRemover.address
        );

        return {
            blacklist,
            defaultAdmin,
            blacklistAdder,
            blacklistRemover,
            otherAccount,
        };
    }

    describe('Initialization', function () {
        it('Should set the right default admin', async function () {
            const { blacklist, defaultAdmin } =
                await loadFixture(deployBlacklist);
            expect(
                await blacklist.hasRole(
                    await blacklist.DEFAULT_ADMIN_ROLE(),
                    defaultAdmin
                )
            ).to.be.true;
        });

        it('should not authorize any account to add to blacklist', async function () {
            const { blacklist, otherAccount } =
                await loadFixture(deployBlacklist);
            const blacklistByOtherAccount = blacklist.connect(otherAccount);
            const aTxId = hre.ethers.sha256(new Uint8Array([2]));
            await expect(blacklistByOtherAccount.addToBlacklist(aTxId, [0]))
                .to.be.revertedWithCustomError(
                    blacklistByOtherAccount,
                    'AccessControlUnauthorizedAccount'
                )
                .withArgs(
                    otherAccount.address,
                    await blacklistByOtherAccount.ADD_BLACKLIST_ROLE()
                );
        });

        it('should not authorize any account to remove from blacklist', async function () {
            const { blacklist, otherAccount } =
                await loadFixture(deployBlacklist);
            const blacklistByOtherAccount = blacklist.connect(otherAccount);
            const aTxId = hre.ethers.sha256(new Uint8Array([2]));
            await expect(
                blacklistByOtherAccount.removeFromBlacklist(aTxId, [0])
            )
                .to.be.revertedWithCustomError(
                    blacklistByOtherAccount,
                    'AccessControlUnauthorizedAccount'
                )
                .withArgs(
                    otherAccount.address,
                    await blacklistByOtherAccount.REMOVE_BLACKLIST_ROLE()
                );
        });
    });

    describe('Blacklist', function () {
        it('Should add an UTXO by its transaction Id and output index', async function () {
            const { blacklist, blacklistAdder } =
                await loadFixture(deployBlacklist);
            const blacklistByAdder = blacklist.connect(blacklistAdder);

            const blockTxId = hre.ethers.sha256(new Uint8Array([1]));
            const blockVout = 1;

            const legitTxId = hre.ethers.sha256(new Uint8Array([2]));
            const legitVout = 0;

            await expect(
                blacklistByAdder.addToBlacklist(blockTxId, [blockVout])
            )
                .to.emit(blacklist, 'Blacklisted')
                .withArgs(blockTxId, blockVout, blacklistAdder.address);

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

        it('Should remove an UTXO by its transaction Id and output index', async function () {
            const { blacklist, blacklistAdder, blacklistRemover } =
                await loadFixture(deployBlacklist);
            const blacklistByAdder = blacklist.connect(blacklistAdder);

            const blockTxId = hre.ethers.sha256(new Uint8Array([1]));
            const toClearVout = 1;
            const blockedVout = 10;

            // Add two to blacklist
            await blacklistByAdder.addToBlacklist(blockTxId, [
                toClearVout,
                blockedVout,
            ]);

            // Check state was set properly
            expect(await blacklist.isBlacklisted(blockTxId, toClearVout)).to.be
                .true;
            expect(await blacklist.isBlacklisted(blockTxId, blockedVout)).to.be
                .true;

            // Remove from blacklist
            const blacklistByRemover = blacklist.connect(blacklistRemover);
            await expect(
                blacklistByRemover.removeFromBlacklist(blockTxId, [toClearVout])
            )
                .to.emit(blacklist, 'Cleared')
                .withArgs(blockTxId, toClearVout, blacklistRemover.address);

            // Ensure vout is now cleared
            expect(await blacklist.isBlacklisted(blockTxId, toClearVout)).to.be
                .false;

            // Ensure other vout was untouched
            expect(await blacklist.isBlacklisted(blockTxId, blockedVout)).to.be
                .true;
        });

        it('Should revert if already blacklisted', async function () {
            const { blacklist, blacklistAdder } =
                await loadFixture(deployBlacklist);

            const blockTxId = hre.ethers.sha256(new Uint8Array([1]));
            const blockedVout = 0;

            // Add to blacklist
            const blacklistByAdder = blacklist.connect(blacklistAdder);
            await blacklistByAdder.addToBlacklist(blockTxId, [blockedVout]);

            // Check state was set properly
            expect(await blacklist.isBlacklisted(blockTxId, blockedVout)).to.be
                .true;

            // Check revert on adding again
            await expect(
                blacklistByAdder.addToBlacklist(blockTxId, [blockedVout])
            )
                .to.revertedWithCustomError(blacklist, 'AlreadyBlacklisted')
                .withArgs(blockTxId, blockedVout);
        });

        it('Should revert if already cleared', async function () {
            const { blacklist, blacklistAdder, blacklistRemover } =
                await loadFixture(deployBlacklist);

            const blockTxId = hre.ethers.sha256(new Uint8Array([1]));
            const blockedVout = 0;

            // Check initial state is as expected
            expect(await blacklist.isBlacklisted(blockTxId, blockedVout)).to.be
                .false;

            // Revert on remove from blacklist on initial cleared state
            const blacklistByRemover = blacklist.connect(blacklistRemover);
            await expect(
                blacklistByRemover.removeFromBlacklist(blockTxId, [blockedVout])
            )
                .to.revertedWithCustomError(blacklist, 'AlreadyCleared')
                .withArgs(blockTxId, blockedVout);

            // Add and remove
            const blacklistByAdder = blacklist.connect(blacklistAdder);
            await blacklistByAdder.addToBlacklist(blockTxId, [blockedVout]);
            expect(await blacklist.isBlacklisted(blockTxId, blockedVout)).to.be
                .true;
            await blacklistByRemover.removeFromBlacklist(blockTxId, [
                blockedVout,
            ]);
            expect(await blacklist.isBlacklisted(blockTxId, blockedVout)).to.be
                .false;

            // Revert on clearing again
            await expect(
                blacklistByRemover.removeFromBlacklist(blockTxId, [blockedVout])
            )
                .to.revertedWithCustomError(blacklist, 'AlreadyCleared')
                .withArgs(blockTxId, blockedVout);
        });
    });
});
