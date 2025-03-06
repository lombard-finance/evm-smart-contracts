import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
    deployContract,
    getSignersWithPrivateKeys,
    Signer,
    init,
} from './helpers';
import { IBCVoucher, LBTCMock } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';

describe('IBCVoucher', function () {
    let deployer: Signer,
        signer1: Signer,
        signer2: Signer,
        signer3: Signer,
        pauser: Signer,
        treasury: Signer;
    let ibcVoucher: StakeAndBake;
    let lbtc: LBTCMock;
    let snapshot: SnapshotRestorer;
    let snapshotTimestamp: number;
    const fee = 10;
    const amount = 100;

    before(async function () {
        [deployer, signer1, signer2, signer3, pauser, treasury] =
            await getSignersWithPrivateKeys();

        const burnCommission = 1000;
        const result = await init(
            burnCommission,
            treasury.address,
            deployer.address
        );
        lbtc = result.lbtc;

        ibcVoucher = await deployContract<IBCVoucher>('IBCVoucher', [
            await lbtc.getAddress(),
            deployer.address,
            fee,
            treasury.address,
        ]);

        // set deployer as minter
        await lbtc.addMinter(deployer.address);

        // Initialize the permit module
        await lbtc.reinitialize();

        await ibcVoucher.grantRole(
            await ibcVoucher.RELAYER_ROLE(),
            deployer.address
        );

        // Give signer1 relayer role
        await ibcVoucher.grantRole(
            await ibcVoucher.RELAYER_ROLE(),
            signer1.address
        );

        // Give signer1 operator role
        await ibcVoucher.grantRole(
            await ibcVoucher.OPERATOR_ROLE(),
            signer1.address
        );

        // IBC Voucher needs to be minter
        await lbtc.addMinter(await ibcVoucher.getAddress());

        snapshot = await takeSnapshot();
        snapshotTimestamp = (await ethers.provider.getBlock('latest'))!
            .timestamp;
    });

    afterEach(async function () {
        // clean the state after each test
        await snapshot.restore();
    });

    describe('Setters', function () {
        it('should allow admin to set treasury', async function () {
            await expect(ibcVoucher.setTreasuryAddress(signer2.address))
                .to.emit(ibcVoucher, 'TreasuryUpdated')
                .withArgs(signer2.address);
        });

        it('should not allow anyone else to set treasury', async function () {
            await expect(
                ibcVoucher.connect(signer1).setTreasuryAddress(signer2.address)
            ).to.be.reverted;
        });

        it('should allow admin to set fee', async function () {
            await expect(ibcVoucher.setFee(200))
                .to.emit(ibcVoucher, 'FeeUpdated')
                .withArgs(200);
        });

        it('should not allow anyone else to set fee', async function () {
            await expect(ibcVoucher.connect(signer1).setFee(200)).to.be
                .reverted;
        });
    });

    describe('Wrapping', function () {
        beforeEach(async function () {
            await expect(
                lbtc['mint(address, uint256)'](signer1.address, amount)
            );
        });

        it('should allow a relayer to wrap LBTC', async function () {
            await lbtc
                .connect(signer1)
                .approve(await ibcVoucher.getAddress(), amount);
            expect(await ibcVoucher.connect(signer1).wrap(amount))
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    signer1.address,
                    await ibcVoucher.getAddress(),
                    amount
                )
                .to.emit(lbtc, 'Transfer')
                .withArgs(await ibcVoucher.getAddress(), treasury.address, fee)
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    await ibcVoucher.getAddress(),
                    ethers.ZeroAddress,
                    amount - fee
                )
                .to.emit(ibcVoucher, 'Transfer')
                .withArgs(ethers.ZeroAddress, signer1.address, amount - fee)
                .to.emit(ibcVoucher, 'VoucherMinted')
                .withArgs(signer1.address, signer1.address, fee, amount - fee);

            expect(await lbtc.balanceOf(signer1.address)).to.be.equal(0);
            expect(await ibcVoucher.balanceOf(signer1.address)).to.be.equal(
                amount - fee
            );
        });

        it('should allow a relayer to wrap LBTC to a given address', async function () {
            await lbtc
                .connect(signer1)
                .approve(await ibcVoucher.getAddress(), amount);
            expect(
                await ibcVoucher
                    .connect(signer1)
                    .wrapTo(signer2.address, amount)
            )
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    signer1.address,
                    await ibcVoucher.getAddress(),
                    amount
                )
                .to.emit(lbtc, 'Transfer')
                .withArgs(await ibcVoucher.getAddress(), treasury.address, fee)
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    await ibcVoucher.getAddress(),
                    ethers.ZeroAddress,
                    amount - fee
                )
                .to.emit(ibcVoucher, 'Transfer')
                .withArgs(ethers.ZeroAddress, signer2.address, amount - fee)
                .to.emit(ibcVoucher, 'VoucherMinted')
                .withArgs(signer1.address, signer2.address, fee, amount - fee);

            expect(await lbtc.balanceOf(signer1.address)).to.be.equal(0);
            expect(await ibcVoucher.balanceOf(signer2.address)).to.be.equal(
                amount - fee
            );
        });

        it('should not allow to wrap with amount equal to or below fee amount', async function () {
            await lbtc
                .connect(signer1)
                .approve(await ibcVoucher.getAddress(), fee);
            await expect(
                ibcVoucher.connect(signer1).wrap(fee)
            ).to.be.revertedWithCustomError(ibcVoucher, 'AmountTooLow');
        });

        it('should not allow to wrapTo with amount equal to or below fee amount', async function () {
            await lbtc
                .connect(signer1)
                .approve(await ibcVoucher.getAddress(), fee);
            await expect(
                ibcVoucher.connect(signer1).wrapTo(signer2.address, fee)
            ).to.be.revertedWithCustomError(ibcVoucher, 'AmountTooLow');
        });
    });

    describe('Spending', function () {
        beforeEach(async function () {
            await expect(
                lbtc['mint(address, uint256)'](signer1.address, amount + fee)
            );
            await lbtc
                .connect(signer1)
                .approve(await ibcVoucher.getAddress(), amount + fee);
            await ibcVoucher
                .connect(signer1)
                .wrapTo(signer2.address, amount + fee);
        });

        it('should allow anyone to spend voucher', async function () {
            await expect(ibcVoucher.connect(signer2).spend(amount))
                .to.emit(ibcVoucher, 'Transfer')
                .withArgs(signer2.address, ethers.ZeroAddress, amount)
                .to.emit(lbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, signer2.address, amount)
                .to.emit(ibcVoucher, 'VoucherSpent')
                .withArgs(signer2.address, signer2.address, amount);

            expect(await lbtc.balanceOf(signer2.address)).to.be.equal(amount);
            expect(await ibcVoucher.balanceOf(signer2.address)).to.be.equal(0);
        });

        it('should allow anyone to spend voucher to a given address', async function () {
            await expect(
                ibcVoucher.connect(signer2).spendTo(signer3.address, amount)
            )
                .to.emit(ibcVoucher, 'Transfer')
                .withArgs(signer2.address, ethers.ZeroAddress, amount)
                .to.emit(lbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, signer3.address, amount)
                .to.emit(ibcVoucher, 'VoucherSpent')
                .withArgs(signer2.address, signer3.address, amount);

            expect(await lbtc.balanceOf(signer3.address)).to.be.equal(amount);
            expect(await ibcVoucher.balanceOf(signer2.address)).to.be.equal(0);
        });

        it('should allow relayer to spendFrom voucher', async function () {
            await expect(
                ibcVoucher.connect(signer1).spendFrom(signer2.address, amount)
            )
                .to.emit(ibcVoucher, 'Transfer')
                .withArgs(signer2.address, ethers.ZeroAddress, amount)
                .to.emit(lbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, signer2.address, amount)
                .to.emit(ibcVoucher, 'VoucherSpent')
                .withArgs(signer2.address, signer2.address, amount);

            expect(await lbtc.balanceOf(signer2.address)).to.be.equal(amount);
            expect(await ibcVoucher.balanceOf(signer2.address)).to.be.equal(0);
        });

        it('should allow relayer to spendFromTo voucher', async function () {
            await expect(
                ibcVoucher
                    .connect(signer1)
                    .spendFromTo(signer2.address, signer3.address, amount)
            )
                .to.emit(ibcVoucher, 'Transfer')
                .withArgs(signer2.address, ethers.ZeroAddress, amount)
                .to.emit(lbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, signer3.address, amount)
                .to.emit(ibcVoucher, 'VoucherSpent')
                .withArgs(signer2.address, signer3.address, amount);

            expect(await lbtc.balanceOf(signer3.address)).to.be.equal(amount);
            expect(await ibcVoucher.balanceOf(signer2.address)).to.be.equal(0);
        });
    });

    describe('Access control', function () {
        beforeEach(async function () {
            await expect(
                lbtc['mint(address, uint256)'](signer2.address, amount)
            );
            await expect(
                lbtc['mint(address, uint256)'](signer1.address, amount + fee)
            );
            await lbtc
                .connect(signer1)
                .approve(await ibcVoucher.getAddress(), amount + fee);
            await expect(
                ibcVoucher
                    .connect(signer1)
                    .wrapTo(signer2.address, amount + fee)
            )
                .to.emit(ibcVoucher, 'VoucherMinted')
                .withArgs(signer1.address, signer2.address, fee, amount);

            expect(await lbtc.balanceOf(signer2.address)).to.be.equal(amount);
            expect(await ibcVoucher.balanceOf(signer2.address)).to.be.equal(
                amount
            );
        });

        it('should not allow just anyone to wrap LBTC', async function () {
            await expect(
                ibcVoucher.connect(signer2).wrap(amount)
            ).to.be.revertedWithCustomError(
                ibcVoucher,
                'AccessControlUnauthorizedAccount'
            );
        });

        it('should not allow just anyone to wrap LBTC to a given address', async function () {
            await expect(
                ibcVoucher.connect(signer2).wrapTo(signer1.address, amount)
            ).to.be.revertedWithCustomError(
                ibcVoucher,
                'AccessControlUnauthorizedAccount'
            );
        });

        it('should not allow just anyone to spendFrom LBTC', async function () {
            await expect(
                ibcVoucher.connect(signer2).spendFrom(signer2.address, amount)
            ).to.be.revertedWithCustomError(
                ibcVoucher,
                'AccessControlUnauthorizedAccount'
            );
        });

        it('should not allow just anyone to spendFromTo LBTC', async function () {
            await expect(
                ibcVoucher
                    .connect(signer2)
                    .spendFromTo(signer2.address, signer1.address, amount)
            ).to.be.revertedWithCustomError(
                ibcVoucher,
                'AccessControlUnauthorizedAccount'
            );
        });
    });

    describe('Pausing', function () {
        beforeEach(async function () {
            await expect(
                lbtc['mint(address, uint256)'](deployer.address, amount)
            );
            await lbtc.approve(await ibcVoucher.getAddress(), amount);
            await ibcVoucher.grantRole(
                await ibcVoucher.PAUSER_ROLE(),
                deployer.address
            );
            await ibcVoucher.pause();
        });

        it('should disallow `wrap` when paused', async function () {
            await expect(ibcVoucher.wrap(amount)).to.be.revertedWithCustomError(
                ibcVoucher,
                'EnforcedPause'
            );
        });

        it('should disallow `wrapTo` when paused', async function () {
            await expect(
                ibcVoucher.wrapTo(signer2.address, amount)
            ).to.be.revertedWithCustomError(ibcVoucher, 'EnforcedPause');
        });

        it('should disallow `spend` when paused', async function () {
            await expect(
                ibcVoucher.spend(amount)
            ).to.be.revertedWithCustomError(ibcVoucher, 'EnforcedPause');
        });

        it('should disallow `spendTo` when paused', async function () {
            await expect(
                ibcVoucher.spendTo(signer2.address, amount)
            ).to.be.revertedWithCustomError(ibcVoucher, 'EnforcedPause');
        });
    });
});
