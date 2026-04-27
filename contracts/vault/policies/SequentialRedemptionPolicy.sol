// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IRedemptionSettlementPolicy, RedemptionSettlementSlice} from "../../interfaces/vault/IRedemptionSettlementPolicy.sol";
import {IVaultRedemptionPlanSource} from "../../interfaces/vault/IVaultRedemptionPlanSource.sol";

/// @title SequentialRedemptionPolicy
/// @notice Iterate `pendingRedeemControllerAt` order; each controller receives up to their
///         `pendingRedeemAssetBudget` until `maxAssets` is exhausted (multi-slice round).
contract SequentialRedemptionPolicy is IRedemptionSettlementPolicy {
    /// @inheritdoc IRedemptionSettlementPolicy
    function settlementPlan(
        address vault,
        uint256 maxAssets
    ) external view returns (RedemptionSettlementSlice[] memory slices) {
        IVaultRedemptionPlanSource v = IVaultRedemptionPlanSource(vault);
        uint256 n = v.pendingRedeemControllerCount();
        uint256 remaining = maxAssets;

        uint256 m = 0;
        for (uint256 i = 0; i < n; ++i) {
            if (remaining == 0) break;
            address c = v.pendingRedeemControllerAt(i);
            uint256 cap = v.pendingRedeemAssetBudget(c);
            if (cap == 0) continue;
            uint256 give = cap <= remaining ? cap : remaining;
            if (give != 0) {
                ++m;
                remaining -= give;
            }
        }

        slices = new RedemptionSettlementSlice[](m);
        remaining = maxAssets;
        uint256 k = 0;
        for (uint256 i = 0; i < n; ++i) {
            if (remaining == 0) break;
            address c = v.pendingRedeemControllerAt(i);
            uint256 cap = v.pendingRedeemAssetBudget(c);
            if (cap == 0) continue;
            uint256 give = cap <= remaining ? cap : remaining;
            if (give != 0) {
                slices[k++] = RedemptionSettlementSlice({controller: c, requestId: 0, assets: give});
                remaining -= give;
            }
        }
    }
}
