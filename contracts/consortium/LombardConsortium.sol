// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {EIP1271SignatureUtils} from "../libs/EIP1271SignatureUtils.sol";

/**
 * @title The contract utilize consortium governance functions
 * @author Lombard.Finance
 * @notice The contracts is a part of Lombard.Finace protocol
 */
contract LombardConsortium is Ownable2StepUpgradeable, IERC1271 {

    error ZeroAddress();

    event ThresholdAddrChanged(address prevValue, address newValue);

    /// @custom:storage-location erc7201:lombardfinance.storage.Consortium
    struct ConsortiumStorage {
        address thresholdAddr;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.Consortium")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant CONSORTIUM_STORAGE_LOCATION =
        0xbac09a3ab0e06910f94a49c10c16eb53146536ec1a9e948951735cde3a58b500;

    function _getConsortiumStorage()
        private
        pure
        returns (ConsortiumStorage storage $)
    {
        assembly {
            $.slot := CONSORTIUM_STORAGE_LOCATION
        }
    }

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function __Consortium_init(address thresholdAddr_) internal onlyInitializing {
        _changeThresholdAddr(thresholdAddr_);
    }

    function initialize(address thresholdAddr_, address ownerKey) external initializer {
        __Ownable_init(ownerKey);
        __Ownable2Step_init();

        __Consortium_init(thresholdAddr_);
    }

    function changeThresholdAddr(address newVal) external onlyOwner {
        _changeThresholdAddr(newVal);
    }

    function _changeThresholdAddr(address newVal) internal {
        // prevent threshold addr from being 0x0
        if (newVal == address(0x0)) {
            revert ZeroAddress();
        }

        ConsortiumStorage storage $ = _getConsortiumStorage();
        emit ThresholdAddrChanged($.thresholdAddr, newVal);
        $.thresholdAddr = newVal;
    }

    function isValidSignature(
        bytes32 _hash,
        bytes memory _signature
    ) external view override returns (bytes4 magicValue) {
        ConsortiumStorage storage $ = _getConsortiumStorage();

        // recover signer
        if (ECDSA.recover(_hash, _signature) != $.thresholdAddr) {
                return EIP1271SignatureUtils.EIP1271_WRONGVALUE;
        }

        return EIP1271SignatureUtils.EIP1271_MAGICVALUE;
    }

    function thresholdAddr() external view returns (address) {
        return _getConsortiumStorage().thresholdAddr;
    }
}
