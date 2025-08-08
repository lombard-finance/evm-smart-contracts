import { scope, task } from 'hardhat/config';
import { check } from './check';

export const ratioScope = scope('ratio');

ratioScope
  .task('check')
  .addPositionalParam('filename', 'The JSON file containing contracts addresses', 'mainnet.json')
  .setAction(check);
