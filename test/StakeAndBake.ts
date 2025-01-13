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
        operator: Signer,
        treasury: Signer;
    let stakeAndBake: StakeAndBake;
    let tellerWithMultiAssetSupportDepositor: TellerWithMultiAssetSupportDepositor;
    let teller: TellerWithMultiAssetSupportMock;
    let lbtc: LBTCMock;
    let snapshot: SnapshotRestorer;
    let snapshotTimestamp: number;

    before(async function () {
        [deployer, signer1, signer2, signer3, operator, treasury] =
            await getSignersWithPrivateKeys();

        const burnCommission = 1000;
        const result = await init(
            burnCommission,
            treasury.address,
            deployer.address
        );
        lbtc = result.lbtc;

        stakeAndBake = await deployContract<StakeAndBake>('StakeAndBake', [
            await lbtc.getAddress(),
            deployer.address,
            operator.address,
            1,
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

        // mock minter for lbtc
        await lbtc.addMinter(deployer.address);

        // set stake and bake as claimer for lbtc
        await lbtc.addClaimer(await stakeAndBake.getAddress());

        // set deployer as operator
        await lbtc.transferOperatorRole(deployer.address);

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
        const value = 10001;
        const fee = 1;
        const depositValue = 10000;

        before(async function () {
            data = await signDepositBtcPayload(
                [signer1],
                [true],
                CHAIN_ID,
                signer2.address,
                value,
                encode(['uint256'], [0]) // txid
            );

            // create permit payload
            const block = await ethers.provider.getBlock('latest');
            const timestamp = block!.timestamp;
            const deadline = timestamp + 100;
            const chainId = (await ethers.provider.getNetwork()).chainId;
            const { v, r, s } = await generatePermitSignature(
                lbtc,
                signer2,
                await stakeAndBake.getAddress(),
                value,
                deadline,
                chainId,
                0
            );

            permitPayload = encode(
                ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
                [value, deadline, v, r, s]
            );

            // make a deposit payload for the boringvault
            depositPayload = encode(
                ['address', 'uint256'],
                [await lbtc.getAddress(), depositValue]
            );
        });

        it('should allow owner to change operator', async function () {
            await expect(stakeAndBake.transferOperatorRole(signer2.address))
                .to.emit(stakeAndBake, 'OperatorRoleTransferred')
                .withArgs(operator.address, signer2.address);
        });

        it('should not allow anyone else to change operator', async function () {
            await expect(
                stakeAndBake
                    .connect(signer2)
                    .transferOperatorRole(signer2.address)
            ).to.be.reverted;
        });

        it('should allow operator to change the fee', async function () {
            await expect(stakeAndBake.connect(operator).setFee(2))
                .to.emit(stakeAndBake, 'FeeChanged')
                .withArgs(1, 2);
        });

        it('should not allow anyone else to change the fee', async function () {
            await expect(stakeAndBake.setFee(2)).to.be.reverted;
        });

        it('should allow admin to add a depositor', async function () {
            await expect(
                stakeAndBake.addDepositor(signer1.address, signer2.address)
            )
                .to.emit(stakeAndBake, 'DepositorAdded')
                .withArgs(signer1.address, signer2.address);
        });

        it('should not allow anyone else to add a depositor', async function () {
            await expect(
                stakeAndBake
                    .connect(signer1)
                    .addDepositor(signer1.address, signer2.address)
            ).to.be.reverted;
        });

        it('should allow admin to remove a depositor', async function () {
            await expect(stakeAndBake.removeDepositor(signer1.address))
                .to.emit(stakeAndBake, 'DepositorRemoved')
                .withArgs(signer1.address);
        });

        it('should not allow anyone else to remove a depositor', async function () {
            await expect(
                stakeAndBake.connect(signer1).removeDepositor(signer1.address)
            ).to.be.reverted;
        });

        it('should stake and bake properly with the correct setup', async function () {
            await expect(
                stakeAndBake.stakeAndBake({
                    vault: await teller.getAddress(),
                    permitPayload: permitPayload,
                    depositPayload: depositPayload,
                    mintPayload: data.payload,
                    proof: data.proof,
                })
            )
                .to.emit(lbtc, 'MintProofConsumed')
                .withArgs(signer2.address, data.payloadHash, data.payload)
                .to.emit(lbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, signer2.address, value)
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    signer2.address,
                    await stakeAndBake.getAddress(),
                    value
                )
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    await stakeAndBake.getAddress(),
                    treasury.address,
                    fee
                )
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    await stakeAndBake.getAddress(),
                    await tellerWithMultiAssetSupportDepositor.getAddress(),
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

        it('should work with allowance', async function () {
            await lbtc
                .connect(signer2)
                .approve(await stakeAndBake.getAddress(), value);
            await lbtc.setMintFee(fee);
            await expect(
                stakeAndBake.stakeAndBake({
                    vault: await teller.getAddress(),
                    permitPayload: permitPayload,
                    depositPayload: depositPayload,
                    mintPayload: data.payload,
                    proof: data.proof,
                })
            )
                .to.emit(lbtc, 'MintProofConsumed')
                .withArgs(signer2.address, data.payloadHash, data.payload)
                .to.emit(lbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, signer2.address, value)
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    signer2.address,
                    await stakeAndBake.getAddress(),
                    value
                )
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    await stakeAndBake.getAddress(),
                    treasury.address,
                    fee
                )
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    await stakeAndBake.getAddress(),
                    await tellerWithMultiAssetSupportDepositor.getAddress(),
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
                await stakeAndBake.getAddress(),
                value,
                deadline,
                chainId,
                0
            );

            const permitPayload2 = encode(
                ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
                [value, deadline, v, r, s]
            );

            // make a deposit payload for the boringvault
            const depositPayload2 = encode(
                ['address', 'uint256'],
                [await lbtc.getAddress(), depositValue]
            );
            await expect(
                stakeAndBake.batchStakeAndBake([
                    {
                        vault: await teller.getAddress(),
                        permitPayload: permitPayload,
                        depositPayload: depositPayload,
                        mintPayload: data.payload,
                        proof: data.proof,
                    },
                    {
                        vault: await teller.getAddress(),
                        permitPayload: permitPayload2,
                        depositPayload: depositPayload2,
                        mintPayload: data2.payload,
                        proof: data2.proof,
                    },
                ])
            )
                .to.emit(lbtc, 'MintProofConsumed')
                .withArgs(signer2.address, data.payloadHash, data.payload)
                .to.emit(lbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, signer2.address, value)
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    signer2.address,
                    await stakeAndBake.getAddress(),
                    value
                )
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    await stakeAndBake.getAddress(),
                    treasury.address,
                    fee
                )
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    await stakeAndBake.getAddress(),
                    await tellerWithMultiAssetSupportDepositor.getAddress(),
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
                .to.emit(lbtc, 'MintProofConsumed')
                .withArgs(signer3.address, data2.payloadHash, data2.payload)
                .to.emit(lbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, signer3.address, value)
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    signer3.address,
                    await stakeAndBake.getAddress(),
                    value
                )
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    await stakeAndBake.getAddress(),
                    treasury.address,
                    fee
                )
                .to.emit(lbtc, 'Transfer')
                .withArgs(
                    await stakeAndBake.getAddress(),
                    await tellerWithMultiAssetSupportDepositor.getAddress(),
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

        it('should revert when an unknown depositor is invoked', async function () {
            await expect(
                stakeAndBake.removeDepositor(await teller.getAddress())
            )
                .to.emit(stakeAndBake, 'DepositorRemoved')
                .withArgs(await teller.getAddress());

            await expect(
                stakeAndBake.stakeAndBake({
                    vault: await teller.getAddress(),
                    permitPayload: permitPayload,
                    depositPayload: depositPayload,
                    mintPayload: data.payload,
                    proof: data.proof,
                })
            ).to.be.revertedWithCustomError(stakeAndBake, 'VaultNotFound');
        });

        it('should revert when remaining amount is zero', async function () {
            await stakeAndBake.connect(operator).setFee(10001);
            await expect(
                stakeAndBake.stakeAndBake({
                    vault: await teller.getAddress(),
                    permitPayload: permitPayload,
                    depositPayload: depositPayload,
                    mintPayload: data.payload,
                    proof: data.proof,
                })
            ).to.be.revertedWithCustomError(stakeAndBake, 'ZeroDepositAmount');
        });
    });
});
