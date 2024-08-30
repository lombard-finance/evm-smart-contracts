import {ethers, network, upgrades} from "hardhat";
import { vars } from "hardhat/config";
import {getAddresses, verify} from "./helpers";

const testEnv = vars.get("LOMBARD_TEST_ENV", "disabled") === "enabled";

async function main() {
  const addresses = getAddresses(network.name);

  if (!addresses.Consortium) {
    throw Error('set consortium before deployment')
  }

  const burnCommission = 100n;

  const res = await upgrades.deployProxy(
    await ethers.getContractFactory(testEnv ? "LBTCMock" : "LBTC"),
    [addresses.Consortium, burnCommission]
  );
  await res.waitForDeployment();

  console.log(await res.getAddress());
  await verify(await res.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
