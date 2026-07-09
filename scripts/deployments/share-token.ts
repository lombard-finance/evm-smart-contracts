import { task } from 'hardhat/config';
import { DEFAULT_STRATEGY_FACTORY } from '../helpers/constants';
import { deployProxyWithCreate3 } from '../helpers/create3Deployment';
import { getOwnersOrDefault } from '../helpers';
import { CustomRuntimeEnvironment } from '../cre';

task('deploy-share-token-proxy', 'Deploys a ShareToken via ProxyFactory (CREATE3)')
  .addParam('name', 'ERC20 token name')
  .addParam('symbol', 'ERC20 token symbol')
  .addParam('decimals', 'Share token decimals; cannot be zero')
  .addParam('defaultAdmin', 'Default admin address', 'self')
  .addParam('adminDelay', 'Initial default admin delay in seconds', '0')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_STRATEGY_FACTORY)
  .addParam('implementation', 'The implementation address')
  .setAction(async (taskArgs, hre) => {
    const { name, symbol, decimals, adminDelay, proxyFactoryAddr, implementation } = taskArgs;

    const { owner, upgradeAdmin } = await getOwnersOrDefault(hre, taskArgs.defaultAdmin, taskArgs.defaultAdmin);

    const saltHash = hre.ethers.id(`finance.lombard.v1.MultiAssetWithAsyncRedemptionStrategy.${symbol}`);

    const impl = await hre.ethers.getContractAt('ShareToken', implementation);

    const args = [name, symbol, Number(decimals), owner, Number(adminDelay)];

    const data = impl.interface.encodeFunctionData('initialize', args);

    await deployProxyWithCreate3(impl, data, proxyFactoryAddr, saltHash, upgradeAdmin, hre);
  });

task('deploy-share-token-impl', 'Deploys a ShareToken implementation').setAction(async (_, hre) => {
  const cre = new CustomRuntimeEnvironment(hre);
  const impl = await cre.deployImplementation('ShareToken');

  console.log(`ShareToken implementation deployed at ${impl}`);
});
