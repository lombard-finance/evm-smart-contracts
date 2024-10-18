import hardhat, { config, ethers, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LBTC, WBTCMock, Bascule } from "../typechain-types";
import {AddressLike, BaseContract, Contract, Signer, Signature} from "ethers";

type Signer = HardhatEthersSigner & {
  publicKey: string;
  privateKey: string;
}

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
  "function payload(bytes32,bytes32,uint64,bytes32,uint32) external",
  "function payload(bytes32,bytes32,bytes32,bytes32,bytes32,uint64,uint256) external",
  "function payload(uint256,bytes[],uint256[],uint256,uint256) external",
])

export function getPayloadForAction(data: any[], action: string) {
  return ACTIONS_IFACE.encodeFunctionData(action, data);
}

export const DEPOSIT_BTC_ACTION = "0xf2e73f7c";
export const DEPOSIT_BRIDGE_ACTION = "0x5c70a505";
export const NEW_VALSET = "0x4aab1d6f";

export async function signDepositBridgePayload(
  signers: HardhatEthersSigner[],
  signatures: boolean[],
  fromChain: string | BigInt,
  fromContract: string,
  toChain: string | BigInt,
  toContract: string,
  recipient: string,
  amount: number | BigInt,
  nonce: BigInt | number = 0n,
) {

  let msg = getPayloadForAction([
    typeof fromChain === 'string' && ethers.getBytes(fromChain).length < 32 ? fromChain : encode(["uint256"], [fromChain]),
    encode(["address"], [fromContract]),
    typeof toChain === 'string' && ethers.getBytes(toChain).length < 32 ? toChain : encode(["uint256"], [toChain]),
    encode(["address"], [toContract]),
    encode(["address"], [recipient]),
    amount,
    encode(["uint256"], [nonce])
  ], DEPOSIT_BRIDGE_ACTION);
  return signPayload(signers, signatures, msg);
}

export async function signDepositBtcPayload(
  signers: HardhatEthersSigner[],
  signatures: boolean[],
  toChain: string | bigint | number | Uint8Array,
  recipient: string,
  amount: BigInt | number,
  txid: string | Uint8Array,
  vout: BigInt = 0n,
) {

  let toChainBytes = toChain;
  if (typeof toChain === 'number' || typeof toChain === 'bigint') {
    toChainBytes = encode(["uint256"], [toChain]);
  }

  let msg = getPayloadForAction([
    toChainBytes,
    encode(["address"], [recipient]),
    amount,
    txid,
    encode(["uint32"], [vout])
  ], DEPOSIT_BTC_ACTION);
  return signPayload(signers, signatures, msg);
}

export async function signNewValSetPayload(
  signers: HardhatEthersSigner[],
  signatures: boolean[],
  epoch: BigInt | number,
  validators: string[],
  weights: number[],
  weightThreshold: number,
  height: BigInt | number = 0n,
) {

  let msg = getPayloadForAction([
    epoch,
    validators,
    weights,
    weightThreshold,
    height,
  ], NEW_VALSET);
  return signPayload(signers, signatures, msg);
}

export async function signPayload(
  signers: HardhatEthersSigner[],
  signatures: boolean[],
  msg: string,
): Promise<{
  payload: string;
  payloadHash: string;
  proof: string;
}> {
  
  if (signers.length !== signatures.length) {
    throw new Error("Signers & signatures must have the same length");
  }

  const hash = ethers.sha256(msg);

  const signaturesArray = (await Promise.all(signers.map(async(signer, index) => {
    if (!signatures[index]) return "0x";

    const signingKey = new ethers.SigningKey((signer as Signer).privateKey);
    const signature = signingKey.sign(hash);
    return signature.serialized.slice(0, 130); // remove V from each sig to follow real consortium
  })))
  
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
      (signers[i] as Signer).privateKey = wallet.privateKey;
      (signers[i] as Signer).publicKey = `0x${ethers.SigningKey.computePublicKey(wallet.publicKey, false).slice(4)}`;
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

export function getUncomprPubkey(signer: HardhatEthersSigner) {
  const raw = ethers.getBytes((signer as Signer).publicKey);

  const unc = new Uint8Array(65);
  // set uncompressed prefix
  unc.set([4])
  unc.set(raw, 1);

  return ethers.hexlify(unc);
}