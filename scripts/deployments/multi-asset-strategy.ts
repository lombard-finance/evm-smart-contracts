import { task } from 'hardhat/config';
import { getOwnersOrDefault, sleep, verify } from '../helpers';

/*
 * Pre-requisites:
 * 1. Deploy the MultiAssetWithAsyncRedemptionStrategy implementation + beacon via `deploy-beacon`
 * 2. Register the beacon in BeaconHub via `hub.setBeacon(keccak256("MultiAssetWithAsyncRedemptionStrategy"), beaconAddr)`
 * 3. Grant DEPLOYER_ROLE on BeaconHub to the deploying account
 *
 * After deployment:
 * 1. Configure deposit assets via addDepositAsset() on the proxy
 * 2. Optionally grant roles (e.g. PRICE_SETTER_ROLE, PAY_REDEMPTIONS_ROLE, TREASURY_ROLE) via AccessControl
 */

task('deploy-multi-asset-strategy', 'Deploys a MultiAssetWithAsyncRedemptionStrategy BeaconProxy via BeaconHub')
  .addParam('beaconHub', 'BeaconHub address')
  .addParam('name', 'ERC20 token name for the strategy share')
  .addParam('symbol', 'ERC20 token symbol for the strategy share')
  .addParam('asset', 'Underlying ERC-20 asset address')
  .addParam('defaultAdmin', 'Default admin address', 'self')
  .addParam('adminDelay', 'Initial default admin delay in seconds', '0')
  .setAction(async (taskArgs, hre) => {
    const { beaconHub: beaconHubAddr, name, symbol, asset, adminDelay } = taskArgs;

    const { owner } = await getOwnersOrDefault(hre, taskArgs.defaultAdmin, taskArgs.defaultAdmin);

    const strategy = await hre.ethers.getContractFactory('MultiAssetWithAsyncRedemptionStrategy');
    const initData = strategy.interface.encodeFunctionData('initialize', [
      name,
      symbol,
      asset,
      owner,
      Number(adminDelay)
    ]);

    const beaconId = hre.ethers.id('MultiAssetWithAsyncRedemptionStrategy');
    const hub = await hre.ethers.getContractAt('BeaconHub', beaconHubAddr);
    const beaconAddr = await hub.beacon(beaconId);
    const receipt = await (await hub.deploy(beaconId, initData)).wait(2);
    await sleep(30_000);

    const deployedEvent = receipt!.logs
      .map((log: any) => {
        try {
          return hub.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e: any) => e?.name === 'Deployed');

    const proxyAddr = deployedEvent?.args.proxy;
    if (!proxyAddr) {
      throw new Error('MultiAssetWithAsyncRedemptionStrategy proxy not found');
    }
    console.log('MultiAssetWithAsyncRedemptionStrategy proxy:', proxyAddr);

    // Use a long delay: the hardhat-upgrades plugin intercepts verify:verify,
    // fails its own beacon-proxy flow (bytecode version mismatch), then falls
    // back to a direct Etherscan call — which needs the block to have propagated.
    await verify(
      hre.run,
      proxyAddr,
      {
        contract: '@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol:BeaconProxy',
        constructorArguments: [beaconAddr, initData]
      },
      10_000
    );
  });
