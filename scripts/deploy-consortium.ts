import { ethers, upgrades, network, run } from "hardhat";
import { getAddresses, sleep } from "./helpers";

async function main() {
  const addresses = getAddresses(network.name);

  if (!addresses.ThresholdKey) {
    throw Error(`ThresholdKey not set for ${network.name}`);
  }

  if (!addresses.Owner) {
    throw Error(`Owner not set for ${network.name}`);
  }

  const res = await upgrades.deployProxy(
    await ethers.getContractFactory("LombardConsortium"),
    [addresses.ThresholdKey, addresses.Owner]
  );
  await res.waitForDeployment();

  console.log(`Deployment address is ${await res.getAddress()}`);
  console.log(`Going to verify...`);

  await sleep(12_000);

  try {
    await run("verify", {
      address: await res.getAddress(),
    });
  } catch (e) {
    console.error(`Verification failed: ${e}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
