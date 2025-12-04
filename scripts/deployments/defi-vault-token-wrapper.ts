import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';

/*
 * After deployment:
 * 1. Add StakeAndBake contracts
 */

task('deploy-defi-vault-token-wrapper', 'Deploys the ERC4626VaultWrapper contract')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('owner', 'The owner of the proxy')
  .addParam('name', 'The name of the vault token')
  .addParam('symbol', 'The symbol of the vault token')
  .addOptionalParam('ownerDelay', 'The delay of admin role change', '0')
  .addParam('pauser', 'The address of account with pauser role')
  .addParam('teller', 'The address of the Veda Teller contract')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_PROXY_FACTORY)
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { ledgerNetwork, owner, name, symbol, ownerDelay, pauser, teller, proxyFactoryAddr } = taskArgs;

    await create3(
      'ERC4626VaultWrapper',
      [owner, name, symbol, ownerDelay, pauser, teller],
      proxyFactoryAddr,
      ledgerNetwork,
      owner,
      hre
    );
  });
