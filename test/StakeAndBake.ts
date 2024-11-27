import { ethers } from 'hardhat';
import { expect } from 'chai';
import { takeSnapshot } from '@nomicfoundation/hardhat-toolbox/network-helpers';
import {
    deployContract,
    getSignersWithPrivateKeys,
    CHAIN_ID,
    getFeeTypedMessage,
    generatePermitSignature,
    NEW_VALSET,
    DEPOSIT_BTC_ACTION,
    encode,
    getPayloadForAction,
    signDepositBtcPayload,
    Signer,
    init,
} from './helpers';
import { StakeAndBake, BoringVaultDepositor, LBTCMock, BoringVaultMock } from '../typechain-types';
import { SnapshotRestorer } from '@nomicfoundation/hardhat-network-helpers/src/helpers/takeSnapshot';

describe('StakeAndBake', function () {
    let stakeAndBake: StakeAndBake;
    let boringVaultDepositor: BoringVaultDepositor;
    let boringVault: BoringVaultMock;
    let lbtc: LBTCMock;

});
