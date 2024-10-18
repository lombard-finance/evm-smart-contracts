import { task } from 'hardhat/config';
import { create3, DEFAULT_PROXY_FACTORY } from '../helpers';

task('deploy-consortium', 'Deploys the Consortium contract via create3')
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .addParam('admin', 'The address of the owner')
    .addParam('thresholdKey', 'The address of LombardConsortium')
    .addParam(
        'proxyFactoryAddr',
        'The ProxyFactory address',
        DEFAULT_PROXY_FACTORY
    )
    .setAction(async (taskArgs, hre) => {
        const { ledgerNetwork, thresholdKey, admin, proxyFactoryAddr } =
            taskArgs;

        await create3(
            'Consortium',
            [thresholdKey, admin],
            proxyFactoryAddr,
            ledgerNetwork,
            admin,
            hre
        );
    });
