// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LBTC} from "../LBTC/LBTC.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title Convenience contract for users who wish to 
 * stake their BTC and deposit it in a vault in the same transaction
 * @author Lombard.Finance
 * @notice This contract is a part of the Lombard.Finance protocol
 */
contract StakeAndBake is Ownable2StepUpgradeable, ReentrancyGuardUpgradeable {
    error InvalidInputLength();
    LBTC public immutable lbtc;

    /// @custom:storage-location erc7201:lombardfinance.storage.StakeAndBake
    struct StakeAndBakeStorage {
        LBTC lbtc;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.StakeAndBake")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STAKE_AND_BAKE_STORAGE_LOCATION =
        0xd0321c9642a0f7a5931cd62db04cb9e2c0d32906ef8824eece128a7ad5e4f500;

    function initialize(LBTC _lbtc) external initializer {
        lbtc = _lbtc;
    }

    /**
     * @notice Mint LBTC and stake directly into a given vault in batches.
     * @param permitPayload Contents of permit approval signed by the user
     * @param mintPayload The message with the stake data
     * @param proof Signature of the consortium approving the mint
     * @param feePayload Contents of the fee approval signed by the user
     * @param userSignature Signature of the user to allow Fee
     */
    function batchStakeAndBake(
        bytes[] calldata permitPayload,
        bytes[] calldata mintPayload,
        bytes[] calldata proof,
        bytes[] calldata feePayload,
        bytes[] calldata userSignature
    ) external {
        uint256 length = permitPayload.length;

        if (
            length != mintPayload.length ||
            length != proof.length ||
            length != feePayload.length ||
            length != userSignature.length
        ) {
            revert InvalidInputLength();
        }

        for (uint256 i; i < length; ++i) {
            stakeAndBake(
                permitPayload[i],
                mintPayload[i],
                proof[i],
                feePayload[i],
                userSignature[i]
            );
        }
    }

    /**
     * @notice Mint LBTC and stake directly into a given vault.
     * @param permitPayload Contents of permit approval signed by the user
     * @param mintPayload The message with the stake data
     * @param proof Signature of the consortium approving the mint
     * @param feePayload Contents of the fee approval signed by the user
     * @param userSignature Signature of the user to allow Fee
     */
    function stakeAndBake(
        TellerWithMultiAssetSupport teller,
        bytes calldata permitPayload,
        bytes calldata mintPayload,
        bytes calldata proof,
        bytes calldata feePayload,
        bytes calldata userSignature
    ) external {
        // First, mint the LBTC and send to owner.
        lbtc.mintWithFee(mintPayload, proof, feePayload, userSignature);

        // Next, we permit the vault to transfer the minted value.
        (
            uint256 value,
            uint256 deadline,
            uint8 v,
            bytes32 r,
            bytes32 s
        ) = abi.decode(permitPayload);

        lbtc.permit(
            _msgSender(),
            address(teller),
            value,
            deadline,
            v,
            r,
            s
        );

        // Finally, deposit LBTC to the given `teller`.
        teller.deposit(address(lbtc), value, 0);
    }

    function _getStakeAndBakeStorage() private pure returns (StakeAndBakeStorage storage $) {
        assembly {
            $.slot := STAKE_AND_BAKE_STORAGE_LOCATION
        }
    }
}
