// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IVaultRedemptionPlanSource
/// @notice Minimal view surface for `IRedemptionSettlementPolicy` (view calls into the vault).
interface IVaultRedemptionPlanSource {
    function pendingRedeemControllerCount() external view returns (uint256);

    function pendingRedeemControllerAt(
        uint256 index
    ) external view returns (address);

    /// @dev Same semantics as ERC-7540 `pendingRedeemRequest`; this vault uses `requestId == 0` only.
    function pendingRedeemRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256 shares);

    /// @dev Remaining asset budget for pending redemptions for `controller` (set at `requestRedeem` before burn).
    function pendingRedeemAssetBudget(address controller) external view returns (uint256 assets);
}
