import { task } from 'hardhat/config';
import { verify } from '../helpers';

task('deploy-direct-converter', 'Deploys DirectConverter (1:1 IAssetConverter; no oracle)').setAction(
  async (_taskArgs, hre) => {
    const converter = await hre.ethers.deployContract('DirectConverter', []);
    await converter.waitForDeployment();

    const address = await converter.getAddress();
    console.log(`DirectConverter: ${address}`);

    await verify(hre.run, address, {
      constructorArguments: []
    });
  }
);

task('deploy-chainlink-converter', 'Deploys ChainlinkConverter (IAssetConverter via AggregatorV3Interface)')
  .addParam('feed', 'Chainlink AggregatorV3Interface address')
  .addParam('tokenDecimals', 'Deposit token decimals (uint8)', '18')
  .addParam('baseDecimals', 'Strategy base asset decimals (uint8)', '8')
  .addParam('heartbeat', 'Max feed staleness in seconds (uint256)')
  .addOptionalParam(
    'sequencerUptimeFeed',
    'L2 sequencer uptime feed; zero disables sequencer checks',
    '0x0000000000000000000000000000000000000000'
  )
  .addOptionalParam('gracePeriod', 'Seconds after sequencer recovery during which deposits still revert', '0')
  .setAction(async (taskArgs, hre) => {
    const { feed, tokenDecimals, baseDecimals, heartbeat, sequencerUptimeFeed, gracePeriod } = taskArgs;

    const args = [
      feed,
      Number(tokenDecimals),
      Number(baseDecimals),
      BigInt(heartbeat),
      sequencerUptimeFeed,
      BigInt(gracePeriod)
    ] as const;

    const converter = await hre.ethers.deployContract('ChainlinkConverter', args);
    await converter.waitForDeployment();

    const address = await converter.getAddress();
    console.log(`ChainlinkConverter: ${address}`);

    await verify(hre.run, address, {
      constructorArguments: [...args]
    });
  });

task('deploy-staked-lbtc-converter', 'Deploys StakedLBTCConverter (IAssetConverter via StakedLBTCOracle ratio)')
  .addParam('oracle', 'StakedLBTCOracle (IOracle) address')
  .setAction(async (taskArgs, hre) => {
    const { oracle } = taskArgs;
    const args = [oracle] as const;

    const converter = await hre.ethers.deployContract('StakedLBTCConverter', args);
    await converter.waitForDeployment();

    const address = await converter.getAddress();
    console.log(`StakedLBTCConverter: ${address}`);

    await verify(hre.run, address, {
      constructorArguments: [...args]
    });
  });
