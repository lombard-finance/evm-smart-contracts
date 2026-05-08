// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

interface IBlocklistOracle {
    /// @dev Why `onDeposit` / `onRedeem` rejected the account (operation implied by the error selector).
    enum DenialReason {
        Blocklist,
        Sanction
    }

    error BlocklistOracle_DepositNotAllowed(DenialReason reason);
    error BlocklistOracle_RedeemNotAllowed(DenialReason reason);
    error BlocklistOracle_ZeroAddress();
    error BlocklistOracle_SanctionListAlreadyAdded();
    error BlocklistOracle_SanctionListNotFound();

    event BlocklistEntrySet(
        address indexed sender,
        address indexed account,
        bool depositNotAllowed,
        bool redeemNotAllowed
    );
    event SanctionListAdded(
        address indexed sender,
        address indexed sanctionList
    );
    event SanctionListRemoved(
        address indexed sender,
        address indexed sanctionList
    );

    /// @dev One blocklisted address with flags; used by {getBlocklistEntries}.
    struct BlocklistAccountEntry {
        address account;
        bool depositNotAllowed;
        bool redeemNotAllowed;
    }

    function onDeposit(address account) external view;
    function onRedeem(address account) external view;

    function setBlocklistEntry(
        address account,
        bool depositNotAllowed,
        bool redeemNotAllowed
    ) external;

    function addSanctionList(address sanctionList) external;
    function removeSanctionList(address sanctionList) external;

    function isSanctioned(address account) external view returns (bool);
    function getBlocklistEntry(
        address account
    ) external view returns (bool depositNotAllowed, bool redeemNotAllowed);

    function blocklistLength() external view returns (uint256);

    /// @notice Page through blocklisted accounts for large lists.
    /// @param offset Start index in the enumerable set (ordering is not stable across mutations).
    /// @param limit Maximum entries to return; if 0, returns an empty array.
    function getBlocklistEntries(
        uint256 offset,
        uint256 limit
    ) external view returns (BlocklistAccountEntry[] memory entries);

    function getSanctionLists() external view returns (address[] memory);
}
