// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @custom:security-contact legal@lombard.finance
interface IBlocklistOracle {
    /// @dev Why {check} rejected the account.
    enum DenialReason {
        Blocklist,
        Sanction
    }

    error BlocklistOracle_NotAllowed(DenialReason reason);
    error BlocklistOracle_ZeroAddress();
    error BlocklistOracle_NotBlocklisted(address account);
    error BlocklistOracle_SanctionListAlreadyAdded();
    error BlocklistOracle_SanctionListNotFound();

    event BlocklistedSet(
        address indexed sender,
        address indexed account,
        bool blocked
    );
    event SanctionListAdded(
        address indexed sender,
        address indexed sanctionList
    );
    event SanctionListRemoved(
        address indexed sender,
        address indexed sanctionList
    );

    /// @notice Compliance gate for deposits and redemptions; reverts if `account` is blocklisted or sanctioned.
    function check(address account) external view;

    /// @notice Adds `accounts` to the manual blocklist. Requires {BLOCKLIST_SETTER_ROLE}.
    ///         Reverts if any account is zero. Already-blocklisted accounts are skipped so urgent
    ///         blocklist updates can be applied without retry friction.
    function blockAccount(address[] calldata accounts) external;

    /// @notice Removes `accounts` from the manual blocklist. Requires {BLOCKLIST_REMOVER_ROLE}.
    ///         Reverts if any account is not blocklisted. Unlike {blockAccount}, missing entries
    ///         revert so the caller gets an exact outcome; unblocks are less time-sensitive and
    ///         can afford strict confirmation.
    function unblockAccount(address[] calldata accounts) external;

    function addSanctionList(address sanctionList) external;

    function removeSanctionList(address sanctionList) external;

    function isSanctioned(address account) external view returns (bool);

    /// @return True if `account` is on the manual blocklist (not sanction lists).
    function isBlocklisted(address account) external view returns (bool);

    function blocklistLength() external view returns (uint256);

    /// @notice Page through blocklisted accounts for large lists.
    /// @param offset Start index in the enumerable set (ordering is not stable across mutations).
    /// @param limit Maximum entries to return; if 0, returns an empty array.
    function getBlocklistEntries(
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory accounts);

    function getSanctionLists() external view returns (address[] memory);
}
