import { task } from 'hardhat/config';
import { upgradeProxy } from '../helpers/upgrade';

task('upgrade-proxy', 'Upgrades proxy contract')
    .addParam('proxy', 'The address of the proxy contract')
    .addParam('contract', 'The name of the contract')
    .setAction(async (taskArgs, hre) => {
        let { proxy, contract } = taskArgs;

        const res = await upgradeProxy(contract, proxy, hre);

        console.log(`Implementation address is ${res.implementation}`);
    });
