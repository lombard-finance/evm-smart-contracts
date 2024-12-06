import { task } from 'hardhat/config';

task('setup-bridge-rate-limits', 'Set rate limits')
    .addParam('bridge', 'The address of bridge to be set')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { bridge } = taskArgs;

        const bridgeContract = await ethers.getContractAt('Bridge', bridge);
        await bridgeContract.setRateLimits(
            [
                {
                    chainId:
                        '0x0000000000000000000000000000000000000000000000000000000000014A34',
                    limit: 1e8,
                    window: 43200,
                },
            ],
            [
                {
                    chainId:
                        '0x0000000000000000000000000000000000000000000000000000000000014A34',
                    limit: 1e8,
                    window: 43200,
                },
            ]
        );
    });
