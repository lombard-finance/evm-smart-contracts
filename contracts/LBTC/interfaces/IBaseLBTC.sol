// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {RateLimitsV2} from "../../libs/RateLimitsV2.sol";

/// @custom:security-contact security@lombard.finance
interface IBaseLBTC {
    error RedeemForBtcDisabled();
    error PayloadAlreadyUsed();
    error AssetRouterNotSet();

    event RedeemRequest(
        address indexed from,
        uint256 indexed nonce,
        uint256 amount,
        uint256 fee,
        bytes payload
    );
    event RedeemsForBtcEnabled(bool);
    event NameAndSymbolChanged(string name, string symbol);
    event ConsortiumChanged(address indexed prevVal, address indexed newVal);
    event TreasuryAddressChanged(
        address indexed prevValue,
        address indexed newValue
    );
    event BurnCommissionChanged(
        uint64 indexed prevValue,
        uint64 indexed newValue
    );
    event DustFeeRateChanged(uint256 indexed oldRate, uint256 indexed newRate);
    event BasculeChanged(address indexed prevVal, address indexed newVal);
    event FeeCharged(uint256 indexed fee, bytes userSignature);
    event FeeChanged(uint256 indexed oldFee, uint256 indexed newFee);
    event RedeemFeeChanged(uint256 indexed oldFee, uint256 indexed newFee);

    event MintProofConsumed(
        address indexed recipient,
        bytes32 indexed payloadHash,
        bytes payload
    );

    event BatchMintSkipped(bytes32 indexed payloadHash, bytes payload);
    event AssetRouterChanged(address indexed prevVal, address indexed newVal);
    event MinterLimitSet(address indexed minter, uint256 limit, uint256 window);

    function burn(uint256 amount) external;

    function burn(address from, uint256 amount) external;

    function mint(address to, uint256 amount) external;

    function getTreasury() external view returns (address);

    function getAssetRouter() external view returns (address);

    function isNative() external view returns (bool);

    function getRedeemFee() external view returns (uint256);

    /// @notice EIP-712 digest for an off-chain fee approval bound to this token's domain.
    /// @param fee Fee value encoded in the approval struct.
    /// @param expiry Expiry timestamp encoded in the approval struct.
    /// @return digest Typed data hash compatible with `getFeeDigest` on the implementation.
    function getFeeDigest(
        uint256 fee,
        uint256 expiry
    ) external view returns (bytes32);

    function isRedeemsEnabled() external view returns (bool);

    /// @notice Sets the leaky-bucket mint rate limit for a `MINTER_ROLE` holder or `address(this)` (proof mint).
    /// @param minter Minter address, or `address(this)` for the proof-mint bucket.
    /// @param config Rate limit configuration (`limit`, `window`).
    /// @custom:access Caller must have `MANAGER_ROLE`
    function setMinterLimit(
        address minter,
        RateLimitsV2.Config memory config
    ) external;

    /// @notice Returns rate-limit state for `minter`.
    /// @param minter Minter address, or `address(this)` for the proof-mint bucket.
    /// @return limit Configured limit; `0` if unset.
    /// @return window Configured window in seconds; `0` if unset.
    /// @return amountInFlight Decayed in-flight amount at `block.timestamp`.
    /// @return remaining Remaining mint allowance; `0` when unset.
    function getMinterLimit(
        address minter
    )
        external
        view
        returns (
            uint256 limit,
            uint256 window,
            uint256 amountInFlight,
            uint256 remaining
        );
}
