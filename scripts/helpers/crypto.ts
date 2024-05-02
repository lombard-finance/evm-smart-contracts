import { BigNumberish, HDNodeWallet } from "ethers";
import { ethers, config } from "hardhat";
import secp256k1 from "secp256k1";

export const signData = async (
  signer: HDNodeWallet,
  data: { to: string; amount: BigNumberish; chainId: BigNumberish }
): Promise<{
  data: string;
  signature: string;
  hash: string;
}> => {
  // encode data and produce hash
  const packed = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint64"],
    [data.chainId, data.to, data.amount]
  );
  const hash = ethers.keccak256(packed);

  // sign hash
  const { signature, recid } = secp256k1.ecdsaSign(
    ethers.getBytes(hash),
    ethers.getBytes(signer.privateKey)
  );
  const signedHash = ethers.hexlify(signature) + (recid === 0 ? "1b" : "1c");

  return {
    data: packed,
    signature: signedHash,
    hash,
  };
};
