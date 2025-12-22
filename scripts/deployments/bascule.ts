import { task } from 'hardhat/config';
import { deploy } from '../helpers/simpleDeployment';
import { ethers } from 'ethers';

/*
 * After deployment:
 * 1. Nothing
 */

task('deploy-basculeV3', 'Deploys the BasculeV3 contract (non-upgradable)')
  .addParam('admin', 'The address of the owner', 'self')
  .addParam('pauser', 'The address that should have pauser role')
  .addParam('depositReporter', 'The address that should have deposit reporter role')
  .addParam('withdrawalValidator', 'The address that should have withdrawal validator reporter role')
  .addParam('maxDeposits', 'The maximum number of deposits that can be in deposit report batch')
  .addParam('trustedSigner', 'The address of trusted signer', ethers.ZeroAddress)
  .setAction(async (taskArgs, hre) => {
    let {
      ledgerNetwork,
      admin: adminArg,
      pauser,
      depositReporter,
      withdrawalValidator,
      maxDeposits,
      trustedSigner
    } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    const admin = hre.ethers.isAddress(adminArg) ? adminArg : await signer.getAddress();

    await deploy(
      'BasculeV3',
      [admin, pauser, depositReporter, withdrawalValidator, maxDeposits, trustedSigner],
      'contracts/bascule/BasculeV3.sol:BasculeV3',
      hre
    );
  });

task('deploy-gmp-bascule', 'Deploys the GMPBasculeV2 contract (non-upgradable)')
  .addParam('admin', 'The address of the owner', 'self')
  .addParam('pauser', 'The address that should have pauser role', 'self')
  .addParam('mintReporter', 'The address that should have mint reporter role')
  .addParam('mintValidator', 'The address that should have mint validator role')
  .addParam('maxMints', 'The maximum number of mints that can be in report batch')
  .addParam('trustedSigner', 'The address of trusted signer')
  .setAction(async (taskArgs, hre) => {
    let { admin: adminArg, pauser: pauserArg, mintReporter, mintValidator, maxMints, trustedSigner } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    const admin = hre.ethers.isAddress(adminArg) ? adminArg : await signer.getAddress();
    const pauser = hre.ethers.isAddress(pauserArg) ? pauserArg : await signer.getAddress();

    await deploy(
      'GMPBasculeV2',
      [admin, pauser, mintReporter, mintValidator, maxMints, trustedSigner],
      'contracts/bascule/GMPBasculeV2.sol:GMPBasculeV2',
      hre
    );
  });
