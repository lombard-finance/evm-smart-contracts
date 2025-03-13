import { verify } from '../helpers';
import { task } from 'hardhat/config';

task('deploy-timelock', 'Deploys the LombardTimeLock contract')
    .addParam('executors', 'List of executors divided by comma', '')
    .addParam('proposers', 'List of proposers divided by comma', '')
    .addParam('minDelay', 'The minimum timelock delay', 3600n.toString())

    .setAction(async (taskArgs, hre) => {
        const {
            executors: executorsArg,
            proposers: proposersArg,
            minDelay,
        } = taskArgs;

        let executors =
            executorsArg.split(',').filter((v: string) => v.length > 0) || [];

        executors.forEach((v: string) => {
            if (!hre.ethers.isAddress(v)) {
                throw new Error(`${v} is not address`);
            }
        });

        let proposers =
            proposersArg.split(',').filter((v: string) => v.length > 0) || [];

        proposers.forEach((v: string) => {
            if (!hre.ethers.isAddress(v)) {
                throw new Error(`${v} is not address`);
            }
        });

        console.log(`exectutors: ${JSON.stringify(executors, null, 2)}`);
        console.log(`proposers: ${JSON.stringify(proposers, null, 2)}`);

        const constructorArguments = [minDelay, proposers, executors];

        const timelock = await hre.ethers.deployContract(
            'LombardTimeLock',
            constructorArguments
        );
        await timelock.waitForDeployment();

        console.log(`Timelock deployed at ${await timelock.getAddress()}`);

        await verify(
            run,
            await timelock.getAddress(),
            {
                constructorArguments,
                contract:
                    'contracts/consortium/LombardTimeLock.sol:LombardTimeLock',
            },
            15_000
        );
    });
