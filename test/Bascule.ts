import { expect } from 'chai';
import { ethers } from 'hardhat';
import { getRandomValues } from 'crypto';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { Bascule } from '../typechain-types';
import {
    SnapshotRestorer,
    takeSnapshot,
} from '@nomicfoundation/hardhat-network-helpers';

// Deposit state enum
enum DepositState {
    UNREPORTED = 0,
    REPORTED = 1,
    WITHDRAWN = 2,
}
describe('Bascule', function () {
    let admin: HardhatEthersSigner;
    let pauser: HardhatEthersSigner;
    let depositReporter: HardhatEthersSigner;
    let withdrawalValidator: HardhatEthersSigner;
    let guardian: HardhatEthersSigner;
    let bascule: Bascule;
    let snapshot: SnapshotRestorer;

    before(async () => {
        [admin, pauser, depositReporter, withdrawalValidator, guardian] =
            await ethers.getSigners();
        bascule = await ethers.deployContract('Bascule', [
            admin,
            pauser,
            depositReporter,
            withdrawalValidator,
            4n,
        ]);

        snapshot = await takeSnapshot();
    });

    afterEach(async function () {
        await snapshot.restore();
    });

    describe('Roles', function () {
        it('Should enforce access control', async () => {
            // Dummy unique identifier
            const uniqueID = new Uint8Array(32);

            // Deposit reporter can report deposits
            await bascule
                .connect(depositReporter)
                .reportDeposits(ethers.randomBytes(32), [uniqueID]);

            // Pauser can't report deposits
            await expect(
                bascule
                    .connect(pauser)
                    .reportDeposits(ethers.randomBytes(32), [uniqueID])
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlUnauthorizedAccount'
            );
            await expect(
                bascule
                    .connect(pauser)
                    .reportDeposits(ethers.randomBytes(32), [uniqueID])
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlUnauthorizedAccount'
            );

            // Withdrawal validator can validate withdrawals
            await bascule
                .connect(withdrawalValidator)
                .validateWithdrawal(uniqueID, 0);

            // Deposit reporter can't validate withdrawals
            await expect(
                bascule.connect(depositReporter).validateWithdrawal(uniqueID, 0)
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlUnauthorizedAccount'
            );

            // Withdrawal validator can't pause
            await expect(
                bascule.connect(withdrawalValidator).pause()
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlUnauthorizedAccount'
            );
        });
    });

    describe('Pauser', function () {
        it('Should pause/unpause the contract', async () => {
            // Admin can't pause
            await expect(
                bascule.connect(admin).pause()
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlUnauthorizedAccount'
            );

            // Pauser can pause
            await expect(bascule.connect(pauser).pause()).to.emit(
                bascule,
                'Paused'
            );

            // The paused getter returns true after pausing
            expect(await bascule.paused()).to.be.true;

            // Dummy unique identifier
            const uniqueID = new Uint8Array(32);

            // No deposit reporting while paused
            await expect(
                bascule
                    .connect(depositReporter)
                    .reportDeposits(ethers.randomBytes(32), [uniqueID])
            ).to.be.revertedWithCustomError(bascule, 'EnforcedPause');

            // No withdrawal validating while paused
            await expect(
                bascule
                    .connect(withdrawalValidator)
                    .validateWithdrawal(uniqueID, 0)
            ).to.be.revertedWithCustomError(bascule, 'EnforcedPause');

            // No update max number of deposits while paused
            await expect(
                bascule.connect(depositReporter).setMaxDeposits(3n)
            ).to.be.revertedWithCustomError(bascule, 'EnforcedPause');

            // Admin can't unpause
            await expect(
                bascule.connect(admin).unpause()
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlUnauthorizedAccount'
            );

            // Pauser can unpause
            await expect(bascule.connect(pauser).unpause()).to.emit(
                bascule,
                'Unpaused'
            );

            // The paused getter returns false after unpausing
            expect(await bascule.paused()).to.be.false;

            // Deposit reporting is now allowed (i.e., doesn't throw)
            await bascule
                .connect(depositReporter)
                .reportDeposits(ethers.randomBytes(32), [uniqueID]);

            // Withdrawal validating is now allowed (i.e., doesn't throw)
            await bascule
                .connect(withdrawalValidator)
                .validateWithdrawal(uniqueID, 0);
        });
    });

    describe('Changing admin', function () {
        it('Should allow admin to change with confirmtaion', async () => {
            // eslint-disable-next-line new-cap
            const adminRole = await bascule.DEFAULT_ADMIN_ROLE();

            // fail to change admin without confirmation
            await expect(
                bascule
                    .connect(admin)
                    .grantRole(adminRole, await pauser.getAddress())
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlEnforcedDefaultAdminRules'
            );
            // initiate transfer
            await expect(
                bascule
                    .connect(admin)
                    .beginDefaultAdminTransfer(await pauser.getAddress())
            ).to.be.emit(bascule, 'DefaultAdminTransferScheduled');
            // can't accept yet
            await expect(
                bascule.connect(pauser).acceptDefaultAdminTransfer()
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlEnforcedDefaultAdminDelay'
            );
            // speed up the test by 3 days
            await ethers.provider.send('evm_increaseTime', [300000]);
            // cancel the transfer
            await expect(
                bascule.connect(admin).cancelDefaultAdminTransfer()
            ).to.be.emit(bascule, 'DefaultAdminTransferCanceled');
            // can't accept now
            await expect(
                bascule.connect(pauser).acceptDefaultAdminTransfer()
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlInvalidDefaultAdmin'
            );
            // transfer again
            await bascule
                .connect(admin)
                .beginDefaultAdminTransfer(await pauser.getAddress());
            // speed up the test by >3 days
            await ethers.provider.send('evm_increaseTime', [300000]);
            // can accept now
            await bascule.connect(pauser).acceptDefaultAdminTransfer();
            // check admin
            expect(await bascule.connect(pauser).owner()).to.equal(
                await pauser.getAddress()
            );
        });
    });

    describe('Deposit reporting and withdrawal validation', function () {
        it('Should validate withdrawals with corresponding deposits', async () => {
            // A unique ID for a deposit
            const uniqueID = new Uint8Array(32);

            // Can't validate for a deposit that doesn't exist
            await expect(
                bascule
                    .connect(withdrawalValidator)
                    .validateWithdrawal(uniqueID, 0)
            ).to.be.revertedWithCustomError(
                bascule,
                'WithdrawalFailedValidation'
            );

            // Report deposit and check that the contract emitted the correct event
            const reportId = ethers.randomBytes(32);
            await expect(
                bascule
                    .connect(depositReporter)
                    .reportDeposits(reportId, [uniqueID])
            )
                .to.emit(bascule, 'DepositsReported')
                .withArgs(reportId, 1);

            // Check that the deposit is in the deposit history
            expect(await bascule.depositHistory(uniqueID)).to.equal(
                DepositState.REPORTED
            );

            // Validate the withdrawal and check that the contract emitted the correct event
            await expect(
                bascule
                    .connect(withdrawalValidator)
                    .validateWithdrawal(uniqueID, 0)
            )
                .to.emit(bascule, 'WithdrawalValidated')
                .withArgs(uniqueID, 0);

            // Check that the deposit has been changed to withdrawn
            expect(await bascule.depositHistory(uniqueID)).to.equal(
                DepositState.WITHDRAWN
            );

            // Can't validate again for the same deposit
            await expect(
                bascule
                    .connect(withdrawalValidator)
                    .validateWithdrawal(uniqueID, 0)
            )
                .to.be.revertedWithCustomError(bascule, 'AlreadyWithdrawn')
                .withArgs(uniqueID, 0);
        });

        it('Should validate withdrawals correspond to batch deposits', async () => {
            // Unique IDs for deposits
            const one = new Uint8Array(32).fill(1);
            const two = new Uint8Array(32).fill(2);
            const three = new Uint8Array(32).fill(3);

            const depositIDs = [one, two, three];

            expect(await bascule.depositHistory(one)).to.equal(
                DepositState.UNREPORTED
            );
            expect(await bascule.depositHistory(two)).to.equal(
                DepositState.UNREPORTED
            );
            expect(await bascule.depositHistory(three)).to.equal(
                DepositState.UNREPORTED
            );

            // Report three deposits and check that the contract emitted the correct
            // event
            const reportId = ethers.randomBytes(32);
            await expect(
                bascule
                    .connect(depositReporter)
                    .reportDeposits(reportId, depositIDs)
            )
                .to.emit(bascule, 'DepositsReported')
                .withArgs(reportId, 3);

            // Check that the deposits are in the deposit history
            expect(await bascule.depositHistory(one)).to.equal(
                DepositState.REPORTED
            );
            expect(await bascule.depositHistory(two)).to.equal(
                DepositState.REPORTED
            );
            expect(await bascule.depositHistory(three)).to.equal(
                DepositState.REPORTED
            );

            // Validate the withdrawals
            for (let i = 0; i < depositIDs.length; i++) {
                const depositID = depositIDs[i];
                await expect(
                    bascule
                        .connect(withdrawalValidator)
                        .validateWithdrawal(depositID, i)
                )
                    .to.emit(bascule, 'WithdrawalValidated')
                    .withArgs(depositID, i);
                // should fail if we already validated or the id and address don't match
                await expect(
                    bascule
                        .connect(withdrawalValidator)
                        .validateWithdrawal(depositID, i)
                ).to.be.revertedWithCustomError(bascule, 'AlreadyWithdrawn');
            }
        });

        it('Should sanity check deposit IDs', async () => {            
            // Unique IDs for transactions
            const one = new Uint8Array(32).fill(1);
            const two = new Uint8Array(32).fill(2);
            const three = new Uint8Array(32).fill(3);
            const four = new Uint8Array(32).fill(4);
            const five = new Uint8Array(32).fill(5);

            // No deposits over the max number
            await expect(
                bascule
                    .connect(depositReporter)
                    .reportDeposits(ethers.randomBytes(32), [one, two, three, four, five])
            ).to.be.revertedWithCustomError(bascule, 'BadDepositReport');

            // No re-used unique IDs
            await expect(
                bascule
                    .connect(depositReporter)
                    .reportDeposits(ethers.randomBytes(32), [one, two, two])
            ).to.be.revertedWithCustomError(bascule, 'AlreadyReported');
        });
    });

    describe('Swapping withdrawalValidator during pause', async () => {
        it('Allows admin to validate and old validator to not', async () => {
            // Unique IDs for transactions
            const one = new Uint8Array(32).fill(1);
            const two = new Uint8Array(32).fill(2);
            const three = new Uint8Array(32).fill(3);
            const four = new Uint8Array(32).fill(4);

            const reportId = ethers.randomBytes(32);
            await expect(
                bascule
                    .connect(depositReporter)
                    .reportDeposits(reportId, [one, two, three, four])
            )
                .to.emit(bascule, 'DepositsReported')
                .withArgs(reportId, 4);

            // Fail to validate withdrawal as admin
            await expect(
                bascule.connect(admin).validateWithdrawal(one, 0)
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlUnauthorizedAccount'
            );

            // Can withdraw as withdrawalValidator
            await bascule
                .connect(withdrawalValidator)
                .validateWithdrawal(one, 0);

            // Pause the contract
            await bascule.connect(pauser).pause();

            // eslint-disable-next-line new-cap
            const withdrawalValidatorRole =
                await bascule.WITHDRAWAL_VALIDATOR_ROLE();

            // Add admin as a new withdrawalValidator
            await expect(
                bascule
                    .connect(admin)
                    .grantRole(
                        withdrawalValidatorRole,
                        await admin.getAddress()
                    )
            )
                .to.emit(bascule, 'RoleGranted')
                .withArgs(withdrawalValidatorRole, admin, admin);

            // Unpause the contract
            await bascule.connect(pauser).unpause();

            // Can withdraw as admin
            await bascule.connect(admin).validateWithdrawal(two, 0);

            // Can withdraw as withdrawalValidator
            await bascule
                .connect(withdrawalValidator)
                .validateWithdrawal(three, 0);

            // Remove withdrawalValidator from role
            await expect(
                bascule
                    .connect(admin)
                    .revokeRole(
                        withdrawalValidatorRole,
                        await withdrawalValidator.getAddress()
                    )
            )
                .to.emit(bascule, 'RoleRevoked')
                .withArgs(withdrawalValidatorRole, withdrawalValidator, admin);

            // Cannot withdraw as withdrawalValidator
            await expect(
                bascule.connect(withdrawalValidator).validateWithdrawal(four, 0)
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlUnauthorizedAccount'
            );

            // Can withdraw as admin
            await bascule.connect(admin).validateWithdrawal(four, 0);
        });
    });

    describe('Update max number of deposits', async () => {
        it('Allows admin to update max number of deposits', async () => {
            // Unique IDs for transactions
            const one = new Uint8Array(32).fill(1);
            const two = new Uint8Array(32).fill(2);
            const three = new Uint8Array(32).fill(3);
            const four = new Uint8Array(32).fill(4);
            const five = new Uint8Array(32).fill(5);

            // Deposit five transactions is not allowed
            await expect(
                bascule
                    .connect(depositReporter)
                    .reportDeposits(ethers.randomBytes(32), [one, two, three, four, five])
            ).to.be.revertedWithCustomError(bascule, 'BadDepositReport');

            // Get max number of deposits
            expect(
                await bascule.connect(depositReporter).maxDeposits()
            ).to.equal(4);

            // Deposit reporter can't update max number of deposits
            await expect(
                bascule.connect(depositReporter).setMaxDeposits(3n)
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlUnauthorizedAccount'
            );

            // Update max number of deposits to 5
            await expect(bascule.connect(admin).setMaxDeposits(5n))
                .to.emit(bascule, 'MaxDepositsUpdated')
                .withArgs(5);

            // Get max number of deposits
            expect(
                await bascule.connect(depositReporter).maxDeposits()
            ).to.equal(5);

            // Deposit five transactions is okay now
            const reportId = ethers.randomBytes(32);
            await expect(
                bascule
                    .connect(depositReporter)
                    .reportDeposits(reportId, [one, two, three, four, five])
            )
                .to.emit(bascule, 'DepositsReported')
                .withArgs(reportId, 5);
        });
    });

    describe('Validation threshold', async () => {
        it('Can be raised by guardian once', async () => {
            expect(
                await bascule.connect(depositReporter).validateThreshold()
            ).to.equal(0);

            // can't set threshold to same value
            await expect(
                bascule.connect(pauser).updateValidateThreshold(0)
            ).to.be.revertedWithCustomError(bascule, 'SameValidationThreshold');

            // can't raise threshold as admin
            await expect(
                bascule.connect(admin).updateValidateThreshold(33)
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlUnauthorizedAccount'
            );

            // grant guardian role
            // eslint-disable-next-line new-cap
            const guardianRole = await bascule.VALIDATION_GUARDIAN_ROLE();
            await expect(
                bascule.connect(admin).grantRole(guardianRole, guardian)
            )
                .to.emit(bascule, 'RoleGranted')
                .withArgs(guardianRole, guardian, admin);

            // pause the contract
            await bascule.connect(pauser).pause();

            // can't set threshold as guardian when paused
            await expect(
                bascule.connect(guardian).updateValidateThreshold(33)
            ).to.be.revertedWithCustomError(bascule, 'EnforcedPause');

            // unpause the contract
            await bascule.connect(pauser).unpause();

            // can raise as guardian
            await expect(bascule.connect(guardian).updateValidateThreshold(33))
                .to.emit(bascule, 'UpdateValidateThreshold')
                .withArgs(0, 33);

            // can lower threshold as admin
            await expect(bascule.connect(admin).updateValidateThreshold(32))
                .to.emit(bascule, 'UpdateValidateThreshold')
                .withArgs(33, 32);

            // can't raise as guardian again
            await expect(
                bascule.connect(guardian).updateValidateThreshold(33)
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlUnauthorizedAccount'
            );

            // can't raise as admin
            await expect(
                bascule.connect(admin).updateValidateThreshold(33)
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlUnauthorizedAccount'
            );
        });

        it('Can be lowerd by admin (whenever)', async () => {
            // eslint-disable-next-line new-cap
            const guardianRole = await bascule.VALIDATION_GUARDIAN_ROLE();

            // grant guardian role
            await expect(
                bascule.connect(admin).grantRole(guardianRole, guardian)
            )
                .to.emit(bascule, 'RoleGranted')
                .withArgs(guardianRole, guardian, admin);

            // raise as guardian
            await expect(bascule.connect(guardian).updateValidateThreshold(33))
                .to.emit(bascule, 'UpdateValidateThreshold')
                .withArgs(0, 33);

            // grant guardian role
            await expect(
                bascule.connect(admin).grantRole(guardianRole, guardian)
            )
                .to.emit(bascule, 'RoleGranted')
                .withArgs(guardianRole, guardian, admin);

            // can't lower threshold as guardian
            await expect(
                bascule.connect(guardian).updateValidateThreshold(32)
            ).to.be.revertedWithCustomError(
                bascule,
                'AccessControlUnauthorizedAccount'
            );

            // can lower threshold as admin
            await expect(bascule.connect(admin).updateValidateThreshold(32))
                .to.emit(bascule, 'UpdateValidateThreshold')
                .withArgs(33, 32);
        });

        it('Allows withdrawals below threshold and checks those above', async () => {
            // grant guardian role
            // eslint-disable-next-line new-cap
            const guardianRole = await bascule.VALIDATION_GUARDIAN_ROLE();
            await expect(
                bascule.connect(admin).grantRole(guardianRole, guardian)
            )
                .to.emit(bascule, 'RoleGranted')
                .withArgs(guardianRole, guardian, admin);

            // raise validation threshold
            await expect(bascule.connect(guardian).updateValidateThreshold(33))
                .to.emit(bascule, 'UpdateValidateThreshold')
                .withArgs(0, 33);

            // add some deposits
            const one = new Uint8Array(32).fill(1);
            const two = new Uint8Array(32).fill(2);
            const three = new Uint8Array(32).fill(3);
            const reportId = ethers.randomBytes(32);
            await expect(
                bascule
                    .connect(depositReporter)
                    .reportDeposits(reportId, [one, two])
            )
                .to.emit(bascule, 'DepositsReported')
                .withArgs(reportId, 2);

            // can withdraw an existing deposit above threshold
            await expect(
                bascule.connect(withdrawalValidator).validateWithdrawal(one, 40)
            )
                .to.emit(bascule, 'WithdrawalValidated')
                .withArgs(one, 40);

            // can withdraw an existing deposit below threshold
            await expect(
                bascule.connect(withdrawalValidator).validateWithdrawal(two, 20)
            )
                .to.emit(bascule, 'WithdrawalValidated')
                .withArgs(two, 20);

            // cannot withdraw a non-existing deposit >= threshold
            await expect(
                bascule
                    .connect(withdrawalValidator)
                    .validateWithdrawal(three, 33)
            )
                .to.be.revertedWithCustomError(
                    bascule,
                    'WithdrawalFailedValidation'
                )
                .withArgs(three, 33);

            // can withdraw a non-existing deposit below threshold
            await expect(
                bascule
                    .connect(withdrawalValidator)
                    .validateWithdrawal(three, 32)
            )
                .to.emit(bascule, 'WithdrawalNotValidated')
                .withArgs(three, 32);
        });
    });

    describe('Crashing before/after reporting', async () => {
        it('Can find deposit report event with reportId', async () => {
            // Unique IDs for transactions
            const one = new Uint8Array(32).fill(1);
            const two = new Uint8Array(32).fill(2);
            const three = new Uint8Array(32).fill(3);
            const four = new Uint8Array(32).fill(4);
            const five = new Uint8Array(32).fill(5);

            const reportId = ethers.randomBytes(32);

            // no event with reportId
            // eslint-disable-next-line new-cap
            const filter = bascule.filters.DepositsReported(reportId);
            expect((await bascule.queryFilter(filter)).length).to.equal(0);

            // report 2 deposits
            await (
                await bascule
                    .connect(depositReporter)
                    .reportDeposits(reportId, [one, two])
            ).wait();
            let events = await bascule.queryFilter(filter);
            expect(events.length).to.equal(1);
            expect(events[0].args[0]).to.equal(ethers.hexlify(reportId));
            expect(events[0].args[1]).to.equal(2n);

            // report 3 deposits with the same reportId (avoid doing this, but it's okay in testing)
            await (
                await bascule
                    .connect(depositReporter)
                    .reportDeposits(reportId, [three, four, five])
            ).wait();
            events = await bascule.queryFilter(filter);
            expect(events.length).to.equal(2);
            expect(events[0].args[0]).to.equal(ethers.hexlify(reportId));
            expect(events[0].args[1]).to.equal(2n);
            expect(events[1].args[0]).to.equal(ethers.hexlify(reportId));
            expect(events[1].args[1]).to.equal(3n);
        });
    });

    describe('Gas benchmark', async () => {
        it('Can deposit', async () => {
            const maxNr = process.env.DEPOSIT_NUM
                ? parseInt(process.env.DEPOSIT_NUM)
                : 1000;

            await bascule.setMaxDeposits(maxNr);
            
            // Unique IDs for transactions
            const depositIDs = new Array(maxNr)
                .fill(0)
                .map((_) => getRandomValues(new Uint8Array(32)));

            // Report maxNr deposits and check that the contract emitted the correct
            const reportId = ethers.randomBytes(32);
            await expect(
                bascule
                    .connect(depositReporter)
                    .reportDeposits(reportId, depositIDs)
            )
                .to.emit(bascule, 'DepositsReported')
                .withArgs(reportId, maxNr);
        });
    });
});
