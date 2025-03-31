// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IIBCVoucher {
    event NameAndSymbolChanged(string name, string symbol);

    event VoucherMinted(
        address indexed from,
        address indexed to,
        uint256 fee,
        uint256 amount
    );
    event VoucherSpent(
        address indexed from,
        address indexed to,
        uint256 amount
    );
    event TreasuryUpdated(address indexed newTreasury);
    event FeeUpdated(uint256 fee);
    event RateLimitUpdated(uint64 limit, uint64 window, uint64 threshold);
    event RateLimitInflowIncreased(uint64 oldCredit, uint amount);
    event RateLimitOutflowIncreased(uint64 oldCredit, uint amount);

    error AmountTooLow();
    error ZeroAddress();
    error RateLimitExceeded(uint64 limit, uint64 flow, uint64 amount);
    error ZeroThreshold();
    error FutureStartTime(uint256 startTime, uint256 blockTimestamp);
    error TooLowWindow();
    error InconsistentThreshold();
    error SlippageExceeded(uint256 amountAfterFee, uint256 minAmountOut);

    /// @notice Gives voucher in exchange for LBTC
    /// @dev Requires LBTC approval
    /// @param amount Amount of LBTC
    /// @param minAmountOut The minimum acceptable amount of LBTC to receive
    function wrap(
        uint256 amount,
        uint256 minAmountOut
    ) external returns (uint256);

    /// @notice Gives voucher to `recipient` in exchange for LBTC
    /// @dev Requires LBTC approval
    /// @param recipient Recipient of Voucher
    /// @param amount Amount of LBTC
    /// @param minAmountOut The minimum acceptable amount of LBTC to receive
    function wrapTo(
        address recipient,
        uint256 amount,
        uint256 minAmountOut
    ) external returns (uint256);

    /// @notice Spends the voucher and gives LBTC back
    /// @dev No approval required, burns directly from message sender
    /// @param amount Amount of Voucher
    function spend(uint256 amount) external;

    /// @notice Spends the voucher and gives LBTC back to `recipient`
    /// @dev No approval required, burns directly from message sender
    /// @param recipient Recipient of LBTC
    /// @param amount Amount of Voucher
    function spendTo(address recipient, uint256 amount) external;

    /// @notice Spends the voucher and gives LBTC back
    /// @dev No approval required, burns directly from specified account.
    /// Only available to relayer role.
    /// @param owner Owner of Voucher
    /// @param amount Amount of Voucher
    function spendFrom(address owner, uint256 amount) external;

    /// @notice Returns the current wrapping fee
    function getFee() external view returns (uint256);
}
