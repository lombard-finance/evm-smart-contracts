// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {INativeLBTC} from "../LBTC/interfaces/INativeLBTC.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IDepositor} from "./depositor/IDepositor.sol";
import {IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Actions} from "../libs/Actions.sol";

/**
 * @title Convenience contract for users who wish to
 * stake their BTC and deposit it in a vault in the same transaction.
 * @author Lombard.Finance
 * @notice This contract is a part of the Lombard.Finance protocol
 */
contract StakeAndBakeNativeToken is
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    using SafeERC20 for IERC20;

    /// @dev error thrown when the remaining amount after taking a fee is zero
    error ZeroDepositAmount();
    /// @dev error thrown when operator is changed to zero address
    error ZeroAddress();
    /// @dev error thrown when fee is attempted to be set above hardcoded maximum
    error FeeGreaterThanMaximum(uint256 fee);
    /// @dev error thrown when no depositor is set
    error NoDepositorSet();
    /// @dev error thrown when stakeAndBakeInternal is called by anyone other than self
    error CallerNotSelf(address caller);
    /// @dev error thrown when amount to be staked is more than permit amount
    error WrongAmount();
    /// @dev error thrown when permit payload is wrong
    error InvalidPermitPayload();

    event DepositorSet(address indexed depositor);
    event BatchStakeAndBakeReverted(
        uint256 indexed index,
        string message,
        bytes customError
    );
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
        /// @notice Amount to be staked, should be the same or less than amount minted
        uint256 amount;
    }

    /// @custom:storage-location erc7201:lombardfinance.storage.StakeAndBakeNativeToken
    struct StakeAndBakeNativeTokenStorage {
        IERC20 nativeLbtc;
        INativeLBTC adapter;
        IDepositor depositor;
        /// @notice Amount to be taken as fee in minimal units of token to be staked
        uint256 fee;
        uint256 gasLimit;
    }

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant FEE_OPERATOR_ROLE = keccak256("FEE_OPERATOR_ROLE");
    bytes32 public constant CLAIMER_ROLE = keccak256("CLAIMER_ROLE");

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.StakeAndBakeNativeToken")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STAKE_AND_BAKE_STORAGE_LOCATION =
        0x0e47f6bdb2c8c295db7a485b9611b576c67616f4bb0fcb676c069d08170f1800;

    /// @notice The maximum possible fee in token minimal units
    uint256 public constant MAXIMUM_FEE = 100000;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    modifier depositorSet() {
        if (
            address(_getStakeAndBakeNativeTokenStorage().depositor) ==
            address(0)
        ) {
            revert NoDepositorSet();
        }
        _;
    }

    function initialize(
        IERC20 nativeLbtc_,
        INativeLBTC adapter_,
        address owner_,
        address operator_,
        uint256 fee_,
        address claimer_,
        address pauser_,
        uint256 gasLimit_
    ) external initializer {
        if (fee_ > MAXIMUM_FEE) revert FeeGreaterThanMaximum(fee_);
        if (address(adapter_) == address(0)) {
            revert ZeroAddress();
        }

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

        StakeAndBakeNativeTokenStorage
            storage $ = _getStakeAndBakeNativeTokenStorage();
        $.nativeLbtc = nativeLbtc_;
        $.adapter = adapter_;
        $.fee = fee_;
        $.gasLimit = gasLimit_;
    }

    /**
     * @notice Sets the claiming fee
     * @param fee The fee to set
     */
    function setFee(uint256 fee) external onlyRole(FEE_OPERATOR_ROLE) {
        if (fee > MAXIMUM_FEE) revert FeeGreaterThanMaximum(fee);
        StakeAndBakeNativeTokenStorage
            storage $ = _getStakeAndBakeNativeTokenStorage();
        $.fee = fee;
        emit FeeChanged(fee);
    }

    /**
     * @notice Sets the maximum gas limit for each stake and bake call
     * @param gasLimit The gas limit to set
     */
    function setGasLimit(
        uint256 gasLimit
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        StakeAndBakeNativeTokenStorage
            storage $ = _getStakeAndBakeNativeTokenStorage();
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
        StakeAndBakeNativeTokenStorage
            storage $ = _getStakeAndBakeNativeTokenStorage();
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
        nonReentrant
        onlyRole(CLAIMER_ROLE)
        depositorSet
        whenNotPaused
        returns (bytes[] memory)
    {
        StakeAndBakeNativeTokenStorage
            storage $ = _getStakeAndBakeNativeTokenStorage();
        bytes[] memory ret = new bytes[](data.length);
        for (uint256 i; i < data.length; ) {
            try this.stakeAndBakeInternal{gas: $.gasLimit}(data[i]) returns (
                bytes memory b
            ) {
                ret[i] = b;
            } catch Error(string memory message) {
                emit BatchStakeAndBakeReverted(i, message, "");
            } catch (bytes memory lowLevelData) {
                emit BatchStakeAndBakeReverted(i, "", lowLevelData);
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
        return
            this.stakeAndBakeInternal{
                gas: _getStakeAndBakeNativeTokenStorage().gasLimit
            }(data);
    }

    function getStakeAndBakeFee() external view returns (uint256) {
        StakeAndBakeNativeTokenStorage
            storage $ = _getStakeAndBakeNativeTokenStorage();
        return $.fee;
    }

    function getStakeAndBakeDepositor() external view returns (IDepositor) {
        StakeAndBakeNativeTokenStorage
            storage $ = _getStakeAndBakeNativeTokenStorage();
        return $.depositor;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function getTokenAndAdapter() external view returns (IERC20, INativeLBTC) {
        StakeAndBakeNativeTokenStorage
            storage $ = _getStakeAndBakeNativeTokenStorage();
        return ($.nativeLbtc, $.adapter);
    }

    function _deposit(
        uint256 stakeAmount,
        address owner,
        bytes calldata depositPayload
    ) internal returns (bytes memory) {
        StakeAndBakeNativeTokenStorage
            storage $ = _getStakeAndBakeNativeTokenStorage();

        // Since a vault could only work with msg.sender, the depositor needs to own the LBTC.
        // The depositor should then send the staked vault shares back to the `owner`.
        $.nativeLbtc.safeIncreaseAllowance(address($.depositor), stakeAmount);

        // Finally, deposit LBTC to the given vault.
        return $.depositor.deposit(owner, stakeAmount, depositPayload);
    }

    function _stakeAndBake(
        StakeAndBakeData calldata data
    ) internal returns (bytes memory) {
        StakeAndBakeNativeTokenStorage
            storage $ = _getStakeAndBakeNativeTokenStorage();

        // First, mint the LBTC.
        $.adapter.mintV1(data.mintPayload, data.proof);
        // Get the recipient.
        (, address owner, , , , ) = abi.decode(
            data.mintPayload[4:],
            (uint256, address, uint256, bytes32, uint32, address)
        );

        // We check if we can simply use transferFrom.
        // Otherwise, we permit the depositor to transfer the minted value.,
        if ($.nativeLbtc.allowance(owner, address(this)) < data.amount) {
            if (data.permitPayload.length < 83) {
                revert InvalidPermitPayload();
            }
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

            if (data.amount > permitAmount) {
                revert WrongAmount();
            }
            IERC20Permit(address($.nativeLbtc)).permit(
                owner,
                address(this),
                permitAmount,
                deadline,
                v,
                r,
                s
            );
        }

        $.nativeLbtc.safeTransferFrom(owner, address(this), data.amount);

        // Take the current maximum fee from the user.
        uint256 feeAmount = $.fee;
        if (data.amount <= feeAmount) {
            revert ZeroDepositAmount();
        }
        if (feeAmount > 0) {
            $.nativeLbtc.safeTransfer($.adapter.getTreasury(), feeAmount);
        }
        return _deposit(data.amount - feeAmount, owner, data.depositPayload);
    }

    function _getStakeAndBakeNativeTokenStorage()
        private
        pure
        returns (StakeAndBakeNativeTokenStorage storage $)
    {
        assembly {
            $.slot := STAKE_AND_BAKE_STORAGE_LOCATION
        }
    }
}
