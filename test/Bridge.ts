import {
    LBTCMock,
    Bascule,
    Consortium,
    Bridge,
    MockCCIPRouter,
    MockRMN,
    LombardTokenPool,
    CLAdapter,
    EndpointV2Mock,
} from '../typechain-types';
import {
    takeSnapshot,
    SnapshotRestorer,
    time,
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

const aChainSelector = 1;
const bChainSelector = 2;

describe('Bridge', function () {
    let deployer: Signer,
        signer1: Signer,
        signer2: Signer,
        signer3: Signer,
        treasurySource: Signer,
        treasuryDestination: Signer,
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
    const absoluteFee = 100n;

    before(async function () {
        [
            deployer,
            signer1,
            signer2,
            signer3,
            treasurySource,
            treasuryDestination,
            admin,
            pauser,
            reporter,
        ] = await getSignersWithPrivateKeys();

        // for both chains
        consortium = await deployContract<Consortium>('Consortium', [
            deployer.address,
        ]);
        await consortium.setInitialValidatorSet(
            getPayloadForAction([1, [signer1.publicKey], [1], 1, 1], NEW_VALSET)
        );

        // chain 1
        lbtcSource = await deployContract<LBTCMock>('LBTCMock', [
            await consortium.getAddress(),
            100,
            treasurySource.address,
            deployer.address,
        ]);
        bridgeSource = await deployContract<Bridge>('Bridge', [
            await lbtcSource.getAddress(),
            treasurySource.address,
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

        // chain 2
        lbtcDestination = await deployContract<LBTCMock>('LBTCMock', [
            await consortium.getAddress(),
            100,
            treasuryDestination.address,
            deployer.address,
        ]);
        bridgeDestination = await deployContract<Bridge>('Bridge', [
            await lbtcDestination.getAddress(),
            treasuryDestination.address,
            deployer.address,
        ]);

        await lbtcSource.addMinter(await bridgeSource.getAddress());
        await lbtcDestination.addMinter(await bridgeDestination.getAddress());

        await bridgeSource.changeConsortium(await consortium.getAddress());
        await bridgeDestination.changeConsortium(await consortium.getAddress());

        // set rate limits
        const oo = {
            chainId: CHAIN_ID,
            limit: 1_0000_0000n, // 1 LBTC
            window: 100,
        };
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
        await bridgeSource.setRateLimits([oo], [oo]);
        await bridgeDestination.setRateLimits([oo], [oo]);

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
        const AMOUNT = 1_0000_0000n; // 1 LBTC

        beforeEach(async function () {
            await lbtcSource.mintTo(signer1.address, AMOUNT);
        });

        it('full flow', async () => {
            let amount = AMOUNT;
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
            expect(
                await lbtcSource.balanceOf(treasurySource.address)
            ).to.be.equal(fee);
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
                await lbtcDestination.balanceOf(treasuryDestination.address)
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

        describe('With failing rate limits', function () {
            it('should fail to deposit if rate limit is exceeded', async function () {
                await lbtcSource.mintTo(signer1.address, 1);

                await expect(
                    bridgeSource
                        .connect(signer1)
                        .deposit(
                            CHAIN_ID,
                            encode(['address'], [signer2.address]),
                            AMOUNT + 1n
                        )
                ).to.be.revertedWithCustomError(
                    bridgeSource,
                    'RateLimitExceeded'
                );
            });

            it('should fail to deposit if aggregated deposit exceeds rate limit', async function () {
                await lbtcSource.mintTo(signer1.address, 1);

                // set rate limit for a non empty window
                await bridgeSource.setRateLimits(
                    [
                        {
                            chainId: CHAIN_ID,
                            limit: AMOUNT,
                            window: 1000000000n, // big window so there is no decay
                        },
                    ],
                    []
                );
                await lbtcSource
                    .connect(signer1)
                    .approve(await bridgeSource.getAddress(), AMOUNT + 1n);
                await bridgeSource
                    .connect(signer1)
                    .deposit(
                        CHAIN_ID,
                        encode(['address'], [signer2.address]),
                        AMOUNT / 2n
                    );
                await expect(
                    bridgeSource
                        .connect(signer1)
                        .deposit(
                            CHAIN_ID,
                            encode(['address'], [signer2.address]),
                            AMOUNT + 1n - AMOUNT / 2n
                        )
                ).to.be.revertedWithCustomError(
                    bridgeSource,
                    'RateLimitExceeded'
                );
            });

            it('should allow more deposits over time', async function () {
                await lbtcSource.mintTo(signer1.address, AMOUNT);

                // set rate limit for a non empty window
                await bridgeSource.setRateLimits(
                    [
                        {
                            chainId: CHAIN_ID,
                            limit: AMOUNT,
                            window: 1, // every second limits get reset
                        },
                    ],
                    []
                );
                await lbtcSource
                    .connect(signer1)
                    .approve(await bridgeSource.getAddress(), AMOUNT * 2n);
                await bridgeSource
                    .connect(signer1)
                    .deposit(
                        CHAIN_ID,
                        encode(['address'], [signer2.address]),
                        AMOUNT
                    );
                await bridgeSource
                    .connect(signer1)
                    .deposit(
                        CHAIN_ID,
                        encode(['address'], [signer2.address]),
                        AMOUNT
                    );
            });

            it('should fail to withdraw if rate limit is exceeded', async function () {
                const bridgeLimit = AMOUNT / 2n;

                await bridgeDestination.setRateLimits(
                    [],
                    [
                        {
                            chainId: CHAIN_ID,
                            limit: bridgeLimit,
                            window: 900,
                        },
                    ]
                );

                // create payload with above limit
                let data = await signDepositBridgePayload(
                    [signer1],
                    [true],
                    CHAIN_ID,
                    await bridgeSource.getAddress(),
                    CHAIN_ID,
                    await bridgeDestination.getAddress(),
                    signer2.address,
                    bridgeLimit + 1n
                );

                await expect(
                    bridgeDestination
                        .connect(signer2)
                        .authNotary(data.payload, data.proof)
                )
                    .to.emit(bridgeDestination, 'PayloadNotarized')
                    .withArgs(signer2.address, ethers.sha256(data.payload));

                await expect(
                    bridgeDestination.connect(signer2).withdraw(data.payload)
                ).to.be.revertedWithCustomError(
                    bridgeDestination,
                    'RateLimitExceeded'
                );
            });

            it('should not allow to withdraw above limit after half of window', async function () {
                const bridgeLimit = AMOUNT / 2n;

                await bridgeDestination.setRateLimits(
                    [],
                    [
                        {
                            chainId: CHAIN_ID,
                            limit: bridgeLimit,
                            window: 1800,
                        },
                    ]
                );

                // create payload equal to limit
                let data = await signDepositBridgePayload(
                    [signer1],
                    [true],
                    CHAIN_ID,
                    await bridgeSource.getAddress(),
                    CHAIN_ID,
                    await bridgeDestination.getAddress(),
                    signer2.address,
                    bridgeLimit
                );

                await expect(
                    bridgeDestination
                        .connect(signer2)
                        .authNotary(data.payload, data.proof)
                )
                    .to.emit(bridgeDestination, 'PayloadNotarized')
                    .withArgs(signer2.address, ethers.sha256(data.payload));

                await expect(
                    bridgeDestination.connect(signer2).withdraw(data.payload)
                ).to.emit(bridgeDestination, 'WithdrawFromBridge');

                await time.increase(900);

                // create payload equal to limit
                data = await signDepositBridgePayload(
                    [signer1],
                    [true],
                    CHAIN_ID,
                    await bridgeSource.getAddress(),
                    CHAIN_ID,
                    await bridgeDestination.getAddress(),
                    signer2.address,
                    bridgeLimit,
                    1
                );

                await expect(
                    bridgeDestination
                        .connect(signer2)
                        .authNotary(data.payload, data.proof)
                )
                    .to.emit(bridgeDestination, 'PayloadNotarized')
                    .withArgs(signer2.address, ethers.sha256(data.payload));

                await expect(
                    bridgeDestination.connect(signer2).withdraw(data.payload)
                ).to.be.revertedWithCustomError(
                    bridgeDestination,
                    'RateLimitExceeded'
                );
            });

            it('should fail to deposit if rate limit is exceeded', async function () {
                const bridgeLimit = AMOUNT / 2n;
                await lbtcSource.mintTo(signer2, AMOUNT);
                await lbtcSource
                    .connect(signer2)
                    .approve(await bridgeSource.getAddress(), AMOUNT);

                await bridgeSource.setRateLimits(
                    [
                        {
                            chainId: CHAIN_ID,
                            limit: bridgeLimit,
                            window: 1800,
                        },
                    ],
                    []
                );

                await expect(
                    bridgeSource
                        .connect(signer2)
                        .deposit(
                            CHAIN_ID,
                            encode(['address'], [signer2.address]),
                            bridgeLimit + 1n
                        )
                ).to.be.revertedWithCustomError(
                    bridgeSource,
                    'RateLimitExceeded'
                );
            });

            it('should not allow to deposit above limit after half of window', async function () {
                const bridgeLimit = AMOUNT / 2n;
                await lbtcSource.mintTo(signer2, AMOUNT);
                await lbtcSource
                    .connect(signer2)
                    .approve(await bridgeSource.getAddress(), AMOUNT);

                await bridgeSource.setRateLimits(
                    [
                        {
                            chainId: CHAIN_ID,
                            limit: bridgeLimit,
                            window: 1800,
                        },
                    ],
                    []
                );

                await expect(
                    bridgeSource
                        .connect(signer2)
                        .deposit(
                            CHAIN_ID,
                            encode(['address'], [signer2.address]),
                            bridgeLimit
                        )
                ).to.emit(bridgeSource, 'DepositToBridge');

                await time.increase(900);

                await expect(
                    bridgeSource
                        .connect(signer2)
                        .deposit(
                            CHAIN_ID,
                            encode(['address'], [signer2.address]),
                            bridgeLimit
                        )
                ).to.be.revertedWithCustomError(
                    bridgeDestination,
                    'RateLimitExceeded'
                );
            });
        });

        it('should deny deposit after removing chain', async () => {
            // Only need to fulfil parameters, they are not subject of the test
            let amount = 10000n;
            let receiver = signer2.address;

            await expect(bridgeSource.removeDestination(CHAIN_ID))
                .to.emit(bridgeSource, 'BridgeDestinationRemoved')
                .withArgs(CHAIN_ID)
                .to.emit(bridgeSource, 'DepositAbsoluteCommissionChanged')
                .withArgs(0, CHAIN_ID)
                .to.emit(bridgeSource, 'DepositRelativeCommissionChanged')
                .withArgs(0, CHAIN_ID);

            await expect(
                bridgeSource
                    .connect(signer1)
                    .deposit(CHAIN_ID, encode(['address'], [receiver]), amount)
            ).to.be.revertedWithCustomError(bridgeSource, 'UnknownDestination');
        });

        describe('With Chainlink Adapter', function () {
            let CCIPRouter: MockCCIPRouter,
                CCIPRMN: MockRMN,
                aTokenPool: LombardTokenPool,
                bTokenPool: LombardTokenPool,
                aCLAdapter: CLAdapter,
                bCLAdapter: CLAdapter;
            const aCCIPFee = 1_0000_0000n; // 1 gwei
            const bCCIPFee = 10_0000_0000n; // 10 gwei

            beforeEach(async function () {
                // configure CCIP
                CCIPRouter = await deployContract<MockCCIPRouter>(
                    'MockCCIPRouter',
                    [], // [aChainSelector, bChainSelector],
                    false
                );
                await CCIPRouter.setFee(aCCIPFee);

                CCIPRMN = await deployContract<MockRMN>('MockRMN', [], false);

                aCLAdapter = await deployContract<CLAdapter>(
                    'CLAdapter',
                    [
                        await bridgeSource.getAddress(),
                        300_000,
                        //
                        await CCIPRouter.getAddress(),
                        [], // no allowlist
                        await CCIPRMN.getAddress(), // will do work of rmn as well,
                    ],
                    false
                );

                aTokenPool = await ethers.getContractAt(
                    'LombardTokenPool',
                    await aCLAdapter.tokenPool()
                );
                await aTokenPool.acceptOwnership();
                await aCLAdapter.setRemoteChainSelector(
                    CHAIN_ID,
                    bChainSelector
                );

                bCLAdapter = await deployContract<CLAdapter>(
                    'CLAdapter',
                    [
                        await bridgeDestination.getAddress(),
                        300_000,
                        //
                        await CCIPRouter.getAddress(),
                        [], // no allowlist
                        await CCIPRMN.getAddress(), // will do work of rmn as well
                    ],
                    false
                );
                bTokenPool = await ethers.getContractAt(
                    'LombardTokenPool',
                    await bCLAdapter.tokenPool()
                );
                await bTokenPool.acceptOwnership();
                await bCLAdapter.setRemoteChainSelector(
                    CHAIN_ID,
                    aChainSelector
                );

                /// configure bridges
                await bridgeSource.changeAdapter(
                    CHAIN_ID,
                    await aCLAdapter.getAddress()
                );
                await bridgeDestination.changeAdapter(
                    CHAIN_ID,
                    await aCLAdapter.getAddress()
                );

                /// set token pools
                await aTokenPool.applyChainUpdates([
                    {
                        remoteChainSelector: bChainSelector,
                        allowed: true,
                        remotePoolAddress: await bTokenPool.getAddress(),
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

                await bTokenPool.applyChainUpdates([
                    {
                        remoteChainSelector: aChainSelector,
                        allowed: true,
                        remotePoolAddress: await aTokenPool.getAddress(),
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

                await aTokenPool.setRemotePool(
                    bChainSelector,
                    ethers.zeroPadValue(await bTokenPool.getAddress(), 32)
                );
                await bTokenPool.setRemotePool(
                    aChainSelector,
                    ethers.zeroPadValue(await aTokenPool.getAddress(), 32)
                );
            });

            it('should route message', async function () {
                let amount = AMOUNT;
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

                // await routerSource.setOffchainData(data.payload, data.proof);

                await lbtcSource
                    .connect(signer1)
                    .approve(await bridgeSource.getAddress(), amount);

                await expect(
                    bridgeSource
                        .connect(signer1)
                        .deposit(
                            CHAIN_ID,
                            ethers.zeroPadValue(receiver, 32),
                            amount,
                            {
                                value: aCCIPFee,
                            }
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
