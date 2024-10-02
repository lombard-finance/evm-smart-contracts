import { task } from "hardhat/config";
import { verify } from "./helpers";

/*
 * After deployment:
 * 1. Set treasury address
 * 2. Set minters (e.g. BTCBPMM)
 * 3. Set pauser
 */


task("deploy-lbtc", "Deploys the LBTC contract")
  .addParam("consortium", "The address of LombardConsortium")
  .addParam("burnCommission", "Burn commission (wei)")
  .setAction(async (taskArgs, hre) => {
    const { consortium, burnCommission } = taskArgs;
    const { ethers, upgrades, run } = hre;

    const res = await upgrades.deployProxy(
      await ethers.getContractFactory("LBTC"),
      [consortium, burnCommission]
    );
    await res.waitForDeployment();
    console.log(`Deployment address is ${await res.getAddress()}`);

    console.log(await res.getAddress());
    await verify(run, await res.getAddress());
  });
