import { task } from "hardhat/config"; 
import { verify } from "../helpers";

task("deploy-btcb-mock", "Deploys the BTCB Mock contract")
  .setAction(async (taskArgs, hre) => {
    const { ethers, run } = hre;

    const deployment  = await ethers.deployContract("BTCBMock");
    await deployment.waitForDeployment();
    
    console.log(`Deployment address is ${await deployment.getAddress()}`);

    await verify(run, await deployment.getAddress());
  });
