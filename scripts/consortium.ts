import {getProxyFactoryAt, getProxySalt, verify} from "./helpers";
import { task } from "hardhat/config";
import {DEFAULT_PROXY_FACTORY} from "./helpers/constants";

task("deploy-consortium", "Deploys the LombardConsortium contract via create3")
  .addParam("ledgerNetwork", "The network name of ledger", "mainnet")
  .addParam("admin", "The address of the owner")
  .addParam("thresholdKey", "The address of LombardConsortium")
  .addParam("proxyFactoryAddr", "The ProxyFactory address", DEFAULT_PROXY_FACTORY)
  .setAction(async (taskArgs, hre) => {

    const { ledgerNetwork, thresholdKey, admin, proxyFactoryAddr } = taskArgs;
    const { ethers, run, upgrades } = hre;

    const factory = await getProxyFactoryAt(ethers, proxyFactoryAddr);
    const saltHash = getProxySalt(ethers, ledgerNetwork, "LombardConsortium");

    const consortiumImpl = await ethers.deployContract("LombardConsortium");
    await consortiumImpl.waitForDeployment();

    const data = consortiumImpl.interface.encodeFunctionData("initialize", [thresholdKey, admin]);

    const tx = await factory.createTransparentProxy(await consortiumImpl.getAddress(), admin, data, saltHash);
    await tx.wait();

    const proxy = await factory.getDeployed(saltHash);
    console.log("Proxy address:", proxy);

    const proxyAdmin = await upgrades.erc1967.getAdminAddress(proxy);
    console.log("Proxy admin:", proxyAdmin);

    await verify(run, await factory.getAddress());
    await verify(run, await consortiumImpl.getAddress());
    await verify(run, proxyAdmin, {
      contract: "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin",
      constructorArguments: [admin],
    });
    await verify(run, proxy, {
      contract: "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy",
      constructorArguments: [await consortiumImpl.getAddress(), admin, data],
    });
  });
