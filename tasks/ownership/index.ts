import { scope, task } from 'hardhat/config';
import { check } from './check';
import { transferOwnership } from './transfer';

export const ownershipScope = scope('ownership');

ownershipScope
    .task('check')
    .addPositionalParam(
        'filename',
        'The JSON file containing contracts addresses',
        'mainnet.json'
    )
    .setAction(check);

ownershipScope
    .task('transfer', 'Call `transferOwnership` on smart-contract')
    .addPositionalParam('target', 'The address of smart-contract')
    .addPositionalParam('owner', 'The address to be owner')
    .setAction(transferOwnership);
