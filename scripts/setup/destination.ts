import { task } from 'hardhat/config';

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

        await bridge.addDestination(
            toChainId,
            toContract,
            relCommission,
            absCommission,
            adapter,
            requireConsortium
        );
    });
