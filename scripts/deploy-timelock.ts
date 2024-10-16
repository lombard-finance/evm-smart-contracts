import { ethers, network, run } from "hardhat";
import { getAddresses, sleep } from "./helpers";

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
