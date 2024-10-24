// test/PoR.test.ts
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { PoR } from "../typechain-types"; // Adjust the import based on your typechain output
import { Signer } from "ethers";

describe("PoR", function () {
    let por: PoR;
    let owner: Signer;
    let operator: Signer;

    beforeEach(async () => {
        [owner, operator] = await ethers.getSigners();
        const PoRFactory = await ethers.getContractFactory("PoR");
        const contract = await upgrades.deployProxy(PoRFactory, [await owner.getAddress()]);
        await contract.waitForDeployment();

        por = PoRFactory.attach(await contract.getAddress()) as PoR;
        //grant operator role to operator
        await por.grantRole(await por.OPERATOR_ROLE(), await operator.getAddress());
    });

    describe("Initialization", function () {
        it("should set the owner correctly", async function () {
            expect(await por.hasRole(await por.DEFAULT_ADMIN_ROLE(), await owner.getAddress())).to.be.true;
        });
    });

    describe("Add Addresses", function () {
        it("should add addresses correctly", async function () {
            await por.connect(operator).addAddresses(
                ["0xAddress1", "0xAddress2"],
                ["a", "b"],
                ["Message1", "Message2"],
                [ethers.keccak256("0x01"), ethers.keccak256("0x02")]
            );

            const [messages, signatures] = await por.getPoRSignatureMessages(["0xAddress1", "0xAddress2"]);
            expect(messages).to.deep.equal(["Message1", "Message2"]);
            expect(signatures).to.deep.equal([ethers.keccak256("0x01"), ethers.keccak256("0x02")]);
        });

        it("should revert if array lengths do not match", async function () {
            await expect(
                por.connect(operator).addAddresses(
                    ["0xAddress1"],
                    ["a"],
                    ["Message1", "Message2"],
                    [ethers.keccak256("0x01")]
                )
            ).to.be.revertedWithCustomError(por, "ArrayLengthMismatch");
        });

        it("should revert if address already exists", async function () {
            await por.connect(operator).addAddresses(
                ["0xAddress1"],
                ["a"],
                ["Message1"],
                [ethers.keccak256("0x01")]
            );

            await expect(
                por.connect(operator).addAddresses(
                    ["0xAddress1"],
                    ["b"],
                    ["Message2"],
                    [ethers.keccak256("0x02")]
                )
            ).to.be.revertedWithCustomError(por, "AddressAlreadyExists");
        });

        it("should revert if not called by operator", async function () {
            await expect(
                por.connect(owner).addAddresses(
                    ["0xAddress1"],
                    ["b"],
                    ["Message1"],
                    [ethers.keccak256("0x01")]
                )
            ).to.be.revertedWithCustomError(por, "AccessControlUnauthorizedAccount")
            .withArgs(await owner.getAddress(), await por.OPERATOR_ROLE());
        });
    });

    describe("Delete Addresses", function () {
        beforeEach(async () => {
            await por.connect(operator).addAddresses(
                ["0xAddress1", "0xAddress2"],
                ["a", "b"],
                ["Message1", "Message2"],
                [ethers.keccak256("0x01"), ethers.keccak256("0x02")]
            );
        });

        it("should delete addresses correctly", async function () {
            await por.connect(owner).deleteAddresses(["0xAddress1"]);

            const [messages, signatures] = await por.getPoRSignatureMessages(["0xAddress1", "0xAddress2"]);
            expect(messages).to.deep.equal(["", "Message2"]);
            expect(signatures).to.deep.equal(["0x", ethers.keccak256("0x02")]);
        });

        it("should ignore non-existing addresses", async function () {
            await por.connect(owner).deleteAddresses(["0xNonExistingAddress"]);
            const [messages, signatures] = await por.getPoRSignatureMessages(["0xAddress1", "0xAddress2"]);
            expect(messages).to.deep.equal(["Message1", "Message2"]);
            expect(signatures).to.deep.equal([ethers.keccak256("0x01"), ethers.keccak256("0x02")]);
        });

        it("should revert if not called by owner", async function () {
            await expect(por.connect(operator).deleteAddresses(["0xAddress1"]))
                .to.be.revertedWithCustomError(por, "AccessControlUnauthorizedAccount")
                .withArgs(await operator.getAddress(), await por.DEFAULT_ADMIN_ROLE());
        });
    });

    describe("Update Message and Signature", function () {
        beforeEach(async () => {
            await por.connect(operator).addAddresses(
                ["0xAddress1"],
                ["a"],
                ["Message1"],
                [ethers.keccak256("0x01")]
            );
        });

        it("should update messages and signatures correctly", async function () {
            await por.connect(operator).updateMessageSignature(
                ["0xAddress1"],
                ["UpdatedMessage1"],
                [ethers.keccak256("0x1234")]
            );

            const [messages, signatures] = await por.getPoRSignatureMessages(["0xAddress1"]);
            expect(messages).to.deep.equal(["UpdatedMessage1"]);
            expect(signatures).to.deep.equal([ethers.keccak256("0x1234")]);
        });

        it("should revert if not called by operator", async function () {
            await expect(
                por.connect(owner).updateMessageSignature(
                    ["0xAddress1"], ["UpdatedMessage1"], [ethers.keccak256("0x1234")]
                )
            ).to.be.revertedWithCustomError(por, "AccessControlUnauthorizedAccount")
            .withArgs(await owner.getAddress(), await por.OPERATOR_ROLE());
        });

        it("should revert if address does not exist", async function () {
            await expect(
                por.connect(operator).updateMessageSignature(["0xNonExistingAddress"], ["UpdatedMessage1"], [ethers.keccak256("0x1234")])
            ).to.be.revertedWithCustomError(por, "AddressDoesNotExist");
        });
    });

    describe("Getters", function () {
        beforeEach(async () => {
            await por.connect(operator).addAddresses(
                ["0xAddress1", "0xAddress2", "0xAddress3"],
                ["a", "b", "c"],
                ["Message1", "Message2", "Message3"],
                [ethers.keccak256("0x01"), ethers.keccak256("0x02"), ethers.keccak256("0x03")]
            );
        });

        it("should return the correct values if addresses are provided", async function () {
            const [messages, signatures] = await por.getPoRSignatureMessages(["0xAddress1", "0xAddress2", "0xAddress3"]);
            expect(messages).to.deep.equal(["Message1", "Message2", "Message3"]);
            expect(signatures).to.deep.equal([ethers.keccak256("0x01"), ethers.keccak256("0x02"), ethers.keccak256("0x03")]);
        });

        it("should return empty arrays if no addresses are provided", async function () {
            const [messages, signatures] = await por.getPoRSignatureMessages([]);
            expect(messages).to.deep.equal([]);
            expect(signatures).to.deep.equal([]);
        });

        it("should return proper values in a range", async function () {
            const [addresses, rootPkIds, messages, signatures] = await por.getPoRAddressSignatureMessages(1, 2);
            expect(addresses).to.deep.equal(["0xAddress2", "0xAddress3"]);
            expect(rootPkIds).to.deep.equal(["b", "c"]);
            expect(messages).to.deep.equal(["Message2", "Message3"]);
            expect(signatures).to.deep.equal([ethers.keccak256("0x02"), ethers.keccak256("0x03")]);
        });

        it("should return all values if no range is provided", async function () {
            const data = await por.getPoRAddressSignatureMessages();
            expect(data.map((d: any) => d.addressStr)).to.deep.equal(["0xAddress1", "0xAddress2", "0xAddress3"]);
            expect(data.map((d: any) => d.rootPkId)).to.deep.equal(["a", "b", "c"]);
            expect(data.map((d: any) => d.messageOrDerivationData)).to.deep.equal(["Message1", "Message2", "Message3"]);
            expect(data.map((d: any) => d.signature)).to.deep.equal([ethers.keccak256("0x01"), ethers.keccak256("0x02"), ethers.keccak256("0x03")]);
        });

        it("should return empty arrays if start is greater than end", async function () {
            const [addresses, messages, signatures] = await por.getPoRAddressSignatureMessages(2, 1);
            expect(addresses).to.deep.equal([]);
            expect(messages).to.deep.equal([]);
            expect(signatures).to.deep.equal([]);
        });

        it("should return addresses list size", async function () {
            const size = await por.getPoRAddressListLength();
            expect(size).to.equal(3);

            //add one more address
            await por.connect(operator).addAddresses(
                ["0xAddress4"],
                ["d"],
                ["Message4"],
                [ethers.keccak256("0x04")]
            );

            const size2 = await por.getPoRAddressListLength();
            expect(size2).to.equal(4);
        });
    });
});
