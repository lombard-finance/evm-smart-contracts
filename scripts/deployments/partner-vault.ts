import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';

/*
 * After deployment:
 * 1. Set lockedFbtc contract address
 * 2. Assign PartnerVault as minter on LBTC contract
 */

task('deploy-partner-vault', 'Deploys the PartnerVault contract via create3')
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .addParam('admin', 'The address of the owner')
    .addParam('lbtc', 'The address of the LBTC contract')
    .addParam('fbtc', 'The address of the FBTC0 contract')
    .addParam('stakeLimit', 'The stake limit of the partner vault')
    .addParam(
        'proxyFactoryAddr',
        'The ProxyFactory address',
        DEFAULT_PROXY_FACTORY
    )
    .setAction(async (taskArgs, hre) => {
        const {
            ledgerNetwork,
            admin,
            lbtc,
            fbtc,
            stakeLimit,
            proxyFactoryAddr,
        } = taskArgs;

        await create3(
            'PartnerVault',
            [admin, fbtc, lbtc, stakeLimit],
            proxyFactoryAddr,
            ledgerNetwork,
            admin,
            hre
        );
    });
