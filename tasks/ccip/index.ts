import { scope, task } from 'hardhat/config';
import { check } from './check';

export const ccipScope = scope('ccip');

ccipScope
  .task('check')
  .addPositionalParam('filename', 'The JSON file containing contracts addresses', 'mainnet.json')
  .setAction(check);
