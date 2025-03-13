import { scope, task } from 'hardhat/config';
import { IEfficientRateLimiterV1 } from '../../typechain-types';
import { rateLimitsLegacy } from './rate-limits';

export const lzScope = scope('lz');

lzScope
    .task('rate-limits-legacy', 'Configure legacy interface rate limits')
    .addParam('eids', 'Eids of remote chains')
    .addParam('limit', 'TBD')
    .addParam('window', 'TBD')
    .addParam('oappAddress', 'The address of OFTAdapter')
    .addFlag('inbound', '')
    .addFlag('outbound', '')
    .addFlag(
        'populate',
        'Populate raw transaction to broadcast it from another account'
    )
    .setAction(rateLimitsLegacy);
