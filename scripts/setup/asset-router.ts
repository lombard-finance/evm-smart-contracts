import { task } from 'hardhat/config';

task('setup-asset-router', 'Call `changeAssetRouter` on smart-contract')
  .addParam('target', 'The address of smart-contract')
  .addParam('tokenType', 'The type of the token')
  .addParam('assetRouter', 'The address of teh AssetRouter')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { target, tokenType, assetRouter } = taskArgs;
    let tokenClassName = '';
    switch (tokenType.toLowerCase()) {
      case 'stakedlbtc':
        tokenClassName = 'StakedLBTC';
        break;
      case 'nativelbtc':
        tokenClassName = 'NativeLBTC';
        break;
      default:
      throw Error("Unexpected token type " + tokenType);
    }

    const nativeLbtc = await ethers.getContractAt(tokenClassName, target);
    await nativeLbtc.changeAssetRouter(assetRouter);
  });
