import {
    time,
    loadFixture,
} from '@nomicfoundation/hardhat-toolbox/network-helpers';
import { LombardTimeLock } from '../typechain-types';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { TxBuilder } from './helpers';

const MIN_DELAY = 10;
const VALUE = '1000';

describe('LombardTimeLock', function () {
    async function deployFixture() {
        const [owner, proposer, executor, admin, account1] =
            await ethers.getSigners();

        const TimeLock = await ethers.getContractFactory('LombardTimeLock');
        const timelock = await TimeLock.deploy(
            10,
            [proposer.address],
            [executor.address]
        );

        return { timelock, owner, proposer, executor, admin, account1 };
    }

    let tx = TxBuilder.new().setDelay(MIN_DELAY).setValue(VALUE),
        hash: string,
        creationTime: number;

    describe('basic tests', function () {
        it('Initial checks', async function () {
            const { timelock, proposer, executor } =
                await loadFixture(deployFixture);

            expect(
                await timelock.hasRole(
                    await timelock.PROPOSER_ROLE(),
                    proposer.address
                )
            ).to.be.true;
            expect(
                await timelock.hasRole(
                    await timelock.EXECUTOR_ROLE(),
                    executor.address
                )
            ).to.be.true;
            expect(await timelock.getMinDelay()).to.be.equal(MIN_DELAY);
        });

        it('Add tx to queue by not a proposer :: reverted', async () => {
            const { timelock, account1 } = await loadFixture(deployFixture);

            tx.setTarget(account1.address);

            await expect(
                timelock.connect(account1).schedule(...tx.scheduleArgs)
            )
                .to.be.revertedWithCustomError(
                    timelock,
                    'AccessControlUnauthorizedAccount'
                )
                .withArgs(account1.address, await timelock.PROPOSER_ROLE());
        });

        it('add tx with less than min offset', async () => {
            const { timelock, proposer, executor, account1 } =
                await loadFixture(deployFixture);

            tx.setDelay(MIN_DELAY - 1);
            await expect(
                timelock.connect(proposer).schedule(...tx.scheduleArgs)
            )
                .to.be.revertedWithCustomError(
                    timelock,
                    'TimelockInsufficientDelay'
                )
                .withArgs(MIN_DELAY - 1, MIN_DELAY);
        });
    });

    describe('add tx to queue and execute', function () {
        let timelock: LombardTimeLock,
            owner: HardhatEthersSigner,
            proposer: HardhatEthersSigner,
            executor: HardhatEthersSigner,
            admin: HardhatEthersSigner,
            account1: HardhatEthersSigner;

        before(async () => {
            // @ts-ignore
            [timelock, owner, proposer, executor, admin, account1] =
                Object.values(await loadFixture(deployFixture));
        });

        it('publish tx', async () => {
            tx.setDelay(MIN_DELAY + 1);

            hash = await timelock.hashOperation(...tx.hashOperationArgs);
            await expect(
                timelock.connect(proposer).schedule(...tx.scheduleArgs)
            )
                .to.emit(timelock, 'CallScheduled')
                .withArgs(hash, '0', ...tx.eventArgs);
            creationTime = await time.latest();
        });

        it('get status after creation', async () => {
            expect(await timelock.isOperationPending(hash)).to.be.true;
            expect(await timelock.isOperationReady(hash)).to.be.false;
            expect(await timelock.isOperationDone(hash)).to.be.false;
        });

        it('execute instantly :: period not passed', async () => {
            await expect(
                timelock.connect(executor).execute(...tx.hashOperationArgs)
            )
                .to.be.revertedWithCustomError(
                    timelock,
                    'TimelockUnexpectedOperationState'
                )
                .withArgs(hash, ethers.zeroPadValue('0x04', 32));
        });

        it('execute by not an owner instantly :: not owner', async () => {
            await expect(
                timelock.connect(account1).execute(...tx.hashOperationArgs)
            )
                .to.be.revertedWithCustomError(
                    timelock,
                    'AccessControlUnauthorizedAccount'
                )
                .withArgs(account1.address, await timelock.EXECUTOR_ROLE());
        });

        it('get timestamp by args', async () => {
            expect(await timelock.getTimestamp(hash)).to.be.eq(
                creationTime + MIN_DELAY + 1
            );
        });

        it('isReady when execution time is come', async () => {
            await time.increaseTo(await timelock.getTimestamp(hash));
            expect(await timelock.isOperationReady(hash)).to.be.true;
        });

        it('execute before timelock is funded :: underlying transaction reverted', async () => {
            // fund the contract to execute tx
            await expect(
                timelock.connect(executor).execute(...tx.hashOperationArgs)
            ).to.be.revertedWithCustomError(timelock, 'FailedInnerCall');
        });

        it('execute by not an owner when ready:: not owner', async () => {
            await owner.sendTransaction({
                from: owner.address,
                to: await timelock.getAddress(),
                value: VALUE,
            });
            await expect(
                timelock.connect(account1).execute(...tx.hashOperationArgs)
            )
                .to.be.revertedWithCustomError(
                    timelock,
                    'AccessControlUnauthorizedAccount'
                )
                .withArgs(account1.address, await timelock.EXECUTOR_ROLE());
        });

        it('execute when delay passed :: success', async () => {
            // fund the contract to execute tx
            expect(
                await timelock
                    .connect(executor)
                    .execute(...tx.hashOperationArgs)
            )
                .to.emit(timelock, 'CallExecuted')
                .withArgs(...tx.scheduleArgs);
            expect(await timelock.isOperationDone(hash)).to.be.true;
        });

        it('repeat execution :: not ready', async () => {
            await expect(
                timelock.connect(executor).execute(...tx.hashOperationArgs)
            )
                .to.be.revertedWithCustomError(
                    timelock,
                    'TimelockUnexpectedOperationState'
                )
                .withArgs(hash, ethers.zeroPadValue('0x04', 32));
        });
    });

    describe('Add replace proposer', function () {
        it('add new proposer', async () => {
            const { timelock, proposer, executor, owner } =
                await loadFixture(deployFixture);

            const grantRoleData = await timelock.grantRole.populateTransaction(
                await timelock.PROPOSER_ROLE(),
                owner.address
            );

            const tx = TxBuilder.new()
                .setTarget(grantRoleData.to)
                .setDelay(MIN_DELAY)
                .setData(grantRoleData.data);

            hash = await timelock.hashOperation(...tx.hashOperationArgs);
            await timelock.connect(proposer).schedule(...tx.scheduleArgs);

            await time.increaseTo(await timelock.getTimestamp(hash));

            await expect(
                timelock.connect(executor).execute(...tx.hashOperationArgs)
            )
                .to.emit(timelock, 'RoleGranted')
                .withArgs(
                    await timelock.PROPOSER_ROLE(),
                    owner.address,
                    await timelock.getAddress()
                );
        });
    });
});
