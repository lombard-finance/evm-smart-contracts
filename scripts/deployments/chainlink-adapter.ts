import { task } from "hardhat/config"; 

/*
 * After deployment:
 * 1. Set adapter in bridge
 * 2. Set bridge in adapter
 */
function chainlinkAdapterTask(taskName: string) {
  task(taskName, "Deploys the TokenPoolAdapter contract")
    .addParam("admin", "The address of the owner")
    .addParam("router", "The chainlink ccip router")
    .addParam("lbtc", "The address of the LBTC contract")
    .addOptionalParam("bridge", "Bridge to set adapter on")
    .setAction(async (taskArgs, hre) => {
      const { lbtc, admin, bridge, router } = taskArgs;

      const adapter = await hre.ethers.deployContract(
        "TokenPoolAdapter",
        [router, lbtc, admin]
      );
      console.log("Chainlink Adapter:", await adapter.getAddress());

      if(bridge) {
        const bridgeContract = await hre.ethers.getContractAt("Bridge", bridge);
        await bridgeContract.changeAdapter(await adapter.getAddress());
        await adapter.changeBridge(bridge);
      }
    });
}

chainlinkAdapterTask("deploy-chainlink-adapter");
chainlinkAdapterTask("deploy-token-pool-adapter");
chainlinkAdapterTask("deploy:TokenPoolAdapter");
