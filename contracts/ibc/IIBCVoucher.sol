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

    /// @notice Gives voucher in exchange for LBTC
    /// @dev Requires LBTC approval
    /// @param amount Amount of LBTC
    function get(uint256 amount) external returns (uint256);

    /// @notice Gives voucher to `recipient` in exchange for LBTC
    /// @dev Requires LBTC approval
    /// @param recipient Recipient of Voucher
    /// @param amount Amount of LBTC
    function getTo(
        address recipient,
        uint256 amount
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
}
