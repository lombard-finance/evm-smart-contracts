import {
    LBTCMock,
    Bascule,
    Consortium,
    Bridge,
    TokenPoolAdapter,
    CCIPRouterMock,
    TokenPool,
} from '../typechain-types';
import {
    takeSnapshot,
    SnapshotRestorer,
} from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
    getSignersWithPrivateKeys,
    deployContract,
    CHAIN_ID,
    getPayloadForAction,
    NEW_VALSET,
    DEPOSIT_BRIDGE_ACTION,
    encode,
    signDepositBridgePayload,
    Signer,
} from './helpers';
import { ethers } from 'hardhat';
import { expect } from 'chai';
import { LBTCTokenPool } from '../typechain-types/contracts/bridge/adapters/TokenPool.sol';

describe('Bridge', function () {
    let deployer: Signer,
        signer1: Signer,
        signer2: Signer,
        signer3: Signer,
        treasury: Signer,
        reporter: Signer,
        admin: Signer,
        pauser: Signer;
    let lbtcSource: LBTCMock;
    let lbtcDestination: LBTCMock;
    let consortium: Consortium;
    let bascule: Bascule;
    let bridgeSource: Bridge;
    let bridgeDestination: Bridge;
    let snapshot: SnapshotRestorer;

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

        // for both chains
        consortium = await deployContract<Consortium>('Consortium', [
            deployer.address,
        ]);
        await consortium.setInitalValidatorSet(
            getPayloadForAction([1, [signer1.publicKey], [1], 1, 1], NEW_VALSET)
        );

        // chain 1
        lbtcSource = await deployContract<LBTCMock>('LBTCMock', [
            await consortium.getAddress(),
            100,
            deployer.address,
        ]);
        bridgeSource = await deployContract<Bridge>('Bridge', [
            await lbtcSource.getAddress(),
            treasury.address,
            deployer.address,
        ]);
        bascule = await deployContract<Bascule>(
            'Bascule',
            [
                admin.address,
                pauser.address,
                reporter.address,
                await lbtcSource.getAddress(),
                100,
            ],
            false
        );
        await lbtcSource.changeBridge(await bridgeSource.getAddress());

        // chain 2
        lbtcDestination = await deployContract<LBTCMock>('LBTCMock', [
            await consortium.getAddress(),
            100,
            deployer.address,
        ]);
        bridgeDestination = await deployContract<Bridge>('Bridge', [
            await lbtcDestination.getAddress(),
            treasury.address,
            deployer.address,
        ]);
        await lbtcDestination.changeBridge(
            await bridgeDestination.getAddress()
        );

        await lbtcSource.changeTreasuryAddress(treasury.address);
        await lbtcDestination.changeTreasuryAddress(treasury.address);

        await lbtcSource.addMinter(await bridgeSource.getAddress());
        await lbtcDestination.addMinter(await bridgeDestination.getAddress());

        await bridgeSource.changeConsortium(await consortium.getAddress());
        await bridgeDestination.changeConsortium(await consortium.getAddress());

        snapshot = await takeSnapshot();
    });

    afterEach(async function () {
        await snapshot.restore();
    });

    describe('Setters and Getters', () => {
        it('should return owner', async function () {
            expect(await bridgeSource.owner()).to.equal(deployer.address);
        });

        it('getDepositRelativeCommission', async function () {
            expect(
                await bridgeSource.getDepositRelativeCommission(
                    ethers.zeroPadValue('0x', 32)
                )
            ).to.equal(0);
        });

        it('getDepositAbsoluteCommission', async function () {
            expect(
                await bridgeSource.getDepositAbsoluteCommission(
                    ethers.zeroPadValue('0x', 32)
                )
            ).to.equal(0);
        });
    });

    describe('Actions/Flows', function () {
        const absoluteFee = 100n;

        beforeEach(async function () {
            await lbtcSource.mintTo(signer1.address, 10000n);
            await bridgeSource.addDestination(
                CHAIN_ID,
                encode(['address'], [await bridgeDestination.getAddress()]),
                1000, // 10%
                0,
                ethers.ZeroAddress,
                true
            );
            await bridgeDestination.addDestination(
                CHAIN_ID,
                encode(['address'], [await bridgeSource.getAddress()]),
                0, // 0%
                absoluteFee,
                ethers.ZeroAddress,
                true
            );
        });

        it('full flow', async () => {
            let amount = 10000n;
            let fee = amount / 10n;

            let amountWithoutFee = amount - fee;
            let receiver = signer2.address;

            let payload = getPayloadForAction(
                [
                    CHAIN_ID,
                    encode(['address'], [await bridgeSource.getAddress()]),
                    CHAIN_ID,
                    encode(['address'], [await bridgeDestination.getAddress()]),
                    encode(['address'], [receiver]),
                    amountWithoutFee,
                    ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [0]),
                ],
                DEPOSIT_BRIDGE_ACTION
            );

            await lbtcSource
                .connect(signer1)
                .approve(await bridgeSource.getAddress(), amount);
            await expect(
                bridgeSource
                    .connect(signer1)
                    .deposit(CHAIN_ID, encode(['address'], [receiver]), amount)
            )
                .to.emit(bridgeSource, 'DepositToBridge')
                .withArgs(
                    signer1.address,
                    encode(['address'], [receiver]),
                    ethers.sha256(payload),
                    payload
                );

            expect(await lbtcSource.balanceOf(signer1.address)).to.be.equal(0);
            expect(await lbtcSource.balanceOf(treasury.address)).to.be.equal(
                fee
            );
            expect((await lbtcSource.totalSupply()).toString()).to.be.equal(
                fee
            );

            expect(
                await lbtcDestination.balanceOf(signer2.address)
            ).to.be.equal(0);
            expect(await lbtcDestination.totalSupply()).to.be.equal(0);

            const data1 = await signDepositBridgePayload(
                [signer1],
                [true],
                CHAIN_ID,
                await bridgeSource.getAddress(),
                CHAIN_ID,
                await bridgeDestination.getAddress(),
                receiver,
                amountWithoutFee
            );

            await expect(
                bridgeDestination
                    .connect(signer2)
                    .authNotary(data1.payload, data1.proof)
            )
                .to.emit(bridgeDestination, 'PayloadNotarized')
                .withArgs(receiver, ethers.sha256(data1.payload));

            await expect(
                bridgeDestination.connect(signer2).withdraw(data1.payload)
            )
                .to.emit(bridgeDestination, 'WithdrawFromBridge')
                .withArgs(
                    receiver,
                    ethers.sha256(data1.payload),
                    data1.payload,
                    amountWithoutFee
                );

            expect(
                (await lbtcDestination.totalSupply()).toString()
            ).to.be.equal(amount - fee);
            expect(
                (await lbtcDestination.balanceOf(signer2.address)).toString()
            ).to.be.equal(amountWithoutFee);

            // bridge back

            amount = amountWithoutFee;
            fee = absoluteFee;
            amountWithoutFee = amount - fee;
            receiver = signer1.address;

            payload = getPayloadForAction(
                [
                    CHAIN_ID,
                    encode(['address'], [await bridgeDestination.getAddress()]),
                    CHAIN_ID,
                    encode(['address'], [await bridgeSource.getAddress()]),
                    encode(['address'], [receiver]),
                    amountWithoutFee,
                    ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [0]),
                ],
                DEPOSIT_BRIDGE_ACTION
            );

            await lbtcDestination
                .connect(signer2)
                .approve(await bridgeDestination.getAddress(), amount);
            await expect(
                bridgeDestination
                    .connect(signer2)
                    .deposit(CHAIN_ID, encode(['address'], [receiver]), amount)
            )
                .to.emit(bridgeDestination, 'DepositToBridge')
                .withArgs(
                    signer2.address,
                    encode(['address'], [receiver]),
                    ethers.sha256(payload),
                    payload
                );

            expect(
                await lbtcDestination.balanceOf(signer2.address)
            ).to.be.equal(0);
            expect(
                await lbtcDestination.balanceOf(treasury.address)
            ).to.be.equal(fee);
            expect(await lbtcDestination.totalSupply()).to.be.equal(fee);

            const data2 = await signDepositBridgePayload(
                [signer1],
                [true],
                CHAIN_ID,
                await bridgeDestination.getAddress(),
                CHAIN_ID,
                await bridgeSource.getAddress(),
                receiver,
                amountWithoutFee
            );

            await expect(
                bridgeSource
                    .connect(signer2)
                    .authNotary(data2.payload, data2.proof)
            )
                .to.emit(bridgeSource, 'PayloadNotarized')
                .withArgs(receiver, ethers.sha256(data2.payload));

            await expect(bridgeSource.connect(signer2).withdraw(data2.payload))
                .to.emit(bridgeSource, 'WithdrawFromBridge')
                .withArgs(
                    receiver,
                    ethers.sha256(data2.payload),
                    data2.payload,
                    amountWithoutFee
                );
        });

        describe('With Chainlink Adapter', function () {
            let routerSource: CCIPRouterMock;
            let routerDestination: CCIPRouterMock;
            let chainlinkAdapterSource: TokenPoolAdapter;
            let chainlinkAdapterDestination: TokenPoolAdapter;
            let tokenPoolSource: TokenPool;
            let tokenPoolDestination: TokenPool;

            beforeEach(async function () {
                /// configure source
                routerSource = await deployContract<CCIPRouterMock>(
                    'CCIPRouterMock',
                    [],
                    false
                );
                chainlinkAdapterSource = await deployContract<TokenPoolAdapter>(
                    'TokenPoolAdapter',
                    [
                        await routerSource.getAddress(),
                        await lbtcSource.getAddress(),
                        [], // no allowlist
                        await routerSource.getAddress(), // will do work of rmn as well
                        await bridgeSource.getAddress(),
                    ],
                    false
                );
                tokenPoolSource = chainlinkAdapterSource;

                await chainlinkAdapterSource.changeBridge(
                    await bridgeSource.getAddress()
                );

                /// configure destination
                routerDestination = await deployContract<CCIPRouterMock>(
                    'CCIPRouterMock',
                    [],
                    false
                );
                chainlinkAdapterDestination =
                    await deployContract<TokenPoolAdapter>(
                        'TokenPoolAdapter',
                        [
                            await routerDestination.getAddress(),
                            await lbtcDestination.getAddress(),
                            [], // no allowlist
                            await routerDestination.getAddress(), // will do work of rmn as well
                            await bridgeDestination.getAddress(),
                        ],
                        false
                    );
                tokenPoolDestination = chainlinkAdapterDestination;

                await chainlinkAdapterDestination.changeBridge(
                    await bridgeDestination.getAddress()
                );

                /// configure bridges
                await bridgeSource.changeAdapter(
                    CHAIN_ID,
                    await chainlinkAdapterSource.getAddress()
                );
                await bridgeDestination.changeAdapter(
                    CHAIN_ID,
                    await chainlinkAdapterDestination.getAddress()
                );

                /// configure router
                await routerSource.setTokenPool(
                    await tokenPoolSource.getAddress()
                );
                await routerDestination.setTokenPool(
                    await tokenPoolDestination.getAddress()
                );
                await routerSource.setDestinationRouter(
                    await routerDestination.getAddress()
                );
                await routerDestination.setDestinationRouter(
                    await routerSource.getAddress()
                );

                /// set token pools
                await tokenPoolSource.applyChainUpdates([
                    {
                        remoteChainSelector: CHAIN_ID,
                        allowed: true,
                        remotePoolAddress:
                            await tokenPoolDestination.getAddress(),
                        remoteTokenAddress: await lbtcDestination.getAddress(),
                        inboundRateLimiterConfig: {
                            isEnabled: false,
                            rate: 0,
                            capacity: 0,
                        },
                        outboundRateLimiterConfig: {
                            isEnabled: false,
                            rate: 0,
                            capacity: 0,
                        },
                    },
                ]);

                await tokenPoolDestination.applyChainUpdates([
                    {
                        remoteChainSelector: CHAIN_ID,
                        allowed: true,
                        remotePoolAddress: await tokenPoolSource.getAddress(),
                        remoteTokenAddress: await lbtcSource.getAddress(),
                        inboundRateLimiterConfig: {
                            isEnabled: false,
                            rate: 0,
                            capacity: 0,
                        },
                        outboundRateLimiterConfig: {
                            isEnabled: false,
                            rate: 0,
                            capacity: 0,
                        },
                    },
                ]);

                await tokenPoolSource.setRemotePool(
                    CHAIN_ID,
                    ethers.zeroPadValue(
                        await tokenPoolDestination.getAddress(),
                        32
                    )
                );
                await tokenPoolDestination.setRemotePool(
                    CHAIN_ID,
                    ethers.zeroPadValue(await tokenPoolSource.getAddress(), 32)
                );
            });

            it('should route message', async function () {
                let amount = 10000n;
                let fee = amount / 10n;

                let amountWithoutFee = amount - fee;
                let receiver = signer2.address;

                let data = await signDepositBridgePayload(
                    [signer1],
                    [true],
                    CHAIN_ID,
                    await bridgeSource.getAddress(),
                    CHAIN_ID,
                    await bridgeDestination.getAddress(),
                    receiver,
                    amountWithoutFee
                );

                routerSource.setOffchainData(data.payload, data.proof);

                await lbtcSource
                    .connect(signer1)
                    .approve(await bridgeSource.getAddress(), amount);
                await expect(
                    bridgeSource
                        .connect(signer1)
                        .deposit(
                            CHAIN_ID,
                            ethers.zeroPadValue(receiver, 32),
                            amount
                        )
                )
                    .to.emit(bridgeSource, 'DepositToBridge')
                    .withArgs(
                        signer1.address,
                        ethers.zeroPadValue(receiver, 32),
                        ethers.sha256(data.payload),
                        data.payload
                    );
            });
        });
    });
});
