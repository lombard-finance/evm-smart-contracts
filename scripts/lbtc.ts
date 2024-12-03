import { task } from "hardhat/config";
import { getProxyFactoryAt, getProxySalt, verify } from "./helpers";
import { DEFAULT_PROXY_FACTORY } from "./helpers/constants";

/*
 * After deployment:
 * 1. Set treasury address
 * 2. Set minters (e.g. BTCBPMM)
 * 3. Set pauser
 */

task("deploy-lbtc", "Deploys the LBTC contract")
  .addParam("ledgerNetwork", "The network name of ledger", "mainnet")
  .addParam("consortium", "The address of LombardConsortium")
  .addParam("burnCommission", "The burn commission")
  .addParam("admin", "The owner of the proxy", "self")
  .addParam(
    "proxyFactoryAddr",
    "The ProxyFactory address",
    DEFAULT_PROXY_FACTORY
  )
  .setAction(async (taskArgs, hre, network) => {
    const {
      ledgerNetwork,
      consortium,
      burnCommission,
      testEnv,
      admin,
      proxyFactoryAddr,
    } = taskArgs;
    const { ethers, run, upgrades } = hre;

    const [signer] = await hre.ethers.getSigners();
    let owner = await signer.getAddress();

    if (hre.ethers.isAddress(admin)) {
      owner = admin;
    }

    const factory = await getProxyFactoryAt(ethers, proxyFactoryAddr);
    const saltHash = getProxySalt(ethers, ledgerNetwork, "LBTC");

    const lbtcImpl = await ethers.deployContract("LBTC");
    await lbtcImpl.waitForDeployment();

    const data = lbtcImpl.interface.encodeFunctionData("initialize", [
      consortium,
      burnCommission,
      owner,
    ]);

    const tx = await factory.createTransparentProxy(
      await lbtcImpl.getAddress(),
      owner,
      data,
      saltHash
    );
    await tx.wait();

    const proxy = await factory.getDeployed(saltHash);
    console.log("Proxy address:", proxy);

    const proxyAdmin = await upgrades.erc1967.getAdminAddress(proxy);
    console.log("Proxy admin:", proxyAdmin);

    await verify(run, await factory.getAddress());
    await verify(run, await lbtcImpl.getAddress());
    await verify(run, proxyAdmin, {
      contract:
        "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin",
      constructorArguments: [owner],
    });
    await verify(run, proxy, {
      contract:
        "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy",
      constructorArguments: [await lbtcImpl.getAddress(), owner, data],
    });

    // reinitialize
    await (await ethers.getContractAt("LBTC", proxy)).reinitialize();
  });
