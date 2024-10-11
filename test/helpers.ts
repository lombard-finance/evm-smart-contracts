import { config, ethers, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LBTCMock, WBTCMock, Bascule } from "../typechain-types";
import { AddressLike, BaseContract, BigNumberish } from "ethers";

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
  "function mint(uint256,address,address,uint256,bytes) external",
  "function burn(uint256,address,uint256,address,address,uint256,bytes) external",
  "function setValidators(address[],uint256[],uint256) external",
])

export function getPayloadForAction(data: any[], action: string) {
  return ACTIONS_IFACE.encodeFunctionData(action, data);
}

export async function signPayload(
  signers: HardhatEthersSigner[],
  signatures: boolean[],
  data: any[],
  executionChainId: BigNumberish,
  caller: AddressLike,
  verifier: AddressLike,
  epoch: number,
  action: string
): Promise<{
  payload: string;
  enhancedPayload: string;
  proof: string;
}> {
  
  if (signers.length !== signatures.length) {
    throw new Error("Signers & signatures must have the same length");
  }

  const originalMessage = getPayloadForAction(data, action);
  const finalMessage = ethers.sha256(encode(
    ["uint256", "address", "address", "uint256", "bytes32"],
    [executionChainId, caller, verifier, epoch, ethers.sha256(originalMessage)]
  ))
  const signaturesArray = await Promise.all(signers.map(async(signer, index) => {
    if (!signatures[index]) return "0x";
    
    const signingKey = new ethers.SigningKey(signer.privateKey);
    const signature = signingKey.sign(finalMessage);
    
    return signature.serialized;
  }));
  
  return {
    payload: originalMessage,
    enhancedPayload: finalMessage,
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
