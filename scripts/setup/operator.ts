import { task } from 'hardhat/config';

task('setup-operator', 'Call `transferOperatorRole` on smart-contract')
  .addParam('target', 'The address of smart-contract')
  .addParam('operator', 'The address to be operator')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { target, operator, populate } = taskArgs;

    const lbtc = await ethers.getContractAt('LBTC', target);

    if (populate) {
      const txData = await lbtc.transferOperatorRole.populateTransaction(operator);
      console.log('Raw transaction:\n', JSON.stringify(txData, null, 2));
    } else {
      await (await lbtc.transferOperatorRole(operator)).wait(2);
    }
  });
