import { scope, task } from 'hardhat/config';
import { check } from './check';
import { transferOwnership } from './transfer';
import { transferAccessControl } from './transfer-access';
import { transferDefaulAdmin } from './transfer-default-admin';
import { acceptDefaultAdmin } from './accept-default-admin';
import { acceptOwnership } from './accept-ownership';

export const ownershipScope = scope('ownership');

ownershipScope
  .task('check')
  .addPositionalParam('filename', 'The JSON file containing contracts addresses', 'mainnet.json')
  .setAction(check);

ownershipScope
  .task('transfer', 'Call `transferOwnership` on smart-contract')
  .addPositionalParam('target', 'The address of smart-contract')
  .addPositionalParam('owner', 'The address to be owner')
  .addFlag('populate', 'Only populate calldata')
  .setAction(transferOwnership);

ownershipScope
  .task('accept', 'Call `acceptOwnership` on smart-contract')
  .addPositionalParam('target', 'The address of smart-contract')
  .addFlag('populate', 'Only populate calldata')
  .setAction(acceptOwnership);

ownershipScope
  .task('transfer-access', 'Call `grantRole` and `revokeRole` on smart-contract')
  .addPositionalParam('target', 'The address of smart-contract')
  .addPositionalParam('owner', 'The address to be owner')
  .setAction(transferAccessControl);

ownershipScope
  .task('transfer-default-admin', 'Call `beginDefaultAdminTransfer` on smart-contract')
  .addPositionalParam('target', 'The address of smart-contract')
  .addPositionalParam('owner', 'The address to be owner')
  .addFlag('populate', 'Only populate calldata')
  .setAction(transferDefaulAdmin);

ownershipScope
  .task('accept-default-admin', 'Call `acceptDefaultAdminTransfer` on smart-contract')
  .addPositionalParam('target', 'The address of smart-contract')
  .addFlag('populate', 'Only populate calldata')
  .setAction(acceptDefaultAdmin);
