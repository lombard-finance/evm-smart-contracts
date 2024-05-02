// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Uncomment this line to use console.log
// import "hardhat/console.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";

/**
 * @title The contract utilize consortium governance functions
 * @author Lombard.Finance
 * @notice The contracts is a part of Lombard.Finace protocol
 */
contract LombardConsortium is Ownable2StepUpgradeable, IERC1271 {

    error BadSignature();

    event ThresholdKeyChanged(address prevValue, address newValue);

    /// @custom:storage-location erc7201:lombardfinance.storage.Consortium
    struct ConsortiumStorage {
        address thresholdKey;
    }

    // bytes4(keccak256("isValidSignature(bytes32,bytes)")
    bytes4 internal constant EIP1271_MAGICVALUE = 0x1626ba7e;

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.Consortium")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ConsortiumStorageLocation =
        0xbac09a3ab0e06910f94a49c10c16eb53146536ec1a9e948951735cde3a58b500;

    function _getConsortiumStorage()
        private
        pure
        returns (ConsortiumStorage storage $)
    {
        assembly {
            $.slot := ConsortiumStorageLocation
        }
    }

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function __Consortium_init(address thresholdKey) internal onlyInitializing {
        _changeThresholdKey(thresholdKey);
    }

    function initialize(address thresholdKey, address ownerKey) external initializer {
        __Ownable_init(ownerKey);
        __Ownable2Step_init();

        __Consortium_init(thresholdKey);
    }

    function changeThresholdKey(address newVal) external onlyOwner {
        _changeThresholdKey(newVal);
    }

    function _changeThresholdKey(address newVal) internal {
        ConsortiumStorage storage $ = _getConsortiumStorage();
        emit ThresholdKeyChanged($.thresholdKey, newVal);
        $.thresholdKey = newVal;
    }

    function isValidSignature(
        bytes32 hash,
        bytes memory signature
    ) external view override returns (bytes4 magicValue) {
        ConsortiumStorage storage $ = _getConsortiumStorage();

        if (ECDSA.recover(hash, signature) != $.thresholdKey) {
                revert BadSignature();
        }

        return EIP1271_MAGICVALUE;
    }

    function thresholdKey() external view returns (address) {
        return _getConsortiumStorage().thresholdKey;
    }
}
