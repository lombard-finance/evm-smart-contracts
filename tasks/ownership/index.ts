import { scope } from 'hardhat/config';
import { check } from './check';

export const ownershipScope = scope('ownership');

ownershipScope
    .task('check')
    .addPositionalParam(
        'filename',
        'The JSON file containing contracts addresses',
        'mainnet.json'
    )
    .setAction(check);
