import { task } from 'hardhat/config';
import { CustomRuntimeEnvironment } from '../cre';
import { populateSchedule, schedule } from '../helpers';
import { parseLibrariesArg } from '../helpers/linkedLibraries';

task('upgrade-proxy', 'Upgrades proxy contract')
  .addParam('proxy', 'The address of the proxy contract')
  .addPositionalParam('contractName', 'The name of the contract')
  .addOptionalParam('timelock', 'The address of timelock contract')
  .addOptionalParam('timelockDelay', 'The timelock delay in seconds')
  .addOptionalParam('timelockSalt', 'The salt to use for the upgrade')
  .addOptionalParam('libraries', 'Comma-separated linked libraries as LibraryName:address', '')
  .addParam('calldata', 'The calldata to execute during upgrade', '0x')
  .addFlag('populate', 'Show tx data to execute later')
  .setAction(async (taskArgs, hre) => {
    const {
      proxy,
      contractName,
      calldata,
      populate,
      timelock: timelockArg,
      timelockDelay: timelockDelayArg,
      timelockSalt: timelockSaltArg,
      libraries
    } = taskArgs;

    const cre = new CustomRuntimeEnvironment(hre);

    const proxyAdmin = await cre.getProxyAdmin(proxy);

    const impl = await cre.deployImplementation(contractName, parseLibrariesArg(libraries));

    if (!populate && !timelockArg) {
      const upgradeTx = await proxyAdmin.upgradeAndCall(proxy, impl, calldata);
      await upgradeTx.wait(1);

      console.log(`Contract ${contractName} at ${proxy} successfully upgraded in ${upgradeTx.hash}`);

      return;
    }

    const upgradeTx = await proxyAdmin.upgradeAndCall.populateTransaction(proxy, impl, calldata);

    if (populate && !timelockArg) {
      console.log(`Upgrade tx data:\n${JSON.stringify(upgradeTx, null, 2)}`);

      return;
    }

    const timelock = await cre.getTimelock(timelockArg);

    if (populate) {
      const timelockTx = await populateSchedule(hre, timelock, upgradeTx, timelockDelayArg);
      console.log(`Upgrade via timelock tx data:\n${JSON.stringify(timelockTx, null, 2)}`);

      return;
    }

    const timelockTx = await schedule(
      hre,
      timelock,
      upgradeTx,
      hre.ethers.ZeroHash,
      timelockSaltArg || hre.ethers.ZeroHash,
      timelockDelayArg
    );

    await timelockTx.wait(1);

    console.log(`Scheduled upgrade for ${contractName} contract at ${proxy} in ${timelockTx.hash}`);
  });

const UPGRADEABLE_BEACON = '@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol:UpgradeableBeacon';

task('upgrade-beacon', 'Deploys a new implementation and points UpgradeableBeacon at it')
  .addParam('beacon', 'The address of the UpgradeableBeacon contract')
  .addPositionalParam('contractName', 'The name of the implementation contract')
  .addOptionalParam('timelock', 'The address of timelock contract')
  .addOptionalParam('timelockDelay', 'The timelock delay in seconds')
  .addOptionalParam('timelockSalt', 'The salt to use for the scheduled upgrade')
  .addFlag('populate', 'Show tx data to execute later')
  .setAction(async (taskArgs, hre) => {
    const {
      beacon,
      contractName,
      populate,
      timelock: timelockArg,
      timelockDelay: timelockDelayArg,
      timelockSalt: timelockSaltArg
    } = taskArgs;

    const cre = new CustomRuntimeEnvironment(hre);

    const impl = await cre.deployImplementation(contractName);

    const beaconContract = await hre.ethers.getContractAt(UPGRADEABLE_BEACON, beacon);

    if (!populate && !timelockArg) {
      const upgradeTx = await beaconContract.upgradeTo(impl);
      await upgradeTx.wait(1);

      console.log(`Beacon ${beacon} upgraded to ${contractName} implementation ${impl} in ${upgradeTx.hash}`);

      return;
    }

    const upgradeTx = await beaconContract.upgradeTo.populateTransaction(impl);

    if (populate && !timelockArg) {
      console.log(`Beacon upgrade tx data:\n${JSON.stringify(upgradeTx, null, 2)}`);

      return;
    }

    const timelock = await cre.getTimelock(timelockArg);

    if (populate) {
      const timelockTx = await populateSchedule(
        hre,
        timelock,
        upgradeTx,
        hre.ethers.ZeroHash,
        timelockSaltArg || hre.ethers.ZeroHash,
        timelockDelayArg
      );
      console.log(`Beacon upgrade via timelock tx data:\n${JSON.stringify(timelockTx, null, 2)}`);

      return;
    }

    const timelockTx = await schedule(
      hre,
      timelock,
      upgradeTx,
      hre.ethers.ZeroHash,
      timelockSaltArg || hre.ethers.ZeroHash,
      timelockDelayArg
    );

    await timelockTx.wait(1);

    console.log(
      `Scheduled beacon upgrade for ${contractName} (impl ${impl}) at beacon ${beacon} in ${timelockTx.hash}`
    );
  });
