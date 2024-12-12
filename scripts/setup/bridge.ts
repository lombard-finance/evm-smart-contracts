import { task } from 'hardhat/config';

task('setup-bridge-rate-limits', 'Set rate limits')
    .addParam('bridge', 'The address of bridge to be set')
    .addParam('chainId', 'The 32 bytes chain id')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { bridge, chainId } = taskArgs;

        const bridgeContract = await ethers.getContractAt('Bridge', bridge);
        await bridgeContract.setRateLimits(
            [
                {
                    chainId: chainId,
                    limit: 1e8,
                    window: 43200,
                },
            ],
            [
                {
                    chainId: chainId,
                    limit: 1e8,
                    window: 43200,
                },
            ]
        );
    });
