import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
    deployContract,
    getSignersWithPrivateKeys,
    getPayloadForAction,
    NEW_VALSET,
    DEPOSIT_BRIDGE_ACTION,
    signDepositBridgePayload,
    signNewValSetPayload,
    encode,
    Signer,
} from './helpers';
import { Consortium } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';

describe('Consortium', function () {
    let deployer: Signer, signer1: Signer, signer2: Signer, signer3: Signer;
    let lombard: Consortium;
    let snapshot: SnapshotRestorer;

    before(async function () {
        [deployer, signer1, signer2, signer3] =
            await getSignersWithPrivateKeys();
        lombard = await deployContract<Consortium>('Consortium', [
            deployer.address,
        ]);
        snapshot = await takeSnapshot();
    });

    afterEach(async function () {
        await snapshot.restore();
    });

    describe('Setters and getters', function () {
        it('should set the correct owner', async function () {
            expect(await lombard.owner()).to.equal(deployer.address);
        });
    });

    it('checkProof :: should revert if not validator set is set', async function () {
        // Empty proof should bypass check if not properly handled
        // Message is not relevant for this test
        await expect(
            lombard.checkProof(ethers.randomBytes(32), '0x')
        ).to.be.revertedWithCustomError(lombard, 'NoValidatorSet');
    });

    it('setNextValidatorSet :: should revert if no initial validator set', async function () {
        const { payload, proof } = await signNewValSetPayload(
            [signer3, signer1, signer2],
            [true, true, false],
            0,
            [signer1.publicKey, signer2.publicKey],
            [1, 1],
            2,
            1
        );
        await expect(
            lombard.setNextValidatorSet(payload, proof)
        ).to.be.revertedWithCustomError(lombard, 'NoValidatorSet');
    });

    describe('With Initial ValidatorSet', function () {
        beforeEach(async function () {
            const initialValset = getPayloadForAction(
                [
                    10,
                    [signer3.publicKey, signer1.publicKey, signer2.publicKey],
                    [1, 1, 1],
                    2,
                    1,
                ],
                NEW_VALSET
            );

            await lombard.setInitialValidatorSet(initialValset);
        });

        it('should set the correct threshold', async function () {
            const validatorSet = await lombard.getValidatorSet(10);
            expect(validatorSet.weightThreshold).to.equal(2);
            expect(validatorSet.weights).to.deep.equal([1, 1, 1]);
            expect(validatorSet.validators).to.deep.equal([
                signer3.address,
                signer1.address,
                signer2.address,
            ]);
        });

        it('should set the correct epoch', async function () {
            expect(await lombard.curEpoch()).to.equal(10);
        });

        it('should set the new consortium correctly', async function () {
            const data = await signNewValSetPayload(
                [signer3, signer1, signer2],
                [true, true, false],
                11,
                [signer1.publicKey, signer2.publicKey],
                [1, 2],
                3,
                1
            );
            await expect(lombard.setNextValidatorSet(data.payload, data.proof))
                .to.emit(lombard, 'ValidatorSetUpdated')
                .withArgs(11, [signer1.address, signer2.address], [1, 2], 3);

            const validatorSet = await lombard.getValidatorSet(11);
            expect(validatorSet.weightThreshold).to.equal(3);
            expect(validatorSet.weights).to.deep.equal([1, 2]);
            expect(validatorSet.validators).to.deep.equal([
                signer1.address,
                signer2.address,
            ]);
        });

        it('should fail to set initial validator set again', async function () {
            const payload = getPayloadForAction(
                [11, [signer1.publicKey], [1], 1, 1],
                NEW_VALSET
            );
            await expect(
                lombard.setInitialValidatorSet(payload)
            ).to.revertedWithCustomError(lombard, 'ValSetAlreadySet');
        });

        it('should fail if epoch is not increasing', async function () {
            const data = await signNewValSetPayload(
                [signer3, signer1, signer2],
                [true, true, false],
                10,
                [signer1.publicKey, signer2.publicKey],
                [1, 1],
                1,
                1
            );
            await expect(
                lombard.setNextValidatorSet(data.payload, data.proof)
            ).to.be.revertedWithCustomError(lombard, 'InvalidEpoch');
        });

        it('should fail if treshold is zero', async function () {
            const data = await signNewValSetPayload(
                [signer3, signer1, signer2],
                [true, true, false],
                11,
                [signer2.publicKey, signer1.publicKey],
                [1, 1],
                0,
                1
            );
            await expect(
                lombard.setNextValidatorSet(data.payload, data.proof)
            ).to.be.revertedWithCustomError(lombard, 'InvalidThreshold');
        });

        it('should fail if treshold is over the sum of weights', async function () {
            const data = await signNewValSetPayload(
                [signer3, signer1, signer2],
                [true, true, false],
                11,
                [signer2.publicKey, signer1.publicKey],
                [1, 1],
                3,
                1
            );
            await expect(
                lombard.setNextValidatorSet(data.payload, data.proof)
            ).to.be.revertedWithCustomError(lombard, 'InvalidThreshold');
        });

        it('should fail if zero weights are used', async function () {
            const data = await signNewValSetPayload(
                [signer3, signer1, signer2],
                [true, true, false],
                11,
                [signer2.publicKey, signer1.publicKey],
                [1, 0],
                3,
                1
            );
            await expect(
                lombard.setNextValidatorSet(data.payload, data.proof)
            ).to.be.revertedWithCustomError(lombard, 'ZeroWeight');
        });

        it('should fail if payload selector is different', async function () {
            const data = await signNewValSetPayload(
                [signer3, signer1, signer2],
                [true, true, false],
                10,
                [signer1.publicKey, signer2.publicKey],
                [1, 1],
                1,
                1
            );
            data.payload = DEPOSIT_BRIDGE_ACTION + data.payload.slice(10); // 0x + 4 bytes
            await expect(lombard.setNextValidatorSet(data.payload, data.proof))
                .to.be.revertedWithCustomError(lombard, 'UnexpectedAction')
                .withArgs(DEPOSIT_BRIDGE_ACTION);
        });

        describe('Signature verification', function () {
            it('should validate correct signatures', async function () {
                const data = await signDepositBridgePayload(
                    [signer3, signer1, signer2],
                    [true, true, false],
                    1n,
                    signer1.address,
                    1n,
                    signer2.address,
                    signer3.address,
                    10
                );

                await lombard.checkProof(data.payloadHash, data.proof);
            });

            it('should validate correct signatures (last signature component set to 0 instead of missing)', async function () {
                const data = await signDepositBridgePayload(
                    [signer3, signer1, signer2],
                    [true, true, true],
                    1n,
                    signer1.address,
                    1n,
                    signer2.address,
                    signer3.address,
                    10
                );

                data.proof = data.proof.slice(0, -64) + '0'.repeat(64);

                await lombard.checkProof(data.payloadHash, data.proof);
            });

            it('should not succeed on invalid signatures', async function () {
                const data = await signDepositBridgePayload(
                    [signer3, signer1, signer2],
                    [true, true, false],
                    1n,
                    signer1.address,
                    1n,
                    signer2.address,
                    signer3.address,
                    10
                );

                const payload = getPayloadForAction(
                    [
                        ethers.AbiCoder.defaultAbiCoder().encode(
                            ['uint256'],
                            [1]
                        ),
                        ethers.AbiCoder.defaultAbiCoder().encode(
                            ['address'],
                            [signer1.address]
                        ), //any address
                        ethers.AbiCoder.defaultAbiCoder().encode(
                            ['uint256'],
                            [2]
                        ), // // mismatching chainId
                        ethers.AbiCoder.defaultAbiCoder().encode(
                            ['address'],
                            [signer2.address]
                        ), //any address
                        ethers.AbiCoder.defaultAbiCoder().encode(
                            ['address'],
                            [signer3.address]
                        ), //any address
                        ethers.AbiCoder.defaultAbiCoder().encode(
                            ['uint64'],
                            [10]
                        ),
                        ethers.AbiCoder.defaultAbiCoder().encode(
                            ['uint256'],
                            [0]
                        ),
                    ],
                    DEPOSIT_BRIDGE_ACTION
                );

                await expect(
                    lombard.checkProof(ethers.sha256(payload), data.proof)
                ).to.be.revertedWithCustomError(lombard, 'NotEnoughSignatures');
            });
        });
    });
});

describe('Consortium with real data', function () {
    const initialValset =
        '0x4aab1d6f000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000002a000000000000000000000000000000000000000000000000000000000000000f0000000000000000000000000000000000000000000000000000000000000001d0000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000004104434be45682238709526d562c099570f7e7c19f670be0a41eff5fde784b0841cea3097052b8389e6424b799eb0a4b7e7a53abb4a62016cb7a7e0ffffb3b28e2700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000410420b2a4abde0bd0a5943c8740b69d244a419ece11505afc6234f62b86c4e3575075dde75b95b988853231f210b28592bc31fa749b29dda5204186aca273413431000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000041041e706ef040f760e5f97504a97479d34bffa6205b35dd97a0815e9bbd1ab8add0fb73442ff761f27d2aebab49b7b0f1ace226c56bd3391c4e47af8071358a93a1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006400000000000000000000000000000000000000000000000000000000000000640000000000000000000000000000000000000000000000000000000000000064';
    const signedValset =
        '0x4aab1d6f000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000003400000000000000000000000000000000000000000000000000000000000000140000000000000000000000000000000000000000000000000000000000000002300000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000004104646fbb32507a14236d22e119b1ae32d7e264a9222a6f1ba7c886aa0a107e1ab4bb5075e9e3823f71dae3774d0537ca1d272967ae5c719dd1accb273dabfc079a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004104434be45682238709526d562c099570f7e7c19f670be0a41eff5fde784b0841cea3097052b8389e6424b799eb0a4b7e7a53abb4a62016cb7a7e0ffffb3b28e2700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000410420b2a4abde0bd0a5943c8740b69d244a419ece11505afc6234f62b86c4e3575075dde75b95b988853231f210b28592bc31fa749b29dda5204186aca273413431000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000041041e706ef040f760e5f97504a97479d34bffa6205b35dd97a0815e9bbd1ab8add0fb73442ff761f27d2aebab49b7b0f1ace226c56bd3391c4e47af8071358a93a10000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000064000000000000000000000000000000000000000000000000000000000000006400000000000000000000000000000000000000000000000000000000000000640000000000000000000000000000000000000000000000000000000000000064';
    const signatures = [
        '0x3044022069088ce4a517a5d63dfd6d85bec9abc415001a75dc0b7311b52ea76c18071b7c022066d7340a5e5cc207b4100bf12a2df70419d41608fab60ac78e310ea3b61e9a3b',
        '0x3045022100d6275a5624c4d55f1df944e9f30de86677b11eef143a9e8b743bc1872501324a0220120350dd88ed081dcf3fed920ae3aadff4454205905bb72d6a393d2b6a1265e6',
        '0x3045022100b9174f60d7af9d917ac6ccd84048711834af30e309a9297f92fccb83d5960acf0220011dbe7f98facd51c15819822e692bef5e78a103e9c88769c8353be18bd468be',
    ];

    let consortium: Consortium;
    let deployer: Signer;

    before(async function () {
        [deployer] = await getSignersWithPrivateKeys();
        consortium = await deployContract<Consortium>('Consortium', [
            deployer.address,
        ]);
    });

    it('should set initial ValSet', async function () {
        await expect(consortium.setInitialValidatorSet(initialValset))
            .to.emit(consortium, 'ValidatorSetUpdated')
            .withArgs(
                2,
                [
                    '0x677B78df56C189C18da25c331DC860257fE8f9e7',
                    '0x86eA4Ef33437B6e51441130094927d1A69044A7D',
                    '0x120Be8fc5738267821F2178B867c40181F374669',
                ],
                [100n, 100n, 100n],
                240
            );
    });

    it('should update initial ValSet', async function () {
        const ethSigs: string[] = [];

        for (const sig of signatures) {
            let rawSig = ethers.getBytes(sig);

            // Extract R and S from the serialized signature
            // The serialized format is: 0x30 <length> 0x02 <length-of-R> <R> 0x02 <length-of-S> <S>
            let rStart = 4; // Skip the first 4 bytes (0x30, total length, 0x02, R length)
            let rLength = rawSig[3];

            // skip 0x00
            if (rawSig[4] == 0) {
                rStart += 1;
                rLength -= 1;
            }
            const sStart = rStart + rLength + 2; // Skip R and 0x02
            const sLength = rawSig[rStart + rLength + 1];

            // Copy R and S into proof, padding to 32 bytes each
            const proof: Uint8Array = new Uint8Array(64);
            proof.set(rawSig.slice(rStart, rStart + rLength), 32 - rLength);
            proof.set(rawSig.slice(sStart, sStart + sLength), 64 - sLength);

            ethSigs.push(ethers.hexlify(proof));
        }

        const proof = encode(['bytes[]'], [ethSigs]);
        await expect(consortium.setNextValidatorSet(signedValset, proof))
            .to.emit(consortium, 'ValidatorSetUpdated')
            .withArgs(
                3,
                [
                    '0x8Ec19B6ee522D909E33eb0DaF41F5aA538a66b8D',
                    '0x677B78df56C189C18da25c331DC860257fE8f9e7',
                    '0x86eA4Ef33437B6e51441130094927d1A69044A7D',
                    '0x120Be8fc5738267821F2178B867c40181F374669',
                ],
                [100n, 100n, 100n, 100n],
                320
            );
    });
});
