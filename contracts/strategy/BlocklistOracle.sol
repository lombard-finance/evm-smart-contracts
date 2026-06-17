// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import {IBlocklistOracle} from "./interfaces/IBlocklistOracle.sol";
import {ISanctionList} from "./interfaces/ISanctionList.sol";

/// @title BlocklistOracle
/// @custom:security-contact legal@lombard.finance
contract BlocklistOracle is
    AccessControlDefaultAdminRulesUpgradeable,
    IBlocklistOracle
{
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @notice May call {blockAccount}; granted to `defaultAdmin_` in {initialize}.
    bytes32 public constant BLOCKLIST_SETTER_ROLE =
        keccak256("BLOCKLIST_SETTER_ROLE");

    /// @notice May call {unblockAccount}; granted to `defaultAdmin_` in {initialize}.
    bytes32 public constant BLOCKLIST_REMOVER_ROLE =
        keccak256("BLOCKLIST_REMOVER_ROLE");

    /// @custom:storage-location erc7201:lombardfinance.storage.BlocklistOracle
    struct BlocklistOracleStorage {
        /// @dev Membership implies blocklisted; enumeration order is not stable.
        EnumerableSet.AddressSet blocklistedAccounts;
        EnumerableSet.AddressSet sanctions;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.BlocklistOracle")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant BLOCKLIST_ORACLE_STORAGE_LOCATION =
        0xa11a1bac81fcbc5a79c2dc5678e17c8be55a825c15c126e87ad02c60c5b0bb00;

    /// @dev Namespaced slot accessor for `BlocklistOracleStorage`; use from concrete contracts when adding oracle fields.
    function _getBlocklistOracleStorage()
        internal
        pure
        returns (BlocklistOracleStorage storage $)
    {
        assembly {
            $.slot := BLOCKLIST_ORACLE_STORAGE_LOCATION
        }
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        uint48 initialDefaultAdminDelay_,
        address defaultAdmin_
    ) external initializer {
        __BlocklistOracle_init(initialDefaultAdminDelay_, defaultAdmin_);
    }

    function __BlocklistOracle_init(
        uint48 initialDefaultAdminDelay_,
        address defaultAdmin_
    ) internal onlyInitializing {
        __AccessControl_init();
        __AccessControlDefaultAdminRules_init(
            initialDefaultAdminDelay_,
            defaultAdmin_
        );
        _grantRole(BLOCKLIST_SETTER_ROLE, defaultAdmin_);
        _grantRole(BLOCKLIST_REMOVER_ROLE, defaultAdmin_);
    }

    /// @inheritdoc IBlocklistOracle
    function blockAccount(
        address[] calldata accounts
    ) external onlyRole(BLOCKLIST_SETTER_ROLE) {
        BlocklistOracleStorage storage $ = _getBlocklistOracleStorage();
        address sender = _msgSender();
        uint256 len = accounts.length;
        for (uint256 i; i < len; ++i) {
            address account = accounts[i];
            if (account == address(0)) revert BlocklistOracle_ZeroAddress();
            if ($.blocklistedAccounts.add(account)) {
                emit BlocklistedSet(sender, account, true);
            }
        }
    }

    /// @inheritdoc IBlocklistOracle
    function unblockAccount(
        address account
    ) external onlyRole(BLOCKLIST_REMOVER_ROLE) {
        if (account == address(0)) revert BlocklistOracle_ZeroAddress();
        BlocklistOracleStorage storage $ = _getBlocklistOracleStorage();
        if (!$.blocklistedAccounts.remove(account))
            revert BlocklistOracle_NotBlocklisted(account);
        emit BlocklistedSet(_msgSender(), account, false);
    }

    /// @inheritdoc IBlocklistOracle
    function addSanctionList(
        address sanctionList
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (sanctionList == address(0)) revert BlocklistOracle_ZeroAddress();
        BlocklistOracleStorage storage $ = _getBlocklistOracleStorage();
        if (!$.sanctions.add(sanctionList))
            revert BlocklistOracle_SanctionListAlreadyAdded();
        emit SanctionListAdded(_msgSender(), sanctionList);
    }

    /// @inheritdoc IBlocklistOracle
    function removeSanctionList(
        address sanctionList
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (sanctionList == address(0)) revert BlocklistOracle_ZeroAddress();
        BlocklistOracleStorage storage $ = _getBlocklistOracleStorage();
        if (!$.sanctions.remove(sanctionList))
            revert BlocklistOracle_SanctionListNotFound();
        emit SanctionListRemoved(_msgSender(), sanctionList);
    }

    /// @inheritdoc IBlocklistOracle
    function isSanctioned(address account) public view returns (bool) {
        BlocklistOracleStorage storage $ = _getBlocklistOracleStorage();
        uint256 len = $.sanctions.length();
        for (uint256 i; i < len; ++i) {
            if (ISanctionList($.sanctions.at(i)).isSanctioned(account)) {
                return true;
            }
        }
        return false;
    }

    /// @inheritdoc IBlocklistOracle
    function isBlocklisted(address account) external view returns (bool) {
        return
            _getBlocklistOracleStorage().blocklistedAccounts.contains(account);
    }

    /// @inheritdoc IBlocklistOracle
    function blocklistLength() external view returns (uint256) {
        return _getBlocklistOracleStorage().blocklistedAccounts.length();
    }

    /// @inheritdoc IBlocklistOracle
    function getBlocklistEntries(
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory accounts) {
        BlocklistOracleStorage storage $ = _getBlocklistOracleStorage();
        uint256 n = $.blocklistedAccounts.length();
        if (limit == 0 || offset >= n) {
            return new address[](0);
        }
        uint256 remaining = n - offset;
        uint256 count = limit < remaining ? limit : remaining;
        accounts = new address[](count);
        for (uint256 i; i < count; ++i) {
            accounts[i] = $.blocklistedAccounts.at(offset + i);
        }
    }

    /// @inheritdoc IBlocklistOracle
    function getSanctionLists() external view returns (address[] memory) {
        BlocklistOracleStorage storage $ = _getBlocklistOracleStorage();
        return $.sanctions.values();
    }

    /// @inheritdoc IBlocklistOracle
    function check(address account) external view override {
        BlocklistOracleStorage storage $ = _getBlocklistOracleStorage();
        if ($.blocklistedAccounts.contains(account)) {
            revert BlocklistOracle_NotAllowed(DenialReason.Blocklist);
        }
        if (isSanctioned(account)) {
            revert BlocklistOracle_NotAllowed(DenialReason.Sanction);
        }
    }
}
