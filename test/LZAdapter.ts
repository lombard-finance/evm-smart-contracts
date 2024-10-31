import { LBTCMock, Consortium, Bridge, LZAdapter } from '../typechain-types';
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
import { ethers, deployments } from 'hardhat';
import { expect } from 'chai';
import { Options } from '@layerzerolabs/lz-v2-utilities';

const aa = require('@layerzerolabs/test-devtools-evm-hardhat/artifacts/contracts/mocks/EndpointV2Mock.sol/EndpointV2Mock.json');

console.log(aa);

Options.length;

import { BaseContract } from 'ethers';

describe('Bridge', function () {
    let deployer: Signer,
        signer1: Signer,
        signer2: Signer,
        signer3: Signer,
        treasury: Signer,
        reporter: Signer,
        admin: Signer,
        pauser: Signer;
    let lbtc: LBTCMock;
    let consortium: Consortium;
    let snapshot: SnapshotRestorer;
    const aEid = 1;
    const bEid = 2;
    let chainId: string;

    let aAdapter: LZAdapter;
    let bAdapter: LZAdapter;
    let aLZEndpoint: BaseContract;
    let bLZEndpoint: BaseContract;
    let aBridge: Bridge;
    let bBridge: Bridge;

    before(async function () {
        chainId = encode(
            ['uint256'],
            [(await ethers.provider.getNetwork()).chainId]
        );

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

        lbtc = await deployContract<LBTCMock>('LBTCMock', [
            await consortium.getAddress(),
            100,
            deployer.address,
        ]);

        // Bridge
        aBridge = await deployContract<Bridge>('Bridge', [
            await lbtc.getAddress(),
            deployer.address,
            deployer.address,
        ]);

        bBridge = await deployContract<Bridge>('Bridge', [
            await lbtc.getAddress(),
            deployer.address,
            deployer.address,
        ]);

        // deploy LayerZero endpoint
        const EndpointV2MockArtifact =
            await deployments.getArtifact('EndpointV2Mock');
        const EndpointV2Mock = new ethers.ContractFactory(
            EndpointV2MockArtifact.abi,
            EndpointV2MockArtifact.bytecode,
            deployer
        );
        aLZEndpoint = await EndpointV2Mock.deploy(aEid);
        bLZEndpoint = await EndpointV2Mock.deploy(bEid);

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
            ethers.zeroPadValue(
                ethers.getBytes(await bAdapter.getAddress()),
                32
            )
        );
        await aAdapter.setEid(chainId, bEid);

        await bAdapter.setPeer(
            aEid,
            ethers.zeroPadValue(
                ethers.getBytes(await aAdapter.getAddress()),
                32
            )
        );
        await bAdapter.setEid(chainId, aEid);

        await aBridge.addDestination(
            chainId,
            await bBridge.getAddress(),
            1,
            1,
            await aAdapter.getAddress()
        );
        await bBridge.addDestination(
            chainId,
            await aBridge.getAddress(),
            2,
            2,
            await bAdapter.getAddress()
        );

        ethers.getContractAtFromArtifact;

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
                await aBridge.getDepositRelativeCommission(
                    ethers.zeroPadValue('0x', 32)
                )
            ).to.equal(1);
        });

        it('getDepositAbsoluteCommission', async function () {
            expect(
                await aBridge.getDepositAbsoluteCommission(
                    ethers.zeroPadValue('0x', 32)
                )
            ).to.equal(1);
        });
    });

    describe('Actions/Flows', function () {
        const absoluteFee = 100n;
        const AMOUNT = 10000n;

        beforeEach(async function () {
            await lbtc.mintTo(signer1.address, AMOUNT);
        });

        it('should bridge from A to B', async () => {
            let fee = AMOUNT / 10n;

            let amountWithoutFee = AMOUNT - fee;
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

            // await lbtc
            //     .connect(signer1)
            //     .approve(await bridgeSource.getAddress(), amount);
            await expect(
                aBridge
                    .connect(signer1)
                    .deposit(chainId, ethers.zeroPadValue(receiver, 32), AMOUNT)
            )
                .to.emit(aBridge, 'DepositToBridge')
                .withArgs(
                    signer1.address,
                    ethers.zeroPadValue(receiver, 32),
                    ethers.sha256(payload),
                    payload
                );

            expect(await lbtc.balanceOf(signer1.address)).to.be.equal(0);
            expect(await lbtc.balanceOf(treasury.address)).to.be.equal(fee);
            expect((await lbtc.totalSupply()).toString()).to.be.equal(fee);

            // expect(await lbtc.balanceOf(signer2.address)).to.be.equal(0);
            // expect(await lbtc.totalSupply()).to.be.equal(0);

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
                .withArgs(receiver, data1.payloadHash, data1.payload);

            await expect(bBridge.connect(signer2).withdraw(data1.payload))
                .to.emit(bBridge, 'WithdrawFromBridge')
                .withArgs(
                    receiver,
                    ethers.sha256(data1.payload),
                    data1.payload
                );
            expect((await lbtc.totalSupply()).toString()).to.be.equal(AMOUNT);
            expect(
                (await lbtc.balanceOf(signer2.address)).toString()
            ).to.be.equal(amountWithoutFee);

            // bridge back

            const amount = amountWithoutFee;

            fee = 1n + absoluteFee;
            amountWithoutFee = amount - fee;

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

            // await lbtc
            //     .connect(signer2)
            //     .approve(await bridgeDestination.getAddress(), amount);
            await expect(
                bBridge
                    .connect(signer2)
                    .deposit(chainId, ethers.zeroPadValue(receiver, 32), amount)
            )
                .to.emit(bBridge, 'DepositToBridge')
                .withArgs(
                    signer2.address,
                    ethers.zeroPadValue(receiver, 32),
                    ethers.sha256(payload),
                    payload
                );

            expect(await lbtc.balanceOf(signer2.address)).to.be.equal(0);
            expect(await lbtc.balanceOf(treasury.address)).to.be.equal(fee);
            expect(await lbtc.totalSupply()).to.be.equal(fee);

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
                .withArgs(receiver, data2.payloadHash, 2);

            await expect(aBridge.connect(signer2).withdraw(data2.payload))
                .to.emit(aBridge, 'WithdrawFromBridge')
                .withArgs(receiver, data2.payloadHash, data2.payload);
        });
    });
});
