import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Contract } from 'ethers';
import { NumberLike } from '@nomicfoundation/hardhat-network-helpers/src/types';

export interface AddressList {
  [key: string]: any;
}

export type RuleFunc = (
  hre: HardhatRuntimeEnvironment,
  chain: string,
  chains: string[],
  chainSelectors: Map<string, bigint>,
  rmns: Map<string, string>,
  routers: Map<string, string>,
  mailboxes: Map<string, string>,
  bridges: Map<string, string>,
  tokenPools: Map<string, string[]>,
  stakedTokens: Map<string, string>,
  nativeTokens: Map<string, string>
) => Promise<void>;

export type LedgerRatio = {
  value: NumberLike;
  timestamp: NumberLike;
};

export type LedgerRatioResponse = {
  ratio: LedgerRatio;
};

export type CcipBasicData = {
  chainSelector: string;
  rmn: string;
  router: string;
};
