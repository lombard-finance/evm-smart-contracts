import {
    LBTCMock,
    Consortium,
    Bridge,
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
    DEPOSIT_BRIDGE_ACTION,
    encode,
    signDepositBridgePayload,
    Signer,
} from './helpers';
import { ethers, deployments } from 'hardhat';
import { expect } from 'chai';

describe('Bridge', function () {
    let deployer: Signer,
        signer1: Signer,
        signer2: Signer,
        signer3: Signer,
        treasury: Signer,
        admin: Signer;
    let lbtc: LBTCMock;
    let consortium: Consortium;
    let snapshot: SnapshotRestorer;
    const aEid = 1;
    const bEid = 2;
    let chainId: string;

    let aAdapter: LZAdapter;
    let bAdapter: LZAdapter;
    let aLZEndpoint: EndpointV2Mock;
    let bLZEndpoint: EndpointV2Mock;
    let aBridge: Bridge;
    let bBridge: Bridge;

    before(async function () {
        chainId = encode(
            ['uint256'],
            [(await ethers.provider.getNetwork()).chainId]
        );

        [deployer, signer1, signer2, signer3, treasury, admin] =
            await getSignersWithPrivateKeys();

        // for both chains
        consortium = await deployContract<Consortium>('ConsortiumMock', [
            deployer.address,
        ]);

        lbtc = await deployContract<LBTCMock>('LBTCMock', [
            await consortium.getAddress(),
            100,
            deployer.address,
        ]);

        // Bridge
        aBridge = await deployContract<Bridge>('Bridge', [
            await lbtc.getAddress(),
            treasury.address,
            deployer.address,
        ]);

        bBridge = await deployContract<Bridge>('Bridge', [
            await lbtc.getAddress(),
            treasury.address,
            deployer.address,
        ]);

        // deploy LayerZero endpoint
        aLZEndpoint = await deployContract<EndpointV2Mock>(
            'EndpointV2Mock',
            [aEid],
            false
        );
        bLZEndpoint = await deployContract<EndpointV2Mock>(
            'EndpointV2Mock',
            [bEid],
            false
        );

        aAdapter = await deployContract<LZAdapter>(
            'LZAdapter',
            [deployer.address, await aLZEndpoint.getAddress()],
            false
        );

        bAdapter = await deployContract<LZAdapter>(
            'LZAdapter',
            [deployer.address, await bLZEndpoint.getAddress()],
            false
        );

        // configuration
        await aAdapter.setPeer(
            bEid,
            encode(['address'], [await bAdapter.getAddress()])
        );
        await aAdapter.setEid(chainId, bEid);

        await bAdapter.setPeer(
            aEid,
            encode(['address'], [await aAdapter.getAddress()])
        );
        await bAdapter.setEid(chainId, aEid);

        await aBridge.addDestination(
            chainId,
            encode(['address'], [await bBridge.getAddress()]),
            1,
            1,
            await aAdapter.getAddress(),
            true
        );

        await bBridge.addDestination(
            chainId,
            encode(['address'], [await aBridge.getAddress()]),
            2,
            2,
            await bAdapter.getAddress(),
            true
        );
        await aLZEndpoint.setDestLzEndpoint(
            await bAdapter.getAddress(),
            await bLZEndpoint.getAddress()
        );
        await bLZEndpoint.setDestLzEndpoint(
            await aAdapter.getAddress(),
            await aLZEndpoint.getAddress()
        );

        await aAdapter.changeBridge(await aBridge.getAddress());
        await bAdapter.changeBridge(await bBridge.getAddress());

        await lbtc.addMinter(await aBridge.getAddress());
        await lbtc.addMinter(await bBridge.getAddress());

        await aBridge.setConsortium(await consortium.getAddress());
        await bBridge.setConsortium(await consortium.getAddress());

        snapshot = await takeSnapshot();
    });

    afterEach(async function () {
        await snapshot.restore();
    });

    describe('Setters and Getters', () => {
        it('should return chain by eid', async function () {
            expect(await aAdapter.getChain(bEid)).to.eq(chainId);
        });

        it('should return eid by chain', async function () {
            expect(await aAdapter.getEID(chainId)).to.eq(bEid);
        });

        it('getDepositRelativeCommission', async function () {
            expect(
                await aBridge.getDepositRelativeCommission(chainId)
            ).to.equal(1);
        });

        it('getDepositAbsoluteCommission', async function () {
            expect(
                await aBridge.getDepositAbsoluteCommission(chainId)
            ).to.equal(1);
        });
    });

    describe('Bridge using auth from consortium', function () {
        const absoluteFee = 100n;
        const AMOUNT = 1_0000_0000n; // 1 LBTC

        beforeEach(async function () {
            await lbtc.mintTo(signer1.address, AMOUNT);
        });

        it('should bridge from A to B', async () => {
            const deductFee = async (
                amount: bigint,
                bridge: Bridge
            ): Promise<bigint> => {
                const absFee =
                    await bridge.getDepositAbsoluteCommission(chainId);
                const relFee =
                    await bridge.getDepositRelativeCommission(chainId);
                // added 9999n to round up
                return amount - (amount * relFee + 9999n) / 100_00n - absFee;
            };

            let amount = AMOUNT;
            let amountWithoutFee = await deductFee(amount, aBridge);
            let receiver = signer2.address;
            let payload = getPayloadForAction(
                [
                    chainId,
                    encode(['address'], [await aBridge.getAddress()]),
                    chainId,
                    encode(['address'], [await bBridge.getAddress()]),
                    encode(['address'], [receiver]),
                    amountWithoutFee,
                    ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [0]),
                ],
                DEPOSIT_BRIDGE_ACTION
            );

            await lbtc
                .connect(signer1)
                .approve(await aBridge.getAddress(), AMOUNT);

            let tx = await deployer.sendTransaction({
                to: signer1.address,
                value: ethers.parseEther('10'),
            });
            await tx.wait();

            await expect(
                aBridge
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
                .to.emit(aBridge, 'DepositToBridge')
                .withArgs(
                    signer1.address,
                    ethers.zeroPadValue(receiver, 32),
                    ethers.sha256(payload),
                    payload
                )
                .and.emit(bAdapter, 'LZMessageReceived');

            expect(await lbtc.balanceOf(signer1.address)).to.be.equal(0);
            expect(await lbtc.balanceOf(treasury.address)).to.be.equal(
                amount - amountWithoutFee
            );
            expect((await lbtc.totalSupply()).toString()).to.be.equal(
                amount - amountWithoutFee
            );

            // TODO: sign payload from event or `payload`
            const data1 = await signDepositBridgePayload(
                [signer1],
                [true],
                chainId,
                await aBridge.getAddress(),
                CHAIN_ID,
                await bBridge.getAddress(),
                receiver,
                amountWithoutFee
            );

            // put auth from consortium

            await expect(bBridge.authNotary(data1.payload, data1.proof))
                .to.emit(bBridge, 'PayloadNotarized')
                .withArgs(receiver, data1.payloadHash);

            await expect(bBridge.connect(signer2).withdraw(data1.payload))
                .to.emit(bBridge, 'WithdrawFromBridge')
                .withArgs(
                    receiver,
                    ethers.sha256(data1.payload),
                    data1.payload,
                    amountWithoutFee
                );
            expect(await lbtc.totalSupply()).to.be.equal(AMOUNT);
            expect(
                (await lbtc.balanceOf(signer2.address)).toString()
            ).to.be.equal(amountWithoutFee);

            // bridge back

            const lastAmountWithoutFee = amountWithoutFee;
            amount = amountWithoutFee;
            amountWithoutFee = await deductFee(amount, bBridge);
            receiver = signer1.address;

            payload = getPayloadForAction(
                [
                    chainId,
                    encode(['address'], [await bBridge.getAddress()]),
                    chainId,
                    encode(['address'], [await aBridge.getAddress()]),
                    encode(['address'], [receiver]),
                    amountWithoutFee,
                    ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [0]),
                ],
                DEPOSIT_BRIDGE_ACTION
            );

            await lbtc
                .connect(signer2)
                .approve(await bBridge.getAddress(), amount);

            tx = await deployer.sendTransaction({
                to: signer2.address,
                value: ethers.parseEther('10'),
            });
            await tx.wait();

            await expect(
                bBridge
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
                .to.emit(bBridge, 'DepositToBridge')
                .withArgs(
                    signer2.address,
                    ethers.zeroPadValue(receiver, 32),
                    ethers.sha256(payload),
                    payload
                )
                .and.emit(aAdapter, 'LZMessageReceived');

            expect(await lbtc.balanceOf(signer2.address)).to.be.equal(0);
            expect(await lbtc.balanceOf(treasury.address)).to.be.equal(
                amount - amountWithoutFee + AMOUNT - lastAmountWithoutFee
            );
            expect(await lbtc.totalSupply()).to.be.equal(
                amount - amountWithoutFee + AMOUNT - lastAmountWithoutFee
            );

            const data2 = await signDepositBridgePayload(
                [signer1],
                [true],
                chainId,
                await bBridge.getAddress(),
                chainId,
                await aBridge.getAddress(),
                receiver,
                amountWithoutFee
            );

            await expect(aBridge.authNotary(data2.payload, data2.proof))
                .to.emit(aBridge, 'PayloadNotarized')
                .withArgs(receiver, data2.payloadHash);

            await expect(aBridge.connect(signer2).withdraw(data2.payload))
                .to.emit(aBridge, 'WithdrawFromBridge')
                .withArgs(
                    receiver,
                    data2.payloadHash,
                    data2.payload,
                    amountWithoutFee
                );
            expect(await lbtc.balanceOf(signer1.address)).to.be.equal(
                amountWithoutFee
            );
        });
    });
});
