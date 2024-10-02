import { sleep, verify} from "./helpers";
import { task } from "hardhat/config";

task("deploy-consortium", "Deploys the LombardConsortium contract")
  .addParam("owner", "The address of the owner")
  .addParam("thresholdKey", "The address of LombardConsortium")
  .addParam("testEnv", "testnet deployment", false)
  .setAction(async (taskArgs, hre) => {

    const { owner, thresholdKey, testEnv } = taskArgs;
    const { ethers, upgrades, run } = hre;

    const res = await upgrades.deployProxy(
      await ethers.getContractFactory("LombardConsortium"),
      [thresholdKey, owner]
    );
    await res.waitForDeployment();

    console.log(`Deployment address is ${await res.getAddress()}`);
    console.log(`Going to verify...`);

    try {
      await verify(run, await res.getAddress());
    } catch (e) {
      console.error(`Verification failed: ${e}`);
    }
  });
