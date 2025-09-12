import { config, ethers, upgrades } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { AddressLike, BaseContract, BigNumberish, ContractMethodArgs, Signature } from 'ethers';
import { Consortium, ERC20, ERC20PermitUpgradeable, NativeLBTC, StakedLBTC } from '../typechain-types';
import { BytesLike } from 'ethers/lib.commonjs/utils/data';

export type Signer = HardhatEthersSigner & {
  publicKey: string;
  privateKey: string;
};

export const encode = (types: string[], values: any[]) => ethers.AbiCoder.defaultAbiCoder().encode(types, values);

export const CHAIN_ID: string = encode(['uint256'], [31337]);

export const e18: bigint = 10n ** 18n;
export const e8: bigint = 10n ** 8n;
export const LEDGER_CHAIN_ID: string = encode(['uint256'], ['0x112233445566778899000000']);
export const BITCOIN_CHAIN_ID: string = encode(
  ['uint256'],
  ['0xff0000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f']
);
export const BTC_STAKING_MODULE_ADDRESS: string = encode(['uint256'], ['0x0089e3e4e7a699d6f131d893aeef7ee143706ac23a']);
export const ASSETS_MODULE_ADDRESS: string = encode(['uint256'], ['0x008bf729ffe074caee622c02928173467e658e19e2']);
export const LEDGER_MAILBOX: string = encode(['uint256'], ['0x222233445566778899000000']);
export const LEDGER_CALLER: string = encode(['uint256'], [0n]);
export const BITCOIN_NATIVE_COIN: string = encode(['uint256'], ['0x00000000000000000000000000000000000001']);

const ACTIONS_IFACE = ethers.Interface.from([
  'function feeApproval(uint256,uint256)',
  'function payload(bytes32,bytes32,uint64,bytes32,uint32) external',
  'function payload(bytes32,bytes32,uint64,bytes32,uint32,bytes32) external',
  'function payload(bytes32,bytes32,bytes32,bytes32,bytes32,uint64,uint256) external',
  'function payload(uint256,bytes[],uint256[],uint256,uint256) external',
  'function MessageV1(bytes32,uint256,bytes32,bytes32,bytes32,bytes) external',
  'function payload(uint256,uint256,bytes32,bytes32,bytes32,bytes32,bytes) external', // StakingOperationRequest
  'function payload(bytes32,bytes32,uint256,bytes32,bytes32,bytes32) external', // StakingOperationReceipt
  'function payload(uint256,uint256,bytes32,bytes) external', // RedeemRequest
  'function mint(bytes32,bytes32,uint256) external', //MINT_SELECTOR
  'function redeem(bytes32,bytes32,bytes32,bytes,uint256) external', //REDEEM_REQUEST_SELECTOR
  'function redeemForBTC(bytes32,bytes,uint256) external', //REDEEM_FOR_BTC_REQUEST_SELECTOR
  'function deposit(bytes32,bytes32,bytes32,bytes32,uint256) external', //DEPOSIT_REQUEST_SELECTOR
  'function payload(bytes32,uint256,uint256)' //Ratio update
]);

export function getGMPPayload(
  sourceContract: string,
  sourceLChainId: string,
  destinationLChainId: string,
  nonce: BigNumberish,
  sender: string,
  recipient: string,
  destinationCaller: string,
  msgBody: string
): string {
  const messagePath = ethers.keccak256(
    encode(['bytes32', 'bytes32', 'bytes32'], [sourceContract, sourceLChainId, destinationLChainId])
  );

  return getPayloadForAction(
    [messagePath, encode(['uint256'], [nonce]), sender, recipient, destinationCaller, msgBody],
    GMP_V1_SELECTOR
  );
}

export function getPayloadForAction(data: any[], action: string) {
  return ACTIONS_IFACE.encodeFunctionData(action, data);
}

export function rawSign(signer: Signer, message: string): string {
  const signingKey = new ethers.SigningKey(signer.privateKey);
  const signature = signingKey.sign(message);

  return signature.serialized;
}

export const DEFAULT_DUST_FEE_RATE = 3000;

export const FEE_APPROVAL_ACTION = '0x8175ca94';
export const DEPOSIT_BTC_ACTION_V0 = '0xf2e73f7c';
export const DEPOSIT_BTC_ACTION_V1 = '0xce25e7c2';
export const DEPOSIT_BRIDGE_ACTION = '0x5c70a505';
export const NEW_VALSET = '0x4aab1d6f';
export const GMP_V1_SELECTOR = '0xe288fb4a';
export const STAKING_REQUEST_SELECTOR = '0xedff11ea';
export const STAKING_RECEIPT_SELECTOR = '0x965597b5';
export const MINT_SELECTOR = '0x155b6b13';
export const REDEEM_REQUEST_SELECTOR = '0xaa3db85f';
export const REDEEM_FROM_NATIVE_TOKEN_SELECTOR = '0x4e3e5047';
export const DEPOSIT_REQUEST_SELECTOR = '0xccb41215';
export const RATIO_UPDATE = '0x6c722c2c';

export async function signDepositBridgePayload(
  signers: Signer[],
  signatures: boolean[],
  fromChain: string | BigInt,
  fromContract: string,
  toChain: string | BigInt,
  toContract: string,
  recipient: string,
  amount: number | BigInt,
  nonce: BigInt | number = 0n
) {
  let msg = getPayloadForAction(
    [
      typeof fromChain === 'string' && ethers.getBytes(fromChain).length < 32
        ? fromChain
        : encode(['uint256'], [fromChain]),
      encode(['address'], [fromContract]),
      typeof toChain === 'string' && ethers.getBytes(toChain).length < 32 ? toChain : encode(['uint256'], [toChain]),
      encode(['address'], [toContract]),
      encode(['address'], [recipient]),
      amount,
      encode(['uint256'], [nonce])
    ],
    DEPOSIT_BRIDGE_ACTION
  );
  return signPayload(signers, signatures, msg);
}

export async function signDepositBtcV0Payload(
  signers: Signer[],
  signatures: boolean[],
  toChain: string | bigint | number | Uint8Array,
  recipient: string,
  amount: BigInt | number,
  txid: string | Uint8Array,
  vout: BigInt = 0n
) {
  let toChainBytes = toChain;
  if (typeof toChain === 'number' || typeof toChain === 'bigint') {
    toChainBytes = encode(['uint256'], [toChain]);
  }

  let msg = getPayloadForAction(
    [toChainBytes, encode(['address'], [recipient]), amount, txid, encode(['uint32'], [vout])],
    DEPOSIT_BTC_ACTION_V0
  );
  return signPayload(signers, signatures, msg);
}

export async function signDepositBtcV1Payload(
  signers: Signer[],
  signatures: boolean[],
  toChain: string | bigint | number | Uint8Array,
  recipient: string,
  amount: BigInt | number,
  txid: string | Uint8Array,
  tokenAddress: string,
  vout: BigInt = 0n
) {
  let toChainBytes = toChain;
  if (typeof toChain === 'number' || typeof toChain === 'bigint') {
    toChainBytes = encode(['uint256'], [toChain]);
  }

  let msg = getPayloadForAction(
    [
      toChainBytes,
      encode(['address'], [recipient]),
      amount,
      txid,
      encode(['uint32'], [vout]),
      encode(['address'], [tokenAddress])
    ],
    DEPOSIT_BTC_ACTION_V1
  );
  return signPayload(signers, signatures, msg);
}

export async function signNewValSetPayload(
  signers: Signer[],
  signatures: boolean[],
  epoch: BigInt | number,
  validators: string[],
  weights: number[],
  weightThreshold: number,
  height: BigInt | number = 0n
) {
  let msg = getPayloadForAction([epoch, validators, weights, weightThreshold, height], NEW_VALSET);
  return signPayload(signers, signatures, msg);
}

export async function signStakingOperationRequestPayload(
  signers: Signer[],
  signatures: boolean[],
  nonce: BigInt | number,
  recipient: BytesLike,
  amount: BigInt | number,
  fromToken: BytesLike,
  toToken: BytesLike,
  fromLChainId: BytesLike,
  toLChainID: BytesLike
) {
  let msg = getPayloadForAction(
    [nonce, amount, fromToken, toToken, fromLChainId, toLChainID, recipient],
    STAKING_REQUEST_SELECTOR
  );
  return signPayload(signers, signatures, msg);
}

export async function signStakingReceiptPayload(
  signers: Signer[],
  signatures: boolean[],
  requestHash: BytesLike,
  recipient: BytesLike,
  amount: BigInt | number,
  fromToken: BytesLike,
  toToken: BytesLike,
  toLChainID: BytesLike
) {
  let msg = getPayloadForAction(
    [requestHash, recipient, amount, fromToken, toToken, toLChainID],
    STAKING_RECEIPT_SELECTOR
  );
  return signPayload(signers, signatures, msg);
}

export function buildRedeemRequestPayload(amount: BigInt | number, nonce: BigInt | number, scriptPubkey: BytesLike) {
  const payload = getPayloadForAction([amount, nonce, CHAIN_ID, scriptPubkey], REDEEM_REQUEST_SELECTOR);
  return { payload, payloadHash: ethers.sha256(payload) };
}

export async function signPayload(
  signers: Signer[],
  signatures: boolean[],
  payload: string,
  cutV: boolean = true
): Promise<{
  payload: string;
  payloadHash: string;
  proof: string;
}> {
  if (signers.length !== signatures.length) {
    throw new Error('Signers & signatures must have the same length');
  }

  const hash = ethers.sha256(payload);

  const signaturesArray = await Promise.all(
    signers.map(async (signer, index) => {
      if (!signatures[index]) return '0x';

      const sig = rawSign(signer, hash);
      if (cutV) {
        return sig.slice(0, 130); // remove V from each sig to follow real consortium
      }
      return sig;
    })
  );

  return {
    payload: payload,
    payloadHash: hash,
    proof: encode(['bytes[]'], [signaturesArray])
  };
}

export async function deployContract<T extends BaseContract>(
  contractName: string,
  args: any[],
  isProxy: boolean = true
): Promise<T> {
  const factory = await ethers.getContractFactory(contractName);
  const contract = await (isProxy ? upgrades.deployProxy(factory, args) : factory.deploy(...args));
  await contract.waitForDeployment();

  return factory.attach(contract.target) as T;
}

export async function getSignersWithPrivateKeys(phrase?: string): Promise<Signer[]> {
  return (await ethers.getSigners()).map((signer, i) => {
    const mnemonic = ethers.Mnemonic.fromPhrase(phrase || config.networks.hardhat.accounts.mnemonic);
    const wallet = ethers.HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${i}`);
    return Object.assign(signer, {
      privateKey: wallet.privateKey,
      publicKey: `0x04${ethers.SigningKey.computePublicKey(wallet.publicKey, false).slice(4)}`
    });
  });
}

export async function initStakedLBTC(owner: string, treasury: string, consortium: string = ethers.ZeroAddress) {
  if (consortium === ethers.ZeroAddress) {
    const c = await deployContract<Consortium>('ConsortiumMock', [owner]);
    consortium = await c.getAddress();
  }
  const lbtc = await deployContract<StakedLBTC & Addressable>('StakedLBTC', [consortium, treasury, owner]);
  lbtc.address = await lbtc.getAddress();
  return lbtc;
}

export async function initNativeLBTC(
  owner: string,
  treasury: string,
  consortium: string = ethers.ZeroAddress
): Promise<NativeLBTC & Addressable> {
  if (consortium === ethers.ZeroAddress) {
    const c = await deployContract<Consortium>('ConsortiumMock', [owner]);
    consortium = await c.getAddress();
  }
  const lbtc = await deployContract<NativeLBTC & Addressable>('NativeLBTC', [
    consortium,
    treasury,
    'Native LBTC',
    'nativeLBTC',
    owner,
    0n
  ]);
  lbtc.address = await lbtc.getAddress();
  return lbtc;
}

export async function generatePermitSignature(
  tokenAddress: string,
  owner: Signer,
  spender: string,
  value: BigNumberish,
  deadline: BigNumberish,
  chainId: BigNumberish,
  nonce: BigNumberish,
  name: string = 'Lombard Staked Bitcoin'
): Promise<{ v: number; r: string; s: string }> {
  const ownerAddress = await owner.getAddress();

  const permitMessage = {
    owner: ownerAddress,
    spender: spender,
    value: value,
    nonce: nonce,
    deadline: deadline
  };

  const types = {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' }
    ]
  };

  const signature = await owner.signTypedData(
    {
      name: name,
      version: '1',
      chainId: chainId,
      verifyingContract: tokenAddress
    },
    types,
    permitMessage
  );

  // Split the signature into v, r, s components
  const signatureObj = Signature.from(signature);
  return { v: signatureObj.v, r: signatureObj.r, s: signatureObj.s };
}

export async function getFeeTypedMessage(
  signer: HardhatEthersSigner,
  verifyingContract: StakedLBTC | NativeLBTC,
  fee: BigNumberish,
  expiry: BigNumberish,
  domainName: string = '',
  version: string = '1',
  chainId: BigNumberish = Number(CHAIN_ID)
) {
  if (domainName === '') {
    domainName = await verifyingContract.name();
  }

  const domain = {
    name: domainName,
    version: version,
    chainId: chainId,
    verifyingContract: await verifyingContract.getAddress()
  };
  const types = {
    feeApproval: [
      { name: 'chainId', type: 'uint256' },
      { name: 'fee', type: 'uint256' },
      { name: 'expiry', type: 'uint256' }
    ]
  };
  const message = { chainId, fee, expiry };

  return signer.signTypedData(domain, types, message);
}

export function randomBigInt(length: number): bigint {
  if (length <= 0) {
    return BigInt(0);
  }

  const min = BigInt(10) ** BigInt(length - 1);
  const max = BigInt(10) ** BigInt(length) - BigInt(1);

  const range = max - min + BigInt(1);
  const rand = BigInt(Math.floor(Math.random() * Number(range)));

  return min + rand;
}

export function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const charsLength = chars.length;

  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charsLength);
    result += chars[randomIndex];
  }

  return result;
}

/**
 * address target,
 * uint256 value,
 * bytes calldata data,
 * bytes32 predecessor,
 * bytes32 salt,uint256 delay
 */
type ScheduleArgs = ContractMethodArgs<
  [
    target: AddressLike,
    value: BigNumberish,
    data: BytesLike,
    predecessor: BytesLike,
    salt: BytesLike,
    delay: BigNumberish
  ]
>;

type HashOperationArgs = ContractMethodArgs<
  [target: AddressLike, value: BigNumberish, data: BytesLike, predecessor: BytesLike, salt: BytesLike]
>;

export class TxBuilder {
  private _target: AddressLike = ethers.ZeroAddress;
  private _value: BigNumberish = '0';
  private _data: BytesLike = '0x';
  private _predecessor: BytesLike = ethers.encodeBytes32String('');
  private _salt: BytesLike = ethers.encodeBytes32String('');
  private _delay: BigNumberish = '0';

  private constructor() {}

  static new() {
    return new TxBuilder();
  }

  setTarget(target: AddressLike): TxBuilder {
    this._target = target;
    return this;
  }

  setValue(value: BigNumberish): TxBuilder {
    this._value = value;
    return this;
  }

  setData(data: BytesLike): TxBuilder {
    this._data = data;
    return this;
  }

  setPredecessor(predecessor: BytesLike): TxBuilder {
    this._predecessor = predecessor;
    return this;
  }

  setSalt(salt: BytesLike): TxBuilder {
    this._salt = salt;
    return this;
  }

  setDelay(delay: BigNumberish): TxBuilder {
    this._delay = delay;
    return this;
  }

  get scheduleArgs(): ScheduleArgs {
    return [this._target, this._value, this._data, this._predecessor, this._salt, this._delay];
  }

  get hashOperationArgs(): HashOperationArgs {
    return [this._target, this._value, this._data, this._predecessor, this._salt];
  }

  get eventArgs() {
    return [this._target, this._value, this._data, this._predecessor, this._delay];
  }
}

// calculate keccak256(abi.encode(uint256(keccak256(namespace)) - 1)) & ~bytes32(uint256(0xff))
export function calculateStorageSlot(namespace: string) {
  // Step 1: keccak256 hash of the string
  const typeHash = ethers.keccak256(ethers.toUtf8Bytes(namespace));

  // Step 2: Convert hash to BigNumber and subtract 1
  const slotIndex = ethers.toBigInt(typeHash) - 1n;

  // Step 3: abi.encode(uint256) — here, we just use ethers' default zero-padded hex
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [slotIndex]);

  // Step 4: keccak256 of encoded data
  const storageSlot = ethers.keccak256(encoded);

  // Step 5: AND with ~bytes32(uint256(0xff)) = mask out last byte (set it to 0)
  const mask = ethers.toBigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff00');
  return ethers.toBigInt(storageSlot) & mask;
}

export function calcFee(body: string, weiPerByte: bigint): { fee: bigint; payloadLength: number } {
  const payload = getGMPPayload(
    encode(['address'], [ethers.ZeroAddress]),
    ethers.ZeroHash,
    ethers.ZeroHash,
    0,
    ethers.ZeroHash,
    ethers.ZeroHash,
    ethers.ZeroHash,
    body
  );
  const payloadLength = ethers.getBytes(payload).length;
  return {
    fee: weiPerByte * BigInt(payloadLength),
    payloadLength
  };
}

export class DefaultData {
  payload: string;
  payloadHash: string;
  proof: string;
  amount: bigint | undefined;
  recipient: Signer | undefined;
  feeApprovalPayload: string | undefined;
  userSignature: string | undefined;
  depositId: string;
  cubistProof: string;
  txid: string;

  constructor(payload: string, payloadHash: string, proof: string, txid: string) {
    this.payload = payload;
    this.payloadHash = payloadHash;
    this.proof = proof;
    this.depositId = '';
    this.cubistProof = '';
    this.txid = ethers.ZeroHash;
  }
}

export class Addressable {
  get address(): string {
    return this._address;
  }

  set address(value: string) {
    this._address = value;
  }

  // @ts-ignore
  private _address: string;
}
