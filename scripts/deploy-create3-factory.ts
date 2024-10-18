import { task } from 'hardhat/config';
import { verify } from './helpers';
import * as readline from 'node:readline';

task('deploy-proxy-factory', 'Deploys the ProxyFactory contract').setAction(
    async (_, hre) => {
        const { ethers, run } = hre;

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const signer = (await ethers.getSigners())[0];
        const nonce = await signer.getNonce();

        if (nonce > 0) {
            console.error(
                `Signer address (${await signer.getAddress()}) nonce ${nonce} > 0`
            );
            rl.question('Do you want to proceed? [Y/n]: ', (ans) => {
                if (!ans.includes('Y')) {
                    console.log('Terminating deploy...');
                    process.exit();
                }
                rl.close();
            });
        }

        const factory = await ethers.deployContract('ProxyFactory');
        const res = await factory.waitForDeployment();
        console.log('ProxyFactory address', await res.getAddress());

        await verify(run, await factory.getAddress());
    }
);
