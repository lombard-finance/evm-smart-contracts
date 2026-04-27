// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {IRedemptionSettlementPolicy, RedemptionSettlementSlice} from "../interfaces/vault/IRedemptionSettlementPolicy.sol";

/// @dev Compile-time `type(IERC4626).interfaceId` for tests (must match `ERC7540AsyncRedeemVault.supportsInterface`).
contract InterfaceIdProbe {
    function erc4626InterfaceId() external pure returns (bytes4) {
        return type(IERC4626).interfaceId;
    }
}

/// @dev Returns a single slice whose `assets` exceeds `maxAssets` (vault must revert).
contract OverflowSumRedemptionPolicyMock is IRedemptionSettlementPolicy {
    function settlementPlan(
        address,
        uint256 maxAssets
    ) external pure returns (RedemptionSettlementSlice[] memory s) {
        s = new RedemptionSettlementSlice[](1);
        s[0] = RedemptionSettlementSlice({
            controller: address(0xdead),
            requestId: 0,
            assets: maxAssets + 1
        });
    }
}
