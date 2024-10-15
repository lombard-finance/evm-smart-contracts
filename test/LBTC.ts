import { ethers } from "hardhat";
import { expect } from "chai";
import { takeSnapshot } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import {
  signPayload,
  deployContract,
  getSignersWithPrivateKeys,
  getPayloadForAction,
  CHAIN_ID,
  generatePermitSignature,
  getFeeTypedMessage,
  encode,
  rawSign,
  enhancePayload
} from "./helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LBTCMock, Bascule, LombardConsortium } from "../typechain-types";
import { SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot";

describe("LBTC", function () {
  let deployer: HardhatEthersSigner,
    signer1: HardhatEthersSigner,
    signer2: HardhatEthersSigner,
    signer3: HardhatEthersSigner,
    treasury: HardhatEthersSigner,
    reporter: HardhatEthersSigner,
    admin: HardhatEthersSigner,
    pauser: HardhatEthersSigner;
  let lbtc: LBTCMock;
  let lbtc2: LBTCMock;
  let bascule: Bascule;
  let consortium: LombardConsortium;
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

    consortium = await deployContract<LombardConsortium>("LombardConsortium", [deployer.address]);
    lbtc = await deployContract<LBTCMock>("LBTCMock", [await consortium.getAddress(), 100, deployer.address]);
    lbtc2 = await deployContract<LBTCMock>("LBTCMock", [await consortium.getAddress(), 100, deployer.address]);
    bascule = await deployContract<Bascule>("Bascule", [admin.address, pauser.address, reporter.address, await lbtc.getAddress(), 100], false);

    await lbtc.changeTreasuryAddress(treasury.address);
    await lbtc2.changeTreasuryAddress(treasury.address);

    await consortium.setInitalValidatorSet([signer1.publicKey], [1], 1, 1);

    // mock minter for lbtc
    await lbtc.addMinter(deployer.address);
    await lbtc2.addMinter(deployer.address);

    // set deployer as claimer for lbtc
    await lbtc.addClaimer(deployer.address);
    await lbtc2.addClaimer(deployer.address);

    snapshot = await takeSnapshot();
    snapshotTimestamp = (await ethers.provider.getBlock("latest"))!.timestamp;
  });

  afterEach(async function () {
    // clean the state after each test
    await snapshot.restore();
  });

  describe("Setters and getters", function () {
    // TODO: check treasury

    it("owner() is deployer", async function () {
      expect(await lbtc.owner()).to.equal(deployer.address);
    });

    it("getDepositRelativeCommission", async function () {
      expect(
        await lbtc.getDepositRelativeCommission(ethers.zeroPadValue("0x", 32))
      ).to.equal(0);
    });

    it("getDepositAbsoluteCommission", async function () {
      expect(
        await lbtc.getDepositAbsoluteCommission(ethers.zeroPadValue("0x", 32))
      ).to.equal(0);
    });

    it("consortium() set at initialization", async function () {
      expect(await lbtc.consortium()).to.equal(await consortium.getAddress());
    });

    it("decimals()", async function () {
      expect(await lbtc.decimals()).to.equal(8n);
    });

    it("Bascule() unset", async function () {
      expect(await lbtc.Bascule()).to.be.equal(ethers.ZeroAddress);
    });

    it("pause() turns on enforced pause", async function () {
      expect(await lbtc.paused()).to.be.false;
      await expect(lbtc.transferPauserRole(pauser.address))
        .to.emit(lbtc, "PauserRoleTransferred")
        .withArgs(ethers.ZeroAddress, pauser.address);
      await expect(lbtc.connect(pauser).pause())
        .to.emit(lbtc, "Paused")
        .withArgs(pauser.address);
      expect(await lbtc.paused()).to.be.true;
    });

    it("pause() reverts when called by not an pauser", async function () {
      await expect(lbtc.connect(signer1).pause())
        .to.revertedWithCustomError(lbtc, "UnauthorizedAccount")
        .withArgs(signer1.address);
    });

    it("unpause() turns off enforced pause", async function () {
      await expect(lbtc.transferPauserRole(pauser.address))
        .to.emit(lbtc, "PauserRoleTransferred")
        .withArgs(ethers.ZeroAddress, pauser.address);

      await lbtc.connect(pauser).pause();
      expect(await lbtc.paused()).to.be.true;
      await expect(lbtc.connect(pauser).unpause())
        .to.emit(lbtc, "Unpaused")
        .withArgs(pauser.address);
      expect(await lbtc.paused()).to.be.false;
    });

    it("unpause() reverts when called by not an pauser", async function () {
      await expect(lbtc.transferPauserRole(pauser.address))
        .to.emit(lbtc, "PauserRoleTransferred")
        .withArgs(ethers.ZeroAddress, pauser.address);
      await lbtc.connect(pauser).pause();
      expect(await lbtc.paused()).to.be.true;
      await expect(lbtc.connect(signer1).unpause())
        .to.revertedWithCustomError(lbtc, "UnauthorizedAccount")
        .withArgs(signer1.address);
    });

    it("changeNameAndSymbol", async function () {
      const newName = "NEW_NAME";
      const newSymbol = "NEW_SYMBOL";
      await expect(lbtc.changeNameAndSymbol(newName, newSymbol))
        .to.emit(lbtc, "NameAndSymbolChanged")
        .withArgs(newName, newSymbol);
      expect(await lbtc.name()).to.be.eq(newName);
      expect(await lbtc.symbol()).to.be.eq(newSymbol);
    });

    it("toggleWithdrawals() enables or disables burn", async function () {
      await expect(lbtc.toggleWithdrawals())
        .to.emit(lbtc, "WithdrawalsEnabled")
        .withArgs(true);

      await expect(lbtc.toggleWithdrawals())
        .to.emit(lbtc, "WithdrawalsEnabled")
        .withArgs(false);
    });

    it("toggleWithdrawals() reverts when called by not an owner", async function () {
      await expect(
        lbtc.connect(signer1).toggleWithdrawals()
      ).to.revertedWithCustomError(lbtc, "OwnableUnauthorizedAccount");
    });

    it("changeBascule", async function () {
      await expect(lbtc.changeBascule(await bascule.getAddress()))
        .to.emit(lbtc, "BasculeChanged")
        .withArgs(ethers.ZeroAddress, await bascule.getAddress());
      await expect(lbtc.changeBascule(ethers.ZeroAddress))
        .to.emit(lbtc, "BasculeChanged")
        .withArgs(await bascule.getAddress(), ethers.ZeroAddress);
    });

    it("addMinter should be callable by owner", async function () {
      await expect(lbtc.addMinter(signer1.address))
        .to.emit(lbtc, "MinterUpdated")
        .withArgs(signer1.address, true);
      expect(await lbtc.isMinter(signer1.address)).to.be.true;
      await lbtc.connect(signer1)[["mint(address,uint256)"]](signer2.address, 100_000_000n);
      expect(await lbtc.balanceOf(signer2.address)).to.be.eq(100_000_000n);
    });

    it("removeMinter should be callable by owner", async function () {
      await lbtc.addMinter(signer1.address);
      await expect(lbtc.removeMinter(signer1.address))
        .to.emit(lbtc, "MinterUpdated")
        .withArgs(signer1.address, false);
      expect(await lbtc.isMinter(signer1.address)).to.be.false;
      await expect(lbtc.connect(signer1)[["mint(address,uint256)"]](signer2.address, 100_000_000n))
        .to.be.revertedWithCustomError(lbtc, "UnauthorizedAccount")
        .withArgs(signer1.address);
    });
  });

  describe("Mint", function () {
    let mintWithoutFee: [string[], string[], any[][]] = [[], [], []];
    let mintWithFee: [string[], string[], string[], string[], any[][]] = [[], [], [], [], []];
    
    describe("Positive cases", function () {
      const args = [
        {
          name: "1 BTC",
          amount: 100_000_000n,
          recipient: () => signer2,
          msgSender: () => signer1,
        },
        {
          name: "3 satoshi",
          amount: 3n,
          recipient: () => signer3,
          msgSender: () => signer2,
        }
      ];
      
      args.forEach(async function (args, i) {        
        it(`Mint ${args.name}`, async function () {
          const balanceBefore = await lbtc.balanceOf(args.recipient().address);
          const totalSupplyBefore = await lbtc.totalSupply();
  
          const data = await signPayload(
            [signer1], 
            [true],
            [
              CHAIN_ID,
              await lbtc.getAddress(),
              args.recipient().address, 
              args.amount, 
              ethers.hexlify(ethers.randomBytes(i + 1)), // extra data, irrelevant
            ],
            CHAIN_ID,
            await lbtc.getAddress(),
            await consortium.getAddress(),
            1,
            "stake",
          );
  
          await expect(lbtc.connect(args.msgSender())["mint(bytes,bytes)"](data.payload, data.proof))
            .to.emit(lbtc, "Transfer")
            .withArgs(ethers.ZeroAddress, args.recipient().address, args.amount);
  
          const balanceAfter = await lbtc.balanceOf(args.recipient().address);
          const totalSupplyAfter = await lbtc.totalSupply();
  
          expect(balanceAfter - balanceBefore).to.be.eq(args.amount);
          expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(args.amount);

          mintWithoutFee[0].push(data.payload);
          mintWithoutFee[1].push(data.proof);
          mintWithoutFee[2].push([ethers.ZeroAddress, args.recipient().address, args.amount]);
        });

        const fees = [1n, args.amount - 1n];
        fees.forEach(async function (fee, j) {
          it(`Mint ${args.name} with ${fee} satoshis fee`, async function () {
            // set domain
            await lbtc.reinitializeV3("Lombard", "1");

            const userBalanceBefore = await lbtc.balanceOf(args.recipient().address);
            const treasuryBalanceBefore = await lbtc.balanceOf(treasury.address);
            const totalSupplyBefore = await lbtc.totalSupply();
    
            const data = await signPayload(
              [signer1],
              [true],
              [
                CHAIN_ID,
                await lbtc.getAddress(),
                args.recipient().address, 
                args.amount, 
                ethers.hexlify(ethers.randomBytes(i * 2 + j)), // extra data, irrelevant
              ],
              CHAIN_ID,
              await lbtc.getAddress(),
              await consortium.getAddress(),
              1,
              "stake",
            );
            const userSignature = await getFeeTypedMessage(
              args.recipient(),
              await lbtc.getAddress(),
              fee,
              snapshotTimestamp + 100,
            );
    
            const approval = getPayloadForAction([fee, snapshotTimestamp + 100], "feeApproval");
            await expect(lbtc.mintWithFee(
              data.payload,
              data.proof,
              approval,
              userSignature
            ))
              .to.emit(lbtc, "Transfer")
              .withArgs(ethers.ZeroAddress, args.recipient().address, args.amount - fee)
              .to.emit(lbtc, "Transfer")
              .withArgs(ethers.ZeroAddress, treasury.address, fee);
    
            const userBalanceAfter = await lbtc.balanceOf(args.recipient().address);
            const treasuryBalanceAfter = await lbtc.balanceOf(treasury.address);
            const totalSupplyAfter = await lbtc.totalSupply();
    
            expect(userBalanceAfter - userBalanceBefore).to.be.eq(args.amount - fee);
            expect(treasuryBalanceAfter - treasuryBalanceBefore).to.be.eq(fee);
            expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(args.amount);

            mintWithFee[0].push(data.payload);
            mintWithFee[1].push(data.proof);
            mintWithFee[2].push(approval);
            mintWithFee[3].push(userSignature);
            mintWithFee[4].push([ethers.ZeroAddress, args.recipient().address, args.amount - fee]);
            mintWithFee[4].push([ethers.ZeroAddress, treasury.address, fee]);
          });
        })
      });

      it("should do permissioned batch mint", async function () {
        await expect(lbtc["batchMint(address[],uint256[])"](
          [signer1.address, signer2.address],
          [1, 2]
        ))
          .to.emit(lbtc, "Transfer").withArgs(ethers.ZeroAddress, signer1.address, 1)
          .to.emit(lbtc, "Transfer").withArgs(ethers.ZeroAddress, signer2.address, 2);
      });

      it("should do batch mint for free", async function () {
        const mintPromise = lbtc["batchMint(bytes[],bytes[])"](mintWithoutFee[0], mintWithoutFee[1]);

        const transferPromises = mintWithoutFee[2].map(async (args) => 
            expect(mintPromise).to.emit(lbtc, "Transfer").withArgs(...args)
        );
        
        await mintPromise;
        await Promise.all(transferPromises);
      });

      it("should do batch mint with fee", async function () {
        await lbtc.reinitializeV3("Lombard", "1");

        const mintPromise = lbtc.batchMintWithFee(mintWithFee[0], mintWithFee[1], mintWithFee[2], mintWithFee[3]);

        const transferPromises = mintWithFee[4].map(async (args) => 
            expect(mintPromise).to.emit(lbtc, "Transfer").withArgs(...args)
        );

        await mintPromise;
        await Promise.all(transferPromises);
      });
  
      describe("With bascule", function () {
        beforeEach(async function () {
          // set bascule
          await lbtc.changeBascule(await bascule.getAddress());
        });
  
        args.forEach(function (args) {
          it(`Mint ${args.name}`, async function () {
            const balanceBefore = await lbtc.balanceOf(args.recipient().address);
            const totalSupplyBefore = await lbtc.totalSupply();
    
            const data = await signPayload(
              [signer1], 
              [true],
              [ 
                CHAIN_ID, 
                await lbtc.getAddress(),
                args.recipient().address, 
                args.amount, 
                ethers.hexlify(ethers.randomBytes(12)), // extra data, irrelevant
              ],
              CHAIN_ID,
              await lbtc.getAddress(),
              await consortium.getAddress(),
              1,
              "stake",
            );
    
            // mint without report fails
            await expect(
              lbtc
                .connect(args.msgSender())
                ["mint(bytes,bytes)"](data.payload, data.proof)
            ).to.be.revertedWithCustomError(bascule, "WithdrawalFailedValidation");
    
            // report deposit
            const reportId = ethers.zeroPadValue("0x01", 32);
            await expect(
              bascule
                .connect(reporter)
                .reportDeposits(reportId, [ethers.sha256(data.payload)])
            )
              .to.emit(bascule, "DepositsReported")
              .withArgs(reportId, 1);
    
            // mint works
            await expect(
              lbtc
                .connect(args.msgSender())
                ["mint(bytes,bytes)"](data.payload, data.proof)
            )
              .to.emit(lbtc, "Transfer")
              .withArgs(ethers.ZeroAddress, args.recipient().address, args.amount);
    
            const balanceAfter = await lbtc.balanceOf(args.recipient().address);
            const totalSupplyAfter = await lbtc.totalSupply();
    
            expect(balanceAfter - balanceBefore).to.be.eq(args.amount);
            expect(totalSupplyAfter - totalSupplyBefore).to.be.eq(args.amount);
          });
        });
      });
    });

    describe("Negative cases", function () {
      let newConsortium: LombardConsortium;
      const defaultExtraData = ethers.hexlify(ethers.randomBytes(4));
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
        extraData: defaultExtraData,
        signatureExtraData: defaultExtraData,
        interface: () => newConsortium,
        customError: "SignatureVerificationFailed",
        params: () => []
      }
      let defaultProof: string;
      let defaultPayload: string;
      
      beforeEach (async function () {
        // Use a bigger consortium to cover more cases
        newConsortium = await deployContract<LombardConsortium>("LombardConsortium", [deployer.address]);
        await newConsortium.setInitalValidatorSet([signer1.publicKey, signer2.publicKey], [1, 1], 2, 1);
        const {proof, payload} = await signPayload(
          defaultArgs.signers(), 
          defaultArgs.signatures,
          [
            defaultArgs.signatureChainId,
            await defaultArgs.signatureDestinationContract(),
            defaultArgs.signatureRecipient().address, 
            defaultArgs.signatureAmount, 
            defaultArgs.signatureExtraData,
          ],
          defaultArgs.executionChain,
          await defaultArgs.caller(),
          await defaultArgs.verifier(),
          await defaultArgs.epoch,
          "stake",
        );
        defaultProof = proof;
        defaultPayload = payload;

        await lbtc.changeConsortium(await newConsortium.getAddress());
      })
      
      const args = [
        {
          ...defaultArgs,
          name: "not enough signatures",
          signatures: [true, false],
          customError: "NotEnoughSignatures",
        },
        {
          ...defaultArgs,
          name: "executed in wrong chain",
          customError: "WrongChainId",
          chainId: 1,
          interface: () => lbtc
        },
        {
          ...defaultArgs,
          name: "destination chain missmatch",
          signatureChainId: defaultArgs.chainId + 1,
        },
        {
          ...defaultArgs,
          name: "recipient is 0 address",
          mintRecipient: () => { return {address: ethers.ZeroAddress}},
          signatureRecipient: () => {return {address: ethers.ZeroAddress}},
          customError: "ZeroAddress",
          interface: () => lbtc
        },
        {
          ...defaultArgs,
          name: "extra data signature mismatch",
          signatureExtraData: ethers.randomBytes(5),
        },
        {
          ...defaultArgs,
          name: "extra data mismatch",
          extraData: ethers.randomBytes(5),
        },
        {
          ...defaultArgs,
          name: "amount is 0",
          mintAmount: 0,
          signatureAmount: 0,
          customError: "ZeroAmount",
          interface: () => lbtc
        },
        {
          ...defaultArgs,
          name: "Wrong signature recipient",
          signatureRecipient: () => signer2,
        },
        {
          ...defaultArgs,
          name: "Wrong mint recipient",
          mintRecipient: () => signer2,
        },
        {
          ...defaultArgs,
          name: "Wrong amount",
          mintAmount: 1,
        },
        {
          ...defaultArgs,
          name: "unknown validator set",
          signers: () => [signer1, deployer],
          customError: "SignatureVerificationFailed",
        },
        {
          ...defaultArgs,
          name: "wrong amount of signatures",
          signers: () => [signer1],
          signatures: [true],
          customError: "LengthMismatch",
        },
      ];
      args.forEach(function (args) {
        it(`Reverts when ${args.name}`, async function () {
          const signature = (await signPayload(
            args.signers(), 
            args.signatures,
            [
              args.signatureChainId, 
              await args.signatureDestinationContract(), 
              args.signatureRecipient().address, 
              args.signatureAmount, 
              args.signatureExtraData
            ],
            args.executionChain,
            await args.caller(),
            await args.verifier(),
            await args.epoch,
            "stake",
          )).proof;
          const payload = getPayloadForAction(
            [
              args.chainId, 
              await args.destinationContract(), 
              args.mintRecipient().address, 
              args.mintAmount, 
              args.extraData
            ],
            "stake",
          );
  
          await expect(
            lbtc["mint(bytes,bytes)"](payload, signature)
          ).to.revertedWithCustomError(args.interface(), args.customError);
        });
      });
  
      it("Reverts when paused", async function () {
        await lbtc.transferPauserRole(deployer.address);
        await lbtc.pause();
        
        // try to use the same proof again
        await expect(
          lbtc["mint(bytes,bytes)"](defaultPayload, defaultProof)
        ).to.revertedWithCustomError(lbtc, "EnforcedPause");
      });
  
      it("Reverts when payload is already used", async function () {
        // use the payload
        await lbtc["mint(bytes,bytes)"](defaultPayload, defaultProof);
        // try to use the same payload again
        await expect(
          lbtc["mint(bytes,bytes)"](defaultPayload, defaultProof)
        ).to.revertedWithCustomError(lbtc, "PayloadAlreadyUsed");

        await expect(
          lbtc.mintWithFee(
            defaultPayload, 
            defaultProof,
            ethers.randomBytes(30), // not relevant feePayload
            ethers.randomBytes(65), // not relevant signature
          )
        ).to.revertedWithCustomError(lbtc, "PayloadAlreadyUsed");
      });

      describe("With fee", function () {
        beforeEach(async function () {
          await lbtc.reinitializeV3("Lombard", "1");
        })

        it("should revert if expired", async function () {
          await expect(lbtc.mintWithFee(
            defaultPayload,
            ethers.randomBytes(65),  // not relevant, should not get to valition
            getPayloadForAction([1, snapshotTimestamp], "feeApproval"),
            await getFeeTypedMessage(
              defaultArgs.mintRecipient(),
              await lbtc.getAddress(),
              1,
              snapshotTimestamp // it is already passed as some txns had happen
            )
          ))
            .to.revertedWithCustomError(lbtc, "UserSignatureExpired")
            .withArgs(snapshotTimestamp);
        })

        it("should revert if fee is too much", async function () {
          await expect(lbtc.mintWithFee(
            defaultPayload,
            ethers.randomBytes(65),  // not relevant, should not get to valition
            getPayloadForAction([defaultArgs.mintAmount, snapshotTimestamp + 100], "feeApproval"),
            await getFeeTypedMessage(
              defaultArgs.mintRecipient(),
              await lbtc.getAddress(),
              defaultArgs.mintAmount,
              snapshotTimestamp + 100
            )
          ))
            .to.revertedWithCustomError(lbtc, "FeeGreaterThanAmount");        
        })

        it("should revert if signature is not from receiver", async function () {
          await expect(lbtc.mintWithFee(
            defaultPayload,
            ethers.randomBytes(65),  // not relevant, should not get to valition
            getPayloadForAction([1, snapshotTimestamp + 100], "feeApproval"),
            await getFeeTypedMessage(
              deployer,
              await lbtc.getAddress(),
              1,
              snapshotTimestamp + 100
            )
          ))
            .to.revertedWithCustomError(lbtc, "InvalidUserSignature");        
        })

        it("should revert if fee signature doesn't match fee payload", async function () {
          await expect(lbtc.mintWithFee(
            defaultPayload,
            ethers.randomBytes(65),  // not relevant, should not get to valition
            getPayloadForAction([1, snapshotTimestamp + 100], "feeApproval"),
            await getFeeTypedMessage(
              defaultArgs.mintRecipient(),
              await lbtc.getAddress(),
              2, // wrong fee
              snapshotTimestamp + 100
            )
          ))
            .to.revertedWithCustomError(lbtc, "InvalidUserSignature");        
        })

        it("should mint in batches", async function () {

        })
      })

      it("should fail to batch mint for free if something is wrong in a mint", async function () {
        const proofs = [...mintWithoutFee[1]];
        proofs[proofs.length - 1] = "0x";

        await expect(lbtc["batchMint(bytes[],bytes[])"](mintWithoutFee[0], proofs))
          .to.be.reverted;
      });

      it("should fail to batch mint for free if parameters size missmatch", async function () {
        const payloads = [...mintWithoutFee[0]];
        const proofs = [...mintWithoutFee[1]];
        payloads.pop()
        proofs.pop()

        await expect(lbtc["batchMint(bytes[],bytes[])"](mintWithoutFee[0], proofs))
          .to.be.revertedWithCustomError(lbtc, "InvalidInputLength");
        await expect(lbtc["batchMint(bytes[],bytes[])"](payloads, mintWithoutFee[1]))
          .to.be.revertedWithCustomError(lbtc, "InvalidInputLength");
      });

      describe("Batch with fee", function () {
        beforeEach(async function () {
          await lbtc.reinitializeV3("Lombard", "1");
        });

        it("should fail to batch if something is wrong with the data", async function () {
          const proofs = [...mintWithFee[1]];
          proofs[proofs.length - 1] = "0x";
          await expect(lbtc.batchMintWithFee(mintWithFee[0], proofs, mintWithFee[2], mintWithFee[3]))
            .to.be.reverted;
        });

        it("should fail to batch if parameters length missmatch", async function () {
          let pop = (arg: string[]) => {
            const data = [...arg];
            data.pop();
            return data;
          }
          await expect(lbtc.batchMintWithFee(pop(mintWithFee[0]), mintWithFee[0], mintWithFee[2], mintWithFee[3]))
            .to.be.revertedWithCustomError(lbtc, "InvalidInputLength");
          await expect(lbtc.batchMintWithFee(mintWithFee[0], pop(mintWithFee[0]), mintWithFee[2], mintWithFee[3]))
            .to.be.revertedWithCustomError(lbtc, "InvalidInputLength");
          await expect(lbtc.batchMintWithFee(mintWithFee[0], mintWithFee[0], pop(mintWithFee[2]), mintWithFee[3]))
            .to.be.revertedWithCustomError(lbtc, "InvalidInputLength");
          await expect(lbtc.batchMintWithFee(mintWithFee[0], mintWithFee[0], mintWithFee[2], pop(mintWithFee[3])))
            .to.be.revertedWithCustomError(lbtc, "InvalidInputLength");
        });
      });
    });

    it("should fail to do permissioned batch mint if parameters size missmatch", async function () {
      await expect(lbtc["batchMint(address[],uint256[])"]([signer1.address],[1, 2]))
        .to.be.revertedWithCustomError(lbtc, "InvalidInputLength");
      await expect(lbtc["batchMint(address[],uint256[])"]([signer1.address, signer2.address],[1]))
        .to.be.revertedWithCustomError(lbtc, "InvalidInputLength");
    });

    it("should fail to do permissioned batch mint if no minter", async function () {
      await expect(lbtc.connect(signer1)["batchMint(address[],uint256[])"]([signer1.address, signer1.address],[1, 2]))
        .to.be.revertedWithCustomError(lbtc, "UnauthorizedAccount").withArgs(signer1.address);
    });
  });
  
  describe("Burn", function () {
    beforeEach(async function () {
      await lbtc.toggleWithdrawals();
    });

    describe("Positive cases", function () {
      it("Unstake half with P2WPKH", async () => {
        const amount = 100_000_000n;
        const halfAmount = amount / 2n;
        const p2wpkh = "0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03";
  
        const burnCommission = await lbtc.getBurnCommission();
  
        const expectedAmountAfterFee = halfAmount - BigInt(burnCommission);
  
        await lbtc.mintTo(signer1.address, amount);
        await expect(lbtc.connect(signer1).redeem(p2wpkh, halfAmount))
          .to.emit(lbtc, "UnstakeRequest")
          .withArgs(signer1.address, p2wpkh, expectedAmountAfterFee);
      });
  
      it("Unstake full with P2TR", async () => {
        const amount = 100_000_000n;
        const p2tr =
          "0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947";
  
        const burnCommission = await lbtc.getBurnCommission();
  
        const expectedAmountAfterFee = amount - BigInt(burnCommission);
        await lbtc.mintTo(signer1.address, amount);
        await expect(lbtc.connect(signer1).redeem(p2tr, amount))
          .to.emit(lbtc, "UnstakeRequest")
          .withArgs(signer1.address, p2tr, expectedAmountAfterFee);
      });
  
      it("Unstake with commission", async () => {
        const amount = 100_000_000n;
        const commission = 1_000_000n;
        const p2tr =
          "0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947";
  
        await lbtc.changeBurnCommission(commission);
  
        await lbtc.mintTo(signer1.address, amount);
  
        await expect(lbtc.connect(signer1).redeem(p2tr, amount))
          .to.emit(lbtc, "UnstakeRequest")
          .withArgs(signer1.address, p2tr, amount - commission);
      });
  
      it("Unstake full with P2WSH", async () => {
        const amount = 100_000_000n;
        const p2wsh =
          "0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3";
        await lbtc.mintTo(signer1.address, amount);
  
        // Get the burn commission
        const burnCommission = await lbtc.getBurnCommission();
  
        // Calculate expected amount after fee
        const expectedAmountAfterFee = amount - BigInt(burnCommission);
  
        await expect(lbtc.connect(signer1).redeem(p2wsh, amount))
          .to.emit(lbtc, "UnstakeRequest")
          .withArgs(signer1.address, p2wsh, expectedAmountAfterFee);
      });
    });

    describe("Negative cases", function () {
      it("Reverts when withdrawals off", async function () {
        await lbtc.toggleWithdrawals();
        const amount = 100_000_000n;
        await lbtc.mintTo(signer1.address, amount);
        await expect(
          lbtc.redeem("0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03", amount)
        ).to.revertedWithCustomError(lbtc, "WithdrawalsDisabled");
      });
  
      it("Reverts if amount is less than burn commission", async function () {
        const burnCommission = await lbtc.getBurnCommission();
        const amountLessThanCommission = BigInt(burnCommission) - 1n;
  
        await lbtc.mintTo(
          signer1.address,
          amountLessThanCommission
        );
  
        await expect(
          lbtc
            .connect(signer1)
            .redeem(
              "0x00143dee6158aac9b40cd766b21a1eb8956e99b1ff03",
              amountLessThanCommission
            )
        )
          .to.be.revertedWithCustomError(lbtc, "AmountLessThanCommission")
          .withArgs(burnCommission);
      });
  
      it("Reverts when amount is below dust limit for P2WSH", async () => {
        const p2wsh =
          "0x002065f91a53cb7120057db3d378bd0f7d944167d43a7dcbff15d6afc4823f1d3ed3";
        const burnCommission = await lbtc.getBurnCommission();
  
        // Start with a very small amount
        let amount = burnCommission + 1n;
        let isAboveDust = false;
  
        // Incrementally increase the amount until we find the dust limit
        while (!isAboveDust) {
          amount += 1n;
          [, isAboveDust] = await lbtc.calcUnstakeRequestAmount(p2wsh, amount);
        }
  
        // Now 'amount' is just above the dust limit. Let's use an amount 1 less than this.
        const amountJustBelowDustLimit = amount - 1n;
  
        await lbtc.mintTo(
          signer1.address,
          amountJustBelowDustLimit
        );
  
        await expect(
          lbtc.connect(signer1).redeem(p2wsh, amountJustBelowDustLimit)
        ).to.be.revertedWithCustomError(lbtc, "AmountBelowDustLimit");
      });
  
      it("Revert with P2SH", async () => {
        const amount = 100_000_000n;
        const p2sh = "0xa914aec38a317950a98baa9f725c0cb7e50ae473ba2f87";
        await lbtc.mintTo(signer1.address, amount);
        await expect(
          lbtc.connect(signer1).redeem(p2sh, amount)
        ).to.be.revertedWithCustomError(lbtc, "ScriptPubkeyUnsupported");
      });
  
      it("Reverts with P2PKH", async () => {
        const amount = 100_000_000n;
        const p2pkh = "0x76a914aec38a317950a98baa9f725c0cb7e50ae473ba2f88ac";
        await lbtc.mintTo(signer1.address, amount);
        await expect(
          lbtc.connect(signer1).redeem(p2pkh, amount)
        ).to.be.revertedWithCustomError(lbtc, "ScriptPubkeyUnsupported");
      });
  
      it("Reverts with P2PK", async () => {
        const amount = 100_000_000n;
        const p2pk =
          "0x4104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac";
        await lbtc.mintTo(signer1.address, amount);
        await expect(
          lbtc.connect(signer1).redeem(p2pk, amount)
        ).to.be.revertedWithCustomError(lbtc, "ScriptPubkeyUnsupported");
      });
  
      it("Reverts with P2MS", async () => {
        const amount = 100_000_000n;
        const p2ms =
          "0x524104d81fd577272bbe73308c93009eec5dc9fc319fc1ee2e7066e17220a5d47a18314578be2faea34b9f1f8ca078f8621acd4bc22897b03daa422b9bf56646b342a24104ec3afff0b2b66e8152e9018fe3be3fc92b30bf886b3487a525997d00fd9da2d012dce5d5275854adc3106572a5d1e12d4211b228429f5a7b2f7ba92eb0475bb14104b49b496684b02855bc32f5daefa2e2e406db4418f3b86bca5195600951c7d918cdbe5e6d3736ec2abf2dd7610995c3086976b2c0c7b4e459d10b34a316d5a5e753ae";
        await lbtc.mintTo(signer1.address, amount);
        await expect(
          lbtc.connect(signer1).redeem(p2ms, amount)
        ).to.be.revertedWithCustomError(lbtc, "ScriptPubkeyUnsupported");
      });
  
      it("Reverts not enough to pay commission", async () => {
        const amount = 999_999n;
        const commission = 1_000_000n;
        const p2tr =
          "0x5120999d8dd965f148662dc38ab5f4ee0c439cadbcc0ab5c946a45159e30b3713947";
  
        await lbtc.changeBurnCommission(commission);
  
        await lbtc.mintTo(signer1.address, amount);
  
        await expect(lbtc.connect(signer1).redeem(p2tr, amount))
          .to.revertedWithCustomError(lbtc, "AmountLessThanCommission")
          .withArgs(commission);
      });
    });
  });

  describe("Permit", function () {
    let timestamp: number;
    let chainId: bigint;

    before(async function () {
      const block = await ethers.provider.getBlock("latest");
      timestamp = block!.timestamp;  
      chainId = (await ethers.provider.getNetwork()).chainId; 
    });

    beforeEach(async function () {
      // Initialize the permit module
      await lbtc.reinitialize();      

      // Mint some tokens
      await lbtc["mint(address,uint256)"](signer1.address, 100_000_000n);
    });

    afterEach(async function () {
      await snapshot.restore();
    });

    it("should transfer funds with permit", async function () {
      // generate permit signature
      const { v, r, s } = await generatePermitSignature(lbtc, signer1, signer2.address, 10_000n, timestamp + 100, chainId, 0);
      
      await lbtc.permit(signer1.address, signer2.address, 10_000n, timestamp + 100, v, r, s);
      
      // check allowance
      expect(await lbtc.allowance(signer1.address, signer2.address)).to.equal(10_000n);

      // check transferFrom
      await lbtc.connect(signer2).transferFrom(signer1.address, signer3.address, 10_000n);
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
        const signature = await generatePermitSignature(lbtc, signer1, signer2.address, 10_000n, timestamp + 100, chainId, 0);
        v = signature.v;
        r = signature.r;
        s = signature.s;
      });

      const params: [() => Signer, () => string, bigint, () => number, string][] = [
        [() => signer1.address, () => signer3.address, 10_000n, () => timestamp + 100, "is sensitive to wrong spender"],
        [() => signer3.address, () => signer2.address, 10_000n, () => timestamp + 100, "is sensitive to wrong signer"],
        [() => signer1.address, () => signer2.address, 10_000n, () => timestamp + 200,   "is sensitive to wrong deadline"],
        [() => signer1.address, () => signer2.address, 1n,      () => timestamp + 100, "is sensitive to wrong value"],
      ];
 
      params.forEach(async function([signer, spender, value, deadline, label]) {
        it(label, async function () {
          await expect(lbtc.permit(signer(), spender(), value, deadline(), v, r, s))
          .to.be.revertedWithCustomError(lbtc, "ERC2612InvalidSigner");
        });
      });
    });

    describe("fail if signature don't match permit params", function () {
      // generate permit signature
      const signaturesData: [() => Signer, () => string, bigint, () => number, () => bigint, number, string][] = [
        [() => signer3, () => signer2.address, 10_000n, () => timestamp + 100, () => chainId, 0, "is sensitive to wrong signer"],
        [() => signer1, () => signer3.address, 10_000n, () => timestamp + 100, () => chainId, 0, "is sensitive to wrong spender"],
        [() => signer1, () => signer2.address, 1n, () => timestamp + 100, () => chainId, 0, "is sensitive to wrong value"],
        [() => signer1, () => signer2.address, 10_000n, () => timestamp + 1, () => chainId, 0, "is sensitive to wrong deadline"],
        [() => signer1, () => signer2.address, 10_000n, () => timestamp + 100, () => 1234n, 0, "is sensitive to wrong chainId"],
        [() => signer1, () => signer2.address, 1n, () => timestamp + 100, () => chainId, 1, "is sensitive to wrong nonce"],
      ];
      signaturesData.forEach(async ([signer, spender, value, deadline, chainId, nonce, label]) => {
        it(label, async () => {
        const { v, r, s } = await generatePermitSignature(lbtc, signer(), spender(), value, deadline(), chainId(), nonce);
        await expect(lbtc.permit(signer1, signer2.address, 10_000n, timestamp + 100, v, r, s))
          .to.be.revertedWithCustomError(lbtc, "ERC2612InvalidSigner");
        });
      });
    });
  });

  describe("Bridge", function () {
    const absoluteFee = 100n;

    beforeEach(async function () {
      await lbtc.mintTo(
        signer1.address,
        10000n
      );
      await lbtc.addDestination(
        CHAIN_ID,
        ethers.zeroPadValue(await lbtc2.getAddress(), 32),
        1000,
        0
      );
      await lbtc2.addDestination(
        CHAIN_ID,
        ethers.zeroPadValue(await lbtc.getAddress(), 32),
        1,
        absoluteFee
      );
    });

    it("full flow", async () => {
      let amount = 10000n;
      let fee = amount / 10n;

      let amountWithoutFee = amount - fee;
      let receiver = signer2.address;

      let payload = getPayloadForAction([
        CHAIN_ID,
        await lbtc.getAddress(),
        CHAIN_ID,
        await lbtc2.getAddress(),
        receiver,
        amountWithoutFee,
        encode(["uint256"], [0])
      ], "bridge");

      await expect(lbtc.connect(signer1).depositToBridge(
        CHAIN_ID,
        ethers.zeroPadValue(receiver, 32),
        amount
      ))
        .to.emit(lbtc, "DepositToBridge")
        .withArgs(
          signer1.address,
          ethers.zeroPadValue(receiver, 32),
          ethers.sha256(payload),
          payload
        );

      expect(await lbtc.balanceOf(signer1.address)).to.be.equal(0);
      expect(await lbtc.balanceOf(treasury.address)).to.be.equal(fee);
      expect((await lbtc.totalSupply()).toString()).to.be.equal(fee);
      
      expect(await lbtc2.balanceOf(signer2.address)).to.be.equal(0);
      expect(await lbtc2.totalSupply()).to.be.equal(0);

      const data1 = await signPayload(
        [signer1],
        [true],
        [
          CHAIN_ID,
          await lbtc.getAddress(),
          CHAIN_ID,
          await lbtc2.getAddress(),
          receiver,
          amountWithoutFee,
          encode(["uint256"], [0])
        ],
        CHAIN_ID,
        await lbtc2.getAddress(),
        await consortium.getAddress(),
        1,
        "bridge"
      );

      await expect(lbtc2.connect(signer2).withdrawFromBridge(data1.payload, data1.proof))
        .to.emit(lbtc2, "WithdrawFromBridge")
        .withArgs(
          receiver,
          ethers.sha256(data1.payload),
          data1.payload
        );
      expect((await lbtc2.totalSupply()).toString()).to.be.equal(amount - fee);
      expect((await lbtc2.balanceOf(signer2.address)).toString()).to.be.equal(
        amountWithoutFee
      );

      // bridge back

      amount = amountWithoutFee;

      fee = 1n + absoluteFee;
      amountWithoutFee = amount - fee;

      payload = getPayloadForAction([
        CHAIN_ID,
        await lbtc2.getAddress(),
        CHAIN_ID,
        await lbtc.getAddress(),
        receiver,
        amountWithoutFee,
        encode(["uint256"], [0])
      ], "bridge");

      await expect(lbtc2.connect(signer2).depositToBridge(
        CHAIN_ID,
        ethers.zeroPadValue(receiver, 32),
        amount
      ))
        .to.emit(lbtc2, "DepositToBridge")
        .withArgs(
          signer2.address,
          ethers.zeroPadValue(receiver, 32),
          ethers.sha256(payload),
          payload
        );

      expect(await lbtc2.balanceOf(signer2.address)).to.be.equal(0);
      expect(await lbtc2.balanceOf(treasury.address)).to.be.equal(fee);
      expect(await lbtc2.totalSupply()).to.be.equal(fee);

      const data2 = await signPayload(
        [signer1],
        [true],
        [
          CHAIN_ID,
          await lbtc2.getAddress(),
          CHAIN_ID,
          await lbtc.getAddress(),
          receiver,
          amountWithoutFee,
          encode(["uint256"], [0])
        ],
        CHAIN_ID,
        await lbtc.getAddress(),
        await consortium.getAddress(),
        1,
        "bridge"
      );

      await expect(lbtc.connect(signer2).withdrawFromBridge(data2.payload, data2.proof))
        .to.emit(lbtc, "WithdrawFromBridge")
        .withArgs(
          receiver,
          ethers.sha256(data2.payload),
          data2.payload
        );
    });

    it("withdrawFromBridge (with Bascule)", async () => {
      // Enable Bascule
      await lbtc.changeBascule(await bascule.getAddress());

      // Use the 2nd half of the full flow test to test the Bascule integration
      let amount = 10000n;;
      let receiver = signer3.address;

      const data = await signPayload(
        [signer1],
        [true],
        [
          CHAIN_ID,
          await lbtc2.getAddress(),
          CHAIN_ID,
          await lbtc.getAddress(),
          receiver,
          amount,
          encode(["uint256"], [0])
        ],
        CHAIN_ID,
        await lbtc.getAddress(),
        await consortium.getAddress(),
        1,
        "bridge"
      );

      // withdraw without report fails
      await expect(lbtc.connect(signer2).withdrawFromBridge(data.payload, data.proof))
        .to.be.revertedWithCustomError(bascule, "WithdrawalFailedValidation")
        .withArgs(ethers.sha256(data.payload), amount);

      // report deposit
      const reportId = ethers.zeroPadValue("0x01", 32);
      await bascule.connect(reporter).reportDeposits(reportId, [ethers.sha256(data.payload)]);

      // withdraw works
      await expect(
        lbtc.connect(signer2).withdrawFromBridge(data.payload, data.proof)
      )
        .to.emit(lbtc, "WithdrawFromBridge")
        .withArgs(
          receiver,
          ethers.sha256(data.payload),
          data.payload
        );
    });
  });
});
