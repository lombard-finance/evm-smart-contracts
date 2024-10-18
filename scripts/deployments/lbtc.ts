import { task } from 'hardhat/config';
import { create3, DEFAULT_PROXY_FACTORY } from '../helpers';

/*
 * After deployment:
 * 1. Set treasury address
 * 2. Set minters (e.g. BTCBPMM)
 * 3. Set pauser
 */

task('deploy-lbtc', 'Deploys the LBTC contract')
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .addParam('consortium', 'The address of LombardConsortium')
    .addParam('burnCommission', 'The burn commission')
    .addParam('admin', 'The owner of the proxy')
    .addParam(
        'proxyFactoryAddr',
        'The ProxyFactory address',
        DEFAULT_PROXY_FACTORY
    )
    .setAction(async (taskArgs, hre, network) => {
        const {
            ledgerNetwork,
            consortium,
            burnCommission,
            testEnv,
            admin,
            proxyFactoryAddr,
        } = taskArgs;

        const data = await create3(
            'LBTC',
            [consortium, burnCommission, admin],
            proxyFactoryAddr,
            ledgerNetwork,
            admin,
            hre
        );

        // reinitialize
        await data.proxy.reinitialize();
    });
