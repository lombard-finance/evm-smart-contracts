import { task } from 'hardhat/config';

task('setup-transfer-pauser-role', 'Call `changePauser` on smart-contract')
  .addParam('target', 'The address of smart-contract')
  .addParam('pauser', 'The address to be pauser')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { target, pauser, populate } = taskArgs;

    const lbtc = await ethers.getContractAt('LBTC', target);

    if (populate) {
      const txData = await lbtc.changePauser.populateTransaction(pauser);
      console.log('Raw transaction:\n', JSON.stringify(txData, null, 2));
    } else {
      await (await lbtc.changePauser(pauser)).wait(2);
    }
  });
