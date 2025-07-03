import { task } from 'hardhat/config';

task('setup-minter', 'Call `addMinter` on smart-contract')
  .addParam('target', 'The address of the smart-contract')
  .addParam('minter', 'The address of the minter')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { target, minter, populate } = taskArgs;

    const lbtc = await ethers.getContractAt('LBTC', target);

    if (populate) {
      const txData = await lbtc.addMinter.populateTransaction(minter);
      console.log('Raw transaction:\n', JSON.stringify(txData, null, 2));
    } else {
      await (await lbtc.addMinter(minter)).wait(2);
    }
  });
