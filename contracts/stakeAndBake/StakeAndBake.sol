// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LBTC} from "../LBTC/LBTC.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title Convenience contract for users who wish to 
 * stake their BTC and deposit it in a vault in the same transaction.
 * @author Lombard.Finance
 * @notice This contract is a part of the Lombard.Finance protocol
 */
contract StakeAndBake is Ownable2StepUpgradeable, ReentrancyGuardUpgradeable {
    /// @dev error thrown when batched stake and bake has mismatching lengths
    error InvalidInputLength();

    /// @custom:storage-location erc7201:lombardfinance.storage.StakeAndBake
    struct StakeAndBakeStorage {
        LBTC lbtc;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.StakeAndBake")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STAKE_AND_BAKE_STORAGE_LOCATION =
        0xd0321c9642a0f7a5931cd62db04cb9e2c0d32906ef8824eece128a7ad5e4f500;

    function initialize(address _lbtc) external initializer {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        $.lbtc = LBTC(_lbtc);
    }

    /**
     * @notice Mint LBTC and stake directly into a given vault in batches.
     * @param vault Address of the vault we will deposit the minted LBTC to
     * @param permitPayload Contents of permit approval signed by the user
     * @param depositPayload Contains the parameters needed to complete a deposit
     * @param mintPayload The message with the stake data
     * @param proof Signature of the consortium approving the mint
     * @param feePayload Contents of the fee approval signed by the user
     * @param userSignature Signature of the user to allow Fee
     */
    function batchStakeAndBake(
        address[] vault,
        bytes[] calldata permitPayload,
        bytes[] calldata depositPayload,
        bytes[] calldata mintPayload,
        bytes[] calldata proof,
        bytes[] calldata feePayload,
        bytes[] calldata userSignature
    ) external {
        uint256 length = vault.length;

        if (
            length != permitPayload.length ||
            length != depositPayload.length ||
            length != mintPayload.length ||
            length != proof.length ||
            length != feePayload.length ||
            length != userSignature.length
        ) {
            revert InvalidInputLength();
        }

        for (uint256 i; i < length; ++i) {
            stakeAndBake(
                vault[i],
                permitPayload[i],
                depositPayload[i],
                mintPayload[i],
                proof[i],
                feePayload[i],
                userSignature[i]
            );
        }
    }

    /**
     * @notice Mint LBTC and stake directly into a given vault.
     * @param vault Address of the vault we will deposit the minted LBTC to
     * @param permitPayload Contents of permit approval signed by the user
     * @param depositPayload ABI encoded function call for vault deposit
     * @param mintPayload The message with the stake data
     * @param proof Signature of the consortium approving the mint
     * @param feePayload Contents of the fee approval signed by the user
     * @param userSignature Signature of the user to allow Fee
     */
    function stakeAndBake(
        address vault,
        bytes calldata permitPayload,
        bytes calldata depositPayload,
        bytes calldata mintPayload,
        bytes calldata proof,
        bytes calldata feePayload,
        bytes calldata userSignature
    ) external nonReentrant {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();

        (
            uint256 value,
            uint256 deadline,
            uint8 v,
            bytes32 r,
            bytes32 s
        ) = abi.decode(
            permitPayload,
            (uint256, uint256, uint8, bytes32, bytes32)
        );

        // First, mint the LBTC and send to owner.
        $.lbtc.mintWithFee(mintPayload, proof, feePayload, userSignature);

        // Next, we permit the vault to transfer the minted value.
        lbtc.permit(
            _msgSender(),
            vault,
            value,
            deadline,
            v,
            r,
            s
        );

        // Finally, deposit LBTC to the given `vault`.
        vault.call(depositPayload);
    }

    function _getStakeAndBakeStorage() private pure returns (StakeAndBakeStorage storage $) {
        assembly {
            $.slot := STAKE_AND_BAKE_STORAGE_LOCATION
        }
    }
}
