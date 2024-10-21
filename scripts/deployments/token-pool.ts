import { task } from 'hardhat/config';
import { sleep, verify } from '../helpers';

/*
 * After deployment:
 * 1. Configure token pool
 */
task('deploy-ccip-token-pool', 'Deploys chainlink TokenPool contract')
    .addParam('router', 'The chainlink ccip router')
    .addParam(
        'lbtc',
        'The address of the LBTC contract / token to be used in the pool'
    )
    .addParam('adapter', 'The address of the adapter')
    .addParam('rmn', 'The address of the RmnProxy')
    .addVariadicPositionalParam(
        'allowlist',
        'The list of addresses allowed to bridge',
        []
    )
    .setAction(async (taskArgs, hre) => {
        const { lbtc, rmn, router, adapter, allowlist } = taskArgs;

        const pool = await hre.ethers.deployContract('LBTCTokenPool', [
            adapter,
            lbtc,
            allowlist,
            rmn,
            router,
        ]);
        console.log('TokenPool:', await pool.getAddress());

        await sleep(12_000);

        await verify(hre.run, await pool.getAddress(), {
            constructorArguments: [adapter, lbtc, allowlist, rmn, router],
        });
    });
