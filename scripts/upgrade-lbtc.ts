import { ethers, upgrades } from "hardhat";
import { getAddresses, sleep } from "./helpers";
import hardhat from "hardhat";

async function main() {
  const addresses = getAddresses(hardhat.network.name);

  if (!addresses.LBTC) {
    throw Error(`LBTC not deployed to ${hardhat.network.name}`);
  }

  const res = await upgrades.upgradeProxy(
    addresses.LBTC,
    await ethers.getContractFactory("LBTC"),
    {
      redeployImplementation: "always",
    }
  );
  await res.waitForDeployment();

  console.log(`Deployment address is ${await res.getAddress()}`);
  console.log(`Going to verify...`);

  await sleep(12_000);

  try {
    await hardhat.run("verify", {
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
