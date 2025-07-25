// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {EIP1271SignatureUtils} from "../libs/EIP1271SignatureUtils.sol";
import {IBaseLBTC} from "./interfaces/IBaseLBTC.sol";
import {Assert} from "./libraries/Assert.sol";
import {Actions} from "../libs/Actions.sol";

/**
 * @title Abstract bridge adapter
 * @author Lombard.finance
 * @notice Implements basic communication with Bridge contract.
 * Should be extended with business logic of bridging protocols (e.g. CCIP, LayerZero).
 */
abstract contract BaseLBTC is
    IBaseLBTC,
    ERC20PausableUpgradeable,
    ERC20PermitUpgradeable,
    ReentrancyGuardUpgradeable
{
    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ERC20")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant ERC20StorageLocation =
        0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00;
    // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.EIP712")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant EIP712StorageLocation =
        0xa16a46d94261c7517cc8ff89f61c0ce93598e3c849801011dee649a6a557d100;

    function getFeeDigest(
        uint256 fee,
        uint256 expiry
    ) external view virtual returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        Actions.FEE_APPROVAL_EIP712_ACTION,
                        block.chainid,
                        fee,
                        expiry
                    )
                )
            );
    }

    function _batchMint(
        address[] calldata to,
        uint256[] calldata amount
    ) internal {
        Assert.equalLength(to.length, amount.length);

        for (uint256 i; i < to.length; ++i) {
            _mint(to[i], amount[i]);
        }
    }

    function _changeNameAndSymbol(
        string memory name_,
        string memory symbol_
    ) internal {
        ERC20Storage storage $ = _getERC20Storage_();
        $._name = name_;
        $._symbol = symbol_;
        EIP712Storage storage $_ = _getEIP712Storage_();
        $_._name = name_;
        emit NameAndSymbolChanged(name_, symbol_);
    }

    function _getERC20Storage_() private pure returns (ERC20Storage storage $) {
        assembly {
            $.slot := ERC20StorageLocation
        }
    }

    function _getEIP712Storage_()
        private
        pure
        returns (EIP712Storage storage $)
    {
        assembly {
            $.slot := EIP712StorageLocation
        }
    }

    /**
     * @dev Override of the _update function to satisfy both ERC20Upgradeable and ERC20PausableUpgradeable
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal virtual override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        super._update(from, to, value);
    }
}
