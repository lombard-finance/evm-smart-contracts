import { scope } from 'hardhat/config';
import { grantRole } from './grant';

export const roleScope = scope('role');

roleScope
  .task('grant', 'Call `grantRole` on smart-contract')
  .addPositionalParam('target', 'The address of smart-contract')
  .addPositionalParam('role', 'The role name to grant')
  .addPositionalParam('account', 'The account to grant')
  .setAction(grantRole);
