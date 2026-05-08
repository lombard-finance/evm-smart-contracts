// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {AccessControlDefaultAdminRulesUpgradeable} from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlDefaultAdminRulesUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import {IBlocklistOracle} from "./interfaces/IBlocklistOracle.sol";
import {ISanctionList} from "./interfaces/ISanctionList.sol";

/// @title BlocklistOracle
contract BlocklistOracle is
    AccessControlDefaultAdminRulesUpgradeable,
    IBlocklistOracle
{
    using EnumerableSet for EnumerableSet.AddressSet;

    struct BlocklistEntry {
        bool depositNotAllowed;
        bool redeemNotAllowed;
    }

    /// @custom:storage-location erc7201:lombardfinance.storage.BlocklistOracle
    struct BlocklistOracleStorage {
        mapping(address => BlocklistEntry) blocklist;
        /// @dev Addresses with at least one of `depositNotAllowed` or `redeemNotAllowed` true; order not stable.
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
    }

    /// @inheritdoc IBlocklistOracle
    function setBlocklistEntry(
        address account,
        bool depositNotAllowed,
        bool redeemNotAllowed
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert BlocklistOracle_ZeroAddress();
        BlocklistOracleStorage storage $ = _getBlocklistOracleStorage();
        $.blocklist[account] = BlocklistEntry({
            depositNotAllowed: depositNotAllowed,
            redeemNotAllowed: redeemNotAllowed
        });
        if (depositNotAllowed || redeemNotAllowed) {
            $.blocklistedAccounts.add(account);
        } else {
            $.blocklistedAccounts.remove(account);
        }
        emit BlocklistEntrySet(
            _msgSender(),
            account,
            depositNotAllowed,
            redeemNotAllowed
        );
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
        BlocklistOracleStorage storage $ = _getBlocklistOracleStorage();
        if (!$.sanctions.remove(sanctionList))
            revert BlocklistOracle_SanctionListNotFound();
        emit SanctionListRemoved(_msgSender(), sanctionList);
    }

    /// @inheritdoc IBlocklistOracle
    function isSanctioned(address account) public view returns (bool) {
        BlocklistOracleStorage storage $ = _getBlocklistOracleStorage();
        uint256 len = $.sanctions.length();
        for (uint256 i = 0; i < len; ++i) {
            if (ISanctionList($.sanctions.at(i)).isSanctioned(account)) {
                return true;
            }
        }
        return false;
    }

    /// @inheritdoc IBlocklistOracle
    function getBlocklistEntry(
        address account
    ) external view returns (bool depositNotAllowed, bool redeemNotAllowed) {
        BlocklistEntry storage e = _getBlocklistOracleStorage().blocklist[
            account
        ];
        return (e.depositNotAllowed, e.redeemNotAllowed);
    }

    /// @inheritdoc IBlocklistOracle
    function blocklistLength() external view returns (uint256) {
        return _getBlocklistOracleStorage().blocklistedAccounts.length();
    }

    /// @inheritdoc IBlocklistOracle
    function getBlocklistEntries(
        uint256 offset,
        uint256 limit
    ) external view returns (BlocklistAccountEntry[] memory entries) {
        BlocklistOracleStorage storage $ = _getBlocklistOracleStorage();
        uint256 n = $.blocklistedAccounts.length();
        if (limit == 0 || offset >= n) {
            return new BlocklistAccountEntry[](0);
        }
        uint256 remaining = n - offset;
        uint256 count = limit < remaining ? limit : remaining;
        entries = new BlocklistAccountEntry[](count);
        for (uint256 i = 0; i < count; ++i) {
            address a = $.blocklistedAccounts.at(offset + i);
            BlocklistEntry storage e = $.blocklist[a];
            entries[i] = BlocklistAccountEntry({
                account: a,
                depositNotAllowed: e.depositNotAllowed,
                redeemNotAllowed: e.redeemNotAllowed
            });
        }
    }

    /// @inheritdoc IBlocklistOracle
    function getSanctionLists() external view returns (address[] memory lists) {
        BlocklistOracleStorage storage $ = _getBlocklistOracleStorage();
        return $.sanctions.values();
    }

    /// @inheritdoc IBlocklistOracle
    function onDeposit(address account) external view override {
        BlocklistOracleStorage storage $ = _getBlocklistOracleStorage();
        if ($.blocklist[account].depositNotAllowed) {
            revert BlocklistOracle_DepositNotAllowed(DenialReason.Blocklist);
        }
        if (isSanctioned(account)) {
            revert BlocklistOracle_DepositNotAllowed(DenialReason.Sanction);
        }
    }

    /// @inheritdoc IBlocklistOracle
    function onRedeem(address account) external view override {
        BlocklistOracleStorage storage $ = _getBlocklistOracleStorage();
        if ($.blocklist[account].redeemNotAllowed) {
            revert BlocklistOracle_RedeemNotAllowed(DenialReason.Blocklist);
        }
        if (isSanctioned(account)) {
            revert BlocklistOracle_RedeemNotAllowed(DenialReason.Sanction);
        }
    }
}
