import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';

/*
 * After deployment:
 * 1. Set initial validator set
 */

task('deploy-asset-router', 'Deploys the AssetRouter contract via create3')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('admin', 'The address of the owner', 'self')
  .addParam('ledgerChainId', 'ID of the ledger chain')
  .addParam('bitcoinChainId', 'ID of the bitcoin chain')
  .addParam('mailbox', 'The mailbox address')
  .addParam('oracle', 'The oracle address')
  .addParam('bascule', 'The bascule address', '0x0000000000000000000000000000000000000000')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_PROXY_FACTORY)
  .addParam('toNativeCommission', 'The commission to receive BTC')
  .addOptionalParam('adminChangeDelay', 'The delay of admin role change', '0')
  .setAction(async (taskArgs, hre) => {
    const {
      ledgerNetwork,
      admin,
      proxyFactoryAddr,
      adminChangeDelay,
      ledgerChainId,
      bitcoinChainId,
      mailbox,
      oracle,
      bascule,
      toNativeCommission
    } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    let owner = await signer.getAddress();

    if (hre.ethers.isAddress(admin)) {
      owner = admin;
    }

    await create3(
      'AssetRouter',
      [
        owner,
        adminChangeDelay,
        ledgerChainId,
        bitcoinChainId,
        mailbox,
        oracle,
        bascule,
        toNativeCommission
      ],
      proxyFactoryAddr,
      ledgerNetwork,
      owner,
      hre
    );
  });
