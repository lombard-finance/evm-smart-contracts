import { ContractFactory } from 'ethers';
import { task } from 'hardhat/config';
import { getOwnersOrDefault, verify } from '../helpers';

function jsonTx(tx: object) {
  return JSON.stringify(tx, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
}

task(
  'deploy-beacon',
  'Deploys an implementation, wraps it in an UpgradeableBeacon, and optionally registers it in BeaconHub'
)
  .addOptionalParam('beaconHub', 'BeaconHub address — if provided, registers the beacon under keccak256(contractName)')
  .addParam('admin', 'Default admin address (see getOwnersOrDefault)', 'self')
  .addParam('upgradeAdmin', 'Receives UpgradeableBeacon ownership (can change implementation)', 'self')
  .addPositionalParam('contract', 'Hardhat artifact name of the implementation contract')
  .addFlag('populate', 'Print deployment / call calldata and do not broadcast')
  .setAction(async (taskArgs, hre) => {
    const { beaconHub: beaconHubAddr, contract: contractName, populate } = taskArgs;
    const { upgradeAdmin } = await getOwnersOrDefault(hre, taskArgs.beaconOwner, taskArgs.beaconOwner);

    // 1. Deploy bare implementation (initializers disabled)
    const impl = await hre.ethers.deployContract(contractName);
    await impl.waitForDeployment();
    const implAddr = await impl.getAddress();
    console.log(`${contractName} implementation:`, implAddr);
    await verify(hre.run, implAddr);

    // 2. Deploy UpgradeableBeacon wrapping the implementation
    const BeaconFactory = await hre.ethers.getContractFactory(
      '@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol:UpgradeableBeacon'
    );
    const beacon = await BeaconFactory.deploy(implAddr, upgradeAdmin);
    await beacon.waitForDeployment();
    const beaconAddr = await beacon.getAddress();
    console.log('UpgradeableBeacon:', beaconAddr);
    await verify(hre.run, beaconAddr, { constructorArguments: [implAddr, upgradeAdmin] });

    // 3. Optionally register the beacon in BeaconHub (caller must hold BEACON_ADMIN_ROLE)
    if (hre.ethers.isAddress(beaconHubAddr)) {
      const beaconId = hre.ethers.id(contractName);
      const hub = await hre.ethers.getContractAt('BeaconHub', beaconHubAddr);
      if (populate) {
        const txData = await hub.setBeacon.populateTransaction(beaconId, beaconAddr);
        console.log('Raw transaction:\n', JSON.stringify(txData, null, 2));
      } else {
        await (await hub.setBeacon(beaconId, beaconAddr)).wait();
        console.log(
          `Beacon registered in BeaconHub: id=${beaconId} (keccak256("${contractName}")) beacon=${beaconAddr}`
        );
      }
    }
  });
