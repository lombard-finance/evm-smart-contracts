import { task } from 'hardhat/config';
import { CustomRuntimeEnvironment } from '../cre';
import { populateSchedule, schedule } from '../helpers';

task('upgrade-proxy', 'Upgrades proxy contract')
  .addParam('proxy', 'The address of the proxy contract')
  .addPositionalParam('contractName', 'The name of the contract')
  .addOptionalParam('timelock', 'The address of timelock contract')
  .addOptionalParam('timelockDelay', 'The timelock delay in seconds')
  .addParam('calldata', 'The calldata to execute during upgrade', '0x')
  .addFlag('populate', 'Show tx data to execute later')
  .setAction(async (taskArgs, hre) => {
    const {
      proxy,
      contractName,
      calldata,
      populate,
      timelock: timelockArg,
      timelockDelay: timelockDelayArg
    } = taskArgs;

    const cre = new CustomRuntimeEnvironment(hre);

    const proxyAdmin = await cre.getProxyAdmin(proxy);

    const impl = await cre.deployImplementation(contractName);

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

    const timelockTx = await schedule(hre, timelock, upgradeTx, timelockDelayArg);

    await timelockTx.wait(1);

    console.log(`Scheduled upgrade for ${contractName} contract at ${proxy} in ${timelockTx.hash}`);
  });
