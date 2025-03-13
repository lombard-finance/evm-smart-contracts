import { BigNumberish, ContractTransaction } from 'ethers';
import { BytesLike } from 'ethers/lib.commonjs/utils/data';
import { DEFAULT_PROXY_FACTORY } from './constants';
import { ITimelockController } from '../../typechain-types';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

type TAddressesWithNetwork = {
    [k: string]: TAddresses;
};

export type TAddresses = {
    LBTC?: string;
    ThresholdKey?: string;
    Owner?: string;
    Consortium?: string;
    Timelock?: string;
    BTCB?: string;
};

export function getAddresses(network: string): TAddresses {
    const addresses: TAddressesWithNetwork = require('../../mainnet.json');
    if (!addresses[network]) {
        throw Error(`network ${network} not supported`);
    }
    return addresses[network];
}

export function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verify(
    run: any,
    address: string,
    options: any = {},
    delay = 13_000
) {
    console.log(`Going to verify...`);

    await sleep(delay);

    try {
        await run('verify:verify', {
            address,
            ...options,
        });
    } catch (e) {
        console.error(`Verification failed: ${e}`);
    }

    console.log('\n');
}

export async function schedule(
    hre: HardhatRuntimeEnvironment,
    timelock: ITimelockController,
    transaction: ContractTransaction,
    predecessor?: BytesLike,
    salt?: BytesLike,
    delay?: BigNumberish
) {
    delay = delay || (await timelock.getMinDelay());

    return await timelock.schedule(
        transaction.to,
        transaction.value || '0',
        transaction.data,
        predecessor || hre.ethers.ZeroHash,
        salt || hre.ethers.ZeroHash,
        delay
    );
}

export async function populateSchedule(
    hre: HardhatRuntimeEnvironment,
    timelock: ITimelockController,
    transaction: ContractTransaction,
    predecessor?: BytesLike,
    salt?: BytesLike,
    delay?: BigNumberish
) {
    delay = delay || (await timelock.getMinDelay());

    return await timelock.schedule.populateTransaction(
        transaction.to,
        transaction.value || '0',
        transaction.data,
        predecessor || hre.ethers.ZeroHash,
        salt || hre.ethers.ZeroHash,
        delay
    );
}

export async function getProxyFactoryAt(
    ethers: any,
    address: string = DEFAULT_PROXY_FACTORY
) {
    return ethers.getContractAt('ProxyFactory', address);
}

/*
 * @return keccak256(finance.lombard.v1.{ledger-network}.{contractName})
 */
export function getProxySalt(
    ethers: any,
    ledgerNetwork: string,
    contractName: string
) {
    return ethers.id(`finance.lombard.v1.${ledgerNetwork}.${contractName}`);
}

/**
 * Computes data for calling a method on a contract
 * @param {string} functionSignature - method signature in solidity selector format "functionName(uint256)".
 * @param {Array} args - arguments to pass to the function
 * @returns {string} - hex encoded data field
 */
export function getTransactionData(
    hre: HardhatRuntimeEnvironment,
    functionSignature: string,
    args: any[]
): string {
    const functionFragment =
        hre.ethers.FunctionFragment.from(functionSignature);
    const iface = new hre.ethers.Interface([functionFragment]);
    return iface.encodeFunctionData(functionFragment.name, args);
}

export function checkEIP165InterfaceId(
    id: string,
    contract: string,
    chain: string,
    hre: HardhatRuntimeEnvironment
): Promise<boolean> {
    const provider = new hre.ethers.JsonRpcProvider(
        hre.config.networks[chain].url
    );
    const data = getTransactionData(hre, 'supportsInterface(bytes4)', [id]);
    return provider.send('eth_call', [
        {
            to: contract,
            data: data,
        },
        'latest',
    ]) as Promise<boolean>;
}
