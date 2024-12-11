import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';

/*
 * After deployment:
 * 1. Set treasury address
 * 2. Set minters (e.g. BTCBPMM)
 * 3. Set pauser
 * 4. Set mint fee
 * 5. Set claimers
 * 6. Set operator
 */

task('deploy-lbtc', 'Deploys the LBTC contract')
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .addParam('consortium', 'The address of LombardConsortium')
    .addParam('burnCommission', 'The burn commission')
    .addParam('admin', 'The owner of the proxy', 'self')
    .addParam(
        'proxyFactoryAddr',
        'The ProxyFactory address',
        DEFAULT_PROXY_FACTORY
    )
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const {
            ledgerNetwork,
            consortium,
            burnCommission,
            admin,
            proxyFactoryAddr,
        } = taskArgs;

        const [signer] = await hre.ethers.getSigners();
        let owner = await signer.getAddress();

        if (hre.ethers.isAddress(admin)) {
            owner = admin;
        }

        const data = await create3(
            'LBTC',
            [consortium, burnCommission, admin],
            proxyFactoryAddr,
            ledgerNetwork,
            owner,
            hre
        );

        // reinitialize
        const lbtc = await ethers.getContractAt('LBTC', data.proxy);
        await lbtc.reinitialize();
    });
