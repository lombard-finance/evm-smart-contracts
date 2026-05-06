// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IAsyncRedemption
/// @notice Asynchronous redemption: optional withdrawal fee in shares, pending requests, and operator-settled fulfillment.
/// @dev This implementation does not use ERC-4626 `withdraw` / `redeem` for settlement; underlying is paid on `fulfillRedeemRequests`.
interface IAsyncRedemption {
    /// @dev Emitted when `requestRedeem` is called.
    event RedeemRequested(
        uint256 indexed requestId,
        address indexed owner,
        address indexed sender,
        uint256 shares,
        uint256 assets
    );

    /// @notice Emitted after assets for listed redemption requests are paid to each request `owner`.
    event RedeemRequestsFulfilled(uint256[] requestIds);

    /// @notice Global cap for a single `requestRedeem` (share units) was updated.
    event MaxRedeemRequestSet(uint256 maxShares);

    /// @notice Submit a redemption request; burns or routes `shares` per implementation.
    /// @param shares Amount of strategy shares to redeem.
    /// @param owner Share owner whose balance is debited / allowance consumed.
    /// @return requestId Request identifier assigned by the strategy.
    function requestRedeem(
        uint256 shares,
        address owner
    ) external returns (uint256 requestId);

    /// @notice Shares still pending settlement for a request.
    function pendingRedeemRequest(
        uint256 requestId
    ) external view returns (uint256 shares);

    /// @notice Withdrawal fee rate (basis points) updated.
    event WithdrawalFeeBpsSet(uint16 bps);

    /// @notice Fee shares sent to treasury on a redemption request.
    event WithdrawalFeeCharged(address indexed treasury, uint256 feeShares);

    /// @param bps The withdrawal fee rate that failed validation (must be < 10_000).
    error AsyncRedemption_WithdrawalFeeBpsTooHigh(uint16 bps);

    error AsyncRedemption_ZeroRedeemRequestShares();

    error AsyncRedemption_NothingToFulfill(uint256 requestId);
}
