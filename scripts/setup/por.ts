import { task } from 'hardhat/config';

task('por-add-root-pubkey', 'Call `addRootPubkey` on smart-contract')
  .addParam('target', 'The address of smart-contract')
  .addParam('rootPubKey', 'The root public key to be added')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { target, rootPubKey, populate } = taskArgs;

    const por = await ethers.getContractAt('PoR', target);

    if (populate) {
      const txData = await por.addRootPubkey.populateTransaction(rootPubKey);
      console.log('Raw transaction:\n', JSON.stringify(txData, null, 2));
    } else {
      await (await por.addRootPubkey(rootPubKey)).wait(2);
    }
  });
