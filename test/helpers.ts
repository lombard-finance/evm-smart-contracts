import { config, ethers, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LBTCMock, WBTCMock, Bascule } from "../typechain-types";
import { AddressLike, BaseContract } from "ethers";

const encode = (types: string[], values: any[]) => ethers.AbiCoder.defaultAbiCoder().encode(types, values);

export const ERRORS_IFACE = {
  interface: ethers.Interface.from([
    "error WrongChainId()",
    "error ZeroAddress()",
    "error ZeroTxId()",
    "error ZeroAmount()",
  ]),
};

export enum ACTIONS {
  MINT,
  BRIDGE,
  SET_VALIDATORS,
}

function getActionDataEncodingFormat(action: ACTIONS) {
  switch (action) {
    case ACTIONS.MINT:
      // chainId, recipient, amount, txnId, eventIndex
      return ["uint256", "address", "uint64", "bytes32", "uint32"];
    case ACTIONS.BRIDGE:
      // fromContract, fromChainId, toContract, toChainId, toAddress, amount, txnId, eventIndex
      return ["address", "uint256", "address", "uint256", "address", "uint64", "bytes32", "uint32",];
    case ACTIONS.SET_VALIDATORS:
      // validators, threshold
      return ["address[]", "uint256"];
  }
}

export function getPayloadForAction(data: any[], action: ACTIONS) {
  return encode(
    getActionDataEncodingFormat(action),
    data
  );
}

export async function signPayload(
  signers: HardhatEthersSigner[],
  weights: boolean[],
  threshold: number,
  data: any[],
  action: ACTIONS
): Promise<{
  payload: string;
  proof: string;
}> {
  
  if (weights.length !== signers.length) {
    throw new Error("Weights and signers must have the same length");
  }

  const packed = getPayloadForAction(data, action);
  const message = ethers.keccak256(packed);
  const validators = signers.map(signer => signer.address);
  const numericWeights = weights.map(Number);
  const signatures = await Promise.all(signers.map(async(signer, index) => {
    if (!weights[index]) return "0x";
    
    const signingKey = new ethers.SigningKey(signer.privateKey);
    const signature = signingKey.sign(message);
    
    return signature.serialized;
  }));
  
  return {
    payload: packed,
    proof: encode(
      ["address[]", "uint256[]", "uint256", "bytes[]"],
      [validators, numericWeights, threshold, signatures]
    ),
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
    }
  }
  return signers;
}


export async function init(consortium: HardhatEthersSigner, burnCommission: number) {
  const LBTC = await ethers.getContractFactory("LBTCMock");
  const lbtc = (await upgrades.deployProxy(LBTC, [
    consortium.address,
    burnCommission
  ])) as unknown as LBTCMock;
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
