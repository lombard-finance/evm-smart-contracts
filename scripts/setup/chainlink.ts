import { task } from 'hardhat/config';
import { sleep } from '../helpers';

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
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { clAdapter, remoteSelector, chain, remotePool, lbtc } = taskArgs;

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

            await tokenPool.applyChainUpdates([
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
            ]);

            console.log(
                `Chain update applied chain selector ${remoteSelector}`
            );

            await sleep(12_000);
        }

        if (chain && remoteSelector) {
            const toChainId = chain.includes('0x')
                ? chain
                : hre.ethers.AbiCoder.defaultAbiCoder().encode(
                      ['uint256'],
                      [chain]
                  );
            const r = await adapter.setRemoteChainSelector(
                toChainId,
                remoteSelector
            );
            await r.wait(2);
            console.log(`Chain ${chain} set for chain selector ${toChainId}`);

            await sleep(12_000);
        }

        if (remotePool && remoteSelector) {
            const toPeer =
                remotePool.length != 42
                    ? remotePool
                    : hre.ethers.AbiCoder.defaultAbiCoder().encode(
                          ['address'],
                          [remotePool]
                      );
            const r = await tokenPool.setRemotePool(remoteSelector, toPeer);
            await r.wait(2);
            console.log(
                `Chain selector ${toPeer} set for eid ${remoteSelector}`
            );

            await sleep(12_000);
        }

        console.log('DONE');
    });

task('setup-ccip-apply-updates', 'Apply CCIP token pool updates')
    .addParam('clAdapter', 'The address of chainlink adapter smart-contract')
    .addParam('lbtc', 'The address of LBTC smart-contract at remote chain')
    .addParam('remoteSelector', 'Remote chain selector of destination chain')
    .addParam('remotePool', 'The address of remote token pool')
    .addOptionalParam('inboundLimitRate')
    .addOptionalParam('inboundLimitCap')
    .addOptionalParam('outboundLimitRate')
    .addOptionalParam('outboundLimitCap')
    .addFlag('disable', 'Disable pathway')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const {
            clAdapter,
            remoteSelector,
            remotePool,
            lbtc,

            disable: disableArg,

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

        await tokenPool.applyChainUpdates([
            {
                remoteChainSelector: remoteSelector,
                allowed: !disableArg,
                remotePoolAddress,
                remoteTokenAddress: lbtcEncoded,
                inboundRateLimiterConfig: {
                    isEnabled: inboundLimitRate && inboundLimitCap,
                    rate: inboundLimitRate || 0,
                    capacity: inboundLimitCap || 0,
                },
                outboundRateLimiterConfig: {
                    isEnabled: outboundLimitRate && outboundLimitCap,
                    rate: outboundLimitRate || 0,
                    capacity: outboundLimitCap || 0,
                },
            },
        ]);

        console.log(
            `Chain update applied chain for selector ${remoteSelector}`
        );
    });
