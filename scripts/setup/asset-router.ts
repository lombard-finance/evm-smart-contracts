import { task } from 'hardhat/config';


task('asset-router-grant-role', 'Call `grantRole` on AssetRouter smart-contract')
  .addParam('target', 'The address of smart-contract')
  .addParam('role', 'The type of the token')
  .addParam('account', 'The address of account that should have this role granted')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { target, role, account } = taskArgs;

    const assetRouter = await ethers.getContractAt('AssetRouter', target);
    await assetRouter.grantRole(ethers.keccak256(ethers.toUtf8Bytes(role)), account);
  });
