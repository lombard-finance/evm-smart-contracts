import { scope, task } from 'hardhat/config';
import { send } from './send';

export const gmpScope = scope('gmp');

gmpScope
  .task('send', 'Send a message through Lombard GMP')
  .addPositionalParam('mailbox', 'The mailbox contract address.')
  .addPositionalParam('recipient', 'The recipient of the message (must implement IHandler).')
  .addPositionalParam('toNetwork', 'The destination network')
  .addParam('body', 'The message body', '0x')
  .addOptionalParam('destinationCaller', 'The eligible caller on the destination chain.')
  .addOptionalParam('from', 'Populate raw transaction to broadcast it from another account')
  .setAction(send);
