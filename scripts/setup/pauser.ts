import { task } from 'hardhat/config';

task('setup-transfer-pauser-role', 'Call `changePauser` on smart-contract')
  .addParam('target', 'The address of smart-contract')
  .addParam('pauser', 'The address to be pauser')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { target, pauser } = taskArgs;

    const lbtc = await ethers.getContractAt('LBTC', target);
    await lbtc.changePauser(pauser);
  });
