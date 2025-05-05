import { task } from 'hardhat/config';
import { create3 } from '../helpers/create3Deployment';
import { sleep } from '../helpers';
import { verify } from '../helpers';

task(
    'deploy-teller-depositor',
    'Deploys the TellerWithMultiAssetSupportDepositor contract'
)
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .addParam('teller', 'The address of the vault')
    .addParam('lbtc', 'The address of the LBTC contract')
    .addParam('stakeAndBake', 'The address of the StakeAndBake contract')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { ledgerNetwork, teller, lbtc, stakeAndBake } = taskArgs;

        const args = [teller, lbtc, stakeAndBake];

        const adapter = await hre.ethers.deployContract(
            'TellerWithMultiAssetSupportDepositor',
            args
        );
        await adapter.waitForDeployment();

        console.log(`Deployment address is ${await adapter.getAddress()}`);
        console.log(`Going to verify...`);

        await sleep(12_000);
        try {
            await verify(hre.run, await adapter.getAddress(), {
                constructorArguments: [teller, lbtc, stakeAndBake],
            });
        } catch (e) {
            console.error(`Verification failed: ${e}`);
        }
    });
