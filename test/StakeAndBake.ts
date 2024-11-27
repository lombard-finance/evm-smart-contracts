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
    let boringVaultDepositor: BoringVaultDepositor;
    let boringVault: BoringVaultMock;
    let accountant: AccountantMock;
    let teller: TellerMock;
    let lbtc: LBTCMock;

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
            [
                await lbtc.getAddress(),
            ],
            false
        );

        boringVault = await deployContract<BoringVaultMock>(
            'BoringVault',
            [],
            false
        );

        accountant = await deployContract<AccountantMock>(
            'Accountant',
            [],
            false
        );

        teller = await deployContract<TellerMock>(
            'Teller',
            [
                await boringVault.getAddress(),
                await accountant.getAddress(),
            ],
            false
        );

        boringVaultDepositor = await deployContract<BoringVaultDepositor>(
            'BoringVaultDepositor,
            [],
            false
        );

        await lbtc.changeTreasuryAddress(treasury.address);

        // mock minter for lbtc
        await lbtc.addMinter(deployer.address);

        // set deployer as claimer for lbtc
        await lbtc.addClaimer(deployer.address);

        // Initialize the permit module
        await lbtc.reinitialize();

        // Add LBTC as an asset to the teller
        await teller.addAsset(await lbtc.getAddress(), 46);

        // Add BoringVaultDepositor as a depositor on the StakeAndBake contract
        await stakeAndBake.addDepositor(await teller.getAddress(), await boringVaultDepositor.getAddress());

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
            const data = await signDepositBtcPayload(
                [signer1],
                [true],
                CHAIN_ID,
                args.recipient().address,
                args.amount,
                encode(['uint256'], [i * 2 + j]) // txid
            );
            const userSignature = await getFeeTypedMessage(
                args.recipient(),
                await lbtc.getAddress(),
                fee,
                snapshotTimestamp + 100
            );

            // set max fee
            await lbtc.setMintFee(max);

            const approval = getPayloadForAction(
                [fee, snapshotTimestamp + 100],
                'feeApproval'
            );

            // create permit payload
            const deadline = timestamp + 100;
            const { v, r, s } = await generatePermitSignature(
                lbtc,
                signer1,
                await boringVault.getAddress(),
                value,
                deadline,
                chainId,
                0
            );

            const permitPayload = encode([value], [deadline], [v], [r], [s]);

            // make a deposit payload for the boringvault
            const depositPayload = encode([await lbtc.getAddress()], [value]);

            await expect(
                stakeAndBake.StakeAndBake(
                    await teller.getAddress(),
                    permitPayload,
                    depositPayload,
                    data.payload,
                    data.proof,
                    approval,
                    userSignature
                )
            )
                .to.emit(lbtc, 'Transfer')
                .withArgs(ethers.ZeroAddress, signer1.address, value)
                .to.emit(lbtc, 'Transfer')
                .withArgs(signer1.address, await boringVault.getAddress(), value)
                .to.emit(boringVault, 'Transfer')
                .withArgs(ethers.ZeroAddress, signer1.address, value - 46);
        });
    });
});
