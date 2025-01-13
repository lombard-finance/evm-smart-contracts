// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LBTC} from "../LBTC/LBTC.sol";
import {ILBTC} from "../LBTC/ILBTC.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IDepositor} from "./depositor/IDepositor.sol";
import {Actions} from "../libs/Actions.sol";

/**
 * @title Convenience contract for users who wish to
 * stake their BTC and deposit it in a vault in the same transaction.
 * @author Lombard.Finance
 * @notice This contract is a part of the Lombard.Finance protocol
 */
contract StakeAndBake is Ownable2StepUpgradeable, ReentrancyGuardUpgradeable {
    /// @dev error thrown when batched stake and bake has mismatching lengths
    error InvalidInputLength();
    /// @dev error thrown when stake and bake is attempted with an unknown vault address
    error VaultNotFound();
    /// @dev error thrown when the permit amount is not corresponding to the mint amount
    error IncorrectPermitAmount();
    /// @dev error thrown when the remaining amount after taking a fee is zero
    error ZeroDepositAmount();
    /// @dev error thrown when an unauthorized account calls an operator only function
    error UnauthorizedAccount(address account);
    /// @dev error thrown when operator is changed to zero address
    error ZeroAddress();

    event DepositorAdded(address indexed vault, address indexed depositor);
    event DepositorRemoved(address indexed vault);
    event BatchStakeAndBakeReverted(
        address indexed owner,
        StakeAndBakeData data
    );
    event FeeChanged(uint256 indexed oldFee, uint256 indexed newFee);
    event OperatorRoleTransferred(
        address indexed previousOperator,
        address indexed newOperator
    );

    struct StakeAndBakeData {
        /// @notice vault Address of the vault we will deposit the minted LBTC to
        address vault;
        /// @notice permitPayload Contents of permit approval signed by the user
        bytes permitPayload;
        /// @notice depositPayload Contains the parameters needed to complete a deposit
        bytes depositPayload;
        /// @notice mintPayload The message with the stake data
        bytes mintPayload;
        /// @notice proof Signature of the consortium approving the mint
        bytes proof;
    }

    /// @custom:storage-location erc7201:lombardfinance.storage.StakeAndBake
    struct StakeAndBakeStorage {
        LBTC lbtc;
        mapping(address => IDepositor) depositors;
        address operator;
        uint256 fee;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.StakeAndBake")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STAKE_AND_BAKE_STORAGE_LOCATION =
        0xd0321c9642a0f7a5931cd62db04cb9e2c0d32906ef8824eece128a7ad5e4f500;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    modifier onlyOperator() {
        if (_getStakeAndBakeStorage().operator != _msgSender()) {
            revert UnauthorizedAccount(_msgSender());
        }
        _;
    }

    function initialize(
        address lbtc_,
        address owner_,
        address operator_,
        uint256 fee_
    ) external initializer {
        __ReentrancyGuard_init();

        __Ownable_init(owner_);
        __Ownable2Step_init();

        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        $.lbtc = LBTC(lbtc_);
        $.fee = fee_;
        $.operator = operator_;
    }

    /**
     * @notice Sets the claiming fee
     * @param fee The fee to set
     */
    function setFee(uint256 fee) external onlyOperator {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        uint256 oldFee = $.fee;
        $.fee = fee;
        emit FeeChanged(oldFee, fee);
    }

    /**
     * @notice Add a depositor to the internal mapping, allowing the contract to
     * `stakeAndBake` to it.
     * @param vault The address of the vault we wish to be able to deposit to
     * @param depositor The address of the depositor abstraction we use to deposit to the vault
     */
    function addDepositor(address vault, address depositor) external onlyOwner {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        $.depositors[vault] = IDepositor(depositor);
        emit DepositorAdded(vault, depositor);
    }

    /**
     * @notice Remove a depositor from the internal mapping, removing `stakeAndBake`
     * functionality for it.
     * @param vault The address of the vault we wish to remove from the internal mapping
     */
    function removeDepositor(address vault) external onlyOwner {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        $.depositors[vault] = IDepositor(address(0));
        emit DepositorRemoved(vault);
    }

    /**
     * @notice Mint LBTC and stake directly into a given vault in batches.
     */
    function batchStakeAndBake(StakeAndBakeData[] calldata data) external {
        for (uint256 i; i < data.length; ) {
            try this.stakeAndBake(data[i]) {} catch {
                Actions.DepositBtcAction memory action = Actions.depositBtc(
                    data[i].mintPayload[4:]
                );
                address owner = action.recipient;
                emit BatchStakeAndBakeReverted(owner, data[i]);
            }

            unchecked {
                i++;
            }
        }
    }

    /**
     * @notice Mint LBTC and stake directly into a given vault.
     * @param data The bundled data needed to execute this function
     */
    function stakeAndBake(
        StakeAndBakeData calldata data
    ) external nonReentrant {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();

        IDepositor depositor = $.depositors[data.vault];
        if (address(depositor) == address(0)) {
            revert VaultNotFound();
        }

        // First, mint the LBTC and send to owner.
        $.lbtc.mint(data.mintPayload, data.proof);

        (
            uint256 permitAmount,
            uint256 deadline,
            uint8 v,
            bytes32 r,
            bytes32 s
        ) = abi.decode(
                data.permitPayload,
                (uint256, uint256, uint8, bytes32, bytes32)
            );

        // Check the recipient.
        Actions.DepositBtcAction memory action = Actions.depositBtc(
            data.mintPayload[4:]
        );
        address owner = action.recipient;

        // We check if we can simply use transferFrom.
        // Otherwise, we permit the depositor to transfer the minted value.
        if ($.lbtc.allowance(owner, address(this)) < permitAmount)
            $.lbtc.permit(
                owner,
                address(this),
                permitAmount,
                deadline,
                v,
                r,
                s
            );

        $.lbtc.transferFrom(owner, address(this), permitAmount);

        // Take the current maximum fee from the user.
        uint256 feeAmount = $.fee;
        $.lbtc.transfer($.lbtc.getTreasury(), feeAmount);

        uint256 remainingAmount = permitAmount - feeAmount;
        if (remainingAmount == 0) revert ZeroDepositAmount();

        // Since a vault could only work with msg.sender, the depositor needs to own the LBTC.
        // The depositor should then send the staked vault shares back to the `owner`.
        $.lbtc.approve(address(depositor), remainingAmount);

        // Finally, deposit LBTC to the given `vault`.
        depositor.deposit(data.vault, owner, data.depositPayload);
    }

    function getStakeAndBakeFee() external view returns (uint256) {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        return $.lbtc.getMintFee();
    }

    function transferOperatorRole(address newOperator) external onlyOwner {
        if (newOperator == address(0)) {
            revert ZeroAddress();
        }
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        address oldOperator = $.operator;
        $.operator = newOperator;
        emit OperatorRoleTransferred(oldOperator, newOperator);
    }

    function _getStakeAndBakeStorage()
        private
        pure
        returns (StakeAndBakeStorage storage $)
    {
        assembly {
            $.slot := STAKE_AND_BAKE_STORAGE_LOCATION
        }
    }
}
