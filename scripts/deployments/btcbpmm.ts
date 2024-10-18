import { task } from 'hardhat/config';
import { create3, DEFAULT_PROXY_FACTORY } from '../helpers';

/*
 * After deployment:
 * 1. Grant pauser role
 * 2. Grant timelock role
 */
task('deploy-btcbpmm', 'Deploys the BTCBPMM contract via create3')
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .addParam('admin', 'The address of the owner')
    .addParam(
        'proxyFactoryAddr',
        'The ProxyFactory address',
        DEFAULT_PROXY_FACTORY
    )
    .addParam('lbtc', 'The address of the LBTC contract')
    .addParam('btcb', 'The address of the BTCB contract')
    .addParam('stakeLimit', 'The stake limit', (30n * 10n ** 8n).toString()) // default is 30 LBTC
    .addParam('withdrawAddress', 'The address to withdraw to')
    .addParam('relativeFee', 'The relative fee of the pmm', 10n.toString())
    .setAction(async (taskArgs, hre) => {
        const {
            ledgerNetwork,
            lbtc,
            btcb,
            admin,
            stakeLimit,
            withdrawAddress,
            proxyFactoryAddr,
            relativeFee,
        } = taskArgs;

        await create3(
            'BTCBPMM',
            [lbtc, btcb, admin, stakeLimit, withdrawAddress, relativeFee],
            proxyFactoryAddr,
            ledgerNetwork,
            admin,
            hre
        );
    });
