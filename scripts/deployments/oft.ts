import { task } from 'hardhat/config';
import { verify } from '../helpers';

task('deploy-oft-adapter', 'Deploys the LayerZero OFT adapter contract')
  .addParam('admin', 'The address of the owner', 'self')
  .addParam('lzEndpoint', 'The LayerZero endpoint')
  .addParam('lbtc', 'The LBTC address')
  .addFlag('burnMint')
  .setAction(async (taskArgs, hre) => {
    const { lbtc, lzEndpoint, admin, burnMint } = taskArgs;

    const [signer] = await hre.ethers.getSigners();
    let owner = await signer.getAddress();

    if (hre.ethers.isAddress(admin)) {
      owner = admin;
    }

    let contractName = burnMint ? 'LBTCBurnMintOFTAdapter' : 'LBTCOFTAdapter';

    const args = [lbtc, lzEndpoint, owner];

    const adapter = await hre.ethers.deployContract(contractName, args);
    console.log(`${contractName}: ${await adapter.getAddress()}`);

    await verify(hre.run, await adapter.getAddress(), {
      constructorArguments: args
    });
  });
