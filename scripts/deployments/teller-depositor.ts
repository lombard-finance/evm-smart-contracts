import { task } from 'hardhat/config';
import { create3 } from '../helpers/create3Deployment';
import { sleep } from '../helpers';

task(
    'deploy-teller-depositor',
    'Deploys the TellerWithMultiAssetSupportDepositor contract'
)
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { ledgerNetwork } = taskArgs;

        const args = [];

        const adapter = await hre.ethers.deployContract(
            'TellerWithMultiAssetSupportDepositor',
            args
        );
        await adapter.waitForDeployment();

        console.log(`Deployment address is ${await adapter.getAddress()}`);
        console.log(`Going to verify...`);

        await sleep(12_000);
        try {
            await run('verify:verify', {
                address: await adapter.getAddress(),
                contract:
                    'contracts/stakeAndBake/depositor/TellerWithMultiAssetSupportDepositor.sol:TellerWithMultiAssetSupportDepositor',
                args,
            });
        } catch (e) {
            console.error(`Verification failed: ${e}`);
        }
    });
