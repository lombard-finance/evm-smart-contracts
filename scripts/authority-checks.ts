import { readFileSync } from 'fs';

import { task } from 'hardhat/config';
import { checkEIP165InterfaceId, getTransactionData } from './helpers';
import {
    ErrAPINotFound,
    getAllLogsByEventAndFirstTopic,
} from './helpers/etherscan';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

const CHECK_IGNORE_LIST = ['chainId', 'admin', 'deprecated', 'ProxyFactory'];

const ACCESS_CONTROL_EIP165_ID = '0x7965db0b';

const ROLE_GRANTED_TOPIC =
    '0x2f8788117e7eff1d82e926ec794901d17c78024a50270940304540a733656f0d';
const ROLE_REVOKED_TOPIC =
    '0xf6391f5c32d9c69d2a47ea670b442974b53935d1edc7fd64eb21e047a839171b';
const DEFAULT_ADMIN_ROLE =
    '0x0000000000000000000000000000000000000000000000000000000000000000';

task(
    'authority-check',
    'Given the set of contracts connected to our services, checks the ownership of such contracts is consistent with our policies'
)
    .addParam(
        'chainConf',
        'The JSON file containing contracts information',
        'mainnet.json'
    )
    .setAction(async (taskArgs, hre) => {
        const { chainConf } = taskArgs;
        const chainConfData = readFileSync(chainConf, 'utf8');
        const contractsData = JSON.parse(chainConfData);
        for (const chainLabel of Object.keys(contractsData)) {
            if (!(chainLabel in hre.config.networks)) {
                console.log(
                    `Chain ${chainLabel} is not configured in Hardhat. Skipping.`
                );
                continue;
            }
            const chainContractsData = contractsData[chainLabel];
            console.log(
                `## Chain: ${chainLabel} - ${chainContractsData['chainId']}`
            );

            // Create a reverse lookup of known admin addresses
            let policyAddresses: { [id: string]: string } = {};
            for (const adminLabel of Object.keys(chainContractsData['admin'])) {
                policyAddresses[chainContractsData['admin'][adminLabel]] =
                    adminLabel;
            }

            for (const contractsGroupLabel of Object.keys(chainContractsData)) {
                if (CHECK_IGNORE_LIST.includes(contractsGroupLabel)) {
                    continue;
                }
                console.log(`# Checking ${contractsGroupLabel} contracts...`);
                const contractsGroup = chainContractsData[contractsGroupLabel];
                for (const contractLabel of Object.keys(contractsGroup)) {
                    const contractAddress = contractsGroup[contractLabel];
                    if (CHECK_IGNORE_LIST.includes(contractLabel)) {
                        continue;
                    }
                    if (!hre.ethers.isAddress(contractAddress)) {
                        console.log(
                            `Skipped ${contractLabel}:${contractAddress}`
                        );
                        continue;
                    }
                    try {
                        const owner = await getContractOwner(
                            chainLabel,
                            contractsGroup[contractLabel],
                            hre
                        );
                        // Lookup for known addresses
                        if (owner in policyAddresses) {
                            console.log(
                                `- OWNER:${contractLabel} -> ${policyAddresses[owner]} OK`
                            );
                        } else {
                            console.log(
                                `- OWNER:${contractLabel} -> UNKNOWN ${owner}`
                            );
                        }
                    } catch (e: any) {
                        switch (e) {
                            case ErrNotContract:
                                console.log(
                                    `- ${contractLabel} -> this is not a contract`
                                );
                                continue;
                            case ErrNotOwnable:
                                console.log(`${contractLabel} is not Ownable`);
                                break;
                            default:
                                console.log(
                                    `Unhandled error on ${contractLabel}:${contractAddress}: ${e}`
                                );
                                continue;
                        }
                    }
                    try {
                        // Check contract has AccessControl capabilities
                        if (
                            !(await checkEIP165InterfaceId(
                                ACCESS_CONTROL_EIP165_ID,
                                contractAddress,
                                chainLabel,
                                hre
                            ))
                        ) {
                            continue;
                        }
                    } catch (e: any) {
                        if (e.info != undefined) {
                            // This is not EIP165 compatible
                            if (e.info.error.code != -32000) {
                                console.log(
                                    `Error checking AccessControl compatibility: ${e.info.error.code}:${e.info.error.message}`
                                );
                            }
                        } else {
                            console.log(
                                `Error checking AccessControl compatibility: ${e}`
                            );
                        }
                        continue;
                    }
                    try {
                        let apiKey: string;
                        if (typeof hre.config.etherscan.apiKey == 'string') {
                            apiKey = hre.config.etherscan.apiKey;
                        } else {
                            if (
                                !(chainLabel in hre.config.etherscan.apiKey) ||
                                hre.config.etherscan.apiKey[chainLabel] == ''
                            ) {
                                console.log(
                                    `No scan API key registered for ${chainLabel}`
                                );
                                continue;
                            }
                            apiKey = hre.config.etherscan.apiKey[chainLabel];
                        }
                        const admins = await getContractDefaultAdmins(
                            chainLabel,
                            contractAddress,
                            apiKey
                        );
                        for (const admin of admins) {
                            let checksummedAdminAddress =
                                hre.ethers.getAddress(admin);
                            if (checksummedAdminAddress in policyAddresses) {
                                console.log(
                                    `- ADMIN:${contractLabel} -> ${policyAddresses[checksummedAdminAddress]} OK`
                                );
                            } else {
                                console.log(
                                    `- ADMIN:${contractLabel} -> UNKNOWN ${checksummedAdminAddress}`
                                );
                            }
                        }
                    } catch (e: any) {
                        if (e == ErrAPINotFound) {
                            console.log(
                                `Scan API for chain ${chainLabel} is not configured`
                            );
                        }
                    }
                }
            }
        }
    });

const ErrNotContract = 'NotContract';
const ErrNotOwnable = 'NotOwnable';
const ErrGeneric = 'Generic';

async function getContractOwner(
    chain: string,
    contractAddress: string,
    hre: HardhatRuntimeEnvironment
): Promise<string> {
    const ownerCalldata = getTransactionData(hre, 'owner()', []);
    const provider = new hre.ethers.JsonRpcProvider(
        hre.config.networks[chain].url
    );
    try {
        const ownerQueriedAddress = (await provider.send('eth_call', [
            {
                to: contractAddress,
                data: ownerCalldata,
            },
            'latest',
        ])) as string;
        // Received 0x as response, this has not a code associated, it is an EOA
        if (ownerQueriedAddress.length < 22) {
            throw ErrNotContract;
        }
        // Convert 32 byte address to a 20 byte checksummed hex
        return hre.ethers.getAddress('0x' + ownerQueriedAddress.slice(26));
    } catch (e: any) {
        if (e.info == undefined) {
            throw e;
        }
        // -32000 may be returned if "owner()" function is not present
        if (e.info.error.code == -32000) {
            throw ErrNotOwnable;
        } else {
            throw ErrGeneric;
        }
    }
}

async function getContractDefaultAdmins(
    chain: string,
    contractAddress: string,
    apiKey: string
): Promise<string[]> {
    const roleGrantedLogs = await getAllLogsByEventAndFirstTopic(
        chain,
        contractAddress,
        ROLE_GRANTED_TOPIC,
        DEFAULT_ADMIN_ROLE,
        apiKey
    );
    const roleRevokedLogs = await getAllLogsByEventAndFirstTopic(
        chain,
        contractAddress,
        ROLE_REVOKED_TOPIC,
        DEFAULT_ADMIN_ROLE,
        apiKey
    );
    const admins: { [id: string]: bigint } = {};
    for (const eventLog of roleGrantedLogs) {
        if (
            !(eventLog.topics[2] in admins) ||
            admins[eventLog.topics[2]] < BigInt(eventLog.blockNumber)
        ) {
            admins[eventLog.topics[2]] = BigInt(eventLog.blockNumber);
        }
    }
    for (const eventLog of roleRevokedLogs) {
        if (
            eventLog.topics[2] in admins &&
            admins[eventLog.topics[2]] > BigInt(eventLog.blockNumber)
        ) {
            delete admins[eventLog.topics[2]];
        }
    }
    return Object.keys(admins).map((elem) => {
        // We have address on 32 bytes from events
        return '0x' + elem.slice(26);
    });
}
