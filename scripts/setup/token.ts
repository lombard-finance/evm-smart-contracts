import { task } from 'hardhat/config';

task('token-set-asset-router', 'Call `changeAssetRouter` on smart-contract')
  .addParam('target', 'The address of smart-contract')
  .addParam('tokenType', 'The type of the token')
  .addParam('assetRouter', 'The address of teh AssetRouter')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { target, tokenType, assetRouter, populate } = taskArgs;
    let tokenClassName = getTokenContractName(tokenType);

    const lbtc = await ethers.getContractAt(tokenClassName, target);

    console.log(`Setting AssetRouter to ${target}`);

    if (populate) {
      const txData = await lbtc.changeAssetRouter.populateTransaction(assetRouter);
      console.log(`changeAssetRouter: ${JSON.stringify(txData, null, 2)}`);
    } else {
      await lbtc.changeAssetRouter(assetRouter);
    }
  });

function getTokenContractName(tokenType: string): string {
  let tokenClassName = '';
  switch (tokenType.toLowerCase()) {
    case 'stakedlbtc':
      tokenClassName = 'StakedLBTC';
      break;
    case 'nativelbtc':
      tokenClassName = 'NativeLBTC';
      break;
    default:
      throw Error('Unexpected token type ' + tokenType);
  }
  return tokenClassName;
}
