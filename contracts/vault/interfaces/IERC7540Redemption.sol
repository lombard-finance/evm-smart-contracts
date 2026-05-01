// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IERC7540Redemption
/// @notice Asynchronous redemption + operator surface from [ERC-7540](https://eips.ethereum.org/EIPS/eip-7540), optional controller-manager registration for redeem controllers, and implementation errors.
/// @dev Claim settlement is implementation-defined (this implementation disables ERC-4626 `withdraw` / `redeem`; use the separated payment flow). ERC-165:
/// `0x620ee8e4` — async redemption; `0xe3bc4e65` — operator methods (required when ERC-7575 is not implemented).
interface IERC7540Redemption {
    /// @dev Emitted when `requestRedeem` is called (EIP-7540).
    event RedeemRequested(
        uint256 indexed requestId,
        address indexed owner,
        address indexed controller,
        address sender,
        uint256 shares
    );

    /// @dev Emitted when `setOperator` updates approval (EIP-7540).
    event OperatorSet(
        address indexed controller,
        address indexed operator,
        bool approved
    );

    /// @notice Emitted when `controller` may again receive new redeem requests (`acceptsRedeemRequests` becomes true).
    event RedeemRequestsAllowed(address indexed controller);

    /// @notice Emitted when `controller` stops accepting new redeem requests (pending may remain).
    event RedeemRequestsStopped(address indexed controller);

    /// @notice Emitted when `controller` is removed from the tracked controller set (`controllers`).
    event RedeemControllerRemoved(address indexed controller);

    /// @notice Emitted when `controller` is registered for enumeration / tracking (`controllers`).
    event RedeemControllerRegistered(address indexed controller);

    /// @notice Emitted after assets for listed redemption requests are paid to each request `owner`.
    event RedeemRequestsFulfilled(uint256[] requestIds);

    /// @notice ERC-4626 `maxRedeem(controller)` cap updated for async redemption flows.
    event MaxRedeemSet(address indexed controller, uint256 maxShares);

    /// @notice Submit a redemption request (EIP-7540); burns or locks `shares` per implementation.
    /// @param shares Amount of vault shares to redeem.
    /// @param controller Registered redeem controller key for this request.
    /// @param owner Share owner whose balance is debited / allowance consumed.
    /// @return requestId Opaque request identifier assigned by the vault.
    function requestRedeem(
        uint256 shares,
        address controller,
        address owner
    ) external returns (uint256 requestId);

    /// @notice Shares still pending settlement for a request (implementation-defined lifecycle).
    /// @param requestId Request identifier returned by `requestRedeem`.
    /// @param controller Redeem controller associated with the request.
    /// @return shares Pending share units for that ticket (may be zero after fulfillment).
    function pendingRedeemRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256 shares);

    /// @notice Shares ready for claim-style settlement when implementations separate pending vs claimable states.
    /// @dev This deployment often returns zero if fulfillment does not use a separate claim queue.
    function claimableRedeemRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256 shares);

    /// @notice Whether `operator` may fulfill or manage redemption tickets for `controller`.
    /// @return allowed True if `operator` is approved via `setOperator`.
    function isOperator(
        address controller,
        address operator
    ) external view returns (bool);

    /// @notice Approve or revoke `operator` acting on behalf of `msg.sender` as a registered controller.
    /// @return success Interface compatibility; implementations return true on success.
    function setOperator(
        address operator,
        bool approved
    ) external returns (bool);

    /// @notice Withdrawal fee rate (basis points) updated.
    event WithdrawalFeeBpsSet(uint16 bps);

    /// @notice Treasury address for withdrawal fee shares updated.
    event WithdrawalTreasurySet(address indexed treasury);

    /// @notice Fee shares sent to treasury on a redemption request.
    event WithdrawalFeeCharged(address indexed treasury, uint256 feeShares);

    error ERC7540_WithdrawalFeeBpsTooHigh();

    error ERC7540_PreviewDisabled();

    /// @notice ERC-4626 `withdraw` / `redeem` are disabled; claim settled via a separate payment entrypoint.
    error ERC7540_ERC4626ClaimDisabled();

    error ERC7540_UnauthorizedClaimCaller(
        address caller,
        address controller,
        uint256 requestId
    );

    error ERC7540_RedeemRequestsAlreadyAllowed(address controller);

    error ERC7540_RedeemRequestsAlreadyStopped(address controller);

    error ERC7540_RedeemControllerNotTracked(address controller);

    error ERC7540_RedeemControllerAlreadyTracked(address controller);

    error ERC7540_RemoveControllerHasPending(address controller);

    error ERC7540_RemoveControllerNotTracked(address controller);

    error ERC7540_ZeroRedeemRequestShares();

    error ERC7540_NothingToFulfill(uint256 requestId);

    error ERC7540_ExceededMaxRedeem(
        address controller,
        uint256 shares,
        uint256 maxShares
    );
}
