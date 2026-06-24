import { task } from 'hardhat/config';
import { verify } from '../helpers';

task('deploy-handler-mock', 'Deploys GMP handler mock').setAction(async (taskArgs, hre) => {
  const args = [true];

  const adapter = await hre.ethers.deployContract('GMPHandlerMock', args);
  console.log(`GMPHandlerMock: ${await adapter.getAddress()}`);

  await verify(hre.run, await adapter.getAddress(), {
    constructorArguments: args
  });
});

task('deploy-token-mock', 'Deploys the Token Mock contract')
  .addParam('name', 'The name of the token')
  .addParam('symbol', 'The symbol of the token')
  .addOptionalParam('decimals', 'ERC20 decimals', '18')
  .setAction(async (taskArgs, hre) => {
    const { ethers, run } = hre;

    const { name, symbol } = taskArgs;
    const decimals = Number.parseInt(taskArgs.decimals, 10);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
      throw new Error('decimals must be an integer from 0 to 18');
    }

    const deployment = await ethers.deployContract('TokenMock', [name, symbol, decimals]);
    await deployment.waitForDeployment();

    console.log(`Deployment address is ${await deployment.getAddress()}`);

    await verify(run, await deployment.getAddress(), {
      constructorArguments: [name, symbol, decimals]
    });
  });
