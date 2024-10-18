import { task } from 'hardhat/config';
import { create3, DEFAULT_PROXY_FACTORY } from '../helpers';

task('deploy-consortium', 'Deploys the Consortium contract via create3')
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .addParam('admin', 'The address of the owner')
    .addParam(
        'proxyFactoryAddr',
        'The ProxyFactory address',
        DEFAULT_PROXY_FACTORY
    )
    .setAction(async (taskArgs, hre) => {
        const { ledgerNetwork, admin, proxyFactoryAddr } = taskArgs;

        await create3(
            'Consortium',
            [admin],
            proxyFactoryAddr,
            ledgerNetwork,
            admin,
            hre
        );
    });
