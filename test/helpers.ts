import { ethers, network } from "hardhat";
import secp256k1 from "secp256k1";

export const signData = async (
  privateKey: string,
  data: { to: string; amount: bigint; chainId?: number }
): Promise<{
  data: string;
  hash: string;
  signature: string;
}> => {
  //pack and hash
  const packed = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint64"],
    [data.chainId || network.config.chainId, data.to, data.amount]
  );
  const hash = ethers.keccak256(packed);

  // sign hash
  const { signature, recid } = secp256k1.ecdsaSign(
    ethers.getBytes(hash),
    ethers.getBytes(privateKey)
  );
  const signedHash = ethers.hexlify(signature) + (recid === 0 ? "1b" : "1c");

  return {
    data: packed,
    hash: hash,
    signature: signedHash,
  };
};
