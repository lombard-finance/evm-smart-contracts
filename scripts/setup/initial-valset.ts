import { task } from 'hardhat/config';

task('setup-initial-valset', 'Call `setInitialValidatorSet` on smart-contract')
  .addParam('target', 'The address of smart-contract')
  .addParam('valset', '')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { target, valset, populate } = taskArgs;

    const consortium = await ethers.getContractAt('Consortium', target);

    if (populate) {
      const txData = await consortium.setInitialValidatorSet.populateTransaction(valset);
      console.log('Raw transaction:\n', JSON.stringify(txData, null, 2));
    } else {
      await (await consortium.setInitialValidatorSet(valset)).wait(2);
    }
  });
