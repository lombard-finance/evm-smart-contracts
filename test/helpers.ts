import { config, ethers, network, upgrades } from "hardhat";
import secp256k1 from "secp256k1";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { LBTCMock, WBTCMock, Bascule } from "../typechain-types";
import { AddressLike, BaseContract, BigNumberish } from "ethers";

const actionIface = ethers.Interface.from([
  "function mint(address,uint256) external",
  "function addPlayer(address) external",
  "function removePlayer(address) external",
  "function withdrawFromBridge(address,uint256) external",
]);

export function encodeMessage(
  action: string,
  args: any[],
) {
  return ethers.keccak256(actionIface.encodeFunctionData(action, args));
}

export function buildFullMessage(
  action: string,
  nonce: BigNumberish,
  expiry: BigNumberish,
  chainId: BigNumberish,  
  contract: string,
  args: any[],
) {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["bytes32", "uint256", "uint256", "uint256", "address"],
      [
        encodeMessage(action, args),
        nonce,
        expiry,
        chainId,
        contract
      ]
    )
  )
}

export function toEthSignedMessageHash(
  action: string,
  nonce: BigNumberish,
  expiry: BigNumberish,
  chainId: BigNumberish,  
  contract: string,
  args: any[],
) {
  return ethers.hashMessage(ethers.getBytes(
    buildFullMessage(action, nonce, expiry, chainId, contract, args)
  ));
}

export async function signMessage(
  signer: HardhatEthersSigner,
  action: string,
  nonce: BigNumberish,
  expiry: BigNumberish,
  chainId: BigNumberish,  
  contract: string,
  args: any[],
) {
  return await signer.signMessage(
    ethers.getBytes(buildFullMessage(action, nonce, expiry, chainId, contract, args))
  );
}

export function mergeSignatures(nonce: BigNumberish, expiry: BigNumberish, signers: string[], signatures: string[]) {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "address[]", "bytes[]"], 
    [nonce, expiry, signers, signatures]
  );
}

export async function createSignature(
  signers: HardhatEthersSigner[],
  action: string,
  nonce: BigNumberish,
  expiry: BigNumberish,
  chainId: BigNumberish,  
  contract: string,
  args: any[],
) {
  return mergeSignatures(
    nonce, expiry, 
    signers.map(signer => signer.address), 
    await Promise.all(signers.map(signer => signMessage(signer, action, nonce, expiry, chainId, contract, args)))
  );
}

export async function deployContract<T extends BaseContract>(contractName: string, args: any[], isProxy: boolean = true) : Promise<T> {
  const factory = await ethers.getContractFactory(contractName);
  const contract = await (isProxy ? upgrades.deployProxy(factory, args) : factory.deploy(...args));
  await contract.waitForDeployment();

  return factory.attach(contract.target) as T;
}

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
