import { task } from 'hardhat/config';
import { DEFAULT_STRATEGY_FACTORY } from '../helpers/constants';
import { deployProxyWithCreate3 } from '../helpers/create3Deployment';
import { getOwnersOrDefault } from '../helpers';
import { CustomRuntimeEnvironment } from '../cre';

task('deploy-multi-asset-strategy-proxy', 'Deploys a MultiAssetWithAsyncRedemptionStrategy via ProxyFactory (CREATE3)')
  .addParam('name', 'ERC20 token name for the strategy share')
  .addParam('symbol', 'ERC20 token symbol for the strategy share')
  .addParam('asset', 'Underlying ERC-20 asset address')
  .addParam('decimals', 'Fallback share decimals, used only when the asset does not expose decimals(); cannot be zero')
  .addParam('defaultAdmin', 'Default admin address', 'self')
  .addParam('adminDelay', 'Initial default admin delay in seconds', '0')
  .addParam('managementFeeTreasury', 'Address receiving management fee share mints', 'self')
  .addParam('blocklist', 'BlocklistOracle proxy implementing IBlocklistOracle (check / blockAccount); cannot be zero')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_STRATEGY_FACTORY)
  .addParam('implementation', 'The implementation address')
  .setAction(async (taskArgs, hre) => {
    const {
      name,
      symbol,
      asset,
      decimals,
      adminDelay,
      managementFeeTreasury: managementFeeTreasuryArg,
      blocklist,
      proxyFactoryAddr,
      implementation
    } = taskArgs;

    const { owner, upgradeAdmin } = await getOwnersOrDefault(hre, taskArgs.defaultAdmin, taskArgs.defaultAdmin);

    let managementFeeTreasury = owner;
    if (hre.ethers.isAddress(managementFeeTreasuryArg)) {
      managementFeeTreasury = managementFeeTreasuryArg;
    }

    const saltHash = hre.ethers.id(`finance.lombard.v1.MultiAssetWithAsyncRedemptionStrategy.${symbol}`);

    const impl = await hre.ethers.getContractAt('MultiAssetWithAsyncRedemptionStrategy', implementation);

    const args = [name, symbol, asset, Number(decimals), owner, Number(adminDelay), managementFeeTreasury, blocklist];

    const data = impl.interface.encodeFunctionData('initialize', args);

    await deployProxyWithCreate3(impl, data, proxyFactoryAddr, saltHash, upgradeAdmin, hre);
  });

task('deploy-multi-asset-strategy-impl', 'Deploys a MultiAssetWithAsyncRedemptionStrategy implementation').setAction(
  async (_, hre) => {
    const cre = new CustomRuntimeEnvironment(hre);
    const impl = await cre.deployImplementation('MultiAssetWithAsyncRedemptionStrategy');

    console.log(`MultiAssetWithAsyncRedemptionStrategy implementation deployed at ${impl}`);
  }
);
