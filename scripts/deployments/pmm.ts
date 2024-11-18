import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';

/*
 * After deployment:
 * 1. Grant pauser role
 * 2. Grant timelock role
 */

task('deploy-pmm', 'Deploys pmm contract via create3')
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .addParam('admin', 'The address of the owner')
    .addParam(
        'proxyFactoryAddr',
        'The ProxyFactory address',
        DEFAULT_PROXY_FACTORY
    )
    .addParam('lbtc', 'The address of the LBTC contract')
    .addParam('btcToken', 'The address of the BTC representation')
    .addParam('stakeLimit', 'The stake limit', (30n * 10n ** 8n).toString()) // default is 30 LBTC
    .addParam('withdrawAddress', 'The address to withdraw to')
    .addParam('relativeFee', 'The relative fee of the pmm', 10n.toString())
    .addParam('pmm', 'The name of pmm contract')
    .setAction(async (taskArgs, hre) => {
        const {
            ledgerNetwork,
            lbtc,
            btcToken,
            admin,
            stakeLimit,
            withdrawAddress,
            proxyFactoryAddr,
            relativeFee,
            pmm,
        } = taskArgs;

        let contractName = '';
        switch (pmm) {
            case 'BTCB':
                contractName = 'BTCBPMM';
                break;
            case 'CBBTC':
                contractName = 'CBBTCPMM';
                break;
            default:
                throw Error(`Unsupported pmm: ${pmm}`);
        }

        await create3(
            contractName,
            [lbtc, btcToken, admin, stakeLimit, withdrawAddress, relativeFee],
            proxyFactoryAddr,
            ledgerNetwork,
            admin,
            hre
        );
    });
