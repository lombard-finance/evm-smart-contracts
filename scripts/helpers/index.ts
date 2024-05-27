type TAddressesWithNetwork = {
  [k: string]: TAddresses;
};

export type TAddresses = {
  LBTC?: string;
  ThresholdKey?: string;
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
