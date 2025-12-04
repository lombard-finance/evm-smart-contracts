import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';

/*
 * After deployment:
 * 1. Set depositor
 */

task('deploy-stake-and-bake', 'Deploys the StakeAndBake contract')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('lbtc', 'The address of the LBTC contract')
  .addParam('admin', 'The owner of the proxy')
  .addParam('operator', 'The operator of the StakeAndBake contract')
  .addParam('fee', 'The starting fee setting')
  .addParam('claimer', 'The claimer of the StakeAndBake contract')
  .addParam('pauser', 'The pauser of the StakeAndBake contract')
  .addParam('gasLimit', 'Gas limit for batch stake and bake calls')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_PROXY_FACTORY)
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { ledgerNetwork, lbtc, admin, operator, fee, claimer, pauser, gasLimit, proxyFactoryAddr } = taskArgs;

    await create3(
      'StakeAndBake',
      [lbtc, admin, operator, fee, claimer, pauser, gasLimit],
      proxyFactoryAddr,
      ledgerNetwork,
      admin,
      hre
    );
  });

task('deploy-stake-and-bake-for-native', 'Deploys the StakeAndBake contract')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('token', 'The address of the NativeLBTC or bridge token contract')
  .addParam('adapter', 'The address of the adapter', '0x0000000000000000000000000000000000000000')
  .addParam('admin', 'The owner of the proxy')
  .addParam('operator', 'The operator of the StakeAndBake contract')
  .addParam('fee', 'The starting fee setting')
  .addParam('claimer', 'The claimer of the StakeAndBake contract')
  .addParam('pauser', 'The pauser of the StakeAndBake contract')
  .addParam('gasLimit', 'Gas limit for batch stake and bake calls')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_PROXY_FACTORY)
  .setAction(async (taskArgs, hre, network) => {
    const { ethers } = hre;

    const { ledgerNetwork, token, adapter, admin, operator, fee, claimer, pauser, gasLimit, proxyFactoryAddr } =
      taskArgs;

    let adapterAddress = adapter;
    if (adapter == ethers.ZeroAddress) {
      adapterAddress = token;
    }

    await create3(
      'StakeAndBakeNativeToken',
      [token, adapterAddress, admin, operator, fee, claimer, pauser, gasLimit],
      proxyFactoryAddr,
      ledgerNetwork,
      admin,
      hre
    );
  });
