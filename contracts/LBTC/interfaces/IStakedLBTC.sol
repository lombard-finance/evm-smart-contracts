// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBaseLBTC} from "./IBaseLBTC.sol";

/// @title IStakedLBTC
/// @notice LBTC backed by proved deposit payloads; extends {IBaseLBTC} with consortium-gated minting and ratio views.
/// @dev Implementations route deposit mints and redeem/deposit flows through the asset router.
/// @custom:security-contact legal@lombard.finance
interface IStakedLBTC is IBaseLBTC {
    /// @dev Used by `migrateToAccessControl` when arguments mismatch legacy state; also legacy custom errors.
    error UnauthorizedAccount(address account);

    /// @notice Mint after verifying consortium `proof` over deposit `payload`.
    /// @param payload Encoded deposit message (e.g. `DepositV1`).
    /// @param proof Notary consortium signature approving the mint.
    /// @return recipient Address that receives the minted StakedLBTC.
    function mint(
        bytes calldata payload,
        bytes calldata proof
    ) external returns (address);

    /// @notice Deposit ratio for this token (from the asset router / oracle).
    /// @return value Current ratio (scaling per oracle / router; often 1e18-based).
    function ratio() external view returns (uint256);

    /// @notice Rate derived from the deposit ratio for amount conversions.
    /// @return rate Value from the configured oracle path via the asset router.
    function getRate() external view returns (uint256);
}
