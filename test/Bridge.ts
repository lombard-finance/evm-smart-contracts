import {
    LBTCMock,
    Bascule,
    Consortium,
    Bridge,
    TokenPoolAdapter,
    CCIPRouterMock,
    TokenPool,
    LZAdapter,
    EndpointV2Mock,
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
        await lbtcSource.changeBridge(await bridgeSource.getAddress());

        // chain 2
        lbtcDestination = await deployContract<LBTCMock>('LBTCMock', [
            await consortium.getAddress(),
            100,
            deployer.address,
        ]);
        bridgeDestination = await deployContract<Bridge>('Bridge', [
            await lbtcDestination.getAddress(),
            treasuryDestination.address,
            deployer.address,
        ]);
        await lbtcDestination.changeBridge(
            await bridgeDestination.getAddress()
        );

        await lbtcSource.changeTreasuryAddress(treasurySource.address);
        await lbtcDestination.changeTreasuryAddress(
            treasuryDestination.address
        );

        await lbtcSource.addMinter(await bridgeSource.getAddress());
        await lbtcDestination.addMinter(await bridgeDestination.getAddress());

        await bridgeSource.changeConsortium(await consortium.getAddress());
        await bridgeDestination.changeConsortium(await consortium.getAddress());

        // set rate limits
        const oo = {
            chainId: CHAIN_ID,
            limit: 1_0000_0000n, // 1 LBTC
            window: 0,
        };
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
        const absoluteFee = 100n;
        const AMOUNT = 1_0000_0000n; // 1 LBTC

        beforeEach(async function () {
            await lbtcSource.mintTo(signer1.address, AMOUNT);
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
                await lbtcSource
                    .connect(signer1)
                    .approve(await bridgeSource.getAddress(), AMOUNT);
                await bridgeSource
                    .connect(signer1)
                    .deposit(
                        CHAIN_ID,
                        encode(['address'], [signer2.address]),
                        AMOUNT
                    );

                const amountWithoutFee = AMOUNT - AMOUNT / 10n;

                const data = await signDepositBridgePayload(
                    [signer1],
                    [true],
                    CHAIN_ID,
                    await bridgeSource.getAddress(),
                    CHAIN_ID,
                    await bridgeDestination.getAddress(),
                    signer2.address,
                    amountWithoutFee
                );

                await expect(
                    bridgeDestination
                        .connect(signer2)
                        .authNotary(data.payload, data.proof)
                )
                    .to.emit(bridgeDestination, 'PayloadNotarized')
                    .withArgs(signer2.address, ethers.sha256(data.payload));

                await bridgeDestination.setRateLimits(
                    [],
                    [
                        {
                            chainId: CHAIN_ID,
                            limit: amountWithoutFee - 1n,
                            window: 0,
                        },
                    ]
                );

                await expect(
                    bridgeDestination.connect(signer2).withdraw(data.payload)
                ).to.be.revertedWithCustomError(
                    bridgeDestination,
                    'RateLimitExceeded'
                );
            });
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

        describe('With LayerZero Adapter', function () {
            let lzAdapterSource: LZAdapter;
            let lzAdapterDestination: LZAdapter;
            let lzEndpointSource: EndpointV2Mock;
            let lzEndpointDestination: EndpointV2Mock;
            let chainId: string;
            const eidSource = 1;
            const eidDestination = 2;

            beforeEach(async function () {
                chainId = encode(
                    ['uint256'],
                    [(await ethers.provider.getNetwork()).chainId]
                );

                // deploy LayerZero endpoint
                lzEndpointSource = await deployContract<EndpointV2Mock>(
                    'EndpointV2Mock',
                    [eidSource],
                    false
                );
                lzEndpointDestination = await deployContract<EndpointV2Mock>(
                    'EndpointV2Mock',
                    [eidDestination],
                    false
                );

                lzAdapterSource = await deployContract<LZAdapter>(
                    'LZAdapter',
                    [
                        deployer.address,
                        await bridgeSource.getAddress(),
                        await lzEndpointSource.getAddress(),
                        100_000,
                    ],
                    false
                );

                lzAdapterDestination = await deployContract<LZAdapter>(
                    'LZAdapter',
                    [
                        deployer.address,
                        await bridgeDestination.getAddress(),
                        await lzEndpointDestination.getAddress(),
                        100_000,
                    ],
                    false
                );

                // configuration
                await lzAdapterSource.setPeer(
                    eidDestination,
                    encode(
                        ['address'],
                        [await lzAdapterDestination.getAddress()]
                    )
                );
                await lzAdapterSource.setEid(chainId, eidDestination);

                await lzAdapterDestination.setPeer(
                    eidSource,
                    encode(['address'], [await lzAdapterSource.getAddress()])
                );
                await lzAdapterDestination.setEid(chainId, eidSource);

                await bridgeSource.changeDepositRelativeCommission(1, chainId);
                await bridgeSource.changeDepositAbsoluteCommission(1, chainId);

                await bridgeDestination.changeDepositRelativeCommission(
                    2,
                    chainId
                );
                await bridgeDestination.changeDepositAbsoluteCommission(
                    2,
                    chainId
                );

                await lzEndpointSource.setDestLzEndpoint(
                    await lzAdapterDestination.getAddress(),
                    await lzEndpointDestination.getAddress()
                );
                await lzEndpointDestination.setDestLzEndpoint(
                    await lzAdapterSource.getAddress(),
                    await lzEndpointSource.getAddress()
                );

                await lzAdapterSource.changeBridge(
                    await bridgeSource.getAddress()
                );
                await lzAdapterDestination.changeBridge(
                    await bridgeDestination.getAddress()
                );

                await bridgeSource.changeAdapter(
                    chainId,
                    await lzAdapterSource.getAddress()
                );
                await bridgeDestination.changeAdapter(
                    chainId,
                    await lzAdapterDestination.getAddress()
                );
            });

            describe('Setters and Getters', () => {
                it('should return chain by eid', async function () {
                    expect(
                        await lzAdapterSource.getChain(eidDestination)
                    ).to.eq(chainId);
                });

                it('should return eid by chain', async function () {
                    expect(await lzAdapterSource.getEID(chainId)).to.eq(
                        eidDestination
                    );
                });
            });

            describe('Bridge using auth from consortium', function () {
                it('should bridge from Source to Destination', async () => {
                    const deductFee = async (
                        amount: bigint,
                        bridge: Bridge
                    ): Promise<bigint> => {
                        const absFee =
                            await bridge.getDepositAbsoluteCommission(chainId);
                        const relFee =
                            await bridge.getDepositRelativeCommission(chainId);
                        // added 9999n to round up
                        return (
                            amount -
                            (amount * relFee + 9999n) / 100_00n -
                            absFee
                        );
                    };

                    let amount = AMOUNT;
                    let amountWithoutFee = await deductFee(
                        amount,
                        bridgeSource
                    );
                    let receiver = signer2.address;
                    let payload = getPayloadForAction(
                        [
                            CHAIN_ID,
                            encode(
                                ['address'],
                                [await bridgeSource.getAddress()]
                            ),
                            CHAIN_ID,
                            encode(
                                ['address'],
                                [await bridgeDestination.getAddress()]
                            ),
                            encode(['address'], [receiver]),
                            amountWithoutFee,
                            ethers.AbiCoder.defaultAbiCoder().encode(
                                ['uint256'],
                                [0]
                            ),
                        ],
                        DEPOSIT_BRIDGE_ACTION
                    );

                    await lbtcSource
                        .connect(signer1)
                        .approve(await bridgeSource.getAddress(), AMOUNT);

                    let tx = await deployer.sendTransaction({
                        to: signer1.address,
                        value: ethers.parseEther('10'),
                    });
                    await tx.wait();

                    await expect(
                        bridgeSource
                            .connect(signer1)
                            .deposit(
                                chainId,
                                ethers.zeroPadValue(receiver, 32),
                                AMOUNT,
                                {
                                    value: ethers.parseEther('10'),
                                }
                            )
                    )
                        .to.emit(bridgeSource, 'DepositToBridge')
                        .withArgs(
                            signer1.address,
                            ethers.zeroPadValue(receiver, 32),
                            ethers.sha256(payload),
                            payload
                        )
                        .and.emit(lzAdapterDestination, 'LZMessageReceived');

                    expect(
                        await lbtcSource.balanceOf(signer1.address)
                    ).to.be.equal(0);
                    expect(
                        await lbtcSource.balanceOf(treasurySource.address)
                    ).to.be.equal(amount - amountWithoutFee);
                    expect(await lbtcSource.totalSupply()).to.be.equal(
                        amount - amountWithoutFee
                    );

                    // TODO: sign payload from event or `payload`
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

                    // put auth from consortium

                    await expect(
                        bridgeDestination.authNotary(data1.payload, data1.proof)
                    )
                        .to.emit(bridgeDestination, 'PayloadNotarized')
                        .withArgs(receiver, data1.payloadHash);

                    await expect(
                        bridgeDestination
                            .connect(signer2)
                            .withdraw(data1.payload)
                    )
                        .to.emit(bridgeDestination, 'WithdrawFromBridge')
                        .withArgs(
                            receiver,
                            ethers.sha256(data1.payload),
                            data1.payload,
                            amountWithoutFee
                        );
                    expect(await lbtcDestination.totalSupply()).to.be.equal(
                        amountWithoutFee
                    );
                    expect(
                        (
                            await lbtcDestination.balanceOf(signer2.address)
                        ).toString()
                    ).to.be.equal(amountWithoutFee);

                    // bridge back

                    const lastAmountWithoutFee = amountWithoutFee;
                    amount = amountWithoutFee;
                    amountWithoutFee = await deductFee(
                        amount,
                        bridgeDestination
                    );
                    receiver = signer1.address;

                    payload = getPayloadForAction(
                        [
                            CHAIN_ID,
                            encode(
                                ['address'],
                                [await bridgeDestination.getAddress()]
                            ),
                            CHAIN_ID,
                            encode(
                                ['address'],
                                [await bridgeSource.getAddress()]
                            ),
                            encode(['address'], [receiver]),
                            amountWithoutFee,
                            ethers.AbiCoder.defaultAbiCoder().encode(
                                ['uint256'],
                                [0]
                            ),
                        ],
                        DEPOSIT_BRIDGE_ACTION
                    );

                    await lbtcDestination
                        .connect(signer2)
                        .approve(await bridgeDestination.getAddress(), amount);

                    tx = await deployer.sendTransaction({
                        to: signer2.address,
                        value: ethers.parseEther('10'),
                    });
                    await tx.wait();

                    await expect(
                        bridgeDestination
                            .connect(signer2)
                            .deposit(
                                chainId,
                                ethers.zeroPadValue(receiver, 32),
                                amount,
                                {
                                    value: ethers.parseEther('10'),
                                }
                            )
                    )
                        .to.emit(bridgeDestination, 'DepositToBridge')
                        .withArgs(
                            signer2.address,
                            ethers.zeroPadValue(receiver, 32),
                            ethers.sha256(payload),
                            payload
                        )
                        .and.emit(lzAdapterSource, 'LZMessageReceived');

                    expect(
                        await lbtcDestination.balanceOf(signer2.address)
                    ).to.be.equal(0);
                    expect(
                        await lbtcDestination.balanceOf(
                            treasuryDestination.address
                        )
                    ).to.be.equal(amount - amountWithoutFee);
                    expect(await lbtcDestination.totalSupply()).to.be.equal(
                        amount - amountWithoutFee
                    );

                    const data2 = await signDepositBridgePayload(
                        [signer1],
                        [true],
                        chainId,
                        await bridgeDestination.getAddress(),
                        chainId,
                        await bridgeSource.getAddress(),
                        receiver,
                        amountWithoutFee
                    );

                    await expect(
                        bridgeSource.authNotary(data2.payload, data2.proof)
                    )
                        .to.emit(bridgeSource, 'PayloadNotarized')
                        .withArgs(receiver, data2.payloadHash);

                    await expect(
                        bridgeSource.connect(signer2).withdraw(data2.payload)
                    )
                        .to.emit(bridgeSource, 'WithdrawFromBridge')
                        .withArgs(
                            receiver,
                            data2.payloadHash,
                            data2.payload,
                            amountWithoutFee
                        );
                    expect(
                        await lbtcSource.balanceOf(signer1.address)
                    ).to.be.equal(amountWithoutFee);
                });
            });
        });
    });
});
