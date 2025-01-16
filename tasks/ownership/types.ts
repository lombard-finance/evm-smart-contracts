import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Contract } from 'ethers';
import { AdminBucket } from './admin-bucket';

export interface AddressList {
    [key: string]: any;
}

export type RuleFunc = (
    hre: HardhatRuntimeEnvironment,
    contract: Contract,
    admins: AdminBucket
) => Promise<void>;
