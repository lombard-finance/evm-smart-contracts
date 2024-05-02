import {SignerWithAddress} from "@nomicfoundation/hardhat-ethers/signers";
import {config, ethers, network} from "hardhat";
import secp256k1 from "secp256k1";

export const signData = async (
    signer: SignerWithAddress,
    data: { to: string; amount: bigint; chainId?: number }
): Promise<{
    data: any;
    signature: any;
}> => {
    const packed = ethers.AbiCoder.defaultAbiCoder().encode(
        ["uint256", "address", "uint64"],
        [data.chainId || network.config.chainId, data.to, data.amount]
    );
    const hash = ethers.keccak256(packed);

    const accounts = config.networks.hardhat.accounts;
    const wallet1 = ethers.Wallet.fromPhrase(
        Array.isArray(accounts) ? "" : accounts.mnemonic
    );

    const signature = sign(wallet1.privateKey, hash);

    return {
        data: packed,
        signature,
    };
};

function sign(privateKey: string, data: string) {
    const {signature, recid} = secp256k1.ecdsaSign(
        ethers.getBytes(data),
        ethers.getBytes(privateKey)
    );
    return ethers.hexlify(signature) + (recid === 0 ? "1b" : "1c");
}