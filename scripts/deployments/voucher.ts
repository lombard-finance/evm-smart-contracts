import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';

task('deploy-voucher', 'Deploys the IBCVoucher contract')
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .addParam('lbtc', 'The address of the LBTC contract')
    .addParam('admin', 'The owner of the proxy')
    .addParam('treasury', 'The treasury address')
    .addParam('fee', 'The starting fee setting')
    .addParam(
        'proxyFactoryAddr',
        'The ProxyFactory address',
        DEFAULT_PROXY_FACTORY
    )
    .setAction(async (taskArgs, hre, network) => {
        const { ledgerNetwork, lbtc, admin, treasury, fee, proxyFactoryAddr } =
            taskArgs;

        await create3(
            'IBCVoucher',
            [lbtc, admin, fee, treasury],
            proxyFactoryAddr,
            ledgerNetwork,
            admin,
            hre
        );
    });
