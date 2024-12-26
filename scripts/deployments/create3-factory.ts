import { task } from 'hardhat/config';
import { verify } from '../helpers';
import * as readline from 'node:readline/promises';

task('deploy-proxy-factory', 'Deploys the ProxyFactory contract')
    .addParam('admin', 'The admin of factory')
    .addParam('deployer', 'The deployer of proxies')
    .setAction(async (taskArgs, hre) => {
        const { admin, deployer } = taskArgs;
        const { ethers, run } = hre;

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const [signer] = await ethers.getSigners();
        const nonce = await signer.getNonce();

        if (nonce > 0) {
            console.error(
                `Signer address (${await signer.getAddress()}) nonce ${nonce} > 0`
            );
            const ans = await rl.question('Do you want to proceed? [Y/n]: ');
            if (!ans.includes('Y')) {
                console.log('Terminating deploy...');
                process.exit();
            }
            rl.close();
        }

        const factory = await ethers.deployContract('ProxyFactory', [
            admin,
            deployer,
        ]);
        const res = await factory.waitForDeployment();
        console.log('ProxyFactory address', await res.getAddress());

        await verify(run, await factory.getAddress());
    });
