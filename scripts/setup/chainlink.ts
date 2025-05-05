import { task } from 'hardhat/config';

task('setup-token-pool', 'Configure TokenPoolAdapter smart-contract')
    .addParam('clAdapter', 'The address of chainlink adapter smart-contract')
    .addOptionalParam(
        'lbtc',
        'The address of LBTC smart-contract at remote chain'
    )
    .addOptionalParam(
        'remoteSelector',
        'Remote chain selector of destination chain'
    )
    .addOptionalParam('chain', 'Chain id of remote selector')
    .addOptionalParam('remotePool', 'The address of remote token pool')
    .addFlag('populate', 'Show transaction data and do not broadcast')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { clAdapter, remoteSelector, chain, remotePool, lbtc, populate } =
            taskArgs;

        const adapter = await ethers.getContractAt('CLAdapter', clAdapter);

        const tokenPool = await ethers.getContractAt(
            'LombardTokenPool',
            await adapter.tokenPool()
        );

        if (remoteSelector && remotePool && lbtc) {
            const remotePoolAddress =
                remotePool.length != 42
                    ? remotePool
                    : hre.ethers.AbiCoder.defaultAbiCoder().encode(
                          ['address'],
                          [remotePool]
                      );

            const lbtcEncoded =
                lbtc.length != 42
                    ? lbtc
                    : hre.ethers.AbiCoder.defaultAbiCoder().encode(
                          ['address'],
                          [lbtc]
                      );

            const args = [
                {
                    remoteChainSelector: remoteSelector,
                    allowed: true,
                    remotePoolAddress,
                    remoteTokenAddress: lbtcEncoded,
                    inboundRateLimiterConfig: {
                        isEnabled: false,
                        rate: 0,
                        capacity: 0,
                    },
                    outboundRateLimiterConfig: {
                        isEnabled: false,
                        rate: 0,
                        capacity: 0,
                    },
                },
            ];

            console.log(
                `tx=applyChainUpdates selector=${remoteSelector} remotePoolAddress=${remotePoolAddress} remoteTokenAddress=${lbtcEncoded}`
            );
            if (populate) {
                const txData =
                    await tokenPool.applyChainUpdates.populateTransaction(args);
                console.log(
                    `applyChainUpdates: ${JSON.stringify(txData, null, 2)}`
                );
            } else {
                const tx = await tokenPool.applyChainUpdates(args);
                await tx.wait(2);
            }
        }

        if (chain && remoteSelector) {
            const toChainId = chain.includes('0x')
                ? chain
                : hre.ethers.AbiCoder.defaultAbiCoder().encode(
                      ['uint256'],
                      [chain]
                  );

            console.log(
                `Chain ${toChainId} set for chain selector ${remoteSelector}`
            );

            if (populate) {
                const txData =
                    await adapter.setRemoteChainSelector.populateTransaction(
                        toChainId,
                        remoteSelector
                    );
                console.log(
                    `setRemoteChainSelector: ${JSON.stringify(txData, null, 2)}`
                );
            } else {
                const tx = await adapter.setRemoteChainSelector(
                    toChainId,
                    remoteSelector
                );
                await tx.wait(2);
            }
        }

        if (remotePool && remoteSelector) {
            const toPeer =
                remotePool.length != 42
                    ? remotePool
                    : hre.ethers.AbiCoder.defaultAbiCoder().encode(
                          ['address'],
                          [remotePool]
                      );

            console.log(
                `Remote peer ${toPeer} set for selector ${remoteSelector}`
            );

            if (populate) {
                const txData =
                    await tokenPool.setRemotePool.populateTransaction(
                        remoteSelector,
                        toPeer
                    );

                console.log(
                    `setRemotePool: ${JSON.stringify(txData, null, 2)}`
                );
            } else {
                const tx = await tokenPool.setRemotePool(
                    remoteSelector,
                    toPeer
                );
                await tx.wait(2);
            }
        }

        console.log('DONE');
    });

task('setup-ccip-apply-updates', 'Apply CCIP token pool updates')
    .addParam('clAdapter', 'The address of chainlink adapter smart-contract')
    .addParam('remoteSelector', 'Remote chain selector of destination chain')
    .addOptionalParam('inboundLimitRate')
    .addOptionalParam('inboundLimitCap')
    .addOptionalParam('outboundLimitRate')
    .addOptionalParam('outboundLimitCap')
    .addFlag('populate', '')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const {
            clAdapter,
            remoteSelector,
            populate,

            inboundLimitRate,
            inboundLimitCap,

            outboundLimitRate,
            outboundLimitCap,
        } = taskArgs;

        const adapter = await ethers.getContractAt('CLAdapter', clAdapter);

        const tokenPool = await ethers.getContractAt(
            'LombardTokenPool',
            await adapter.tokenPool()
        );

        if (populate) {
            const rawTx =
                await tokenPool.setChainRateLimiterConfig.populateTransaction(
                    remoteSelector,
                    {
                        isEnabled: outboundLimitRate && outboundLimitCap,
                        capacity: outboundLimitCap,
                        rate: outboundLimitRate,
                    },
                    {
                        isEnabled: inboundLimitRate && inboundLimitCap,
                        capacity: inboundLimitCap,
                        rate: inboundLimitRate,
                    }
                );
            console.log(`Tx: ${JSON.stringify(rawTx, null, 2)}`);
            return;
        }

        await tokenPool.setChainRateLimiterConfig(
            remoteSelector,
            {
                isEnabled: outboundLimitRate && outboundLimitCap,
                capacity: outboundLimitCap,
                rate: outboundLimitRate,
            },
            {
                isEnabled: inboundLimitRate && inboundLimitCap,
                capacity: inboundLimitCap,
                rate: inboundLimitRate,
            }
        );

        console.log(
            `Chain update applied chain for selector ${remoteSelector}`
        );
    });
