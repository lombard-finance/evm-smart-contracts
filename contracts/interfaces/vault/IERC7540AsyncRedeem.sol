// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IERC7540AsyncRedeem
/// @notice Asynchronous redemption + operator surface from [ERC-7540](https://eips.ethereum.org/EIPS/eip-7540).
/// @dev Claim path uses ERC-4626 `withdraw` / `redeem` (optionally overloaded with `controller` per ERC-7540). ERC-165:
/// `0x620ee8e4` — async redemption; `0xe3bc4e65` — operator methods (required when ERC-7575 is not implemented).
interface IERC7540AsyncRedeem {
    /// @dev Emitted when `requestRedeem` is called (EIP-7540).
    event RedeemRequest(
        address indexed controller,
        address indexed owner,
        uint256 indexed requestId,
        address sender,
        uint256 shares
    );

    /// @dev Emitted when `setOperator` updates approval (EIP-7540).
    event OperatorSet(address indexed controller, address indexed operator, bool approved);

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

    /// @notice Shares in claimable state for `(requestId, controller)` (claim via `withdraw` / `redeem`).
    function claimableRedeemRequest(
        uint256 requestId,
        address controller
    ) external view returns (uint256 shares);

    /// @notice Whether `operator` may act on requests for `controller`.
    function isOperator(address controller, address operator) external view returns (bool);

    /// @notice Approve or revoke `operator` for `msg.sender` as controller.
    function setOperator(address operator, bool approved) external returns (bool);
}
