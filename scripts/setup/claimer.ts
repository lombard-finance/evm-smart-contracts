import { task } from 'hardhat/config';

task('setup-claimer', 'Call `addClaimer` on smart-contract')
  .addParam('target', 'The address of smart-contract')
  .addParam('claimer', 'The address to be claimer')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { target, claimer, populate } = taskArgs;

    const lbtc = await ethers.getContractAt('LBTC', target);

    if (populate) {
      const txData = await lbtc.addClaimer.populateTransaction(claimer);
      console.log('Raw transaction:\n', JSON.stringify(txData, null, 2));
    } else {
      await (await lbtc.addClaimer(claimer)).wait(2);
    }
  });
