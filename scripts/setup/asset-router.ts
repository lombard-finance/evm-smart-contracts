import { task } from 'hardhat/config';

task('asset-router-set-route', 'Call `setRoute` on AssetRouter smart-contract')
  .addParam('target', 'The address of smart-contract')
  .addParam('fromToken', 'The address of the source token')
  .addParam('fromChain', 'The ID of the source chain')
  .addParam('toToken', 'The address of the destination token')
  .addParam('toChain', 'The ID of the destination chain')
  .addParam('routeType', 'The type of the route')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { target, fromToken, fromChain, toToken, toChain, routeType, populate } = taskArgs;

    const fromT =
      fromToken.length != 42 ? fromToken : hre.ethers.AbiCoder.defaultAbiCoder().encode(['address'], [fromToken]);
    const toT = toToken.length != 42 ? toToken : hre.ethers.AbiCoder.defaultAbiCoder().encode(['address'], [toToken]);

    const fromChainId = fromChain.includes('0x')
      ? fromChain
      : hre.ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [fromChain]);
    const toChainId = toChain.includes('0x')
      ? toChain
      : hre.ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [toChain]);

    const assetRouter = await ethers.getContractAt('AssetRouter', target);

    console.log(`Setting route on ${target}`);

    if (populate) {
      const txData = await assetRouter.setRoute.populateTransaction(fromT, fromChainId, toT, toChainId, routeType);
      console.log(`setRoute: ${JSON.stringify(txData, null, 2)}`);
    } else {
      await assetRouter.setRoute(fromT, fromChainId, toT, toChainId, routeType);
    }
  });
