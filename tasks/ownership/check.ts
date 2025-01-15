import * as fs from 'node:fs';
import { HardhatRuntimeEnvironment, RunSuperFunction } from 'hardhat/types';
import path from 'node:path';
import { Contract } from 'ethers';
import { HardhatEthersProvider } from '@nomicfoundation/hardhat-ethers/internal/hardhat-ethers-provider';

const IGNORE_SCOPE_LIST: string[] = [
    'admin', // ignored, because used as source of possible admins
];
const IGNORE_CONTRACT_LIST = [
    'ThresholdKey',
    'BTCB',
    'Router',
    'RMN',
    'CBBTC',
    'FBTC',
    'LockedFBTC',
];

const RULESET: Array<Rule> = [
    checkOwnable,
    checkOwnable2Step,
    checkAccessControlAdmin,
];

interface AddressList {
    [key: string]: any;
}

export async function check(
    taskArgs: any,
    hre: HardhatRuntimeEnvironment,
    runSuper: RunSuperFunction<any>
) {
    const p = path.join(taskArgs.filename);
    if (!fs.existsSync(p)) {
        throw new Error(`${p} does not exist`);
    }
    const addresses: AddressList = JSON.parse(fs.readFileSync(p, 'utf8'));

    const addressList = addresses[hre.network.name];
    if (!addressList) {
        throw new Error(`no addresses found for ${hre.network.name}`);
    }

    const admins = addressList['admin'];
    if (!admins) {
        throw new Error(`no admins found for ${hre.network.name}`);
    }

    for (const scope in addressList) {
        if (IGNORE_SCOPE_LIST.includes(scope)) continue;
        const contracts = addressList[scope];
        if (!contracts || typeof contracts != 'object') {
            console.warn(`scope ${scope} ignored`);
            continue;
        }

        for (const contractName in contracts) {
            if (IGNORE_CONTRACT_LIST.includes(contractName)) continue;

            const contractAddr = contracts[contractName];
            if (!hre.ethers.isAddress(contractAddr)) {
                continue;
            }

            const code = await hre.ethers.provider.getCode(contractAddr);
            if (code === '0x') {
                console.warn(
                    `no code at address ${contractAddr} of ${contractName}`
                );
                continue;
            }

            const contract = await hre.ethers.getContractAt(
                contractName,
                contracts[contractName]
            );

            console.log(`Checking ${contractName} at ${contractAddr}...`);

            for (const f of RULESET) {
                // console.log(`Running ${f.name} rule`);
                await f(hre, contract, admins);
            }
        }
    }
}

type AdminList = {
    TimeLock: string; // LombardTimelock contract
    Owner: string; // Gnosis Safe wallet
    Deployer: string; // EOA deployer
};

// rules
type Rule = (
    hre: HardhatRuntimeEnvironment,
    contract: Contract,
    admins: AdminList
) => Promise<void>;

async function checkOwnable(
    { ethers }: HardhatRuntimeEnvironment,
    contract: Contract,
    admins: AdminList
) {
    if (!contract.interface.hasFunction('owner')) return;
    const owner = await contract['owner']();

    switch (true) {
        case owner === admins.TimeLock:
            console.log(`\t✅\towner is timelock`);
            break;
        case owner === admins.Owner:
            console.log(`\t❓\towner is multisig`);
            break;
        case owner === admins.Deployer:
            console.log(`\t⚠️\towner is deployer`);
            break;
        default:
            console.log(`\t📛\towner is unknown ${owner}`);
    }
}

async function checkOwnable2Step(
    { ethers }: HardhatRuntimeEnvironment,
    contract: Contract,
    admins: AdminList
) {
    if (!contract.interface.hasFunction('pendingOwner')) return;

    const pendingOwner = await contract['pendingOwner']();

    switch (true) {
        case pendingOwner === ethers.ZeroAddress:
            console.log(`\t✅\tno pending owner`);
            break;
        case pendingOwner === admins.TimeLock:
            console.log(`\t🔄\tpendingOwner is timelock`);
            break;
        case pendingOwner === admins.Owner:
            console.log(`\t❓\tpendingOwner is multisig`);
            break;
        case pendingOwner === admins.Deployer:
            console.log(`\t⚠️\tpendingOwner is deployer`);
            break;
        default:
            console.log(`\t📛\tpendingOwner is unknown ${pendingOwner}`);
    }
}

async function checkAccessControlAdmin(
    { ethers }: HardhatRuntimeEnvironment,
    contract: Contract,
    admins: AdminList
) {
    if (
        !contract.interface.hasFunction('DEFAULT_ADMIN_ROLE') ||
        !contract.interface.hasEvent('RoleGranted')
    )
        return;

    // it's enough to check only address who get the role
    const events = await queryEventsSafe(
        'RoleGranted',
        contract,
        ethers.provider
    );

    const list: { [key: string]: boolean } = {};

    for (const event of events) {
        const e = event as unknown as { args: Array<string> };
        list[e.args[1]] = true;
    }

    if (Object.keys(list).length === 0) {
        console.log(
            '\t\tno RoleGranted events found, skip AccessControl check'
        );
    }

    for (const addr in list) {
        const hasRole = await contract['hasRole'](
            contract['DEFAULT_ADMIN_ROLE'](),
            addr
        );

        if (!hasRole) continue;

        switch (true) {
            case addr === admins.TimeLock:
                console.log(`\t✅\ttimelock has admin role`);
                break;
            case addr === admins.Owner:
                console.log(`\t❓\towner has admin role`);
                break;
            case addr === admins.Deployer:
                console.log(`\t⚠️\tdeployer has admin role`);
                break;
            default:
                console.log(`\t📛\tunknown ${addr} has admin role`);
        }
    }
}

async function queryEventsSafe(
    event: string,
    contract: Contract,
    provider: HardhatEthersProvider
) {
    let events;
    try {
        events = await contract.queryFilter(contract.getEvent(event));
    } catch (e: any) {
        const res = /block range: (\d+)/.exec(e);

        if (!res || res.length < 2) {
            throw e;
        }

        const range = Number(res[1]);
        // in this case check latest possible
        const latest = await provider.getBlockNumber();
        events = await contract.queryFilter(
            contract.getEvent(event),
            latest - range,
            latest
        );
    }

    return events || [];
}
