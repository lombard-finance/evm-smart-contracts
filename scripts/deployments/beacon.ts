import { task } from 'hardhat/config';
import { getOwnersOrDefault, verify } from '../helpers';

task('deploy-beacon', 'Deploys an implementation, wraps it in an UpgradeableBeacon, and optionally registers it in BeaconHub')
  .addOptionalParam('beaconHub', 'BeaconHub address — if provided, registers the beacon under keccak256(contractName)')
  .addParam('beaconOwner', 'Owner of the deployed UpgradeableBeacon', 'self')
  .addPositionalParam('contract', 'Hardhat artifact name of the implementation contract')
  .setAction(async (taskArgs, hre) => {
    const { beaconHub: beaconHubAddr, contract: contractName } = taskArgs;
    const { owner: beaconOwner } = await getOwnersOrDefault(hre, taskArgs.beaconOwner, taskArgs.beaconOwner);

    // 1. Deploy bare implementation (initializers disabled)
    const impl = await hre.ethers.deployContract(contractName);
    await impl.waitForDeployment();
    const implAddr = await impl.getAddress();
    console.log(`${contractName} implementation:`, implAddr);
    await verify(hre.run, implAddr);

    // 2. Deploy UpgradeableBeacon wrapping the implementation
    const BeaconFactory = await hre.ethers.getContractFactory(
      '@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol:UpgradeableBeacon',
    );
    const beacon = await BeaconFactory.deploy(implAddr, beaconOwner);
    await beacon.waitForDeployment();
    const beaconAddr = await beacon.getAddress();
    console.log('UpgradeableBeacon:', beaconAddr);
    await verify(hre.run, beaconAddr, { constructorArguments: [implAddr, beaconOwner] });

    // 3. Optionally register the beacon in BeaconHub (caller must hold BEACON_ADMIN_ROLE)
    if (hre.ethers.isAddress(beaconHubAddr)) {
      const beaconId = hre.ethers.id(contractName);
      const hub = await hre.ethers.getContractAt('BeaconHub', beaconHubAddr);
      await (await hub.setBeacon(beaconId, beaconAddr)).wait();
      console.log(`Beacon registered in BeaconHub: id=${beaconId} (keccak256("${contractName}")) beacon=${beaconAddr}`);
    }
  });