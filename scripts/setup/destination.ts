import { task } from 'hardhat/config';

task('setup-add-destination', 'Call `addDestination` on bridge smart-contract')
    .addParam('target', 'The address of bridge smart-contract')
    .addParam('chainId', 'The destination chain id')
    .addParam('contract', 'The address of destination bridge smart-contract')
    .addParam('relCommission', 'The relative commission for bridge', '1')
    .addParam('absCommission', 'The absolute commission for bridge', '10')
    .setAction(async (taskArgs, hre, network) => {
        const { ethers } = hre;

        const { target, chainId, contract, relCommission, absCommission } =
            taskArgs;

        const toChainId = chainId.includes('0x')
            ? chainId
            : ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [chainId]);

        const toContract =
            contract.length != 42
                ? contract
                : ethers.AbiCoder.defaultAbiCoder().encode(
                      ['address'],
                      [contract]
                  );

        const bridge = await ethers.getContractAt('Bridge', target);
        await bridge.addDestination(
            toChainId,
            toContract,
            relCommission,
            absCommission
        );
    });
