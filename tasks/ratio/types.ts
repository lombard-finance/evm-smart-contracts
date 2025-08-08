import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Contract } from 'ethers';

export interface AddressList {
  [key: string]: any;
}

export type RuleFunc = (hre: HardhatRuntimeEnvironment, contract: Contract) => Promise<void>;
