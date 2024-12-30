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
        'proxyAdmin',
        'the account to set as admin of the proxy in charge of contract upgrades'
    )
    .setAction(async (taskArgs, hre) => {
        const { admin, proxyAdmin } = taskArgs;
        await proxyDeployment(
            'DepositNotarizationBlacklist',
            [admin],
            proxyAdmin,
            hre
        );
    });
