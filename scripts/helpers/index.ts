import { BigNumberish, ContractTransaction } from 'ethers';
import { BytesLike } from 'ethers/lib.commonjs/utils/data';
import { DEFAULT_PROXY_FACTORY } from './constants';

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
    const addresses: TAddressesWithNetwork = require('../../addresses-mainnet.json');
    if (!addresses[network]) {
        throw Error(`network ${network} not supported`);
    }
    return addresses[network];
}

export function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verify(run: any, address: string, options: any = {}) {
    console.log(`Going to verify...`);

    await sleep(12_000);

    try {
        await run('verify:verify', {
            address,
            ...options,
        });
    } catch (e) {
        console.error(`Verification failed: ${e}`);
    }
}

export async function schedule(
    ethers: any,
    {
        timelockAddr,
        transaction,
        predecessor,
        salt,
        delay,
    }: {
        timelockAddr: string;
        transaction: ContractTransaction;
        predecessor?: BytesLike;
        salt?: BytesLike;
        delay?: BigNumberish;
    }
) {
    const timelock = await ethers.getContractAt(
        'ITimelockController',
        timelockAddr
    );

    if (!delay) {
        delay = await timelock.getMinDelay();
    }

    const res = await timelock.schedule(
        transaction.to,
        transaction.value || '0',
        transaction.data,
        predecessor || ethers.ZeroHash,
        salt || ethers.ZeroHash,
        delay
    );
    await res.wait();
    console.log(res.hash);
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
