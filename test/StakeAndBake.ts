import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
    deployContract,
    getSignersWithPrivateKeys,
    CHAIN_ID,
    getFeeTypedMessage,
    generatePermitSignature,
    NEW_VALSET,
    DEPOSIT_BTC_ACTION,
    encode,
    getPayloadForAction,
    signDepositBtcPayload,
    Signer,
    init,
} from './helpers';
import {
    StakeAndBake,
    BoringVaultDepositor,
    LBTCMock,
    BoringVaultMock,
    AccountantMock,
    TellerMock,
} from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';

describe('StakeAndBake', function () {
    let deployer: Signer,
        signer1: Signer,
        signer2: Signer,
        signer3: Signer,
        treasury: Signer;
    let stakeAndBake: StakeAndBake;
    let tellerWithMultiAssetSupportDepositor: TellerWithMultiAssetSupportDepositor;
    let teller: TellerWithMultiAssetSupportMock;
    let lbtc: LBTCMock;
    let snapshot: SnapshotRestorer;
    let snapshotTimestamp: number;

    before(async function () {
        [deployer, signer1, signer2, signer3, treasury] =
            await getSignersWithPrivateKeys();

        const burnCommission = 1000;
        const result = await init(burnCommission, deployer.address);
        lbtc = result.lbtc;

        stakeAndBake = await deployContract<StakeAndBake>('StakeAndBake', [
            await lbtc.getAddress(),
            deployer.address,
        ]);

        teller = await deployContract<TellerWithMultiAssetSupportMock>(
            'TellerWithMultiAssetSupportMock',
            [],
            false
        );

        tellerWithMultiAssetSupportDepositor =
            await deployContract<TellerWithMultiAssetSupportDepositor>(
                'TellerWithMultiAssetSupportDepositor',
                [],
                false
            );

        await lbtc.changeTreasuryAddress(treasury.address);

        // mock minter for lbtc
        await lbtc.addMinter(deployer.address);

        // set stake and bake as claimer for lbtc
        await lbtc.addClaimer(await stakeAndBake.getAddress());

        // Initialize the permit module
        await lbtc.reinitialize();

        // Add BoringVaultDepositor as a depositor on the StakeAndBake contract
        await expect(
            stakeAndBake.addDepositor(
                await teller.getAddress(),
                await tellerWithMultiAssetSupportDepositor.getAddress()
            )
        )
            .to.emit(stakeAndBake, 'DepositorAdded')
            .withArgs(
                await teller.getAddress(),
                await tellerWithMultiAssetSupportDepositor.getAddress()
            );

        snapshot = await takeSnapshot();
        snapshotTimestamp = (await ethers.provider.getBlock('latest'))!
            .timestamp;
    });

    afterEach(async function () {
        // clean the state after each test
        await snapshot.restore();
    });

    describe('Stake and Bake', function () {
        let data;
        let permitPayload;
        let depositPayload;
        let approval;
        let userSignature;
        const value = 10001;
        const fee = 1;
        const depositValue = 5000;

        before(async function () {
            data = await signDepositBtcPayload(
                [signer1],
                [true],
                CHAIN_ID,
                signer2.address,
                value,
                encode(['uint256'], [0]) // txid
            );
            userSignature = await getFeeTypedMessage(
                signer2,
                await lbtc.getAddress(),
                fee,
                snapshotTimestamp + 100
            );

            // set max fee
            await lbtc.setMintFee(fee);

            approval = getPayloadForAction(
                [fee, snapshotTimestamp + 100],
                'feeApproval'
            );

            // create permit payload
            const block = await ethers.provider.getBlock('latest');
            const timestamp = block!.timestamp;
            const deadline = timestamp + 100;
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const { v, r, s } = await generatePermitSignature(
                lbtc,
                signer2,
                await tellerWithMultiAssetSupportDepositor.getAddress(),
                depositValue,
                deadline,
                chainId,
                0
            );

            permitPayload = encode(
                ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
                [depositValue, deadline, v, r, s]
            );

            // make a deposit payload for the boringvault
            depositPayload = encode(
                ['address', 'address', 'uint256'],
                [signer2.address, await lbtc.getAddress(), depositValue]
            );
        });

        it('should stake and bake properly with the correct setup', async function () {
            await expect(
                stakeAndBake.stakeAndBake({
                    vault: await teller.getAddress(),
                    owner: signer2.address,
                    permitPayload: permitPayload,
                    depositPayload: depositPayload,
                    mintPayload: data.payload,
                    proof: data.proof,
                    feePayload: approval,
                    userSignature: userSignature,
                })
            )
                .to.emit(lbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, signer2.address, value - fee)
                .to.emit(lbtc, 'FeeCharged')
                .withArgs(fee, userSignature)
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    signer2.address,
                    await tellerWithMultiAssetSupportDepositor.getAddress(),
                    depositValue
                )
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    await tellerWithMultiAssetSupportDepositor.getAddress(),
                    await teller.getAddress(),
                    depositValue
                )
                .to.emit(teller, 'Transfer')
                .withArgs(
                    ethers.ZeroAddress,
                    await tellerWithMultiAssetSupportDepositor.getAddress(),
                    depositValue - 50
                )
                .to.emit(teller, 'Transfer')
                .withArgs(
                    await tellerWithMultiAssetSupportDepositor.getAddress(),
                    signer2.address,
                    depositValue - 50
                );
        });
        it('should batch stake and bake properly with the correct setup', async function () {
            // NB for some reason trying to do this in a loop and passing around arrays of parameters
            // makes the test fail, so i'm doing it the ugly way here
            const data2 = await signDepositBtcPayload(
                [signer1],
                [true],
                CHAIN_ID,
                signer3.address,
                value,
                encode(['uint256'], [0]) // txid
            );
            const userSignature2 = await getFeeTypedMessage(
                signer3,
                await lbtc.getAddress(),
                fee,
                snapshotTimestamp + 100
            );

            // set max fee
            await lbtc.setMintFee(fee);

            // create permit payload
            const block = await ethers.provider.getBlock('latest');
            const timestamp = block!.timestamp;
            const deadline = timestamp + 100;
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const { v, r, s } = await generatePermitSignature(
                lbtc,
                signer3,
                await tellerWithMultiAssetSupportDepositor.getAddress(),
                depositValue,
                deadline,
                chainId,
                0
            );

            const permitPayload2 = encode(
                ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
                [depositValue, deadline, v, r, s]
            );

            // make a deposit payload for the boringvault
            const depositPayload2 = encode(
                ['address', 'address', 'uint256'],
                [signer3.address, await lbtc.getAddress(), depositValue]
            );
            await expect(
                stakeAndBake.batchStakeAndBake([
                    {
                        vault: await teller.getAddress(),
                        owner: signer2.address,
                        permitPayload: permitPayload,
                        depositPayload: depositPayload,
                        mintPayload: data.payload,
                        proof: data.proof,
                        feePayload: approval,
                        userSignature: userSignature,
                    },
                    {
                        vault: await teller.getAddress(),
                        owner: signer3.address,
                        permitPayload: permitPayload2,
                        depositPayload: depositPayload2,
                        mintPayload: data2.payload,
                        proof: data2.proof,
                        feePayload: approval,
                        userSignature: userSignature2,
                    },
                ])
            )
                .to.emit(lbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, signer2.address, value - fee)
                .to.emit(lbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, signer3.address, value - fee)
                .to.emit(lbtc, 'FeeCharged')
                .withArgs(fee, userSignature)
                .to.emit(lbtc, 'FeeCharged')
                .withArgs(fee, userSignature2)
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    signer2.address,
                    await tellerWithMultiAssetSupportDepositor.getAddress(),
                    depositValue
                )
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    signer3.address,
                    await tellerWithMultiAssetSupportDepositor.getAddress(),
                    depositValue
                )
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    await tellerWithMultiAssetSupportDepositor.getAddress(),
                    await teller.getAddress(),
                    depositValue
                )
                .to.emit(teller, 'Transfer')
                .withArgs(
                    ethers.ZeroAddress,
                    await tellerWithMultiAssetSupportDepositor.getAddress(),
                    depositValue - 50
                )
                .to.emit(teller, 'Transfer')
                .withArgs(
                    await tellerWithMultiAssetSupportDepositor.getAddress(),
                    signer2.address,
                    depositValue - 50
                )
                .to.emit(teller, 'Transfer')
                .withArgs(
                    await tellerWithMultiAssetSupportDepositor.getAddress(),
                    signer3.address,
                    depositValue - 50
                );
        });
        it('should revert when an unknown depositor is invoked', async function () {
            await expect(
                stakeAndBake.removeDepositor(await teller.getAddress())
            )
                .to.emit(stakeAndBake, 'DepositorRemoved')
                .withArgs(await teller.getAddress());

            await expect(
                stakeAndBake.stakeAndBake({
                    vault: await teller.getAddress(),
                    owner: signer2.address,
                    permitPayload: permitPayload,
                    depositPayload: depositPayload,
                    mintPayload: data.payload,
                    proof: data.proof,
                    feePayload: approval,
                    userSignature: userSignature,
                })
            ).to.be.revertedWithCustomError(stakeAndBake, 'VaultNotFound');
        });
    });
});
