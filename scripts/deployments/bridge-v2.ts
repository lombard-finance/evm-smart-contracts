import { task } from 'hardhat/config';
import { DEFAULT_PROXY_FACTORY } from '../helpers/constants';
import { create3 } from '../helpers/create3Deployment';
import { deploy } from '../helpers/simpleDeployment';

/*
 * After deployment:
 * 1. Set destinations
 */

task('deploy-gmp-bridge', 'Deploys the BridgeV2 contract via create3')
  .addParam('ledgerNetwork', 'The network name of ledger', 'mainnet')
  .addParam('admin', 'The address of the owner', 'self')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_PROXY_FACTORY)
  .addParam('mailbox', 'The address of the mailbox')
  .setAction(async (taskArgs, hre) => {
    let { ledgerNetwork, mailbox, admin: adminArg, proxyFactoryAddr } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    const admin = hre.ethers.isAddress(adminArg) ? adminArg : await signer.getAddress();

    await create3('BridgeV2', [admin, mailbox], proxyFactoryAddr, ledgerNetwork, admin, hre);
  });

task('deploy-ccip-token-pool-v2', 'Deploys the `LombardTokenPoolV2` contract')
  .addParam('bridge', 'The BridgeV2 contrat address')
  .addParam('token', 'The bridgeable token')
  .addParam('rmn', 'CCIP RMN contract address')
  .addParam('router', 'CCIP Router contract address')
  .addOptionalParam('admin', 'The owner of the proxy')
  .addOptionalParam('tokenAdapter', 'The token adapter if presented')
  .setAction(async (taskArgs, hre) => {
    const { bridge, token, rmn, router, admin, tokenAdapter } = taskArgs;
    const { ethers } = hre;

    const contract = tokenAdapter ? 'BridgeTokenPool' : 'LombardTokenPoolV2';
    const args = tokenAdapter ? [bridge, token, tokenAdapter, [], rmn, router] : [bridge, token, [], rmn, router];

    const { contractAddress: tokenPoolAddr } = await deploy(
      contract,
      args,
      `contracts/bridge/providers/${contract}.sol:${contract}`,
      hre
    );

    console.log(`TokenPool deployed at ${tokenPoolAddr}`);

    if (!admin) {
      console.log('Admin not provided. Do not transfer ownership.');
      return;
    }

    const tokenPool = await ethers.getContractAt('LombardTokenPoolV2', tokenPoolAddr);
    console.log(`Transferring ownership to ${admin}`);
    const tx = await tokenPool.transferOwnership(admin);
    await tx.wait(2);
    console.log(`Ownership transferred to ${admin}: ${tx.hash}`);
  });
