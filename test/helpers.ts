import { config, ethers, upgrades } from 'hardhat';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import {
    AddressLike,
    BaseContract,
    BigNumberish,
    ContractMethodArgs,
    Signature,
} from 'ethers';
import {
    Consortium,
    ERC20PermitUpgradeable,
    LBTCMock,
} from '../typechain-types';
import { BytesLike } from 'ethers/lib.commonjs/utils/data';

export type Signer = HardhatEthersSigner & {
    publicKey: string;
    privateKey: string;
};

export const encode = (types: string[], values: any[]) =>
    ethers.AbiCoder.defaultAbiCoder().encode(types, values);

export const CHAIN_ID: string = encode(['uint256'], [31337]);

const ACTIONS_IFACE = ethers.Interface.from([
    'function feeApproval(uint256,uint256)',
    'function payload(bytes32,bytes32,uint64,bytes32,uint32) external',
    'function payload(bytes32,bytes32,bytes32,bytes32,bytes32,uint64,uint256) external',
    'function payload(uint256,bytes[],uint256[],uint256,uint256) external',
]);

export function getPayloadForAction(data: any[], action: string) {
    return ACTIONS_IFACE.encodeFunctionData(action, data);
}

export function rawSign(signer: Signer, message: string): string {
    const signingKey = new ethers.SigningKey(signer.privateKey);
    const signature = signingKey.sign(message);

    return signature.serialized;
}

export const DEFAULT_LBTC_DUST_FEE_RATE = 3000;

export const DEPOSIT_BTC_ACTION = '0xf2e73f7c';
export const DEPOSIT_BRIDGE_ACTION = '0x5c70a505';
export const NEW_VALSET = '0x4aab1d6f';

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
            typeof fromChain === 'string' &&
            ethers.getBytes(fromChain).length < 32
                ? fromChain
                : encode(['uint256'], [fromChain]),
            encode(['address'], [fromContract]),
            typeof toChain === 'string' && ethers.getBytes(toChain).length < 32
                ? toChain
                : encode(['uint256'], [toChain]),
            encode(['address'], [toContract]),
            encode(['address'], [recipient]),
            amount,
            encode(['uint256'], [nonce]),
        ],
        DEPOSIT_BRIDGE_ACTION
    );
    return signPayload(signers, signatures, msg);
}

export async function signDepositBtcPayload(
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
        [
            toChainBytes,
            encode(['address'], [recipient]),
            amount,
            txid,
            encode(['uint32'], [vout]),
        ],
        DEPOSIT_BTC_ACTION
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
    let msg = getPayloadForAction(
        [epoch, validators, weights, weightThreshold, height],
        NEW_VALSET
    );
    return signPayload(signers, signatures, msg);
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
        proof: encode(['bytes[]'], [signaturesArray]),
    };
}

export async function deployContract<T extends BaseContract>(
    contractName: string,
    args: any[],
    isProxy: boolean = true
): Promise<T> {
    const factory = await ethers.getContractFactory(contractName);
    const contract = await (isProxy
        ? upgrades.deployProxy(factory, args)
        : factory.deploy(...args));
    await contract.waitForDeployment();

    return factory.attach(contract.target) as T;
}

export async function getSignersWithPrivateKeys(
    phrase?: string
): Promise<Signer[]> {
    return (await ethers.getSigners()).map((signer, i) => {
        const mnemonic = ethers.Mnemonic.fromPhrase(
            phrase || config.networks.hardhat.accounts.mnemonic
        );
        const wallet = ethers.HDNodeWallet.fromMnemonic(
            mnemonic,
            `m/44'/60'/0'/0/${i}`
        );
        return Object.assign(signer, {
            privateKey: wallet.privateKey,
            publicKey: `0x04${ethers.SigningKey.computePublicKey(wallet.publicKey, false).slice(4)}`,
        });
    });
}

export async function init(
    burnCommission: number,
    treasury: string,
    owner: string
) {
    const consortium = await deployContract<Consortium>('ConsortiumMock', [
        owner,
    ]);

    const lbtc = await deployContract<LBTCMock>('LBTCMock', [
        await consortium.getAddress(),
        burnCommission,
        treasury,
        owner,
    ]);

    return { lbtc, consortium };
}

export async function generatePermitSignature(
    token: ERC20PermitUpgradeable,
    owner: Signer,
    spender: string,
    value: BigNumberish,
    deadline: BigNumberish,
    chainId: BigNumberish,
    nonce: BigNumberish
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
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
        ],
    };

    const signature = await owner.signTypedData(
        {
            name: 'Lombard Staked Bitcoin',
            version: '1',
            chainId: chainId,
            verifyingContract: await token.getAddress(),
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
    verifyingContract: string,
    fee: BigNumberish,
    expiry: BigNumberish,
    domainName: string = 'Lombard Staked Bitcoin',
    version: string = '1',
    chainId: BigNumberish = Number(CHAIN_ID)
) {
    const domain = {
        name: domainName,
        version: version,
        chainId: chainId,
        verifyingContract: verifyingContract,
    };
    const types = {
        feeApproval: [
            { name: 'chainId', type: 'uint256' },
            { name: 'fee', type: 'uint256' },
            { name: 'expiry', type: 'uint256' },
        ],
    };
    const message = { chainId, fee, expiry };

    return signer.signTypedData(domain, types, message);
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
        delay: BigNumberish,
    ]
>;

type HashOperationArgs = ContractMethodArgs<
    [
        target: AddressLike,
        value: BigNumberish,
        data: BytesLike,
        predecessor: BytesLike,
        salt: BytesLike,
    ]
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
        return [
            this._target,
            this._value,
            this._data,
            this._predecessor,
            this._salt,
            this._delay,
        ];
    }

    get hashOperationArgs(): HashOperationArgs {
        return [
            this._target,
            this._value,
            this._data,
            this._predecessor,
            this._salt,
        ];
    }

    get eventArgs() {
        return [
            this._target,
            this._value,
            this._data,
            this._predecessor,
            this._delay,
        ];
    }
}
