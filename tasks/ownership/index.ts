import { scope, task } from 'hardhat/config';
import { check } from './check';
import { transferOwnership } from './transfer';
import { transferAccessControl } from './transfer-access';

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

ownershipScope
    .task(
        'transfer-access',
        'Call `grantRole` and `revokeRole` on smart-contract'
    )
    .addPositionalParam('target', 'The address of smart-contract')
    .addPositionalParam('owner', 'The address to be owner')
    .setAction(transferAccessControl);
