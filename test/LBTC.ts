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
    DEFAULT_LBTC_DUST_FEE_RATE,
} from './helpers';
import { LBTCMock, Bascule, Consortium } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';

describe('LBTC', function () {
    let deployer: Signer,
        signer1: Signer,
        signer2: Signer,
        signer3: Signer,
        treasury: Signer,
        reporter: Signer,
        admin: Signer,
        pauser: Signer;
    let lbtc: LBTCMock;
    let lbtc2: LBTCMock;
    let bascule: Bascule;
    let snapshot: SnapshotRestorer;
    let snapshotTimestamp: number;
    let consortium: Consortium;
    let consortium2: Consortium;

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

        const result = await init(
            burnCommission,
            treasury.address,
            deployer.address
        );
        lbtc = result.lbtc;
        consortium = result.consortium;

        const result2 = await init(
            burnCommission,
            treasury.address,
            deployer.address
        );
        lbtc2 = result2.lbtc;
        consortium2 = result2.consortium;

        bascule = await deployContract<Bascule>(
            'Bascule',
            [
                admin.address,
                pauser.address,
                reporter.address,
                await lbtc.getAddress(),
                100,
            ],
            false
        );

        // mock minter for lbtc
        await lbtc.addMinter(deployer.address);
        await lbtc2.addMinter(deployer.address);

        // set deployer as claimer for lbtc
        await lbtc.addClaimer(deployer.address);
        await lbtc2.addClaimer(deployer.address);

        // set deployer as operator for lbtc
        await lbtc.transferOperatorRole(deployer.address);
        await lbtc2.transferOperatorRole(deployer.address);

        // Initialize the permit module
        await lbtc.reinitialize();
        await lbtc2.reinitialize();

        snapshot = await takeSnapshot();
        snapshotTimestamp = (await ethers.provider.getBlock('latest'))!
            .timestamp;
    });

    afterEach(async function () {
        // clean the state after each test
        await snapshot.restore();
    });

    describe('Setters and getters', function () {
        it('treasury() is set', async function () {
            expect(await lbtc.getTreasury()).to.equal(treasury.address);
            expect(await lbtc2.getTreasury()).to.equal(treasury.address);
        });

        it('owner() is deployer', async function () {
            expect(await lbtc.owner()).to.equal(deployer.address);
        });

        it('decimals()', async function () {
            expect(await lbtc.decimals()).to.equal(8n);
        });

        it('consortium()', async function () {
            expect(await lbtc.consortium()).to.equal(
                await consortium.getAddress()
            );
            expect(await lbtc2.consortium()).to.equal(
                await consortium2.getAddress()
            );
        });

        it('Bascule() unset', async function () {
            expect(await lbtc.Bascule()).to.be.equal(ethers.ZeroAddress);
        });

        it('pause() turns on enforced pause', async function () {
            expect(await lbtc.paused()).to.be.false;
            await expect(lbtc.transferPauserRole(pauser.address))
                .to.emit(lbtc, 'PauserRoleTransferred')
                .withArgs(ethers.ZeroAddress, pauser.address);
            await expect(lbtc.connect(pauser).pause())
                .to.emit(lbtc, 'Paused')
                .withArgs(pauser.address);
            expect(await lbtc.paused()).to.be.true;
        });

        it('pause() reverts when called by not an pauser', async function () {
            await expect(lbtc.connect(signer1).pause())
                .to.revertedWithCustomError(lbtc, 'UnauthorizedAccount')
                .withArgs(signer1.address);
        });

        it('unpause() turns off enforced pause', async function () {
            await expect(lbtc.transferPauserRole(pauser.address))
                .to.emit(lbtc, 'PauserRoleTransferred')
                .withArgs(ethers.ZeroAddress, pauser.address);

            await lbtc.connect(pauser).pause();
            expect(await lbtc.paused()).to.be.true;
            await expect(lbtc.connect(pauser).unpause())
                .to.emit(lbtc, 'Unpaused')
                .withArgs(pauser.address);
            expect(await lbtc.paused()).to.be.false;
        });

        it('unpause() reverts when called by not an pauser', async function () {
            await expect(lbtc.transferPauserRole(pauser.address))
                .to.emit(lbtc, 'PauserRoleTransferred')
                .withArgs(ethers.ZeroAddress, pauser.address);
            await lbtc.connect(pauser).pause();
            expect(await lbtc.paused()).to.be.true;
            await expect(lbtc.connect(signer1).unpause())
                .to.revertedWithCustomError(lbtc, 'UnauthorizedAccount')
                .withArgs(signer1.address);
        });

        it('toggleWithdrawals() enables or disables burn', async function () {
            await expect(lbtc.toggleWithdrawals())
                .to.emit(lbtc, 'WithdrawalsEnabled')
                .withArgs(true);

            await expect(lbtc.toggleWithdrawals())
                .to.emit(lbtc, 'WithdrawalsEnabled')
                .withArgs(false);
        });

        it('toggleWithdrawals() reverts when called by not an owner', async function () {
            await expect(
                lbtc.connect(signer1).toggleWithdrawals()
            ).to.revertedWithCustomError(lbtc, 'OwnableUnauthorizedAccount');
        });

        it('changeBascule', async function () {
            await expect(lbtc.changeBascule(await bascule.getAddress()))
                .to.emit(lbtc, 'BasculeChanged')
                .withArgs(ethers.ZeroAddress, await bascule.getAddress());
            await expect(lbtc.changeBascule(ethers.ZeroAddress))
                .to.emit(lbtc, 'BasculeChanged')
                .withArgs(await bascule.getAddress(), ethers.ZeroAddress);
        });

        it('addMinter should be callable by owner', async function () {
            await expect(lbtc.addMinter(signer1.address))
                .to.emit(lbtc, 'MinterUpdated')
                .withArgs(signer1.address, true);
            expect(await lbtc.isMinter(signer1.address)).to.be.true;
            await lbtc
                .connect(signer1)
                ['mint(address,uint256)'](signer2.address, 100_000_000n);
            expect(await lbtc.balanceOf(signer2.address)).to.be.eq(
                100_000_000n
            );
        });

        it('removeMinter should be callable by owner', async function () {
            await lbtc.addMinter(signer1.address);
            await expect(lbtc.removeMinter(signer1.address))
                .to.emit(lbtc, 'MinterUpdated')
                .withArgs(signer1.address, false);
            expect(await lbtc.isMinter(signer1.address)).to.be.false;
            await expect(
                lbtc
                    .connect(signer1)
                    ['mint(address,uint256)'](signer2.address, 100_000_000n)
            )
                .to.be.revertedWithCustomError(lbtc, 'UnauthorizedAccount')
                .withArgs(signer1.address);
        });

        it('should fail to add minter if not owner', async function () {
            await expect(
                lbtc.connect(signer1).addMinter(signer1.address)
            ).to.revertedWithCustomError(lbtc, 'OwnableUnauthorizedAccount');
        });

        it('should fail to add zero address as minter', async function () {
            await expect(
                lbtc.addMinter(ethers.ZeroAddress)
            ).to.revertedWithCustomError(lbtc, 'ZeroAddress');
        });

        it('should fail to remove minter if not owner', async function () {
            await expect(
                lbtc.connect(signer1).removeMinter(signer1.address)
            ).to.revertedWithCustomError(lbtc, 'OwnableUnauthorizedAccount');
        });

        it('addClaimer should be callable by owner', async function () {
            await expect(lbtc.addClaimer(signer1.address))
                .to.emit(lbtc, 'ClaimerUpdated')
                .withArgs(signer1.address, true);
            expect(await lbtc.isClaimer(signer1.address)).to.be.true;
        });

        it('removeClaimer should be callable by owner', async function () {
            await lbtc.addClaimer(signer1.address);
            await expect(lbtc.removeClaimer(signer1.address))
                .to.emit(lbtc, 'ClaimerUpdated')
                .withArgs(signer1.address, false);
            expect(await lbtc.isClaimer(signer1.address)).to.be.false;
        });

        it('should fail to add claimer if not owner', async function () {
            await expect(
                lbtc.connect(signer1).addClaimer(signer1.address)
            ).to.revertedWithCustomError(lbtc, 'OwnableUnauthorizedAccount');
        });

        it('should fail to add zero address as claimer', async function () {
            await expect(
                lbtc.addClaimer(ethers.ZeroAddress)
            ).to.revertedWithCustomError(lbtc, 'ZeroAddress');
        });

        it('should fail to remove claimer if not owner', async function () {
            await expect(
                lbtc.connect(signer1).removeClaimer(signer1.address)
            ).to.revertedWithCustomError(lbtc, 'OwnableUnauthorizedAccount');
        });

        it('transferOperatorRole should be callable by owner', async function () {
            await expect(lbtc.transferOperatorRole(signer1.address))
                .to.emit(lbtc, 'OperatorRoleTransferred')
                .withArgs(deployer.address, signer1.address);
            expect(await lbtc.operator()).to.be.equal(signer1.address);
        });

        it('should fail to add operator if not owner', async function () {
            await expect(
                lbtc.connect(signer1).transferOperatorRole(signer1.address)
            ).to.revertedWithCustomError(lbtc, 'OwnableUnauthorizedAccount');
        });

        it('should fail to add zero address operator', async function () {
            await expect(
                lbtc.transferOperatorRole(ethers.ZeroAddress)
            ).to.revertedWithCustomError(lbtc, 'ZeroAddress');
        });

        it('should set mint fee by operator', async function () {
            await expect(lbtc.setMintFee(1234))
                .to.emit(lbtc, 'FeeChanged')
                .withArgs(0, 1234);
            expect(await lbtc.getMintFee()).to.be.equal(1234);
        });

        it('should fail to set mint fee if not operator', async function () {
            await expect(
                lbtc.connect(signer1).setMintFee(1)
            ).to.revertedWithCustomError(lbtc, 'UnauthorizedAccount');
        });

        it('changeTreasuryAddres() fails if not owner', async function () {
            await expect(
                lbtc.connect(signer1).changeTreasuryAddress(signer1.address)
            ).to.revertedWithCustomError(lbtc, 'OwnableUnauthorizedAccount');
        });

        it('changeTreasuryAddres() fails if setting treasury to zero address', async function () {
            await expect(
                lbtc.changeTreasuryAddress(ethers.ZeroAddress)
            ).to.revertedWithCustomError(lbtc, 'ZeroAddress');
        });

        it('should get the default dust fee rate', async function () {
            expect(await lbtc.getDustFeeRate()).to.be.equal(
                DEFAULT_LBTC_DUST_FEE_RATE
            );
        });

        it('changeDustFeeRate() fails if not owner', async function () {
            await expect(
                lbtc.connect(signer1).changeDustFeeRate(BigInt(1000))
            ).to.revertedWithCustomError(lbtc, 'OwnableUnauthorizedAccount');
        });

        it('changeDustFeeRate() fails if setting to 0', async function () {
            await expect(lbtc.changeDustFeeRate(0)).to.revertedWithCustomError(
                lbtc,
                'InvalidDustFeeRate'
            );
        });

        it('changeDustFeeRate() succeeds with non zero dust fee', async function () {
            let defaultDustFeeRate = await lbtc.getDustFeeRate();
            let newDustFeeRate = defaultDustFeeRate + BigInt(1000);
            await expect(lbtc.changeDustFeeRate(newDustFeeRate))
                .to.emit(lbtc, 'DustFeeRateChanged')
                .withArgs(defaultDustFeeRate, newDustFeeRate);
            // restore for next tests
            await lbtc.changeDustFeeRate(defaultDustFeeRate);
        });
    });

    describe('Mint', function () {
        let mintWithoutFee: [string[], string[], any[][]] = [[], [], []];
        let mintWithFee: [string[], string[], string[], string[], any[][]] = [
            [],
            [],
            [],
            [],
            [],
        ];

        describe('Positive cases', function () {
            const args = [
                {
                    name: '1 BTC',
                    amount: 100_000_000n,
                    recipient: () => signer2,
                    msgSender: () => signer1,
                },
                {
                    name: '3 satoshi',
                    amount: 3n,
                    recipient: () => signer3,
                    msgSender: () => signer2,
                },
            ];

            args.forEach(async function (args, i) {
                it(`Mint ${args.name}`, async function () {
                    const balanceBefore = await lbtc.balanceOf(
                        args.recipient().address
                    );
                    const totalSupplyBefore = await lbtc.totalSupply();

                    const data = await signDepositBtcPayload(
                        [signer1],
                        [true],
                        CHAIN_ID,
                        args.recipient().address,
                        args.amount,
                        encode(['uint256'], [i + 1]) // txid
                    );

                    await expect(
                        lbtc
                            .connect(args.msgSender())
                            ['mint(bytes,bytes)'](data.payload, data.proof)
                    )
                        .to.emit(lbtc, 'Transfer')
                        .withArgs(
                            ethers.ZeroAddress,
                            args.recipient().address,
                            args.amount
                        );

                    const balanceAfter = await lbtc.balanceOf(
                        args.recipient().address
                    );
                    const totalSupplyAfter = await lbtc.totalSupply();

                    expect(balanceAfter - balanceBefore).to.be.eq(args.amount);
                    expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(
                        args.amount
                    );

                    mintWithoutFee[0].push(data.payload);
                    mintWithoutFee[1].push(data.proof);
                    mintWithoutFee[2].push([
                        ethers.ZeroAddress,
                        args.recipient().address,
                        args.amount,
                    ]);
                });

                const fees = [
                    { max: args.amount, fee: args.amount - 1n },
                    { max: args.amount, fee: 1n },
                    { max: args.amount - 1n, fee: args.amount },
                    { max: 1n, fee: args.amount },
                ];
                fees.forEach(async function ({ fee, max }, j) {
                    it(`Mint ${args.name} with ${fee} satoshis fee and max fee of ${max}`, async function () {
                        const userBalanceBefore = await lbtc.balanceOf(
                            args.recipient().address
                        );
                        const treasuryBalanceBefore = await lbtc.balanceOf(
                            treasury.address
                        );
                        const totalSupplyBefore = await lbtc.totalSupply();

                        const data = await signDepositBtcPayload(
                            [signer1],
                            [true],
                            CHAIN_ID,
                            args.recipient().address,
                            args.amount,
                            encode(['uint256'], [i * 2 + j]) // // txid
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

                        const appliedFee = fee < max ? fee : max;
                        await expect(
                            lbtc.mintWithFee(
                                data.payload,
                                data.proof,
                                approval,
                                userSignature
                            )
                        )
                            .to.emit(lbtc, 'Transfer')
                            .withArgs(
                                ethers.ZeroAddress,
                                args.recipient().address,
                                args.amount - appliedFee
                            )
                            .to.emit(lbtc, 'Transfer')
                            .withArgs(
                                ethers.ZeroAddress,
                                treasury.address,
                                appliedFee
                            )
                            .to.emit(lbtc, 'FeeCharged')
                            .withArgs(appliedFee, userSignature);

                        const userBalanceAfter = await lbtc.balanceOf(
                            args.recipient().address
                        );
                        const treasuryBalanceAfter = await lbtc.balanceOf(
                            treasury.address
                        );
                        const totalSupplyAfter = await lbtc.totalSupply();

                        expect(userBalanceAfter - userBalanceBefore).to.be.eq(
                            args.amount - appliedFee
                        );
                        expect(
                            treasuryBalanceAfter - treasuryBalanceBefore
                        ).to.be.eq(appliedFee);
                        expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(
                            args.amount
                        );

                        if (fee < max) {
                            // use cases where max fee is not relevant
                            // to later on test batMintWithFe
                            mintWithFee[0].push(data.payload);
                            mintWithFee[1].push(data.proof);
                            mintWithFee[2].push(approval);
                            mintWithFee[3].push(userSignature);
                            mintWithFee[4].push([
                                ethers.ZeroAddress,
                                args.recipient().address,
                                args.amount - appliedFee,
                            ]);
                            mintWithFee[4].push([
                                ethers.ZeroAddress,
                                treasury.address,
                                appliedFee,
                            ]);
                        }
                    });
                });
            });

            it('should do permissioned batch mint', async function () {
                await expect(
                    lbtc['batchMint(address[],uint256[])'](
                        [signer1.address, signer2.address],
                        [1, 2]
                    )
                )
                    .to.emit(lbtc, 'Transfer')
                    .withArgs(ethers.ZeroAddress, signer1.address, 1)
                    .to.emit(lbtc, 'Transfer')
                    .withArgs(ethers.ZeroAddress, signer2.address, 2);
            });

            it('should do batch mint for free', async function () {
                const mintPromise = lbtc['batchMint(bytes[],bytes[])'](
                    mintWithoutFee[0],
                    mintWithoutFee[1]
                );

                const transferPromises = mintWithoutFee[2].map(async (args) =>
                    expect(mintPromise)
                        .to.emit(lbtc, 'Transfer')
                        .withArgs(...args)
                );

                await mintPromise;
                await Promise.all(transferPromises);
            });

            it('should do batch mint with fee', async function () {
                // set the maximum fee from args
                await lbtc.setMintFee(
                    args.reduce((x, y) => (x.amount > y.amount ? x : y))
                        .amount + 100n
                );

                const mintPromise = lbtc.batchMintWithFee(
                    mintWithFee[0],
                    mintWithFee[1],
                    mintWithFee[2],
                    mintWithFee[3]
                );

                const transferPromises = mintWithFee[4].map(async (args) =>
                    expect(mintPromise)
                        .to.emit(lbtc, 'Transfer')
                        .withArgs(...args)
                );

                await mintPromise;
                await Promise.all(transferPromises);
            });

            describe('With bascule', function () {
                beforeEach(async function () {
                    // set bascule
                    await lbtc.changeBascule(await bascule.getAddress());
                });

                args.forEach(function (args) {
                    it(`Mint ${args.name}`, async function () {
                        const balanceBefore = await lbtc.balanceOf(
                            args.recipient().address
                        );
                        const totalSupplyBefore = await lbtc.totalSupply();

                        const data = await signDepositBtcPayload(
                            [signer1],
                            [true],
                            CHAIN_ID,
                            args.recipient().address,
                            args.amount,
                            ethers.hexlify(ethers.randomBytes(32)) // extra data, irrelevant
                        );

                        // mint without report fails
                        await expect(
                            lbtc
                                .connect(args.msgSender())
                                ['mint(bytes,bytes)'](data.payload, data.proof)
                        ).to.be.revertedWithCustomError(
                            bascule,
                            'WithdrawalFailedValidation'
                        );

                        // report deposit
                        const reportId = ethers.zeroPadValue('0x01', 32);
                        await expect(
                            bascule.connect(reporter).reportDeposits(reportId, [
                                ethers.keccak256('0x' + data.payload.slice(10)), // use legacy hash
                            ])
                        )
                            .to.emit(bascule, 'DepositsReported')
                            .withArgs(reportId, 1);

                        // mint works
                        await expect(
                            lbtc
                                .connect(args.msgSender())
                                ['mint(bytes,bytes)'](data.payload, data.proof)
                        )
                            .to.emit(lbtc, 'Transfer')
                            .withArgs(
                                ethers.ZeroAddress,
                                args.recipient().address,
                                args.amount
                            );

                        const balanceAfter = await lbtc.balanceOf(
                            args.recipient().address
                        );
                        const totalSupplyAfter = await lbtc.totalSupply();

                        expect(balanceAfter - balanceBefore).to.be.eq(
                            args.amount
                        );
                        expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(
                            args.amount
                        );
                    });
                });
            });
        });

        describe('Negative cases', function () {
            let newConsortium: Consortium;
            const defaultTxId = ethers.hexlify(ethers.randomBytes(32));
            const defaultArgs = {
                signers: () => [signer1, signer2],
                signatures: [true, true],
                threshold: 2,
                mintRecipient: () => signer1,
                signatureRecipient: () => signer1,
                mintAmount: 100_000_000n,
                signatureAmount: 100_000_000n,
                destinationContract: () => lbtc.getAddress(),
                signatureDestinationContract: () => lbtc.getAddress(),
                chainId: CHAIN_ID,
                signatureChainId: CHAIN_ID,
                executionChain: CHAIN_ID,
                caller: () => lbtc.getAddress(),
                verifier: () => newConsortium.getAddress(),
                epoch: 1,
                txId: defaultTxId,
                signatureTxId: defaultTxId,
                interface: () => newConsortium,
                customError: 'NotEnoughSignatures',
                params: () => [],
            };
            let defaultProof: string;
            let defaultPayload: string;

            beforeEach(async function () {
                // Use a bigger consortium to cover more cases
                newConsortium = await deployContract<Consortium>('Consortium', [
                    deployer.address,
                ]);
                const valset = getPayloadForAction(
                    [1, [signer1.publicKey, signer2.publicKey], [1, 1], 2, 1],
                    NEW_VALSET
                );
                await newConsortium.setInitialValidatorSet(valset);
                const data = await signDepositBtcPayload(
                    defaultArgs.signers(),
                    defaultArgs.signatures,
                    defaultArgs.signatureChainId,
                    defaultArgs.signatureRecipient().address,
                    defaultArgs.signatureAmount,
                    defaultArgs.signatureTxId
                );
                defaultProof = data.proof;
                defaultPayload = data.payload;

                await lbtc.changeConsortium(await newConsortium.getAddress());
            });

            const args = [
                {
                    ...defaultArgs,
                    name: 'not enough signatures',
                    signatures: [true, false],
                    customError: 'NotEnoughSignatures',
                },
                {
                    ...defaultArgs,
                    name: 'executed in wrong chain',
                    customError: 'WrongChainId',
                    chainId: 1,
                    interface: () => lbtc,
                },
                {
                    ...defaultArgs,
                    name: 'destination chain missmatch',
                    signatureChainId: ethers.randomBytes(32),
                },
                {
                    ...defaultArgs,
                    name: 'recipient is 0 address',
                    mintRecipient: () => {
                        return { address: ethers.ZeroAddress };
                    },
                    signatureRecipient: () => {
                        return { address: ethers.ZeroAddress };
                    },
                    customError: 'Actions_ZeroAddress',
                    interface: () => lbtc,
                },
                {
                    ...defaultArgs,
                    name: 'extra data signature mismatch',
                    signatureTxId: ethers.randomBytes(32),
                },
                {
                    ...defaultArgs,
                    name: 'extra data mismatch',
                    txId: ethers.randomBytes(32),
                },
                {
                    ...defaultArgs,
                    name: 'amount is 0',
                    mintAmount: 0,
                    signatureAmount: 0,
                    customError: 'ZeroAmount',
                    interface: () => lbtc,
                },
                {
                    ...defaultArgs,
                    name: 'Wrong signature recipient',
                    signatureRecipient: () => signer2,
                },
                {
                    ...defaultArgs,
                    name: 'Wrong mint recipient',
                    mintRecipient: () => signer2,
                },
                {
                    ...defaultArgs,
                    name: 'Wrong amount',
                    mintAmount: 1,
                },
                {
                    ...defaultArgs,
                    name: 'unknown validator set',
                    signers: () => [signer1, deployer],
                    customError: 'NotEnoughSignatures',
                },
                {
                    ...defaultArgs,
                    name: 'wrong amount of signatures',
                    signers: () => [signer1],
                    signatures: [true],
                    customError: 'LengthMismatch',
                },
            ];
            args.forEach(function (args) {
                it(`Reverts when ${args.name}`, async function () {
                    const data = await signDepositBtcPayload(
                        args.signers(),
                        args.signatures,
                        args.signatureChainId,
                        args.signatureRecipient().address,
                        args.signatureAmount,
                        args.signatureTxId
                    );
                    const payload = getPayloadForAction(
                        [
                            encode(['uint256'], [args.chainId]),
                            encode(['address'], [args.mintRecipient().address]),
                            args.mintAmount,
                            args.txId,
                            0,
                        ],
                        DEPOSIT_BTC_ACTION
                    );

                    await expect(
                        lbtc['mint(bytes,bytes)'](payload, data.proof)
                    ).to.revertedWithCustomError(
                        args.interface(),
                        args.customError
                    );
                });
            });

            it('Reverts when paused', async function () {
                await lbtc.transferPauserRole(deployer.address);
                await lbtc.pause();

                // try to use the same proof again
                await expect(
                    lbtc['mint(bytes,bytes)'](defaultPayload, defaultProof)
                ).to.revertedWithCustomError(lbtc, 'EnforcedPause');
            });

            it('Reverts when payload is already used', async function () {
                // use the payload
                await lbtc['mint(bytes,bytes)'](defaultPayload, defaultProof);
                // try to use the same payload again
                await expect(
                    lbtc['mint(bytes,bytes)'](defaultPayload, defaultProof)
                ).to.revertedWithCustomError(lbtc, 'PayloadAlreadyUsed');

                await expect(
                    lbtc.mintWithFee(
                        defaultPayload,
                        defaultProof,
                        getPayloadForAction(
                            [1, snapshotTimestamp + 100],
                            'feeApproval'
                        ),
                        await getFeeTypedMessage(
                            defaultArgs.mintRecipient(),
                            await lbtc.getAddress(),
                            1,
                            snapshotTimestamp + 100
                        )
                    )
                ).to.revertedWithCustomError(lbtc, 'PayloadAlreadyUsed');
            });

            describe('With fee', function () {
                it('should revert if expired', async function () {
                    await expect(
                        lbtc.mintWithFee(
                            defaultPayload,
                            defaultProof,
                            getPayloadForAction(
                                [1, snapshotTimestamp],
                                'feeApproval'
                            ),
                            await getFeeTypedMessage(
                                defaultArgs.mintRecipient(),
                                await lbtc.getAddress(),
                                1,
                                snapshotTimestamp // it is already passed as some txns had happen
                            )
                        )
                    )
                        .to.revertedWithCustomError(
                            lbtc,
                            'UserSignatureExpired'
                        )
                        .withArgs(snapshotTimestamp);
                });

                it('should revert if wrong deposit btc payload type', async function () {
                    let feeApprovalPayload = getPayloadForAction(
                        [1, snapshotTimestamp],
                        'feeApproval'
                    );
                    await expect(
                        lbtc.mintWithFee(
                            feeApprovalPayload,
                            defaultProof,
                            feeApprovalPayload,
                            await getFeeTypedMessage(
                                defaultArgs.mintRecipient(),
                                await lbtc.getAddress(),
                                1,
                                snapshotTimestamp // it is already passed as some txns had happen
                            )
                        )
                    )
                        .to.revertedWithCustomError(lbtc, 'UnexpectedAction')
                        .withArgs(feeApprovalPayload.slice(0, 10));
                });

                it('should revert if wrong fee approval btc payload type', async function () {
                    await expect(
                        lbtc.mintWithFee(
                            defaultPayload,
                            defaultProof,
                            defaultPayload,
                            await getFeeTypedMessage(
                                defaultArgs.mintRecipient(),
                                await lbtc.getAddress(),
                                1,
                                snapshotTimestamp // it is already passed as some txns had happen
                            )
                        )
                    )
                        .to.revertedWithCustomError(lbtc, 'UnexpectedAction')
                        .withArgs(defaultPayload.slice(0, 10));
                });

                it('should revert if not claimer', async function () {
                    await expect(
                        lbtc
                            .connect(signer1)
                            .mintWithFee(
                                defaultPayload,
                                defaultProof,
                                getPayloadForAction(
                                    [1, snapshotTimestamp + 100],
                                    'feeApproval'
                                ),
                                await getFeeTypedMessage(
                                    defaultArgs.mintRecipient(),
                                    await lbtc.getAddress(),
                                    1,
                                    snapshotTimestamp + 100
                                )
                            )
                    )
                        .to.revertedWithCustomError(lbtc, 'UnauthorizedAccount')
                        .withArgs(signer1);
                });

                it('should revert if fee is too much', async function () {
                    // make sure current fee is not going to reduce the amount charged
                    await lbtc.setMintFee(defaultArgs.mintAmount + 10n);

                    await expect(
                        lbtc.mintWithFee(
                            defaultPayload,
                            defaultProof,
                            getPayloadForAction(
                                [
                                    defaultArgs.mintAmount,
                                    snapshotTimestamp + 100,
                                ],
                                'feeApproval'
                            ),
                            await getFeeTypedMessage(
                                defaultArgs.mintRecipient(),
                                await lbtc.getAddress(),
                                defaultArgs.mintAmount,
                                snapshotTimestamp + 100
                            )
                        )
                    ).to.revertedWithCustomError(lbtc, 'FeeGreaterThanAmount');
                });

                it('should revert if signature is not from receiver', async function () {
                    await expect(
                        lbtc.mintWithFee(
                            defaultPayload,
                            defaultProof,
                            getPayloadForAction(
                                [1, snapshotTimestamp + 100],
                                'feeApproval'
                            ),
                            await getFeeTypedMessage(
                                deployer,
                                await lbtc.getAddress(),
                                1,
                                snapshotTimestamp + 100
                            )
                        )
                    ).to.revertedWithCustomError(lbtc, 'InvalidUserSignature');
                });

                it("should revert if fee signature doesn't match fee payload", async function () {
                    await expect(
                        lbtc.mintWithFee(
                            defaultPayload,
                            defaultProof,
                            getPayloadForAction(
                                [1, snapshotTimestamp + 100],
                                'feeApproval'
                            ),
                            await getFeeTypedMessage(
                                defaultArgs.mintRecipient(),
                                await lbtc.getAddress(),
                                2, // wrong fee
                                snapshotTimestamp + 100
                            )
                        )
                    ).to.revertedWithCustomError(lbtc, 'InvalidUserSignature');
                });

                describe('With batch', function () {
                    it('should fail to batch if something is wrong with the data', async function () {
                        const proofs = [...mintWithFee[1]];
                        proofs[proofs.length - 1] = '0x';
                        await expect(
                            lbtc.batchMintWithFee(
                                mintWithFee[0],
                                proofs,
                                mintWithFee[2],
                                mintWithFee[3]
                            )
                        ).to.be.reverted;
                    });

                    it('should fail to batch if not claimer', async function () {
                        const proofs = [...mintWithFee[1]];
                        proofs[proofs.length - 1] = '0x';
                        await expect(
                            lbtc
                                .connect(signer1)
                                .batchMintWithFee(
                                    mintWithFee[0],
                                    proofs,
                                    mintWithFee[2],
                                    mintWithFee[3]
                                )
                        )
                            .to.be.revertedWithCustomError(
                                lbtc,
                                'UnauthorizedAccount'
                            )
                            .withArgs(signer1.address);
                    });

                    it('should fail to batch if parameters length missmatch', async function () {
                        let pop = (arg: string[]) => {
                            const data = [...arg];
                            data.pop();
                            return data;
                        };
                        await expect(
                            lbtc.batchMintWithFee(
                                pop(mintWithFee[0]),
                                mintWithFee[0],
                                mintWithFee[2],
                                mintWithFee[3]
                            )
                        ).to.be.revertedWithCustomError(
                            lbtc,
                            'InvalidInputLength'
                        );
                        await expect(
                            lbtc.batchMintWithFee(
                                mintWithFee[0],
                                pop(mintWithFee[0]),
                                mintWithFee[2],
                                mintWithFee[3]
                            )
                        ).to.be.revertedWithCustomError(
                            lbtc,
                            'InvalidInputLength'
                        );
                        await expect(
                            lbtc.batchMintWithFee(
                                mintWithFee[0],
                                mintWithFee[0],
                                pop(mintWithFee[2]),
                                mintWithFee[3]
                            )
                        ).to.be.revertedWithCustomError(
                            lbtc,
                            'InvalidInputLength'
                        );
                        await expect(
                            lbtc.batchMintWithFee(
                                mintWithFee[0],
                                mintWithFee[0],
                                mintWithFee[2],
                                pop(mintWithFee[3])
                            )
                        ).to.be.revertedWithCustomError(
                            lbtc,
                            'InvalidInputLength'
                        );
                    });
                });
            });

            it('should fail to batch mint for free if something is wrong in a mint', async function () {
                const proofs = [...mintWithoutFee[1]];
                proofs[proofs.length - 1] = '0x';

                await expect(
                    lbtc['batchMint(bytes[],bytes[])'](
                        mintWithoutFee[0],
                        proofs
                    )
                ).to.be.reverted;
            });

            it('should fail to batch mint for free if parameters size missmatch', async function () {
                const payloads = [...mintWithoutFee[0]];
                const proofs = [...mintWithoutFee[1]];
                payloads.pop();
                proofs.pop();

                await expect(
                    lbtc['batchMint(bytes[],bytes[])'](
                        mintWithoutFee[0],
                        proofs
                    )
                ).to.be.revertedWithCustomError(lbtc, 'InvalidInputLength');
                await expect(
                    lbtc['batchMint(bytes[],bytes[])'](
                        payloads,
                        mintWithoutFee[1]
                    )
                ).to.be.revertedWithCustomError(lbtc, 'InvalidInputLength');
            });
        });

        it('should fail to do permissioned batch mint if parameters size missmatch', async function () {
            await expect(
                lbtc['batchMint(address[],uint256[])'](
                    [signer1.address],
                    [1, 2]
                )
            ).to.be.revertedWithCustomError(lbtc, 'InvalidInputLength');
            await expect(
                lbtc['batchMint(address[],uint256[])'](
                    [signer1.address, signer2.address],
                    [1]
                )
            ).to.be.revertedWithCustomError(lbtc, 'InvalidInputLength');
        });

        it('should fail to do permissioned batch mint if no minter', async function () {
            await expect(
                lbtc
                    .connect(signer1)
                    [
                        'batchMint(address[],uint256[])'
                    ]([signer1.address, signer1.address], [1, 2])
            )
                .to.be.revertedWithCustomError(lbtc, 'UnauthorizedAccount')
                .withArgs(signer1.address);
        });
    });

    describe('Burn', function () {
        beforeEach(async function () {
            await lbtc.toggleWithdrawals();
        });

        describe('Positive cases', function () {
            it('Unstake half with P2WPKH', async () => {
                const amount = 100_000_000n;
                const halfAmount = amount / 2n;
                const p2wpkh = '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03';

                const burnCommission = await lbtc.getBurnCommission();

                const expectedAmountAfterFee =
                    halfAmount - BigInt(burnCommission);

                await lbtc.mintTo(signer1.address, amount);
                await expect(lbtc.connect(signer1).redeem(p2wpkh, halfAmount))
                    .to.emit(lbtc, 'UnstakeRequest')
                    .withArgs(signer1.address, p2wpkh, expectedAmountAfterFee);
            });

            it('Unstake full with P2TR', async () => {
                const amount = 100_000_000n;
                const p2tr =
                    '0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947';

                const burnCommission = await lbtc.getBurnCommission();

                const expectedAmountAfterFee = amount - BigInt(burnCommission);
                await lbtc.mintTo(signer1.address, amount);
                await expect(lbtc.connect(signer1).redeem(p2tr, amount))
                    .to.emit(lbtc, 'UnstakeRequest')
                    .withArgs(signer1.address, p2tr, expectedAmountAfterFee);
            });

            it('Unstake with commission', async () => {
                const amount = 100_000_000n;
                const commission = 1_000_000n;
                const p2tr =
                    '0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947';

                await lbtc.changeBurnCommission(commission);

                await lbtc.mintTo(signer1.address, amount);

                await expect(lbtc.connect(signer1).redeem(p2tr, amount))
                    .to.emit(lbtc, 'UnstakeRequest')
                    .withArgs(signer1.address, p2tr, amount - commission);
            });

            it('Unstake full with P2WSH', async () => {
                const amount = 100_000_000n;
                const p2wsh =
                    '0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3';
                await lbtc.mintTo(signer1.address, amount);

                // Get the burn commission
                const burnCommission = await lbtc.getBurnCommission();

                // Calculate expected amount after fee
                const expectedAmountAfterFee = amount - BigInt(burnCommission);

                await expect(lbtc.connect(signer1).redeem(p2wsh, amount))
                    .to.emit(lbtc, 'UnstakeRequest')
                    .withArgs(signer1.address, p2wsh, expectedAmountAfterFee);
            });
        });

        describe('Negative cases', function () {
            it('Reverts when withdrawals off', async function () {
                await lbtc.toggleWithdrawals();
                const amount = 100_000_000n;
                await lbtc.mintTo(signer1.address, amount);
                await expect(
                    lbtc.redeem(
                        '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
                        amount
                    )
                ).to.revertedWithCustomError(lbtc, 'WithdrawalsDisabled');
            });

            it('Reverts if amount is less than burn commission', async function () {
                const burnCommission = await lbtc.getBurnCommission();
                const amountLessThanCommission = BigInt(burnCommission) - 1n;

                await lbtc.mintTo(signer1.address, amountLessThanCommission);

                await expect(
                    lbtc
                        .connect(signer1)
                        .redeem(
                            '0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03',
                            amountLessThanCommission
                        )
                )
                    .to.be.revertedWithCustomError(
                        lbtc,
                        'AmountLessThanCommission'
                    )
                    .withArgs(burnCommission);
            });

            it('Reverts when amount is below dust limit for P2WSH', async () => {
                const p2wsh =
                    '0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3';
                const burnCommission = await lbtc.getBurnCommission();

                // Start with a very small amount
                let amount = burnCommission + 1n;
                let isAboveDust = false;

                // Incrementally increase the amount until we find the dust limit
                while (!isAboveDust) {
                    amount += 1n;
                    [, isAboveDust] = await lbtc.calcUnstakeRequestAmount(
                        p2wsh,
                        amount
                    );
                }

                // Now 'amount' is just above the dust limit. Let's use an amount 1 less than this.
                const amountJustBelowDustLimit = amount - 1n;

                await lbtc.mintTo(signer1.address, amountJustBelowDustLimit);

                await expect(
                    lbtc
                        .connect(signer1)
                        .redeem(p2wsh, amountJustBelowDustLimit)
                ).to.be.revertedWithCustomError(lbtc, 'AmountBelowDustLimit');
            });

            it('Revert with P2SH', async () => {
                const amount = 100_000_000n;
                const p2sh = '0xa914aec38a317950a98baa9f725c0cb7e50ae473ba2f87';
                await lbtc.mintTo(signer1.address, amount);
                await expect(
                    lbtc.connect(signer1).redeem(p2sh, amount)
                ).to.be.revertedWithCustomError(
                    lbtc,
                    'ScriptPubkeyUnsupported'
                );
            });

            it('Reverts with P2PKH', async () => {
                const amount = 100_000_000n;
                const p2pkh =
                    '0x76a914aec38a317950a98baa9f725c0cb7e50ae473ba2f88ac';
                await lbtc.mintTo(signer1.address, amount);
                await expect(
                    lbtc.connect(signer1).redeem(p2pkh, amount)
                ).to.be.revertedWithCustomError(
                    lbtc,
                    'ScriptPubkeyUnsupported'
                );
            });

            it('Reverts with P2PK', async () => {
                const amount = 100_000_000n;
                const p2pk =
                    '0x4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac';
                await lbtc.mintTo(signer1.address, amount);
                await expect(
                    lbtc.connect(signer1).redeem(p2pk, amount)
                ).to.be.revertedWithCustomError(
                    lbtc,
                    'ScriptPubkeyUnsupported'
                );
            });

            it('Reverts with P2MS', async () => {
                const amount = 100_000_000n;
                const p2ms =
                    '0x524104d81fd577272bbe73308c93009eec5dc9fc319fc1ee2e7066e17220a5d47a18314578be2faea34b9f1f8ca078f8621acd4bc22897b03daa422b9bf56646b342a24104ec3afff0b2b66e8152e9018fe3be3fc92b30bf886b3487a525997d00fd9da2d012dce5d5275854adc3106572a5d1e12d4211b228429f5a7b2f7ba92eb0475bb14104b49b496684b02855bc32f5daefa2e2e406db4418f3b86bca5195600951c7d918cdbe5e6d3736ec2abf2dd7610995c3086976b2c0c7b4e459d10b34a316d5a5e753ae';
                await lbtc.mintTo(signer1.address, amount);
                await expect(
                    lbtc.connect(signer1).redeem(p2ms, amount)
                ).to.be.revertedWithCustomError(
                    lbtc,
                    'ScriptPubkeyUnsupported'
                );
            });

            it('Reverts not enough to pay commission', async () => {
                const amount = 999_999n;
                const commission = 1_000_000n;
                const p2tr =
                    '0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947';

                await lbtc.changeBurnCommission(commission);

                await lbtc.mintTo(signer1.address, amount);

                await expect(lbtc.connect(signer1).redeem(p2tr, amount))
                    .to.revertedWithCustomError(
                        lbtc,
                        'AmountLessThanCommission'
                    )
                    .withArgs(commission);
            });
        });
    });

    describe('Permit', function () {
        let timestamp: number;
        let chainId: bigint;

        before(async function () {
            const block = await ethers.provider.getBlock('latest');
            timestamp = block!.timestamp;
            chainId = (await ethers.provider.getNetwork()).chainId;
        });

        beforeEach(async function () {
            // Mint some tokens
            await lbtc['mint(address,uint256)'](signer1.address, 100_000_000n);
        });

        afterEach(async function () {
            await snapshot.restore();
        });

        it('should transfer funds with permit', async function () {
            // generate permit signature
            const { v, r, s } = await generatePermitSignature(
                lbtc,
                signer1,
                signer2.address,
                10_000n,
                timestamp + 100,
                chainId,
                0
            );

            await lbtc.permit(
                signer1.address,
                signer2.address,
                10_000n,
                timestamp + 100,
                v,
                r,
                s
            );

            // check allowance
            expect(
                await lbtc.allowance(signer1.address, signer2.address)
            ).to.equal(10_000n);

            // check transferFrom
            await lbtc
                .connect(signer2)
                .transferFrom(signer1.address, signer3.address, 10_000n);
            expect(await lbtc.balanceOf(signer3.address)).to.equal(10_000n);

            // check nonce is incremented
            expect(await lbtc.nonces(signer1.address)).to.equal(1);
        });

        describe("fail if permit params don't match the signature", function () {
            let v: number;
            let r: string;
            let s: string;

            before(async function () {
                // generate permit signature
                const signature = await generatePermitSignature(
                    lbtc,
                    signer1,
                    signer2.address,
                    10_000n,
                    timestamp + 100,
                    chainId,
                    0
                );
                v = signature.v;
                r = signature.r;
                s = signature.s;
            });

            const params: [
                () => string,
                () => string,
                bigint,
                () => number,
                string,
            ][] = [
                [
                    () => signer1.address,
                    () => signer3.address,
                    10_000n,
                    () => timestamp + 100,
                    'is sensitive to wrong spender',
                ],
                [
                    () => signer3.address,
                    () => signer2.address,
                    10_000n,
                    () => timestamp + 100,
                    'is sensitive to wrong signer',
                ],
                [
                    () => signer1.address,
                    () => signer2.address,
                    10_000n,
                    () => timestamp + 200,
                    'is sensitive to wrong deadline',
                ],
                [
                    () => signer1.address,
                    () => signer2.address,
                    1n,
                    () => timestamp + 100,
                    'is sensitive to wrong value',
                ],
            ];

            params.forEach(async function ([
                signer,
                spender,
                value,
                deadline,
                label,
            ]) {
                it(label, async function () {
                    await expect(
                        lbtc.permit(
                            signer(),
                            spender(),
                            value,
                            deadline(),
                            v,
                            r,
                            s
                        )
                    ).to.be.revertedWithCustomError(
                        lbtc,
                        'ERC2612InvalidSigner'
                    );
                });
            });
        });

        describe("fail if signature don't match permit params", function () {
            // generate permit signature
            const signaturesData: [
                () => Signer,
                () => string,
                bigint,
                () => number,
                () => bigint,
                number,
                string,
            ][] = [
                [
                    () => signer3,
                    () => signer2.address,
                    10_000n,
                    () => timestamp + 100,
                    () => chainId,
                    0,
                    'is sensitive to wrong signer',
                ],
                [
                    () => signer1,
                    () => signer3.address,
                    10_000n,
                    () => timestamp + 100,
                    () => chainId,
                    0,
                    'is sensitive to wrong spender',
                ],
                [
                    () => signer1,
                    () => signer2.address,
                    1n,
                    () => timestamp + 100,
                    () => chainId,
                    0,
                    'is sensitive to wrong value',
                ],
                [
                    () => signer1,
                    () => signer2.address,
                    10_000n,
                    () => timestamp + 1,
                    () => chainId,
                    0,
                    'is sensitive to wrong deadline',
                ],
                [
                    () => signer1,
                    () => signer2.address,
                    10_000n,
                    () => timestamp + 100,
                    () => 1234n,
                    0,
                    'is sensitive to wrong chainId',
                ],
                [
                    () => signer1,
                    () => signer2.address,
                    1n,
                    () => timestamp + 100,
                    () => chainId,
                    1,
                    'is sensitive to wrong nonce',
                ],
            ];
            signaturesData.forEach(
                async ([
                    signer,
                    spender,
                    value,
                    deadline,
                    chainId,
                    nonce,
                    label,
                ]) => {
                    it(label, async () => {
                        const { v, r, s } = await generatePermitSignature(
                            lbtc,
                            signer(),
                            spender(),
                            value,
                            deadline(),
                            chainId(),
                            nonce
                        );
                        await expect(
                            lbtc.permit(
                                signer1,
                                signer2.address,
                                10_000n,
                                timestamp + 100,
                                v,
                                r,
                                s
                            )
                        ).to.be.revertedWithCustomError(
                            lbtc,
                            'ERC2612InvalidSigner'
                        );
                    });
                }
            );
        });
    });
});
