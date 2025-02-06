import { IEfficientRateLimiterV1 } from '../../typechain-types';
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types';

export const rateLimitsLegacy = async (
    taskArgs: TaskArguments,
    { ethers }: HardhatRuntimeEnvironment
) => {
    const { oappAddress, inbound, outbound, eids, limit, window, populate } =
        taskArgs;

    let direction = -1n;
    if (!!inbound && !outbound) {
        direction = 0n;
    } else if (!inbound && !!outbound) {
        direction = 1n;
    } else {
        throw Error('should be selected only one direction');
    }

    const oftAdapter = await ethers.getContractAt(
        'IEfficientRateLimiterV1',
        oappAddress
    );

    const limits: IEfficientRateLimiterV1.RateLimitConfigStruct[] = eids
        .split(',')
        .map((eid: string) => {
            const e = BigInt(eid);
            return { eid: e, limit, window };
        });

    if (populate) {
        const tx = await oftAdapter.setRateLimits.populateTransaction(
            limits,
            direction
        );
        console.log('Raw transaction:\n', JSON.stringify(tx, null, 2));
    } else {
        // Send the transaction
        const tx = await oftAdapter.setRateLimits(limits, direction);

        console.log('Transaction sent:', tx.hash);
        await tx.wait();
    }
};
