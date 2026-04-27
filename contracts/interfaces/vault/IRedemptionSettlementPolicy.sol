// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @dev One controller’s pending redemption asset budget to move toward claimable in a single {fulfillRedemptions} step.
struct RedemptionSettlementSlice {
    address controller;
    uint256 requestId;
    /// @notice Asset amount (underlying `asset()` units) to move from pending to claimable for this slice.
    uint256 assets;
}

/// @title IRedemptionSettlementPolicy
/// @notice Pluggable **view-only** plan for ERC-7540-style pending→claimable redemption settlement.
/// @dev The vault calls {settlementPlan} on **permissionless** {fulfillRedemptions}; policies are trusted **only** for
///      ordering / allocation across controllers. MUST NOT write storage or be payable. Sum of `assets` MUST be ≤ `maxAssets`.
interface IRedemptionSettlementPolicy {
    /// @notice Return slices for one settlement round given the vault’s spendable `asset` budget (`maxAssets`).
    function settlementPlan(
        address vault,
        uint256 maxAssets
    ) external view returns (RedemptionSettlementSlice[] memory);
}
