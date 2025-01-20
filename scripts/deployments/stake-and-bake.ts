import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';

/*
 * After deployment:
 * 1. Set depositor
 */

task('deploy-stake-and-bake', 'Deploys the StakeAndBake contract')
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .addParam('lbtc', 'The address of the LBTC contract')
    .addParam('admin', 'The owner of the proxy')
    .addParam('operator', 'The operator of the StakeAndBake contract')
    .addParam('fee', 'The starting fee setting')
    .addParam('claimer', 'The claimer of the StakeAndBake contract')
    .addParam('pauser', 'The pauser of the StakeAndBake contract')
    .addParam(
        'proxyFactoryAddr',
        'The ProxyFactory address',
        DEFAULT_PROXY_FACTORY
    )
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const {
            ledgerNetwork,
            lbtc,
            admin,
            operator,
            fee,
            claimer,
            pauser,
            proxyFactoryAddr,
        } = taskArgs;

        await create3(
            'StakeAndBake',
            [lbtc, admin, operator, fee, claimer, pauser],
            proxyFactoryAddr,
            ledgerNetwork,
            admin,
            hre
        );
    });
