import { task } from 'hardhat/config';
import { DepositNotarizationBlacklist } from '../typechain-types';

task(
    'blacklist',
    'Add or remove the transaction output to/from the blacklist contract'
)
    .addPositionalParam(
        'txHash',
        'the account to set as initial default admin of the blacklist contract'
    )
    .addPositionalParam(
        'vout',
        'the account in charge of contract upgrades to set as admin of the proxy'
    )
    .addParam('address', 'the address of the blacklist contract')
    .addFlag('remove', 'removes the transaction output from the blacklist')
    .setAction(async (taskArgs, hre) => {
        const { txHash, vout, address, remove } = taskArgs;
        const blacklistContractFactory = await hre.ethers.getContractFactory(
            'DepositNotarizationBlacklist'
        );
        const blacklistContract = blacklistContractFactory.attach(
            address
        ) as DepositNotarizationBlacklist;

        let tx;

        // If remove we first check if tx is blacklisted and then issue method call
        if (remove) {
            try {
                if (!(await blacklistContract.isBlacklisted(txHash, vout))) {
                    console.log(`${txHash}:${vout} is not blacklisted`);
                    return;
                }
            } catch (error) {
                console.error(error);
                console.error(
                    `Could not verify current status of ${txHash}:${vout}. Aborted.`
                );
                return;
            }
            tx = blacklistContract.removeFromBlacklist(txHash, [vout]);
        } else {
            tx = blacklistContract.addToBlacklist(txHash, [vout]);
        }

        try {
            const receipt = await tx;
            let removedString = '';
            if (remove) removedString = 'non-';
            console.log(
                `Successfully modified ${txHash}:${vout} state to ${removedString}blacklisted with transaction ${receipt.hash}`
            );
        } catch (error) {
            console.error(error);
            console.log(`Timed out or failed to execute transaction`);
        }
    });
