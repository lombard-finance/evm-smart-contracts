import { run } from "hardhat";

type TAddressesWithNetwork = {
  [k: string]: TAddresses;
};

export type TAddresses = {
  LBTC?: string;
  ThresholdKey?: string;
  Owner?: string;
  Consortium?: string;
};

export function getAddresses(network: string): TAddresses {
  const addresses: TAddressesWithNetwork = require("../../addresses.json");
  if (!addresses[network]) {
    throw Error(`network ${network} not supported`);
  }
  return addresses[network];
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verify(address: string) {
  console.log(`Going to verify...`);

  await sleep(12_000);

  try {
    await run("verify", {
      address,
    });
  } catch (e) {
    console.error(`Verification failed: ${e}`);
  }
}
