import { expect } from "chai";
import { ethers } from "hardhat";
import { VerifySignatureTest } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("VerifySignatureTest", function () {
  let verifySignatureTest: VerifySignatureTest;
  let signer: SignerWithAddress;

  before(async function () {
    const VerifySignatureTest = await ethers.getContractFactory("VerifySignatureTest");
    verifySignatureTest = await VerifySignatureTest.deploy() as VerifySignatureTest;
    await verifySignatureTest.waitForDeployment();
    [signer] = await ethers.getSigners();
  });

  it("should verify MAX_PLAYERS constant value and its calculation", async function () {
    const MAX_PLAYERS = 10509;
    
    // Get the current block gas limit
    const latestBlock = await ethers.provider.getBlock("latest");
    const currentBlockGasLimit = latestBlock!.gasLimit;

    // Measure ECDSA verification gas cost

    const message = "Hello, World!";
    const messageHash = ethers.hashMessage(message);
    const signature = await signer.signMessage(message);
    
    const tx = await verifySignatureTest.verifySignatureWithGas.staticCall(signer.address, messageHash, signature);
    const [isValid, gasUsed] = tx;

    const recoveredAddress = await verifySignatureTest.recoverSigner(messageHash, signature);

    expect(isValid).to.be.true;
    expect(recoveredAddress).to.equal(signer.address);

    const ecdsaVerificationGas = Number(gasUsed);

    const maxSignatures = Math.floor(Number(currentBlockGasLimit) / ecdsaVerificationGas);

    // Calculate the maximum number of players for BFT consensus
    const calculatedMaxPlayers = Math.floor((maxSignatures - 1) * 3 / 2);

    // console.log(`Current Block Gas Limit: ${currentBlockGasLimit}`);
    // console.log(`Measured ECDSA Verification Gas: ${ecdsaVerificationGas}`);
    // console.log(`Calculated Max Players: ${calculatedMaxPlayers}`);
    // console.log(`Contract Max Players: ${MAX_PLAYERS}`);

    // Verify that the MAX_PLAYERS is equal to the calculated value
    expect(MAX_PLAYERS).to.equal(BigInt(calculatedMaxPlayers));

    // Verify that the number of required signatures fits within a block
    const requiredSignatures = Math.floor(Number(MAX_PLAYERS) * 2 / 3) + 1;
    expect(requiredSignatures).to.be.lessThanOrEqual(maxSignatures);

    // console.log(`Required Signatures: ${requiredSignatures}`);
    // console.log(`Max Signatures per Block: ${maxSignatures}`);
  });
});