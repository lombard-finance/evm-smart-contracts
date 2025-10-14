import { task } from 'hardhat/config';
import { TokenPool } from '../../typechain-types';

task('setup-token-pool', 'Configure TokenPoolAdapter smart-contract')
  .addParam('clAdapter', 'The address of chainlink adapter smart-contract')
  .addOptionalParam('lbtc', 'The address of LBTC smart-contract at remote chain')
  .addOptionalParam('remoteSelector', 'Remote chain selector of destination chain')
  .addOptionalParam('chain', 'Chain id of remote selector')
  .addOptionalParam('remotePool', 'The address of remote token pool')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { clAdapter, remoteSelector, chain, remotePool, lbtc, populate } = taskArgs;

    const adapter = await ethers.getContractAt('CLAdapter', clAdapter);

    const tokenPool = await ethers.getContractAt('LombardTokenPool', await adapter.tokenPool());

    if (remoteSelector && remotePool && lbtc) {
      const remotePoolAddress =
        remotePool.length != 42 ? remotePool : hre.ethers.AbiCoder.defaultAbiCoder().encode(['address'], [remotePool]);

      const lbtcEncoded = lbtc.length != 42 ? lbtc : hre.ethers.AbiCoder.defaultAbiCoder().encode(['address'], [lbtc]);

      const args: TokenPool.ChainUpdateStruct[] = [
        {
          remoteChainSelector: remoteSelector,
          remotePoolAddresses: [remotePoolAddress],
          remoteTokenAddress: lbtcEncoded,
          inboundRateLimiterConfig: {
            isEnabled: false,
            rate: 0,
            capacity: 0
          },
          outboundRateLimiterConfig: {
            isEnabled: false,
            rate: 0,
            capacity: 0
          }
        }
      ];

      console.log(
        `tx=applyChainUpdates selector=${remoteSelector} remotePoolAddress=${remotePoolAddress} remoteTokenAddress=${lbtcEncoded}`
      );
      if (populate) {
        const txData = await tokenPool.applyChainUpdates.populateTransaction([], args);
        console.log(`applyChainUpdates: ${JSON.stringify(txData, null, 2)}`);
      } else {
        const tx = await tokenPool.applyChainUpdates([], args);
        await tx.wait(2);
      }
    }

    if (chain && remoteSelector) {
      const toChainId = chain.includes('0x')
        ? chain
        : hre.ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [chain]);

      console.log(`Chain ${toChainId} set for chain selector ${remoteSelector}`);

      if (populate) {
        const txData = await adapter.setRemoteChainSelector.populateTransaction(toChainId, remoteSelector);
        console.log(`setRemoteChainSelector: ${JSON.stringify(txData, null, 2)}`);
      } else {
        const tx = await adapter.setRemoteChainSelector(toChainId, remoteSelector);
        await tx.wait(2);
      }
    }

    console.log('DONE');
  });

task('setup-token-pool-v2', 'Configure LombardTokenPoolV2 smart-contract')
  .addPositionalParam('tokenPool', 'The address of token pool smart-contract')
  .addOptionalParam('remoteToken', 'The address of the token at remote chain')
  .addOptionalParam('remoteSelector', 'Remote chain selector of destination chain')
  .addOptionalParam('remoteChain', 'Chain id of remote selector')
  .addOptionalParam('remotePool', 'The address of remote token pool')
  .addFlag('populate', 'Show transaction data and do not broadcast')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;
    const encoder = ethers.AbiCoder.defaultAbiCoder();

    const { tokenPool: tokenPoolArg, remoteSelector, remoteChain, remotePool, remoteToken, populate } = taskArgs;

    const tokenPool = await ethers.getContractAt('LombardTokenPoolV2', tokenPoolArg);

    if (remoteSelector && remotePool && remoteToken) {
      const remotePoolBytes = remotePool.length != 42 ? remotePool : encoder.encode(['address'], [remotePool]);

      const remoteTokenBytes = remoteToken.length != 42 ? remoteToken : encoder.encode(['address'], [remoteToken]);

      const args: TokenPool.ChainUpdateStruct[] = [
        {
          remoteChainSelector: remoteSelector,
          remotePoolAddresses: [remotePoolBytes],
          remoteTokenAddress: remoteTokenBytes,
          inboundRateLimiterConfig: {
            isEnabled: false,
            rate: 0,
            capacity: 0
          },
          outboundRateLimiterConfig: {
            isEnabled: false,
            rate: 0,
            capacity: 0
          }
        }
      ];

      console.log(
        `tx=applyChainUpdates selector=${remoteSelector} remotePoolAddress=${remotePoolBytes} remoteTokenAddress=${remoteTokenBytes}`
      );
      if (populate) {
        const txData = await tokenPool.applyChainUpdates.populateTransaction([], args);
        console.log(`applyChainUpdates: ${JSON.stringify(txData, null, 2)}`);
      } else {
        const tx = await tokenPool.applyChainUpdates([], args);
        await tx.wait(2);
      }
    }

    if (remoteChain && remoteSelector && remotePool) {
      const remoteChainId = remoteChain.includes('0x') ? remoteChain : encoder.encode(['uint256'], [remoteChain]);
      const remotePoolBytes = remotePool.length != 42 ? remotePool : encoder.encode(['address'], [remotePool]);

      console.log(`Chain ${remoteChainId} set for chain selector ${remoteSelector}`);

      if (populate) {
        const txData = await tokenPool.setPath.populateTransaction(remoteSelector, remoteChainId, remotePoolBytes);
        console.log(`setPath: ${JSON.stringify(txData, null, 2)}`);
      } else {
        const tx = await tokenPool.setPath(remoteSelector, remoteChainId, remotePoolBytes);
        await tx.wait(2);
      }
    }

    console.log('DONE');
  });

task('setup-ccip-apply-updates', 'Apply CCIP token pool updates')
  .addParam('clAdapter', 'The address of chainlink adapter smart-contract')
  .addParam('remoteSelector', 'Remote chain selector of destination chain')
  .addOptionalParam('inboundLimitRate')
  .addOptionalParam('inboundLimitCap')
  .addOptionalParam('outboundLimitRate')
  .addOptionalParam('outboundLimitCap')
  .addFlag('populate', '')
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const {
      clAdapter,
      remoteSelector,
      populate,

      inboundLimitRate,
      inboundLimitCap,

      outboundLimitRate,
      outboundLimitCap
    } = taskArgs;

    const adapter = await ethers.getContractAt('CLAdapter', clAdapter);

    const tokenPool = await ethers.getContractAt('LombardTokenPool', await adapter.tokenPool());

    if (populate) {
      const rawTx = await tokenPool.setChainRateLimiterConfig.populateTransaction(
        remoteSelector,
        {
          isEnabled: outboundLimitRate && outboundLimitCap,
          capacity: outboundLimitCap,
          rate: outboundLimitRate
        },
        {
          isEnabled: inboundLimitRate && inboundLimitCap,
          capacity: inboundLimitCap,
          rate: inboundLimitRate
        }
      );
      console.log(`Tx: ${JSON.stringify(rawTx, null, 2)}`);
      return;
    }

    await tokenPool.setChainRateLimiterConfig(
      remoteSelector,
      {
        isEnabled: outboundLimitRate && outboundLimitCap,
        capacity: outboundLimitCap,
        rate: outboundLimitRate
      },
      {
        isEnabled: inboundLimitRate && inboundLimitCap,
        capacity: inboundLimitCap,
        rate: inboundLimitRate
      }
    );

    console.log(`Chain update applied chain for selector ${remoteSelector}`);
  });
