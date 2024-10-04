import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { BTCBPMM, WBTCMock, LBTC } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { takeSnapshot, SnapshotRestorer } from "@nomicfoundation/hardhat-network-helpers";

describe("BTCBPMM", function () {
  let pmm: BTCBPMM;
  let btcb: WBTCMock;
  let lbtc: LBTC;

  let deployer: HardhatEthersSigner;
  let withdrawalAddress: HardhatEthersSigner;
  let signer1: HardhatEthersSigner;
  let signer2: HardhatEthersSigner;
  let timeLock: HardhatEthersSigner;
  let pauser: HardhatEthersSigner;

  let snapshot: SnapshotRestorer;

  async function deploy<T>(contractName: string, asType: string, args: any[] = [], isProxy: boolean = true) {
    const factory = await ethers.getContractFactory(contractName);
    const contract = isProxy ? await upgrades.deployProxy(factory, args) : await factory.deploy(...args);
    await contract.waitForDeployment();
    return (await ethers.getContractFactory(asType)).attach(await contract.getAddress()) as T;
  }

  before(async function () {
    [deployer, withdrawalAddress, signer1, signer2, timeLock, pauser] = await ethers.getSigners();

    btcb = await deploy<WBTCMock>("WBTCMock", "WBTCMock");
    lbtc = await deploy<LBTC>("LBTC", "LBTC", [
        ethers.hexlify(ethers.randomBytes(20)), // not relevant for BTCB tests
        1000                                    // not relevant for BTCB tests 
    ]);
    pmm = await deploy<BTCBPMM>("BTCBPMM", "BTCBPMM", [
        await lbtc.getAddress(),
        await btcb.getAddress(),
        await deployer.getAddress(),
        ethers.parseUnits("30", 8),
        await withdrawalAddress.getAddress()
    ]);

    // use btcb decimals of 8
    await btcb.setDecimals(18);

    snapshot = await takeSnapshot();
  });

  afterEach(async function () {
    // get back to a clean state
    await snapshot.restore();
  });

  describe("Access Control", function () {

    it("should revert if withdrawal address is not set by the timelock", async function () {
      await expect(pmm.connect(signer1).setWithdrawalAddress(await signer1.getAddress())) 
      .to.be.revertedWithCustomError(pmm, "AccessControlUnauthorizedAccount")
      .withArgs(signer1.address, await pmm.TIMELOCK_ROLE());
    });

    it("should revert if stake limit is set by non-timelock", async function () {
        await expect(pmm.setStakeLimit(100))
        .to.be.revertedWithCustomError(pmm, "AccessControlUnauthorizedAccount")
        .withArgs(deployer.address, await pmm.TIMELOCK_ROLE());
    });

    it("should revert if pause is triggered by non-pauser", async function () {
        await expect(pmm.pause())
            .to.be.revertedWithCustomError(pmm, "AccessControlUnauthorizedAccount")
            .withArgs(deployer.address, await pmm.PAUSER_ROLE());
    });

    it("should revert if unpause is triggered by non-admin", async function () {
        await expect(pmm.connect(signer1).unpause())
            .to.be.revertedWithCustomError(pmm, "AccessControlUnauthorizedAccount")
            .withArgs(signer1.address, await pmm.DEFAULT_ADMIN_ROLE());
    });

    it("should revert if withdrawBTCB is triggered by non-admin", async function () {
        await expect(pmm.connect(signer1).withdrawBTCB(100))
            .to.be.revertedWithCustomError(pmm, "AccessControlUnauthorizedAccount")
            .withArgs(signer1.address, await pmm.DEFAULT_ADMIN_ROLE());
    });

    it("should revert if contract is not paused", async function () {
        await expect(pmm.unpause())
            .to.be.revertedWithCustomError(pmm, "ExpectedPause");
    });

    describe("With Pauser", function () {
        beforeEach(async function () {
            await pmm.grantRole(await pmm.PAUSER_ROLE(), await pauser.getAddress());
        });

        it("should pause the contract", async function () {
            await expect(pmm.connect(pauser).pause())
                .to.emit(pmm, "Paused")
                .withArgs(pauser.address);
            expect(await pmm.paused()).to.be.true;
        });

        it("should unpause the contract", async function () {
            await pmm.connect(pauser).pause();
            await expect(pmm.unpause())
                .to.emit(pmm, "Unpaused")
                .withArgs(deployer.address);
            expect(await pmm.paused()).to.be.false;
        });
    });

    describe("With Timelock", function () {
        beforeEach(async function () {
            await pmm.grantRole(await pmm.TIMELOCK_ROLE(), await timeLock.getAddress());
        });

        it("should set the withdrawal address", async function () {
            await expect(pmm.connect(timeLock).setWithdrawalAddress(withdrawalAddress.address))
                .to.emit(pmm, "WithdrawalAddressSet")
                .withArgs(withdrawalAddress.address);
            expect(await pmm.withdrawalAddress()).to.equal(withdrawalAddress.address);
        });

        it("should set the stake limit", async function () {
            await expect(pmm.connect(timeLock).setStakeLimit(100))
                .to.emit(pmm, "StakeLimitSet")
                .withArgs(100);
            expect(await pmm.stakeLimit()).to.equal(100);
            expect(await pmm.remainingStake()).to.equal(100);
        });
    });
  });
  
  describe("Operations", function () {
    beforeEach(async function () {
        await pmm.grantRole(await pmm.PAUSER_ROLE(), await pauser.getAddress());
        await pmm.grantRole(await pmm.TIMELOCK_ROLE(), await timeLock.getAddress());

        // some btcb for signers
        await btcb.mint(await signer1.getAddress(), ethers.parseUnits("100", 18));
        await btcb.mint(await signer2.getAddress(), ethers.parseUnits("100", 18));
    });

    it("should fail to swap if PMM is not whitelisted as minter", async function () {
        await btcb.connect(signer1).approve(await pmm.getAddress(), ethers.parseUnits("10", 10));
        await expect(pmm.connect(signer1).swapBTCBToLBTC(ethers.parseUnits("10", 10)))
            .to.be.revertedWithCustomError(lbtc, "UnauthorizedAccount")
            .withArgs(await pmm.getAddress());
    });

    it("should fail to swap if amount is to low and will result in 0 LBTC", async function () {
        await btcb.connect(signer1).approve(await pmm.getAddress(), 1);
        await expect(pmm.connect(signer1).swapBTCBToLBTC(1))
            .to.be.revertedWithCustomError(lbtc, "ZeroAmount");
    });

    describe("With whitelisted minter", function () {
        beforeEach(async function () {
            await lbtc.addMinter(await pmm.getAddress());
        });

        it("should allow swaps", async function () {
            await btcb.connect(signer1).approve(await pmm.getAddress(), ethers.parseUnits("11", 18) + 10n);
            await expect(pmm.connect(signer1).swapBTCBToLBTC(ethers.parseUnits("11", 18) + 10n))
                .to.emit(btcb, "Transfer")
                .withArgs(signer1.address, await pmm.getAddress(), ethers.parseUnits("11", 18))
                .to.emit(lbtc, "Transfer")
                .withArgs(ethers.ZeroAddress, signer1.address, ethers.parseUnits("11", 8));
            expect(await pmm.remainingStake()).to.equal(ethers.parseUnits("19", 8));
            expect(await lbtc.balanceOf(signer1.address)).to.equal(ethers.parseUnits("11", 8));
            expect(await btcb.balanceOf(signer1.address)).to.equal(ethers.parseUnits("89", 18));
            expect(await btcb.balanceOf(await pmm.getAddress())).to.equal(ethers.parseUnits("11", 18));
        });

        it("should fail to swap more than limit", async function () {
            await btcb.connect(signer1).approve(await pmm.getAddress(), ethers.parseUnits("35", 18));
            await expect(pmm.connect(signer1).swapBTCBToLBTC(ethers.parseUnits("35", 18)))
                .to.be.revertedWithCustomError(pmm, "StakeLimitExceeded");
        });

        it("should allow more swaps if limit is increased", async function () {
            await btcb.connect(signer1).approve(await pmm.getAddress(), ethers.parseUnits("30", 18));
            await pmm.connect(signer1).swapBTCBToLBTC(ethers.parseUnits("30", 18));
            expect(await pmm.remainingStake()).to.equal(0);

            await pmm.connect(timeLock).setStakeLimit(ethers.parseUnits("40", 8));
            expect(await pmm.remainingStake()).to.equal(ethers.parseUnits("10", 8));
            await btcb.connect(signer2).approve(await pmm.getAddress(), ethers.parseUnits("10", 18));
            await pmm.connect(signer2).swapBTCBToLBTC(ethers.parseUnits("10", 18));
            expect(await pmm.remainingStake()).to.equal(0);
        });

        it("should allow withdrawals", async function () {
            await btcb.connect(signer1).approve(await pmm.getAddress(), ethers.parseUnits("30", 18));
            await pmm.connect(signer1).swapBTCBToLBTC(ethers.parseUnits("30", 18));

            await expect(pmm.withdrawBTCB(1))
                .to.emit(btcb, "Transfer")
                .withArgs(await pmm.getAddress(), await withdrawalAddress.getAddress(), 1);
            expect(await btcb.balanceOf(await withdrawalAddress.getAddress())).to.equal(1);
        });

        it("should have zero remaining stake if total stake is greater than limit", async function () {
            await btcb.connect(signer1).approve(await pmm.getAddress(), ethers.parseUnits("30", 18));
            await pmm.connect(signer1).swapBTCBToLBTC(ethers.parseUnits("30", 18));

            await pmm.connect(timeLock).setStakeLimit(ethers.parseUnits("20", 8));
            expect(await pmm.remainingStake()).to.equal(0);
        });

        describe("When Paused", function () {
            beforeEach(async function () {
                await pmm.connect(pauser).pause();
            });

            it("should revert swaps", async function () {
                await btcb.connect(signer1).approve(await pmm.getAddress(), 30);
                await expect(pmm.connect(signer1).swapBTCBToLBTC(30))
                    .to.be.revertedWithCustomError(pmm, "EnforcedPause");
            });

            it("should revert withdrawals", async function () {
                await expect(pmm.withdrawBTCB(1))
                    .to.be.revertedWithCustomError(pmm, "EnforcedPause");
            });
        });
    });
  });
}); 
