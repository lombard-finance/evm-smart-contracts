import { task } from 'hardhat/config';
import { create3 } from '../helpers/create3Deployment';
import { sleep } from '../helpers';
import { verify } from '../helpers';

task('deploy-kiln-depositor', 'Deploys the KilnDepositor contract')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('vault', 'The address of the vault')
  .addParam('lbtc', 'The address of the LBTC contract')
  .addParam('stakeAndBake', 'The address of the StakeAndBake contract')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { ledgerNetwork, vault, lbtc, stakeAndBake } = taskArgs;

    const args = [vault, lbtc, stakeAndBake];

    const adapter = await hre.ethers.deployContract('KilnDepositor', args);
    await adapter.waitForDeployment();

    console.log(`Deployment address is ${await adapter.getAddress()}`);
    console.log(`Going to verify...`);

    await sleep(12_000);
    try {
      await verify(hre.run, await adapter.getAddress(), {
        constructorArguments: [vault, lbtc, stakeAndBake]
      });
    } catch (e) {
      console.error(`Verification failed: ${e}`);
    }
  });
