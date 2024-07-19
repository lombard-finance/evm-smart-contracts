// Import constants
import {takeSnapshot} from "@nomicfoundation/hardhat-toolbox/network-helpers";


const {config, ethers, waffle, upgrades} = require("hardhat");
const hre = require("hardhat");
const {assert, expect} = require("chai");
const web3x = require("web3");
const {
    encodeTransactionReceipt,
    encodeProof,
} = require("../utils/bridge_utils");
const {signMessageUsingPrivateKey} = require("../utils/evmutils.js");
const {init} = require("./helpers.ts");

// Constants
const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
const CHAIN1 = "31337";
const CHAIN2 = "31337";
const amount = ethers.parseEther('10');

// Addresses
let deployer, eoa1, eoa2, consortium, treasury, snapshot;

// Protocol Contracts
let router, lbtc1, lbtc2, tokenFactory;

// Participant Contracts
let warptoken1, warptoken2;

// Offchain data
let encodedProof, rawReceipt, proofSignature, proofHash, receiptHash, receipt;

describe("===LBTCBridge===", function () {
    describe("Bridge tokens", async () => {
        before(async () => {

            // Get Addresses
            [deployer, consortium, eoa1, eoa2, treasury] = await hre.ethers.getSigners();

            // await enrichWithPrivateKeys(signers);
            const result = await init(consortium);
            lbtc1 = result.lbtc;
            const result2 = await init(consortium);
            lbtc2 = result2.lbtc;

            await lbtc1.changeTreasuryAddress(treasury);
            await lbtc2.changeTreasuryAddress(treasury);

            snapshot = await takeSnapshot();
            await lbtc1["mint(address,uint256)"](eoa1.address, ethers.parseEther('100'));
            // Add warp link between two warp tokens on different chains [Using same chain for test]
            await lbtc1.addDestination(CHAIN2, await lbtc2.getAddress(), 0);
            await lbtc2.addDestination(CHAIN1, await lbtc1.getAddress(), 0);
        });
        it("Deposit LBTC1", async () => {
            this.timeout(1500000000);
            // Bridge can only warp tokens with allowance from 'eoa1'
            // Deposit WarpToken1
            expect((await lbtc1.balanceOf(eoa1.address)).toString()).to.be.equal(ethers.parseEther('100').toString());
            expect((await lbtc1.totalSupply()).toString()).to.be.equal(ethers.parseEther('100').toString());
            let tx = await lbtc1.connect(eoa1).depositToBridge(CHAIN2, eoa2.address, amount)
            receipt = await tx.wait();
            await expect(tx).to
                .emit(lbtc1, "DepositToBridge")
                .withArgs(CHAIN2, eoa1.address, eoa2.address, await lbtc1.getAddress(), await lbtc2.getAddress(), amount, 1);
            expect((await lbtc1.balanceOf(eoa1.address)).toString()).to.be.equal(ethers.parseEther('90').toString());
            expect((await lbtc1.totalSupply()).toString()).to.be.equal(ethers.parseEther('90').toString());
        });
        it("Withdraw LBTC2", async function () {
            this.timeout(1500000000);

            [encodedProof, rawReceipt, proofSignature, proofHash] = generateWithdrawalData(consortium, receipt);
            expect((await lbtc2.balanceOf(eoa2.address)).toString()).to.be.equal(ethers.parseEther('0').toString());
            expect((await lbtc2.totalSupply()).toString()).to.be.equal(ethers.parseEther('0').toString());


            let tx = await lbtc2.connect(eoa2).withdrawFromBridge(encodedProof, rawReceipt, proofSignature);
            receipt = await tx.wait();
            await expect(tx).to
                .emit(lbtc2, "WithdrawFromBridge")
                .withArgs(receiptHash, eoa1.address, eoa2.address, await lbtc1.getAddress(), await lbtc2.getAddress(), amount);
            expect((await lbtc2.totalSupply()).toString()).to.be.equal(ethers.parseEther('10').toString());
            expect((await lbtc2.balanceOf(eoa2.address)).toString()).to.be.equal(ethers.parseEther('10').toString());
        });
        it("Deposit LBTC2", async () => {

            this.timeout(1500000000);
            // Bridge can only warp tokens with allowance from 'eoa1'
            // Deposit WarpToken1
            expect((await lbtc2.balanceOf(eoa2.address)).toString()).to.be.equal(ethers.parseEther('10').toString());
            expect((await lbtc2.totalSupply()).toString()).to.be.equal(ethers.parseEther('10').toString());
            let tx = await lbtc2.connect(eoa2).depositToBridge(CHAIN1, eoa1.address, amount)
            receipt = await tx.wait();
            await expect(tx).to
                .emit(lbtc2, "DepositToBridge")
                .withArgs(CHAIN1, eoa2.address, eoa1.address, await lbtc2.getAddress(), await lbtc1.getAddress(),  amount, 1);
            expect((await lbtc2.balanceOf(eoa1.address)).toString()).to.be.equal(ethers.parseEther('0').toString());
            expect((await lbtc2.totalSupply()).toString()).to.be.equal(ethers.parseEther('0').toString());
        });
        it("Withdraw LBTC1", async function () {

            this.timeout(1500000000);

            [encodedProof, rawReceipt, proofSignature, proofHash] = generateWithdrawalData(consortium, receipt);
            expect((await lbtc1.balanceOf(eoa1.address)).toString()).to.be.equal(ethers.parseEther('90').toString());
            expect((await lbtc1.totalSupply()).toString()).to.be.equal(ethers.parseEther('90').toString());


            let tx = await lbtc1.connect(eoa1).withdrawFromBridge(encodedProof, rawReceipt, proofSignature);
            receipt = await tx.wait();
            await expect(tx).to
                .emit(lbtc1, "WithdrawFromBridge")
                .withArgs(receiptHash, eoa2.address, eoa1.address, await lbtc2.getAddress(), await lbtc1.getAddress(), amount);
            expect((await lbtc1.totalSupply()).toString()).to.be.equal(ethers.parseEther('100').toString());
            expect((await lbtc1.balanceOf(eoa1.address)).toString()).to.be.equal(ethers.parseEther('100').toString());
        });
        it("reverts: Non-consortium signing", async () => {

            this.timeout(1500000000);
            // Bridge can only warp tokens with allowance from 'eoa1'
            // Deposit WarpToken1
            expect((await lbtc1.balanceOf(eoa1.address)).toString()).to.be.equal(ethers.parseEther('100').toString());
            expect((await lbtc1.totalSupply()).toString()).to.be.equal(ethers.parseEther('100').toString());
            let tx = await lbtc1.connect(eoa1).depositToBridge(CHAIN2, eoa2.address, amount)
            receipt = await tx.wait();
            await expect(tx).to
                .emit(lbtc1, "DepositToBridge")
                .withArgs(CHAIN2, eoa1.address, eoa2.address, await lbtc1.getAddress(), await lbtc2.getAddress(),  amount, 2);
            expect((await lbtc2.balanceOf(eoa1.address)).toString()).to.be.equal(ethers.parseEther('0').toString());
            expect((await lbtc2.totalSupply()).toString()).to.be.equal(ethers.parseEther('0').toString());

            // --- Withdraw ---
            // Process proofs but signer is non-consortium
            [encodedProof, rawReceipt, proofSignature, proofHash] = generateWithdrawalData(treasury, receipt);
            await expect(lbtc2.connect(eoa1).withdrawFromBridge(encodedProof, rawReceipt, proofSignature)).to.be.revertedWithCustomError(lbtc2,"BadSignature");
        });
    });
});

function generateWithdrawalData(signer, receipt) {

    [rawReceipt, receiptHash] = encodeTransactionReceipt(receipt);

    [encodedProof, proofHash] = encodeProof(
        CHAIN1,
        1,
        receipt.hash,
        receipt.blockNumber,
        receipt.blockHash,
        receipt.index,
        receiptHash,
        web3x.utils.padLeft(web3x.utils.toHex(amount.toString()), 64)
    );

    const accounts = config.networks.hardhat.accounts;
    for (let i = 0; ; i++) {
        const wallet1 = ethers.HDNodeWallet.fromMnemonic(ethers.Mnemonic.fromPhrase(accounts.mnemonic), accounts.path + `/${i}`);
        if (wallet1.address == signer.address) {
            const privateKey = wallet1.privateKey.substring(2);
            proofSignature = signMessageUsingPrivateKey(privateKey, proofHash);
            break;
        }
    }

    return [encodedProof, rawReceipt, proofSignature, proofHash];
}