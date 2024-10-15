import hardhat, { config, ethers, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LBTC, WBTCMock, Bascule } from "../typechain-types";
import { AddressLike, BaseContract, Contract, Signer, Signature, BigNumberish } from "ethers";
import {string} from "hardhat/internal/core/params/argumentTypes";

export const CHAIN_ID = ethers.zeroPadValue("0x7A69", 32);

const encode = (types: string[], values: any[]) => ethers.AbiCoder.defaultAbiCoder().encode(types, values);

export const ERRORS_IFACE = {
  interface: ethers.Interface.from([
    "error WrongChainId()",
    "error ZeroAddress()",
    "error ZeroTxId()",
    "error ZeroAmount()",
  ]),
};

const ACTIONS_IFACE = ethers.Interface.from([
  "function payload(bytes32,bytes32,uint64,bytes32,uint32) external",
  "function payload(bytes32,bytes32,bytes32,bytes32,bytes32,uint64,uint256) external",
  "function payload(uint256,bytes[],uint256[],uint256,uint256) external",
])


export const DEPOSIT_BTC_ACTION = "DEPOSIT_BTC_ACTION";
export const DEPOSIT_BRIDGE_ACTION = "DEPOSIT_BRIDGE_ACTION";
export const NEW_VALSET = "NEW_VALSET";

export const ACTIONS: {
  [key: string]: (data: any[]) => string
} = {
  DEPOSIT_BTC_ACTION: (data: any[]) => {
    return ACTIONS_IFACE.encodeFunctionData("0xf2e73f7c", data)
  },
  DEPOSIT_BRIDGE_ACTION: (data: any[]) => {
    return ACTIONS_IFACE.encodeFunctionData("0x5c70a505", data)
  },
  NEW_VALSET: (data: any[]) => {
    return ACTIONS_IFACE.encodeFunctionData("0x4aab1d6f", data)
  }
}

export async function signPayload(
  signers: HardhatEthersSigner[],
  signatures: boolean[],
  data: any[],
  action: string
): Promise<{
  payload: string;
  payloadHash: string;
  proof: string;
}> {
  
  if (signers.length !== signatures.length) {
    throw new Error("Signers & signatures must have the same length");
  }

  const msg = ACTIONS[action](data);
  const hash = ethers.sha256(msg);

  const signaturesArray = await Promise.all(signers.map(async(signer, index) => {
    if (!signatures[index]) return "0x";

    const signingKey = new ethers.SigningKey(signer.privateKey);
    const signature = signingKey.sign(hash);
    
    return signature.serialized;
  }));
  
  return {
    payload: msg,
    payloadHash: hash,
    proof: encode(["bytes[]"], [signaturesArray]),
  };
}

export async function deployContract<T extends BaseContract>(contractName: string, args: any[], isProxy: boolean = true) : Promise<T> {
  const factory = await ethers.getContractFactory(contractName);
  const contract = await (isProxy ? upgrades.deployProxy(factory, args) : factory.deploy(...args));
  await contract.waitForDeployment();

  return factory.attach(contract.target) as T;
}

export async function getSignersWithPrivateKeys(
  phrase?: string
): Promise<HardhatEthersSigner[]> {
  const signers = await ethers.getSigners();
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
      signers[i].publicKey = `0x${ethers.SigningKey.computePublicKey(wallet.publicKey, false).slice(4)}`;
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