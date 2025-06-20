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
    function getFeeDigest(uint256 fee, uint256 expiry) external view virtual returns(bytes32) {
        return _hashTypedDataV4(
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

    function _mint(
        bytes calldata rawPayload,
        bytes calldata proof
    ) internal virtual;

    function _mintWithFee(
        bytes calldata mintPayload,
        bytes calldata proof,
        bytes calldata feePayload,
        bytes calldata userSignature
    ) internal virtual;

    function _getMaxFee() internal view virtual returns (uint256);

    function _getTreasury() internal view virtual returns (address);

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
