import { config, ethers, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LBTC, WBTCMock, Bascule } from "../typechain-types";
import { AddressLike, BaseContract, Contract, Signer, Signature, BigNumberish } from "ethers";

export const CHAIN_ID = ethers.zeroPadValue("0x7A69", 32);

export const encode = (types: string[], values: any[]) => ethers.AbiCoder.defaultAbiCoder().encode(types, values);

export const ERRORS_IFACE = {
  interface: ethers.Interface.from([
    "error WrongChainId()",
    "error ZeroAddress()",
    "error ZeroTxId()",
    "error ZeroAmount()",
  ]),
};

const ACTIONS_IFACE = ethers.Interface.from([
  "function stake(uint256,address,address,uint256,bytes) external",
  "function bridge(uint256,address,uint256,address,address,uint256,bytes) external",
  "function setValidators(bytes[],uint256[],uint256,uint256) external",
  "function feeApproval(uint256,uint256,uint256)"
])

export function getPayloadForAction(data: any[], action: string) {
  return ACTIONS_IFACE.encodeFunctionData(action, data);
}

export function rawSign(
  signer: HardhatEthersSigner,
  message: string
): string {
  const signingKey = new ethers.SigningKey(signer.privateKey);
  const signature = signingKey.sign(message);
  
  return signature.serialized;
}

export function enhancePayload(
  executionChainId: BigNumberish,
  caller: AddressLike,
  verifier: AddressLike,
  epoch: number,
  originalMessage: string
) {
  return ethers.sha256(encode(
    ["uint256", "address", "address", "uint256", "bytes32"],
    [executionChainId, caller, verifier, epoch, ethers.sha256(originalMessage)]
  ))
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
  const finalMessage = enhancePayload(executionChainId, caller, verifier, epoch, originalMessage);
  const signaturesArray = await Promise.all(signers.map(async(signer, index) => {
    if (!signatures[index]) return "0x";
    
    return rawSign(signer, finalMessage);
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

export async function getFeeTypedMessage(
  signer: HardhatEthersSigner,
  verifyingContract: string,
  minimumReceived: BigNumberish,
  fee: BigNumberish,
  expiry: BigNumberish,
  domainName: string = "Lombard",
  version: string = "1",
  chain: BigNumberish = Number(CHAIN_ID)
) {
  const domain = {
      name: domainName,
      version: version,
      chainId: chain,
      verifyingContract: verifyingContract
  };
  const types = {
      feeApproval: [
          { name: "minimumReceived", type: "uint256" },
          { name: "fee", type: "uint256" },
          { name: "expiry", type: "uint256" }
      ]
  };
  const message = {minimumReceived, fee, expiry};

  return signer.signTypedData(domain, types, message);
}
