import { task } from 'hardhat/config';
import { getOwnersOrDefault, verify } from '../helpers';

/*
 * Pre-requisites:
 * 1. Deploy Shard implementation + beacon via `deploy-beacon Shard ...`
 * 2. Register the beacon in BeaconHub: `hub.setBeacon(keccak256("Shard"), beaconAddr)`
 *    (done automatically if `deploy-beacon` was run with `--beacon-hub <addr>`)
 * 3. Grant DEPLOYER_ROLE on BeaconHub to the deploying account
 *
 * After deployment:
 * 1. Optionally grant PRIVILEGED_EXECUTOR_ROLE for validator-bypass exec paths
 * 2. If using MerkleAllowlistValidator, call setAllowlistRoot() on the validator
 */

task('deploy-shard', 'Deploys a Shard BeaconProxy via BeaconHub')
  .addParam('beaconHub', 'BeaconHub address')
  .addParam('strategy', 'IStrategy (share token) address')
  .addParam('validator', 'IShardExecValidator address (e.g. MerkleAllowlistValidator)')
  .addParam('admin', 'Receives DEFAULT_ADMIN_ROLE', 'self')
  .addParam('liquidityRoleHolder', 'Receives STRATEGY_TOKEN_LIQUIDITY_ROLE', 'self')
  .setAction(async (taskArgs, hre) => {
    const {
      beaconHub: beaconHubAddr,
      strategy: strategyAddr,
      validator: validatorAddr,
      admin,
      liquidityRoleHolder: liquidityArg
    } = taskArgs;

    const { owner } = await getOwnersOrDefault(hre, admin, admin);
    const { owner: liquidityRoleHolder } = await getOwnersOrDefault(hre, liquidityArg, liquidityArg);

    const shard = await hre.ethers.getContractFactory('Shard');
    const initData = shard.interface.encodeFunctionData('initialize', [
      strategyAddr,
      validatorAddr,
      owner,
      liquidityRoleHolder
    ]);

    const beaconId = hre.ethers.id('Shard');
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
    if (!proxyAddr) {
      throw new Error('Shard proxy not found');
    }
    console.log('Shard proxy:', proxyAddr);

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
