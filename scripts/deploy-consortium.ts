import { verify} from "./helpers";
import { task } from "hardhat/config";

task("deploy-consortium", "Deploys the LombardConsortium contract")
  .addParam("owner", "The address of the owner")
  .addParam("thresholdKey", "The address of LombardConsortium")
  .setAction(async (taskArgs, hre) => {

    const { owner, thresholdKey } = taskArgs;
    const { ethers, upgrades, run } = hre;

    const res = await upgrades.deployProxy(
      await ethers.getContractFactory("LombardConsortium"),
      [thresholdKey, owner]
    );
    await res.waitForDeployment();

    console.log(`Deployment address is ${await res.getAddress()}`);

    try {
      await verify(run, await res.getAddress());
    } catch (e) {
      console.error(`Verification failed: ${e}`);
    }
  });
