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
abstract contract BaseLBTC is IBaseLBTC, ERC20PausableUpgradeable, ERC20PermitUpgradeable, ReentrancyGuardUpgradeable {

    function _batchMint(
        address[] calldata to,
        uint256[] calldata amount
    ) internal {
        Assert.equalLength(to.length, amount.length);

        for (uint256 i; i < to.length; ++i) {
            _mint(to[i], amount[i]);
        }
    }

    function _batchMint(
        bytes[] calldata payload,
        bytes[] calldata proof
    ) internal {
        Assert.equalLength(payload.length, proof.length);

        for (uint256 i; i < payload.length; ++i) {
            // Pre-emptive check if payload was used. If so, we can skip the call.
            bytes32 payloadHash = sha256(payload[i]);
            if (_isPayloadUsed(payloadHash)) {
                emit BatchMintSkipped(payloadHash, payload[i]);
                continue;
            }

            _mint(payload[i], proof[i]);
        }
    }

    function _batchMintWithFee(
        bytes[] calldata mintPayload,
        bytes[] calldata proof,
        bytes[] calldata feePayload,
        bytes[] calldata userSignature
    ) internal {
        Assert.equalLength(mintPayload.length, proof.length);
        Assert.equalLength(mintPayload.length, feePayload.length);
        Assert.equalLength(mintPayload.length, userSignature.length);

        for (uint256 i; i < mintPayload.length; ++i) {
            // Pre-emptive check if payload was used. If so, we can skip the call.
            bytes32 payloadHash = sha256(mintPayload[i]);
            if (_isPayloadUsed(payloadHash)) {
                emit BatchMintSkipped(payloadHash, mintPayload[i]);
                continue;
            }

            _mintWithFee(
                mintPayload[i],
                proof[i],
                feePayload[i],
                userSignature[i]
            );
        }
    }

    function _mint(
        bytes calldata rawPayload,
        bytes calldata proof
    ) internal virtual {}

    function _mintWithFee(
        bytes calldata mintPayload,
        bytes calldata proof,
        bytes calldata feePayload,
        bytes calldata userSignature
    ) internal virtual {
        _mint(mintPayload, proof);

        Assert.selector(feePayload, Actions.FEE_APPROVAL_ACTION);
        Actions.FeeApprovalAction memory feeAction = Actions.feeApproval(
            feePayload[4:]
        );

        (uint256 maxFee, address treasury) = _getMaxFeeAndTreasury();
        uint256 fee = Math.min(maxFee, feeAction.fee);

        if (fee >= feeAction.amount) {
            revert FeeGreaterThanAmount();
        }

        {
            bytes32 digest = _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        Actions.FEE_APPROVAL_EIP712_ACTION,
                        block.chainid,
                        feeAction.fee,
                        feeAction.expiry,
                        feeAction.amount,
                        feeAction.feePayer
                    )
                )
            );

            Assert.feeApproval(digest, feeAction.feePayer, userSignature);
        }

        if (fee > 0) {
            _burn(feeAction.feePayer, fee);
            _mint(treasury, fee);
        }

        emit FeeCharged(fee, userSignature);
    }

    function _isPayloadUsed(bytes32 payloadHash) internal view virtual returns (bool) {}
    function _getMaxFeeAndTreasury() internal view virtual returns (uint256, address) {}

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