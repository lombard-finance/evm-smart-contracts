import { task } from 'hardhat/config';
import { sleep } from '../helpers';

task('setup-add-destination', 'Call `addDestination` on bridge smart-contract')
    .addParam('target', 'The address of bridge smart-contract')
    .addParam('chainId', 'The destination chain id')
    .addParam('contract', 'The address of destination bridge smart-contract')
    .addParam('relCommission', 'The relative commission for bridge', '1')
    .addParam('absCommission', 'The absolute commission for bridge', '10')
    .addParam(
        'adapter',
        'The address of adapter',
        '0x0000000000000000000000000000000000000000'
    )
    .addFlag('requireConsortium', 'Use if consortium required for destination')
    .setAction(async (taskArgs, hre, network) => {
        const {
            target,
            chainId,
            contract,
            relCommission,
            absCommission,
            adapter,
            requireConsortium,
        } = taskArgs;

        const toChainId = chainId.includes('0x')
            ? chainId
            : hre.ethers.AbiCoder.defaultAbiCoder().encode(
                  ['uint256'],
                  [chainId]
              );

        const toContract =
            contract.length != 42
                ? contract
                : hre.ethers.AbiCoder.defaultAbiCoder().encode(
                      ['address'],
                      [contract]
                  );

        const bridge = await hre.ethers.getContractAt('Bridge', target);

        const existingDest = await bridge.getDestination(toChainId);
        if (
            existingDest.bridgeContract !=
            hre.ethers.zeroPadValue(hre.ethers.ZeroAddress, 32)
        ) {
            console.log(`Removing existing destination ${existingDest}`);
            await (await bridge.removeDestination(toChainId)).wait(2);
        }
        console.log(`Adding destination to ${toChainId}`);

        await sleep(12_000);

        await bridge.addDestination(
            toChainId,
            toContract,
            relCommission,
            absCommission,
            adapter,
            requireConsortium
        );
    });

task('setup-bridge-rate-limits', 'Set rate limits')
    .addParam('bridge', 'The address of bridge to be set')
    .addParam('chainId', 'The 32 bytes chain id')
    .addParam('window', 'Rate limit window', '43200')
    .addParam('limit', 'Rate limit amount', (1e8).toString())
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { bridge, chainId, window, limit } = taskArgs;

        const toChainId = chainId.includes('0x')
            ? chainId
            : hre.ethers.AbiCoder.defaultAbiCoder().encode(
                  ['uint256'],
                  [chainId]
              );

        const bridgeContract = await ethers.getContractAt('Bridge', bridge);
        await bridgeContract.setRateLimits(
            [
                {
                    chainId: toChainId,
                    limit: limit,
                    window: window,
                },
            ],
            [
                {
                    chainId: toChainId,
                    limit: limit,
                    window: window,
                },
            ]
        );
    });
