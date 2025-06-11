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
