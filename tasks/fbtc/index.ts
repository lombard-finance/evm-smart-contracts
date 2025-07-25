import { scope, task } from 'hardhat/config';
import { finalizeRedeemFBTC, stakeFBTC, startRedeemFBTC } from './partner-vault';

export const fbtcScope = scope('fbtc');

fbtcScope
  .task('stake', "Calls FBTCPartnerVault's mint")
  .addPositionalParam('target', 'FBTCPartnerVault contract address')
  .addParam('amount', 'Amount of FBTC to stake')
  .addFlag('populate', 'Populate raw transaction to broadcast it from another account')
  .setAction(stakeFBTC);

fbtcScope
  .task('start-redeem', "Calls FBTCPartnerVault's nitializeBurn")
  .addPositionalParam('target', 'FBTCPartnerVault contract address')
  .addParam('recipient', 'Recipient address of FBTC')
  .addParam('amount', 'Amount of FBTC to stake')
  .addParam('txid', 'BTC deposit tx Id')
  .addParam('index', "The transaction output index to user's deposit address")
  .addFlag('populate', 'Populate raw transaction to broadcast it from another account')
  .setAction(startRedeemFBTC);

fbtcScope
  .task('finalize-redeem', "Calls FBTCPartnerVault's finalizeBurn")
  .addPositionalParam('target', 'FBTCPartnerVault contract address')
  .addParam('recipient', 'Recipient address of FBTC')
  .addParam('amount', 'Amount of FBTC to stake')
  .addParam('txid', 'BTC deposit tx Id')
  .addParam('index', "The transaction output index to user's deposit address")
  .addFlag('populate', 'Populate raw transaction to broadcast it from another account')
  .setAction(finalizeRedeemFBTC);
