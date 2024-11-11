import { task, vars } from "hardhat/config";
import {
  verify,
  getAddresses,
  getProxyFactoryAt,
  getProxySalt,
} from "./helpers";
import { DEFAULT_PROXY_FACTORY } from "./helpers/constants";

/*
 * After deployment:
 * 1. Grant pauser role
 * 2. Grant timelock role
 */

task("deploy-pmm", "Deploys pmm contract via create3")
  .addParam("ledgerNetwork", "The network name of ledger", "mainnet")
  .addParam("admin", "The address of the owner")
  .addParam(
    "proxyFactoryAddr",
    "The ProxyFactory address",
    DEFAULT_PROXY_FACTORY
  )
  .addParam("lbtc", "The address of the LBTC contract")
  .addParam("btcToken", "The address of the BTC representation")
  .addParam("stakeLimit", "The stake limit", (30n * 10n ** 8n).toString()) // default is 30 LBTC
  .addParam("withdrawAddress", "The address to withdraw to")
  .addParam("relativeFee", "The relative fee of the pmm", 10n.toString())
  .addParam("pmm", "The name of pmm contract")
  .setAction(async (taskArgs, hre) => {
    const {
      ledgerNetwork,
      lbtc,
      btcToken,
      admin,
      stakeLimit,
      withdrawAddress,
      proxyFactoryAddr,
      relativeFee,
      pmm,
    } = taskArgs;
    const { ethers, run, upgrades } = hre;

    const factory = await getProxyFactoryAt(ethers, proxyFactoryAddr);

    let contractName = "";
    switch (pmm) {
      case "BTCB":
        contractName = "BTCBPMM";
        break;
      case "CBBTC":
        contractName = "CBBTCPMM";
        break;
      default:
        throw Error(`Unsupported pmm: ${pmm}`);
    }
    const saltHash = getProxySalt(ethers, ledgerNetwork, contractName);

    const pmmImpl = await ethers.deployContract(contractName);
    await pmmImpl.waitForDeployment();

    const data = pmmImpl.interface.encodeFunctionData("initialize", [
      lbtc,
      btcToken,
      admin,
      stakeLimit,
      withdrawAddress,
      relativeFee,
    ]);

    const tx = await factory.createTransparentProxy(
      await pmmImpl.getAddress(),
      admin,
      data,
      saltHash
    );
    await tx.wait();

    const proxy = await factory.getDeployed(saltHash);
    console.log("Proxy address:", proxy);

    const proxyAdmin = await upgrades.erc1967.getAdminAddress(proxy);
    console.log("Proxy admin:", proxyAdmin);

    await verify(run, await factory.getAddress());
    await verify(run, await pmmImpl.getAddress());
    await verify(run, proxyAdmin, {
      contract:
        "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin",
      constructorArguments: [admin],
    });
    await verify(run, proxy, {
      contract:
        "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy",
      constructorArguments: [await pmmImpl.getAddress(), admin, data],
    });
  });
