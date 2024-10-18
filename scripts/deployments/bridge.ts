import { task } from 'hardhat/config';
import { create3, DEFAULT_PROXY_FACTORY } from '../helpers';

task('deploy-bridge', 'Deploys the Bridge contract via create3')
    .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
    .addParam('admin', 'The address of the owner')
    .addParam(
        'proxyFactoryAddr',
        'The ProxyFactory address',
        DEFAULT_PROXY_FACTORY
    )
    .addParam('lbtc', 'The address of the LBTC contract')
    .addParam('treasury', 'The address of the treasury')
    .addParam(
        'adapter',
        'Address of the initial adapter to use or name of the adapter to deploy'
    )
    .addOptionalParam(
        'router',
        'For TokenPoolAdapter is deployed as part of the execution'
    )
    .addFlag('setBridge', 'Indicates if bridge needs to be set in adapter')
    .setAction(async (taskArgs, hre) => {
        let {
            ledgerNetwork,
            lbtc,
            admin,
            proxyFactoryAddr,
            treasury,
            adapter,
            setBridge,
        } = taskArgs;

        if (adapter.slice(0, 2) !== '0x') {
            const data = await hre.run(
                `deploy:${adapter}`,
                taskArgs // should contain all arguments for adapter
            );
            adapter = await data.proxy.getAddress();
        }
        const data = await create3(
            'Bridge',
            [lbtc, treasury, adapter, admin],
            proxyFactoryAddr,
            ledgerNetwork,
            admin,
            hre
        );
        if (setBridge) {
            const adapterContract = await hre.ethers.getContractAt(
                'AbstractAdapter',
                adapter
            );
            await adapterContract.changeBridge(await data.proxy.getAddress());
        }
    });
