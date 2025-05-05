import { task } from 'hardhat/config';
import { proxyDeployment } from '../helpers/proxyDeployment';

task(
    'deploy-blacklist',
    'Deploy the Blacklist contract for deposit notarizations'
)
    .addParam(
        'admin',
        'the account to set as initial default admin of the blacklist contract'
    )
    .addParam(
        'proxyOwner',
        'the account in charge of contract upgrades to set as admin of the proxy'
    )
    .setAction(async (taskArgs, hre) => {
        const { admin, proxyOwner } = taskArgs;
        await proxyDeployment(
            'DepositNotarizationBlacklist',
            [admin],
            proxyOwner,
            hre
        );
    });
