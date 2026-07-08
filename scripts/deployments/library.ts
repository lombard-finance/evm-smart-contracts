import { task } from 'hardhat/config';
import { verify } from '../helpers';
import { deployLibrary } from '../helpers/libraryDeployment';

task('deploy-library', 'Deploys a Solidity library')
  .addPositionalParam('libraryName', 'The name of the library contract')
  .setAction(async ({ libraryName }, hre) => {
    const address = await deployLibrary(hre, libraryName);
    console.log(`${libraryName} library deployed at`, address);
    const { sourceName } = hre.artifacts.readArtifactSync(libraryName);
    await verify(hre.run, address, {
      contract: `${sourceName}:${libraryName}`
    });
  });
