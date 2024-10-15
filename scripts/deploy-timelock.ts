import {getProxyFactoryAt, getProxySalt, verify} from "./helpers";
import { task } from "hardhat/config";
import {DEFAULT_PROXY_FACTORY} from "./helpers/constants";

task("deploy-timelock", "Deploys the LombardTimeLock contract via create3")
  .addParam("ledgerNetwork", "The network name of ledger", "mainnet")
  .addParam("admin", "The address of the owner")
  .addParam("minDelay", "Minimum delay between proposal and execution")
  .addVariadicPositionalParam("proposers", "The list of proposers")
  .addVariadicPositionalParam("executors", "The list of executors")
  .addParam("proxyFactoryAddr", "The ProxyFactory address", DEFAULT_PROXY_FACTORY)
  .setAction(async (taskArgs, hre) => {

    const { ledgerNetwork, admin, proxyFactoryAddr, minDelay, proposers, executors } = taskArgs;
    const { ethers, run, upgrades } = hre;

    const factory = await getProxyFactoryAt(ethers, proxyFactoryAddr);
    const saltHash = getProxySalt(ethers, ledgerNetwork, "LombardTimelock");

    const timelockImpl = await ethers.deployContract("LombardTimelock");
    await timelockImpl.waitForDeployment();

    const data = timelockImpl.interface.encodeFunctionData("initialize", [minDelay, proposers, executors]);

    const tx = await factory.createTransparentProxy(await timelockImpl.getAddress(), admin, data, saltHash);
    await tx.wait();

    const proxy = await factory.getDeployed(saltHash);
    console.log("Proxy address:", proxy);

    const proxyAdmin = await upgrades.erc1967.getAdminAddress(proxy);
    console.log("Proxy admin:", proxyAdmin);

    await verify(run, await factory.getAddress());
    await verify(run, await timelockImpl.getAddress());
    await verify(run, proxyAdmin, {
      contract: "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol:ProxyAdmin",
      constructorArguments: [admin],
    });
    await verify(run, proxy, {
      contract: "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol:TransparentUpgradeableProxy",
      constructorArguments: [await timelockImpl.getAddress(), admin, data],
    });
  });


async function main() {
  const addresses = getAddresses(network.name);

  if (!addresses.Owner) {
    throw Error(`Owner not set for ${network.name}`);
  }

  const [deployer] = await ethers.getSigners();

  const constructorArguments = [
    "3600", // 1 hour
    [await deployer.getAddress(), addresses.Owner],
    [addresses.Owner],
  ];

  console.log("going to deploy...");
  const timelock = await ethers.deployContract(
    "LombardTimeLock",
    constructorArguments
  );
  await timelock.waitForDeployment();

  console.log(`Deployment address is ${await timelock.getAddress()}`);
  console.log(`Going to verify...`);

  await sleep(12_000);
  try {
    await run("verify:verify", {
      address: await timelock.getAddress(),
      contract: "contracts/consortium/LombardTimeLock.sol:LombardTimeLock",
      constructorArguments,
    });
  } catch (e) {
    console.error(`Verification failed: ${e}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
