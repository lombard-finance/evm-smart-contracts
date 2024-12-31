import { readFileSync } from 'fs';

import { task } from 'hardhat/config';
import { getTransactionData } from './helpers';

const CHECK_IGNORE_LIST = ['chainId', 'admin', 'deprecated', 'ProxyFactory'];

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
        const ownerCalldata = getTransactionData(hre, 'owner()', []);
        for (const chainLabel of Object.keys(contractsData)) {
            if (!(chainLabel in hre.config.networks)) {
                console.log(
                    `Chain ${chainLabel} is not configured in Hardhat. Skipping.`
                );
                continue;
            }
            const provider = new hre.ethers.JsonRpcProvider(
                hre.config.networks[chainLabel].url
            );
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
                        const ownerQueriedAddress = (await provider.send(
                            'eth_call',
                            [
                                {
                                    to: contractsGroup[contractLabel],
                                    data: ownerCalldata,
                                },
                                'latest',
                            ]
                        )) as string;
                        // Received 0x as response, this has not a code associated, it is an EOA
                        if (ownerQueriedAddress.length < 22) {
                            console.log(
                                `- ${contractLabel} -> this is not a contract`
                            );
                            continue;
                        }
                        // Convert 32 byte address to a 20 byte checksummed hex
                        const ownerAddress = hre.ethers.getAddress(
                            '0x' + ownerQueriedAddress.slice(26)
                        );
                        // Lookup for known addresses
                        if (ownerAddress in policyAddresses) {
                            console.log(
                                `- ${contractLabel} -> ${policyAddresses[ownerAddress]} OK`
                            );
                        } else {
                            console.log(
                                `- ${contractLabel} -> UNKNOWN ${ownerAddress}`
                            );
                        }
                    } catch (e: any) {
                        if (e.info.error.code == -32000) {
                            console.log(
                                `Error accessing ownership information for ${contractLabel}:${contractAddress}. WIP: AccessControl`
                            );
                        } else {
                            console.log(
                                `Unhandled error on ${contractLabel}:${contractAddress}`
                            );
                        }
                    }
                }
            }
        }
    });
