// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {NativeLBTC} from "./NativeLBTC.sol";
import {Actions} from "../libs/Actions.sol";

/**
 * @title ERC20 representation of Lombard Staked Bitcoin
 * @author Lombard.Finance
 * @notice The contracts is a part of Lombard.Finace protocol
 */
contract StakedLBTC is NativeLBTC {
    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.LBTC")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant LBTC_STORAGE_LOCATION =
        0xa9a2395ec4edf6682d754acb293b04902817fdb5829dd13adb0367ab3a26c700;

    function _decodeMintPayload(
        bytes calldata payload
    ) internal view override returns (DecodedPayload memory) {
        if (
            bytes4(payload) != Actions.DEPOSIT_BTC_ACTION_V0 &&
            bytes4(payload) != Actions.DEPOSIT_BTC_ACTION_V1
        ) {
            revert UnexpectedAction(bytes4(payload));
        }

        address recipient;
        uint256 amount;
        if (bytes4(payload) == Actions.DEPOSIT_BTC_ACTION_V1) {
            Actions.DepositBtcActionV1 memory action = Actions.depositBtcV1(
                payload[4:]
            );

            recipient = action.recipient;
            amount = action.amount;
            if (action.tokenAddress != address(this)) {
                revert WrongTokenAddress(action.tokenAddress);
            }
        } else if (bytes4(payload) == Actions.DEPOSIT_BTC_ACTION_V0) {
            Actions.DepositBtcActionV0 memory action = Actions.depositBtcV0(
                payload[4:]
            );

            recipient = action.recipient;
            amount = action.amount;
        }

        return DecodedPayload(recipient, amount);
    }
}
