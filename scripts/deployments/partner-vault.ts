import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';

/*
 * After deployment:
 * 1. Set initial validator set
 */

task('deploy-partner-vault', 'Deploys the PartnerVault contract via create3')
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .addParam('admin', 'The address of the owner')
    .addParam('lbtc', 'The address of the LBTC contract')
    .addParam('fbtc', 'The address of the FBTC contract')
    .addParam(
        'proxyFactoryAddr',
        'The ProxyFactory address',
        DEFAULT_PROXY_FACTORY
    )
    .setAction(async (taskArgs, hre) => {
        const { ledgerNetwork, admin, lbtc, fbtc, proxyFactoryAddr } = taskArgs;

        await create3(
            'PartnerVault',
            [admin, fbtc, lbtc],
            proxyFactoryAddr,
            ledgerNetwork,
            admin,
            hre
        );
    });
