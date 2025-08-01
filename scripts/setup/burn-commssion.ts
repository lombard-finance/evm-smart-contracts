import { task } from 'hardhat/config';

task('setup-burn-commission', 'Call `changeBurnCommission` on smart-contract')
  .addParam('target', 'The address of smart-contract')
  .addParam('value', 'The burn commission')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { target, value, populate } = taskArgs;

    const lbtc = await ethers.getContractAt('LBTC', target);

    if (populate) {
      const txData = await lbtc.changeBurnCommission.populateTransaction(value);
      console.log('Raw transaction:\n', JSON.stringify(txData, null, 2));
    } else {
      await (await lbtc.changeBurnCommission(value)).wait(2);
    }
  });
