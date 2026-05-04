import { task } from 'hardhat/config';
import { getOwnersOrDefault, verify } from '../helpers';

/*
 * Pre-requisites:
 * 1. Deploy the MultiAssetWithAsyncRedemptionVault implementation + beacon via `deploy-beacon`
 * 2. Register the beacon in BeaconHub via `hub.setBeacon(keccak256("MultiAssetWithAsyncRedemptionVault"), beaconAddr)`
 * 3. Grant DEPLOYER_ROLE on BeaconHub to the deploying account
 *
 * After deployment:
 * 1. Configure deposit assets via addDepositAsset() on the proxy
 * 2. Optionally grant `OPERATOR_ROLE` / adjust `maxRedeemRequestShares` via admin or treasury
 */

task('deploy-multi-asset-vault', 'Deploys a MultiAssetWithAsyncRedemptionVault BeaconProxy via BeaconHub')
  .addParam('beaconHub', 'BeaconHub address')
  .addParam('name', 'ERC20 token name for the vault share')
  .addParam('symbol', 'ERC20 token symbol for the vault share')
  .addParam('asset', 'Underlying ERC-20 asset address')
  .addParam('defaultAdmin', 'Default admin address', 'self')
  .addParam('adminDelay', 'Initial default admin delay in seconds', '0')
  .addParam('strategyDeployer', 'Strategy deployer address', 'self')
  .setAction(async (taskArgs, hre) => {
    const {
      beaconHub: beaconHubAddr,
      name,
      symbol,
      asset,
      adminDelay,
    } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    const signerAddr = await signer.getAddress();

    const { owner: defaultAdmin, upgradeAdmin: strategyDeployer } = await getOwnersOrDefault(
      hre,
      taskArgs.defaultAdmin,
      taskArgs.strategyDeployer
    );

    const vault = await hre.ethers.getContractFactory('MultiAssetWithAsyncRedemptionVault');
    const initData = vault.interface.encodeFunctionData('initialize', [
      name,
      symbol,
      asset,
      defaultAdmin,
      Number(adminDelay),
      strategyDeployer
    ]);

    const beaconId = hre.ethers.id('MultiAssetWithAsyncRedemptionVault');
    const hub = await hre.ethers.getContractAt('BeaconHub', beaconHubAddr);
    const beaconAddr = await hub.beacon(beaconId);
    const receipt = await (await hub.deploy(beaconId, initData)).wait(5);

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
    console.log('MultiAssetWithAsyncRedemptionVault proxy:', proxyAddr);

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
      60_000
    );
  });
