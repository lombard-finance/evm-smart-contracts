import { task } from 'hardhat/config';
import { getOwnersOrDefault, verify } from '../helpers';

/*
 * Pre-requisites:
 * 1. Deploy SatelliteStrategy implementation + beacon via `deploy-beacon SatelliteStrategy ...`
 * 2. Register the beacon in BeaconHub: `hub.setBeacon(keccak256("SatelliteStrategy"), beaconAddr)`
 *    (done automatically if `deploy-beacon` was run with `--beacon-hub <addr>`)
 * 3. Grant DEPLOYER_ROLE on BeaconHub to the deploying account
 *
 * After deployment:
 * 1. Optionally grant PRIVILEGED_EXECUTOR_ROLE for validator-bypass exec paths
 * 2. If using MerkleAllowlistValidator, call setAllowlistRoot() on the validator
 */

task('deploy-satellite-strategy', 'Deploys a SatelliteStrategy BeaconProxy via BeaconHub')
  .addParam('beaconHub', 'BeaconHub address')
  .addParam('validator', 'IStrategyExecValidator address (e.g. MerkleAllowlistValidator)')
  .addParam('defaultAdmin', 'Receives DEFAULT_ADMIN_ROLE', 'self')
  .setAction(async (taskArgs, hre) => {
    const { beaconHub: beaconHubAddr, validator: validatorAddr } = taskArgs;

    const { owner: defaultAdmin } = await getOwnersOrDefault(hre, taskArgs.defaultAdmin, taskArgs.defaultAdmin);

    const satellite = await hre.ethers.getContractFactory('SatelliteStrategy');
    const initData = satellite.interface.encodeFunctionData('initialize', [validatorAddr, defaultAdmin]);

    const beaconId = hre.ethers.id('SatelliteStrategy');
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
    console.log('SatelliteStrategy proxy:', proxyAddr);

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
