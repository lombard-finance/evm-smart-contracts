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
import { StakeAndBake, BoringVaultDepositor, LBTCMock, BoringVaultMock, AccountantMock, TellerMock } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';

describe('StakeAndBake', function () {
    let deployer: Signer,
        signer1: Signer,
        signer2: Signer,
        signer3: Signer,
        treasury: Signer,
        reporter: Signer,
        admin: Signer,
        pauser: Signer;
    let stakeAndBake: StakeAndBake;
    let tellerWithMultiAssetSupportDepositor: TellerWithMultiAssetSupportDepositor;
    let teller: TellerWithMultiAssetSupportMock;
    let lbtc: LBTCMock;
    let snapshot: SnapshotRestorer;
    let snapshotTimestamp: number;

    before(async function () {
        [
            deployer,
            signer1,
            signer2,
            signer3,
            treasury,
            admin,
            pauser,
            reporter,
        ] = await getSignersWithPrivateKeys();

        const burnCommission = 1000;
        const result = await init(burnCommission, deployer.address);
        lbtc = result.lbtc;

        stakeAndBake = await deployContract<StakeAndBake>(
            'StakeAndBake',
            [await lbtc.getAddress(), deployer.address],
        );

        teller = await deployContract<TellerWithMultiAssetSupportMock>(
            'TellerWithMultiAssetSupportMock',
            [],
            false
        );

        tellerWithMultiAssetSupportDepositor = await deployContract<TellerWithMultiAssetSupportDepositor>(
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
        await stakeAndBake.addDepositor(await teller.getAddress(), await tellerWithMultiAssetSupportDepositor.getAddress());

        snapshot = await takeSnapshot();
        snapshotTimestamp = (await ethers.provider.getBlock('latest'))!
            .timestamp;
    });

    afterEach(async function () {
        // clean the state after each test
        await snapshot.restore();
    });

    describe('Stake and Bake', function () {
        it('should stake and bake properly with the correct setup', async function () {
            const value = 10001;
            const fee = 1;
            const data = await signDepositBtcPayload(
                [signer1],
                [true],
                CHAIN_ID,
                signer2.address,
                value,
                encode(['uint256'], [0]) // txid
            );
            const userSignature = await getFeeTypedMessage(
                signer2,
                await lbtc.getAddress(),
                fee,
                snapshotTimestamp + 100
            );

            // set max fee
            await lbtc.setMintFee(fee);

            const approval = getPayloadForAction(
                [fee, snapshotTimestamp + 100],
                'feeApproval'
            );

            // create permit payload
            const block = await ethers.provider.getBlock('latest');
            const timestamp = block!.timestamp;
            const deadline = timestamp + 100;
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const depositValue = 5000;
            const { v, r, s } = await generatePermitSignature(
                lbtc,
                signer2,
                await tellerWithMultiAssetSupportDepositor.getAddress(),
                depositValue,
                deadline,
                chainId,
                0
            );

            const permitPayload = encode(['uint256', 'uint256', 'uint8', 'uint256', 'uint256'], [depositValue, deadline, v, r, s]);

            // make a deposit payload for the boringvault
            const depositPayload = encode(['address', 'address', 'uint256'], [signer2.address, await lbtc.getAddress(), depositValue]);

            await expect(
                stakeAndBake.stakeAndBake(
                    {
                        vault: await teller.getAddress(),
                        owner: signer2.address,
                        permitPayload: permitPayload,
                        depositPayload: depositPayload,
                        mintPayload: data.payload,
                        proof: data.proof,
                        feePayload: approval,
                        userSignature: userSignature
                    }
                )
            )
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    ethers.ZeroAddress, 
                    signer2.address, 
                    value - fee
                )
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
    });
});
