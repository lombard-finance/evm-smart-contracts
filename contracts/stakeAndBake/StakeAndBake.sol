// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IStakedLBTC} from "../LBTC/interfaces/IStakedLBTC.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IDepositor} from "./depositor/IDepositor.sol";
import {Actions} from "../libs/Actions.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

/**
 * @title Convenience contract for users who wish to
 * stake their BTC and deposit it in a vault in the same transaction.
 * @author Lombard.Finance
 * @notice This contract is a part of the Lombard.Finance protocol
 */
contract StakeAndBake is
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    /// @dev error thrown when the remaining amount after taking a fee is zero
    error ZeroDepositAmount();
    /// @dev error thrown when operator is changed to zero address
    error ZeroAddress();
    /// @dev error thrown when fee is attempted to be set above hardcoded maximum
    error FeeGreaterThanMaximum(uint256 fee);
    /// @dev error thrown when no depositor is set
    error NoDepositorSet();
    /// @dev error thrown when collecting funds from user fails
    error CollectingFundsFailed();
    /// @dev error thrown when sending the fee fails
    error SendingFeeFailed();
    /// @dev error thrown when approving to the depositor fails
    error ApprovalFailed();
    /// @dev error thrown when stakeAndBakeInternal is called by anyone other than self
    error CallerNotSelf(address caller);

    event DepositorSet(address indexed depositor);
    event BatchStakeAndBakeReverted(uint256 indexed index, string message);
    event FeeChanged(uint256 newFee);
    event GasLimitChanged(uint256 newGasLimit);

    struct StakeAndBakeData {
        /// @notice Contents of permit approval signed by the user
        bytes permitPayload;
        /// @notice Contains the parameters needed to complete a deposit
        bytes depositPayload;
        /// @notice The message with the stake data
        bytes mintPayload;
        /// @notice Signature of the consortium approving the mint
        bytes proof;
    }

    /// @custom:storage-location erc7201:lombardfinance.storage.StakeAndBake
    struct StakeAndBakeStorage {
        IStakedLBTC lbtc;
        IDepositor depositor;
        uint256 fee;
        uint256 gasLimit;
    }

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant FEE_OPERATOR_ROLE = keccak256("FEE_OPERATOR_ROLE");
    bytes32 public constant CLAIMER_ROLE = keccak256("CLAIMER_ROLE");

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.StakeAndBake")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STAKE_AND_BAKE_STORAGE_LOCATION =
        0xd0321c9642a0f7a5931cd62db04cb9e2c0d32906ef8824eece128a7ad5e4f500;

    uint256 public constant MAXIMUM_FEE = 100000;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    modifier depositorSet() {
        if (address(_getStakeAndBakeStorage().depositor) == address(0)) {
            revert NoDepositorSet();
        }
        _;
    }

    function initialize(
        IStakedLBTC lbtc_,
        address owner_,
        address operator_,
        uint256 fee_,
        address claimer_,
        address pauser_,
        uint256 gasLimit_
    ) external initializer {
        if (fee_ > MAXIMUM_FEE) revert FeeGreaterThanMaximum(fee_);

        __ReentrancyGuard_init();
        __Pausable_init();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, owner_);
        _grantRole(FEE_OPERATOR_ROLE, operator_);
        _grantRole(PAUSER_ROLE, pauser_);
        _grantRole(CLAIMER_ROLE, claimer_);

        // We need the stake and bake contract to hold a claimer role as well, for when we call
        // `batchStakeAndBake`.
        _grantRole(CLAIMER_ROLE, address(this));

        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        $.lbtc = lbtc_;
        $.fee = fee_;
        $.gasLimit = gasLimit_;
    }

    /**
     * @notice Sets the claiming fee
     * @param fee The fee to set
     */
    function setFee(uint256 fee) external onlyRole(FEE_OPERATOR_ROLE) {
        if (fee > MAXIMUM_FEE) revert FeeGreaterThanMaximum(fee);
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        $.fee = fee;
        emit FeeChanged(fee);
    }

    /**
     * @notice Sets the maximum gas limit for a batch stake and bake call
     * @param gasLimit The gas limit to set
     */
    function setGasLimit(
        uint256 gasLimit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        $.gasLimit = gasLimit;
        emit GasLimitChanged(gasLimit);
    }

    /**
     * @notice Sets a depositor, allowing the contract to `stakeAndBake` to it.
     * @param depositor The address of the depositor abstraction we use to deposit to the vault
     */
    function setDepositor(
        address depositor
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (depositor == address(0)) revert ZeroAddress();
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        $.depositor = IDepositor(depositor);
        emit DepositorSet(depositor);
    }

    /**
     * @notice Mint LBTC and stake directly into a given vault in batches.
     */
    function batchStakeAndBake(
        StakeAndBakeData[] calldata data
    )
        external
        onlyRole(CLAIMER_ROLE)
        depositorSet
        whenNotPaused
        returns (bytes[] memory)
    {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        bytes[] memory ret = new bytes[](data.length);
        for (uint256 i; i < data.length; ) {
            try this.stakeAndBakeInternal{gas: $.gasLimit}(data[i]) returns (
                bytes memory b
            ) {
                ret[i] = b;
            } catch Error(string memory message) {
                emit BatchStakeAndBakeReverted(i, message);
            }

            unchecked {
                i++;
            }
        }

        return ret;
    }

    function stakeAndBakeInternal(
        StakeAndBakeData calldata data
    ) external returns (bytes memory) {
        if (_msgSender() != address(this)) {
            revert CallerNotSelf(_msgSender());
        }
        return _stakeAndBake(data);
    }

    /**
     * @notice Mint LBTC and stake directly into a given vault.
     * @param data The bundled data needed to execute this function
     */
    function stakeAndBake(
        StakeAndBakeData calldata data
    )
        external
        nonReentrant
        onlyRole(CLAIMER_ROLE)
        depositorSet
        whenNotPaused
        returns (bytes memory)
    {
        return _stakeAndBake(data);
    }

    function getStakeAndBakeFee() external view returns (uint256) {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        return $.fee;
    }

    function getStakeAndBakeDepositor() external view returns (IDepositor) {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        return $.depositor;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function _deposit(
        uint256 permitAmount,
        uint256 feeAmount,
        address owner,
        bytes calldata depositPayload
    ) internal returns (bytes memory) {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        uint256 remainingAmount = permitAmount - feeAmount;

        // Since a vault could only work with msg.sender, the depositor needs to own the LBTC.
        // The depositor should then send the staked vault shares back to the `owner`.
        if (
            !IERC20(address($.lbtc)).approve(
                address($.depositor),
                remainingAmount
            )
        ) revert ApprovalFailed();

        // Finally, deposit LBTC to the given vault.
        return $.depositor.deposit(owner, remainingAmount, depositPayload);
    }

    function _stakeAndBake(
        StakeAndBakeData calldata data
    ) internal returns (bytes memory) {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();

        // First, mint the LBTC.
        address owner = $.lbtc.mint(data.mintPayload, data.proof);

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

        // We check if we can simply use transferFrom.
        // Otherwise, we permit the depositor to transfer the minted value.
        if (
            IERC20(address($.lbtc)).allowance(owner, address(this)) <
            permitAmount
        )
            IERC20Permit(address($.lbtc)).permit(
                owner,
                address(this),
                permitAmount,
                deadline,
                v,
                r,
                s
            );

        if (
            !IERC20(address($.lbtc)).transferFrom(
                owner,
                address(this),
                permitAmount
            )
        ) revert CollectingFundsFailed();

        // Take the current maximum fee from the user.
        uint256 feeAmount = $.fee;
        if (feeAmount > 0) {
            if (
                !IERC20(address($.lbtc)).transfer(
                    $.lbtc.getTreasury(),
                    feeAmount
                )
            ) revert SendingFeeFailed();
        }

        if (permitAmount > feeAmount) {
            return
                _deposit(permitAmount, feeAmount, owner, data.depositPayload);
        } else {
            revert ZeroDepositAmount();
        }
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
