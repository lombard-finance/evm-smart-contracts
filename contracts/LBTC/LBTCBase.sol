// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20Upgradeable, IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BitcoinUtils, OutputType} from "../libs/BitcoinUtils.sol";
import {IBascule} from "../bascule/interfaces/IBascule.sol";
import {ILBTC} from "./ILBTC.sol";
import {FeeUtils} from "../libs/FeeUtils.sol";
import {Consortium} from "../consortium/Consortium.sol";
import {Actions} from "../libs/Actions.sol";
import {EIP1271SignatureUtils} from "../libs/EIP1271SignatureUtils.sol";

/**
 * @title Base contract for LBTC tokens
 * @author Lombard.Finance
 * @notice This contract is a part of the Lombard.Finance protocol
 */
abstract contract LBTCBase is
    ILBTC,
    ERC20PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC20PermitUpgradeable
{
    struct DecodedPayload {
        address recipient;
        uint256 amount;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     *
     * Because LBTC repsents BTC we use the same decimals.
     *
     */
    function decimals() public view virtual override returns (uint8) {
        return 8;
    }

    /**
     * @notice Mint LBTC by proving a stake action happened
     * @param payload The message with the stake data
     * @param proof Signature of the consortium approving the mint
     */
    function mint(
        bytes calldata payload,
        bytes calldata proof
    ) public nonReentrant {
        // payload validation
        DecodedPayload memory decodedPayload = _decodeMintPayload(payload);

        _validateAndMint(
            decodedPayload.recipient,
            decodedPayload.amount,
            decodedPayload.amount,
            payload,
            proof
        );
    }

    /**
     * @dev Burns LBTC
     *
     * @param amount Amount of LBTC to burn
     */
    function burn(uint256 amount) external {
        _burn(_msgSender(), amount);
    }

    function _mintWithFee(
        bytes calldata mintPayload,
        bytes calldata proof,
        bytes calldata feePayload,
        bytes calldata userSignature,
        uint256 fee,
        address treasury
    ) internal virtual nonReentrant {
        // mint payload validation
        DecodedPayload memory decodedPayload = _decodeMintPayload(mintPayload);

        // fee payload validation
        if (bytes4(feePayload) != Actions.FEE_APPROVAL_ACTION) {
            revert UnexpectedAction(bytes4(feePayload));
        }
        Actions.FeeApprovalAction memory feeAction = Actions.feeApproval(
            feePayload[4:]
        );

        if (fee > feeAction.fee) {
            fee = feeAction.fee;
        }

        if (fee >= decodedPayload.amount) {
            revert FeeGreaterThanAmount();
        }

        {
            // Fee validation
            bytes32 digest = _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        Actions.FEE_APPROVAL_EIP712_ACTION,
                        block.chainid,
                        feeAction.fee,
                        feeAction.expiry
                    )
                )
            );

            if (
                !EIP1271SignatureUtils.checkSignature(
                    decodedPayload.recipient,
                    digest,
                    userSignature
                )
            ) {
                revert InvalidUserSignature();
            }
        }

        // modified payload to be signed
        _validateAndMint(
            decodedPayload.recipient,
            decodedPayload.amount - fee,
            decodedPayload.amount,
            mintPayload,
            proof
        );

        // mint fee to treasury
        _mint(treasury, fee);

        emit FeeCharged(fee, userSignature);
    }

    function _calcFeeAndDustLimit(
        bytes calldata scriptPubkey,
        uint256 amount,
        uint64 fee,
        uint256 dustFeeRate
    ) internal pure returns (uint256, bool, uint256, bool) {
        OutputType outType = BitcoinUtils.getOutputType(scriptPubkey);
        if (outType == OutputType.UNSUPPORTED) {
            revert ScriptPubkeyUnsupported();
        }

        if (amount <= fee) {
            return (0, false, 0, false);
        }

        uint256 amountAfterFee = amount - fee;
        uint256 dustLimit = BitcoinUtils.getDustLimitForOutput(
            outType,
            scriptPubkey,
            dustFeeRate
        );

        bool isAboveDust = amountAfterFee > dustLimit;
        return (amountAfterFee, true, dustLimit, isAboveDust);
    }

    /**
     * @dev Checks that the deposit was validated by the Bascule drawbridge.
     * @param bascule Bascule contract.
     * @param depositID The unique ID of the deposit.
     * @param amount The withdrawal amount.
     */
    function _confirmDeposit(
        IBascule bascule,
        bytes32 depositID,
        uint256 amount
    ) internal {
        if (address(bascule) != address(0)) {
            bascule.validateWithdrawal(depositID, amount);
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

    function _validateAndMint(
        address recipient,
        uint256 amountToMint,
        uint256 depositAmount,
        bytes calldata payload,
        bytes calldata proof
    ) internal virtual;

    function _decodeMintPayload(
        bytes calldata payload
    ) internal view virtual returns (DecodedPayload memory);
}
