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

    /// @notice Submit a redemption request; moves `shares` out of `owner` custody per implementation (EIP-7540).
    function requestRedeem(
        uint256 shares,
        address controller,
        address owner
    ) external returns (uint256 requestId);

    /// @notice Shares still pending (not yet claimable) for `(requestId, controller)`.
    function pendingRedeemRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256 shares);

    /// @notice Shares in claimable state for `(requestId, controller)` (claim via implementation-defined settlement, not ERC-4626 `withdraw` / `redeem` here).
    function claimableRedeemRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256 shares);

    /// @notice Whether `operator` may act on requests for `controller`.
    function isOperator(
        address controller,
        address operator
    ) external view returns (bool);

    /// @notice Approve or revoke `operator` for `msg.sender` as controller.
    function setOperator(
        address operator,
        bool approved
    ) external returns (bool);

    /// @notice Whether `controller` may receive new redeem requests.
    function acceptsRedeemRequests(
        address controller
    ) external view returns (bool);

    error ERC7540PreviewDisabled();

    /// @notice ERC-4626 `withdraw` / `redeem` are disabled; claim settled via a separate payment entrypoint.
    error ERC7540ERC4626ClaimDisabled();

    error ERC7540UnauthorizedClaimCaller(address caller, address controller);

    error RedeemRequestsNotAccepted(address controller);

    error ERC7540RedeemRequestsAlreadyAllowed(address controller);

    error ERC7540RedeemRequestsAlreadyStopped(address controller);

    error ERC7540RedeemControllerNotTracked(address controller);

    error ERC7540RedeemControllerAlreadyTracked(address controller);

    error ERC7540RemoveControllerHasPending(address controller);

    error ERC7540RemoveControllerNotTracked(address controller);

    error ERC7540ZeroRedeemRequestShares();

    error ERC7540NothingToFulfill(uint256 requestId);
}
