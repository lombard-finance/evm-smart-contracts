import { task } from "hardhat/config"; 
import {verify, getProxyFactoryAt, getProxySalt} from "./helpers";
import {DEFAULT_PROXY_FACTORY} from "./helpers/constants";

/*
 * After deployment:
 * 1. Add root pubkeys
 * 2. Grant operator role
 * 3. Add addresses
 */
task("deploy-por", "Deploys the PoR contract via create3")
  .addParam("ledgerNetwork", "The network name of ledger", "mainnet")
  .addParam("admin", "The address of the owner")
  .addParam("proxyFactoryAddr", "The ProxyFactory address", DEFAULT_PROXY_FACTORY)
  .setAction(async (taskArgs, hre) => {
    // TODO: update to use helpers when bft branch gets merged
  
    const { ledgerNetwork, admin, proxyFactoryAddr } = taskArgs;
    const { ethers, run, upgrades } = hre;

    const factory = await getProxyFactoryAt(ethers, proxyFactoryAddr);
    const saltHash = getProxySalt(ethers, ledgerNetwork, "PoR");

    const porImpl = await ethers.deployContract("PoR");
    await porImpl.waitForDeployment();

    const data = porImpl.interface.encodeFunctionData("initialize", [admin]);

    const tx = await factory.createTransparentProxy(await porImpl.getAddress(), admin, data, saltHash);
    await tx.wait();

    const proxy = await factory.getDeployed(saltHash);
    console.log("Proxy address:", proxy);

    const proxyAdmin = await upgrades.erc1967.getAdminAddress(proxy);
    console.log("Proxy admin:", proxyAdmin);

    await verify(run, await factory.getAddress());
    await verify(run, await porImpl.getAddress());
    await verify(run, proxyAdmin, {
      contract: "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin",
      constructorArguments: [admin],
    });
    await verify(run, proxy, {
      contract: "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy",
      constructorArguments: [await porImpl.getAddress(), admin, data],
    });
  });
