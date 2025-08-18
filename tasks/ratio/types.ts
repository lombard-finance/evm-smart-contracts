import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Contract } from 'ethers';
import { NumberLike } from '@nomicfoundation/hardhat-network-helpers/src/types';

export interface AddressList {
  [key: string]: any;
}

export type RuleFunc = (
  hre: HardhatRuntimeEnvironment,
  contract: Contract,
  expectedRatio: LedgerRatio
) => Promise<void>;

export type LedgerRatio = {
  value: NumberLike;
  timestamp: NumberLike;
};

export type LedgerRatioResponse = {
  ratio: LedgerRatio;
};
