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
    error BlocklistOracle_AlreadyBlocklisted(address account);
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

    /// @notice Adds `account` to the manual blocklist. Requires {BLOCKLIST_SETTER_ROLE}. Reverts if already blocklisted.
    function blockAccount(address account) external;

    /// @notice Removes `account` from the manual blocklist. Requires {BLOCKLIST_REMOVER_ROLE}. Reverts if not blocklisted.
    function unblockAccount(address account) external;

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
