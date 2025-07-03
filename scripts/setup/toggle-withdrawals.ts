import { task } from 'hardhat/config';

task('setup-toggle-withdrawals', 'Call `toggleWithdrawals` on smart-contract')
  .addParam('target', 'The address of smart-contract')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { target, populate } = taskArgs;

    const lbtc = await ethers.getContractAt('LBTC', target);

    if (populate) {
      const txData = await lbtc.toggleWithdrawals.populateTransaction();
      console.log('Raw transaction:\n', JSON.stringify(txData, null, 2));
    } else {
      await (await lbtc.toggleWithdrawals()).wait(2);
    }
  });
