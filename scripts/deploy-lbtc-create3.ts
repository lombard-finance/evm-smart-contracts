import { task } from "hardhat/config";
import { verify } from "./helpers";

task("deploy-lbtc-create3", "Deploys the LBTC contract with create3")
  .addParam("consortium", "The address of LombardConsortium")
  .addParam("burnCommission", "The burn commission")
  .addParam("salt", "The text to use as salt")
  .addParam("admin", "The owner of the proxy")
  .addFlag("testEnv", "testnet deployment")
  .setAction(async (taskArgs, hre) => {
    const { consortium, burnCommission, testEnv, salt, admin } = taskArgs;
    const { ethers, run, upgrades } = hre;

    const factory = await ethers.deployContract("ProxyFactory");
    await factory.waitForDeployment();

    const lbtcFactory = await ethers.getContractFactory(testEnv ? "LBTCMock" : "LBTC");
    const lbtc = await lbtcFactory.deploy();
    await lbtc.waitForDeployment();

    const data = lbtc.interface.encodeFunctionData("initialize", [consortium, burnCommission]);
    const saltHash = ethers.keccak256(salt);

    const tx = await factory.createTransparentProxy(await lbtc.getAddress(), admin, data, saltHash);
    await tx.wait();
    
    const proxy = await factory.getDeployed(saltHash);
    console.log("Proxy address:", proxy);
    
    const proxyAdmin = await upgrades.erc1967.getAdminAddress(proxy);
    console.log("Proxy admin:", proxyAdmin);

    await verify(run, await factory.getAddress());
    await verify(run, await lbtc.getAddress());
    await verify(run, proxyAdmin, {
      contract: "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin",
      constructorArguments: [admin],
    });
    await verify(run, proxy, {
      contract: "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy",
      constructorArguments: [await lbtc.getAddress(), admin, data],
    });
  });
