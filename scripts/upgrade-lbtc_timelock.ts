import { ethers, upgrades } from "hardhat";
import {getAddresses, schedule, verify} from "./helpers";
import hardhat from "hardhat";
import { vars } from "hardhat/config";

const testEnv = vars.get("LOMBARD_TEST_ENV", "disabled") === "enabled";

async function main() {
  const addresses = getAddresses(hardhat.network.name);

  if (!addresses.LBTC) {
    throw Error(`LBTC not deployed to ${hardhat.network.name}`);
  }

  if (!addresses.Timelock) {
    throw Error(`Timelock not deployed to ${hardhat.network.name}`);
  }

  const proxyAdmin = await ethers.getContractAt(
    'IProxyAdmin',
    await upgrades.erc1967.getAdminAddress(addresses.LBTC)
  );

  const newImpl = await upgrades.prepareUpgrade(
    addresses.LBTC,
    await ethers.getContractFactory(testEnv ? "LBTCMock" : "LBTC"),
    {
      redeployImplementation: "always",
      unsafeAllowRenames: true,
    }
  );

  if (typeof newImpl !== 'string') {
    console.log('returned receipt, schedule tx manually', newImpl);
    return true;
  }

  const upgradeTx = await proxyAdmin.upgradeAndCall.populateTransaction(
    addresses.LBTC,
    newImpl,
    '0x'
  );
  console.log('upgrade tx', upgradeTx);

  // only for mainnet
  await schedule({
    timelockAddr: addresses.Timelock,
    transaction: upgradeTx,
  });

  await verify(newImpl);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
