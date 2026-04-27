// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IRedemptionSettlementPolicy, RedemptionSettlementSlice} from "../../interfaces/vault/IRedemptionSettlementPolicy.sol";
import {IVaultRedemptionPlanSource} from "../../interfaces/vault/IVaultRedemptionPlanSource.sol";

/// @title BasicRedemptionPolicy
/// @notice Minimal FIFO: each `settlementPlan` returns at most one slice — the first controller (vault
///         enumeration order) with non-zero `pendingRedeemAssetBudget`, funded by `min(budget, maxAssets)`.
///         Callers may invoke {Vault7540RedemptionUpgradeable-fulfillRedemptions} repeatedly to drain multiple controllers.
contract BasicRedemptionPolicy is IRedemptionSettlementPolicy {
    /// @inheritdoc IRedemptionSettlementPolicy
    function settlementPlan(
        address vault,
        uint256 maxAssets
    ) external view returns (RedemptionSettlementSlice[] memory slices) {
        if (maxAssets == 0) {
            return new RedemptionSettlementSlice[](0);
        }

        IVaultRedemptionPlanSource v = IVaultRedemptionPlanSource(vault);
        uint256 n = v.pendingRedeemControllerCount();
        for (uint256 i = 0; i < n; ++i) {
            address controller = v.pendingRedeemControllerAt(i);
            uint256 budget = v.pendingRedeemAssetBudget(controller);
            if (budget == 0) continue;

            uint256 assets = budget <= maxAssets ? budget : maxAssets;
            slices = new RedemptionSettlementSlice[](1);
            slices[0] = RedemptionSettlementSlice({
                controller: controller,
                requestId: 0,
                assets: assets
            });
            return slices;
        }

        return new RedemptionSettlementSlice[](0);
    }
}
