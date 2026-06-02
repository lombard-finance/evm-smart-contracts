// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IAsyncRedemption
/// @notice Asynchronous redemption: optional redeem fee in shares, pending requests, and operator-settled fulfillment.
/// @dev This implementation does not use ERC-4626 `withdraw` / `redeem` for settlement; underlying is paid on `fulfillRedeemRequests`.
/// @custom:security-contact legal@lombard.finance
interface IAsyncRedemption {
    /// @dev Per `requestRedeem` ticket; global totals mirror open requests.
    /// @dev `owner` and `requestBlock` pack into a single storage slot (160 + 96 bits).
    struct RedeemRequest {
        uint256 pendingShares;
        uint256 pendingAssets;
        address owner;
        uint96 requestBlock;
    }

    /// @dev Emitted when `requestRedeem` is called.
    /// @param assets Net underlying assets owed on fulfillment (matches `RedeemRequest.pendingAssets`).
    /// @param shares Net shares burned for the request (matches `RedeemRequest.pendingShares`); gross requested = `shares + feeShares`.
    /// @param feeShares Redeem fee shares transferred to {feeTreasury}.
    event RedeemRequested(
        uint256 indexed requestId,
        address indexed owner,
        address indexed sender,
        uint256 assets,
        uint256 shares,
        uint256 feeShares
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
    ) external view returns (RedeemRequest memory request);

    /// @notice Total underlying assets pending settlement for `owner` across all open requests.
    function pendingAssetsOf(
        address owner
    ) external view returns (uint256 assets);

    /// @notice Redeem fee rate (basis points) updated.
    event RedeemFeeBpsSet(uint16 bps);

    /// @notice Fee shares sent to treasury on a redemption request.
    event RedeemFeeCharged(address indexed treasury, uint256 feeShares);

    /// @param bps The redeem fee rate that failed validation (must be < 10_000).
    error AsyncRedemption_RedeemFeeBpsTooHigh(uint16 bps);

    error AsyncRedemption_NothingToFulfill(uint256 requestId);

    /// @param feeShares The redeem fee shares that failed validation (must be < shares).
    error AsyncRedemption_FeeSharesGreaterThanShares(
        uint256 feeShares,
        uint256 shares
    );

    error AsyncRedemption_ZeroAssets(uint256 shares);

    /// @notice A request cannot be fulfilled in the same block it was created in.
    /// @param requestId The request whose fulfillment was attempted too early.
    /// @param requestBlock Block in which the request was created.
    error AsyncRedemption_FulfillTooEarly(
        uint256 requestId,
        uint256 requestBlock
    );
}
