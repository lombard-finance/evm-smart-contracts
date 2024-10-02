import { config, ethers, network, upgrades } from "hardhat";
import secp256k1 from "secp256k1";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LBTC, WBTCMock, Bascule } from "../typechain-types";
import { AddressLike, Contract, Signer, Signature } from "ethers";

export function signOutputPayload(
  privateKey: string,
  data: {
    to: string;
    amount: bigint;
    chainId?: number;
    txId?: string;
    outputIndex?: number;
  }
): {
  data: string;
  hash: string;
  signature: string;
} {
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

export function signBridgeDepositPayload(
  privateKey: string,
  fromContract: string,
  fromChainId: string,
  toContract: string,
  toChainId: string,
  toAddress: string,
  amount: bigint,
  txHash: string,
  eventIndex: number
): {
  data: string;
  hash: string;
  signature: string;
} {
  const packed = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "bytes32",
      "bytes32",
      "bytes32",
      "bytes32",
      "bytes32",
      "uint64",
      "bytes32",
      "uint32",
    ],
    [
      fromContract,
      fromChainId,
      toContract,
      toChainId,
      toAddress,
      amount,
      txHash,
      eventIndex,
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

export function enrichWithPrivateKeys(
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
  return signers;
}

export async function init(consortium: HardhatEthersSigner, burnCommission: number) {
  const LBTC = await ethers.getContractFactory("LBTC");
  const lbtc = (await upgrades.deployProxy(LBTC, [
    consortium.address,
    burnCommission
  ])) as unknown as LBTC;
  await lbtc.waitForDeployment();

  const WBTC = await ethers.getContractFactory("WBTCMock");
  const wbtc = (await upgrades.deployProxy(WBTC, [])) as unknown as WBTCMock;
  await wbtc.waitForDeployment();

  return { lbtc, wbtc };
}

export async function deployBascule(reporter: HardhatEthersSigner, lbtc: AddressLike): Promise<Bascule> {
  const Bascule = await ethers.getContractFactory("Bascule");
  const [admin, pauser, maxDeposits] = [ reporter.address, reporter.address, 100 ];
  const bascule = await Bascule.deploy(admin, pauser, reporter, lbtc, maxDeposits);
  await bascule.waitForDeployment();
  return bascule;
}

export async function generatePermitSignature(
  token: Contract, 
  owner: Signer, 
  spender: string,
  value: number, 
  deadline: number, 
  chainId: number , 
  nonce: number
): Promise<{ v: number; r: string; s: string }> {
  const ownerAddress = await owner.getAddress();

  const permitMessage = {
    owner: ownerAddress,
    spender: spender,
    value: value,
    nonce: nonce,
    deadline: deadline,
  };

  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const signature = await owner.signTypedData({
    name: "Lombard Staked Bitcoin",
    version: "1",
    chainId: chainId,
    verifyingContract: await token.getAddress(),
  }, types, permitMessage);

  // Split the signature into v, r, s components
  const signatureObj = Signature.from(signature); 
  return { v: signatureObj.v, r: signatureObj.r, s: signatureObj.s };
}