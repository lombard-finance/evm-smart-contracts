import { ethers, upgrades } from "hardhat";
import { vars } from "hardhat/config";
import { verify } from "./helpers";

const consortiumAddress = vars.get(
  "CONSORTIUM_ADDRESS",
  "0x1820b9218cb2D9a3790EDe3b5F20851BEc8971B0"
);

const testEnv = vars.get("LOMBARD_TEST_ENV", "disabled") === "enabled";

async function main() {
  const res = await upgrades.deployProxy(
    await ethers.getContractFactory(testEnv ? "LBTCMock" : "LBTC"),
    [consortiumAddress]
  );
  await res.waitForDeployment();

  console.log(await res.getAddress());
  await verify(await res.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
