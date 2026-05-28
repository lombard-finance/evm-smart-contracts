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
  .addFlag('inverted', 'If set, treat feed answer as token-per-base (invert)')
  .setAction(async (taskArgs, hre) => {
    const { feed, tokenDecimals, baseDecimals, heartbeat, sequencerUptimeFeed, gracePeriod, inverted } = taskArgs;

    const args = [
      feed,
      Number(tokenDecimals),
      Number(baseDecimals),
      BigInt(heartbeat),
      sequencerUptimeFeed,
      BigInt(gracePeriod),
      inverted
    ];

    const converter = await hre.ethers.deployContract('ChainlinkConverter', args);
    await converter.waitForDeployment();

    const address = await converter.getAddress();
    console.log(`ChainlinkConverter: ${address}`);

    await verify(hre.run, address, {
      constructorArguments: [...args]
    });
  });

/**
 * Deploy ChainlinkCompositeConverter (two Chainlink feeds as numerator/denominator ratio).
 *
 * Example (BTC-base strategy, WETH deposit via ETH/USD ÷ BTC/USD):
 *
 *   yarn hardhat deploy-chainlink-composite-converter \
 *     --network <network> \
 *     --feed-numerator <ETH/USD feed> \
 *     --feed-denominator <BTC/USD feed> \
 *     --token-decimals 18 \
 *     --base-decimals 8 \
 *     --heartbeat 3600
 */
task(
  'deploy-chainlink-composite-converter',
  'Deploys ChainlinkCompositeConverter (two AggregatorV3Interface feeds as a ratio)'
)
  .addParam('feedNumerator', 'First feed address (e.g. ETH/USD)')
  .addParam('feedDenominator', 'Second feed address (e.g. BTC/USD)')
  .addParam('tokenDecimals', 'Deposit token decimals (uint8)', '18')
  .addParam('baseDecimals', 'Strategy base asset decimals (uint8)', '8')
  .addParam('heartbeat', 'Max feed staleness in seconds (uint256)')
  .addOptionalParam(
    'sequencerUptimeFeed',
    'L2 sequencer uptime feed; zero disables sequencer checks',
    '0x0000000000000000000000000000000000000000'
  )
  .addOptionalParam('gracePeriod', 'Seconds after sequencer recovery during which deposits still revert', '0')
  .addFlag('inverted', 'If set, use reciprocal of numerator/denominator ratio')
  .setAction(async (taskArgs, hre) => {
    const {
      feedNumerator,
      feedDenominator,
      tokenDecimals,
      baseDecimals,
      heartbeat,
      sequencerUptimeFeed,
      gracePeriod,
      inverted
    } = taskArgs;

    const args = [
      feedNumerator,
      feedDenominator,
      Number(tokenDecimals),
      Number(baseDecimals),
      BigInt(heartbeat),
      sequencerUptimeFeed,
      BigInt(gracePeriod),
      inverted
    ];

    const converter = await hre.ethers.deployContract('ChainlinkCompositeConverter', args);
    await converter.waitForDeployment();

    const address = await converter.getAddress();
    console.log(`ChainlinkCompositeConverter: ${address}`);

    await verify(hre.run, address, {
      constructorArguments: [...args]
    });
  });
