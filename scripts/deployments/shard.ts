import { task } from 'hardhat/config';
import { DEFAULT_STRATEGY_FACTORY } from '../helpers/constants';
import { deployProxyWithCreate3 } from '../helpers/create3Deployment';
import { getOwnersOrDefault } from '../helpers';
import { CustomRuntimeEnvironment } from '../cre';

task('deploy-shard-impl', 'Deploys a Shard implementation').setAction(async (_, hre) => {
  const cre = new CustomRuntimeEnvironment(hre);
  const impl = await cre.deployImplementation('Shard');

  console.log(`Shard implementation deployed at ${impl}`);
});

task('deploy-shard-proxy', 'Deploys a Shard proxy via ProxyFactory (CREATE3)')
  .addParam('strategy', 'IStrategy (share token) address')
  .addParam('validator', 'IShardExecValidator address (e.g. MerkleAllowlistValidator)')
  .addParam('defaultAdmin', 'Default admin address', 'self')
  .addParam('liquidityRoleHolder', 'Receives STRATEGY_TOKEN_LIQUIDITY_ROLE', 'self')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_STRATEGY_FACTORY)
  .addParam('purpose', 'The purpose of the shard')
  .addParam('implementation', 'The implementation address')
  .setAction(async (taskArgs, hre) => {
    const {
      strategy,
      validator,
      liquidityRoleHolder: liquidityArg,
      proxyFactoryAddr,
      purpose,
      implementation
    } = taskArgs;

    const { owner, upgradeAdmin } = await getOwnersOrDefault(hre, taskArgs.defaultAdmin, taskArgs.defaultAdmin);

    let liquidityRoleHolder = owner;
    if (hre.ethers.isAddress(liquidityArg)) {
      liquidityRoleHolder = liquidityArg;
    }

    const saltHash = hre.ethers.id(`finance.lombard.v1.Shard.${purpose}`);

    const impl = await hre.ethers.getContractAt('Shard', implementation);

    const data = impl.interface.encodeFunctionData('initialize', [strategy, validator, owner, liquidityRoleHolder]);

    await deployProxyWithCreate3(impl, data, proxyFactoryAddr, saltHash, upgradeAdmin, hre);
  });

task('deploy-remote-shard-impl', 'Deploys a RemoteShard implementation').setAction(async (_, hre) => {
  const cre = new CustomRuntimeEnvironment(hre);
  const impl = await cre.deployImplementation('RemoteShard');

  console.log(`RemoteShard implementation deployed at ${impl}`);
});

task('deploy-remote-shard-proxy', 'Deploys a RemoteShard proxy via ProxyFactory (CREATE3)')
  .addParam('validator', 'IShardExecValidator address (e.g. MerkleAllowlistValidator)')
  .addParam('defaultAdmin', 'Default admin address', 'self')
  .addParam('proxyFactoryAddr', 'The ProxyFactory address', DEFAULT_STRATEGY_FACTORY)
  .addParam('implementation', 'The implementation address')
  .addParam('purpose', 'The purpose of the remote shard')
  .setAction(async (taskArgs, hre) => {
    const { validator, proxyFactoryAddr, implementation, purpose } = taskArgs;

    const { owner, upgradeAdmin } = await getOwnersOrDefault(hre, taskArgs.defaultAdmin, taskArgs.defaultAdmin);

    const saltHash = hre.ethers.id(`finance.lombard.v1.RemoteShard.${purpose}`);

    const impl = await hre.ethers.getContractAt('RemoteShard', implementation);

    const data = impl.interface.encodeFunctionData('initialize', [validator, owner]);

    await deployProxyWithCreate3(impl, data, proxyFactoryAddr, saltHash, upgradeAdmin, hre);
  });
