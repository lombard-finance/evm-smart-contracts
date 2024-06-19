import { config, ethers, network } from "hardhat";
import secp256k1 from "secp256k1";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export async function signData(
  privateKey: string,
  data: {
    to: string;
    amount: bigint;
    chainId?: number;
    txId?: string;
    outputIndex?: number;
  }
): Promise<{
  data: string;
  hash: string;
  signature: string;
}> {
  //pack and hash
  const packed = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint64", "bytes32", "uint32"],
    [
      data.chainId || network.config.chainId,
      data.to,
      data.amount,
      data.txId || ethers.randomBytes(32),
      data.outputIndex || Math.floor(Math.random() * 4294967295),
    ]
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
}

export async function enrichWithPrivateKeys(
  signers: HardhatEthersSigner[],
  phrase?: string
) {
  const mnemonic = ethers.Mnemonic.fromPhrase(
    phrase || config.networks.hardhat.accounts.mnemonic
  );
  for (let i = 0; i < signers.length; i++) {
    const wallet = ethers.HDNodeWallet.fromMnemonic(
      mnemonic,
      `m/44'/60'/0'/0/${i}`
    );
    if (wallet.address === signers[i].address) {
      signers[i].privateKey = wallet.privateKey;
    }
  }
}
