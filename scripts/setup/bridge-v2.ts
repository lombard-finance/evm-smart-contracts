import { task } from 'hardhat/config';

task('setup-destination-token', 'Call `addDestinationToken` on BridgeV2 smart-contract')
  .addPositionalParam('target', 'The address of BridgeV2 smart-contract')
  .addParam('destChainId', 'The destination chain id')
  .addParam('sourceToken', 'The address of source token smart contract')
  .addParam('destinationToken', 'The address of destination token smart-contract')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { target, destChainId: chainId, sourceToken: fromToken, destinationToken, populate } = taskArgs;
    const { ethers } = hre;
    const encoder = ethers.AbiCoder.defaultAbiCoder();

    if (!ethers.isAddress(fromToken)) {
      throw Error(`invalid arg: source token (${fromToken}) should be an address`);
    }
    const toToken = ethers.isAddress(destinationToken)
      ? encoder.encode(['address'], [destinationToken])
      : destinationToken;

    const toChainId = chainId.includes('0x')
      ? chainId
      : hre.ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [chainId]);

    const bridge = await hre.ethers.getContractAt('BridgeV2', target);

    const existingDestToken = await bridge.getAllowedDestinationToken(toChainId, fromToken);
    if (existingDestToken != hre.ethers.zeroPadValue(hre.ethers.ZeroAddress, 32)) {
      console.log(`Removing existing destination token ${existingDestToken}`);
      if (populate) {
        const txData = await bridge.removeDestinationToken.populateTransaction(toChainId, fromToken, toToken);
        console.log(`removeDestinationToken: ${JSON.stringify(txData, null, 2)}`);
      } else {
        await (await bridge.removeDestinationToken(toChainId, fromToken, toToken)).wait(2);
      }
    }
    console.log(`Adding destination to ${toChainId}`);

    if (populate) {
      const txData = await bridge.addDestinationToken.populateTransaction(toChainId, fromToken, toToken);
      console.log(`addDestination: ${JSON.stringify(txData, null, 2)}`);
    } else {
      const tx = await bridge.addDestinationToken(toChainId, fromToken, toToken);
      await tx.wait(2);
    }
  });

task('setup-destination-bridge', 'Call `setDestinationBridge` on BridgeV2 smart-contract')
  .addPositionalParam('target', 'The address of BridgeV2 smart-contract')
  .addParam('destChainId', 'The destination chain id')
  .addParam('destBridge', 'The destination bridge address')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { target, destChainId: chainId, populate, destBridge: destBridgeArg } = taskArgs;
    const { ethers } = hre;
    const encoder = ethers.AbiCoder.defaultAbiCoder();

    const destBridge = ethers.isAddress(destBridgeArg) ? encoder.encode(['address'], [destBridgeArg]) : destBridgeArg;

    const toChainId = chainId.includes('0x')
      ? chainId
      : hre.ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [chainId]);

    const bridge = await hre.ethers.getContractAt('BridgeV2', target);

    const existingDest = await bridge.destinationBridge(toChainId);
    if (existingDest != hre.ethers.zeroPadValue(hre.ethers.ZeroAddress, 32)) {
      console.log(`Destination bridge was already set as ${existingDest}, replacing...`);
    }

    if (populate) {
      const txData = await bridge.setDestinationBridge.populateTransaction(toChainId, destBridge);
      console.log(`setDestinationBridge: ${JSON.stringify(txData, null, 2)}`);
    } else {
      const tx = await bridge.setDestinationBridge(toChainId, destBridge);
      await tx.wait(2);
    }
  });

task('setup-token-rate-limits', 'Set withdrawal rate limits for `BridgeV2` contract.')
  .addPositionalParam('bridge', 'The address of bridge to be set')
  .addPositionalParam('token', 'The token to apply limits.')
  .addParam('chainId', 'The incoming chain id.')
  .addParam('window', 'Rate limit window', '43200')
  .addParam('limit', 'Rate limit amount', (1e8).toString())
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { bridge, chainId, window, limit, populate, token } = taskArgs;

    if (!ethers.isAddress(token)) {
      throw Error(`invalid arg: token (${token}) should be an address`);
    }
    const toChainId = chainId.includes('0x')
      ? chainId
      : hre.ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [chainId]);

    const bridgeContract = await ethers.getContractAt('BridgeV2', bridge);

    if (populate) {
      const txData = await bridgeContract.setTokenRateLimits.populateTransaction(token, {
        chainId: toChainId,
        limit: limit,
        window: window
      });
      console.log(`setRateLimits: ${JSON.stringify(txData, null, 2)}`);
    } else {
      const tx = await bridgeContract.setTokenRateLimits(token, {
        chainId: toChainId,
        limit: limit,
        window: window
      });
      await tx.wait(2);
    }
  });
