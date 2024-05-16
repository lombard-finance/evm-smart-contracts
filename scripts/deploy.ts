import { ethers, upgrades } from "hardhat";
import { vars } from "hardhat/config";

const consortiumAddress = vars.get(
  "CONSORTIUM_ADDRESS",
  "0x1820b9218cb2D9a3790EDe3b5F20851BEc8971B0"
);

async function main() {
  const accounts = await ethers.getSigners();

  const res = await upgrades.deployProxy(
    await ethers.getContractFactory("LBTC"),
    [consortiumAddress]
  );
  await res.waitForDeployment();

  console.log(await res.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
