import { task, vars } from "hardhat/config"; 
import { verify, getAddresses } from "./helpers";

/*
 * After deployment:
 * 1. Grant pauser role
 * 2. Grant timelock role
 */

task("deploy-btcbpmm", "Deploys the BTCBPMM contract")
  .addParam("lbtc", "The address of the LBTC contract")
  .addParam("btcb", "The address of the BTCB contract")
  .addParam("admin", "The address of the admin")
  .addParam("stakeLimit", "The stake limit")
  .addParam("withdrawAddress", "The address to withdraw to")
  .setAction(async (taskArgs, hre) => {
    const { lbtc, btcb, admin, stakeLimit, withdrawAddress } = taskArgs;
    const { ethers, upgrades, run } = hre;
    
    const deployment  = await upgrades.deployProxy(
        await ethers.getContractFactory("BTCBPMM"),
        [lbtc, btcb, admin, stakeLimit, withdrawAddress]
    );
    await deployment.waitForDeployment();
    
    console.log(`Deployment address is ${await deployment.getAddress()}`);

    await verify(run, await deployment.getAddress());
  });

task("deploy-btcbpmm-vars", "Deploys the BTCBPMM contract with environment variables")
  .addOptionalParam("lbtc", "The address of the LBTC contract")
  .addOptionalParam("btcb", "The address of the BTCB contract")
  .addOptionalParam("admin", "The address of the admin")
  .addOptionalParam("stakeLimit", "The stake limit")
  .addOptionalParam("withdrawAddress", "The address to withdraw to")
  .setAction(async (taskArgs, hre) => {
    const { run, network } = hre;
    const { lbtc, btcb, admin, stakeLimit, withdrawAddress } = taskArgs;
    const addresses = getAddresses(network.name);

    const _lbtc = vars.get("LBTC_ADDRESS", lbtc || addresses.LBTC);
    const _btcb = vars.get("BTCB_ADDRESS", btcb || addresses.BTCB);
    const _admin = vars.get("ADMIN_ADDRESS", admin || addresses.Owner);
    const _stakeLimit = vars.get("STAKE_LIMIT", stakeLimit);
    const _withdrawAddress = vars.get("WITHDRAW_ADDRESS", withdrawAddress);
    await run("deploy-btcbpmm", {
      lbtc: _lbtc,
      btcb: _btcb,
      admin: _admin,
      stakeLimit: _stakeLimit,
      withdrawAddress: _withdrawAddress
    });
  });
