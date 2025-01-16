// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LBTC} from "../LBTC/LBTC.sol";
import {ILBTC} from "../LBTC/ILBTC.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IDepositor} from "./depositor/IDepositor.sol";
import {Actions} from "../libs/Actions.sol";

/**
 * @title Convenience contract for users who wish to
 * stake their BTC and deposit it in a vault in the same transaction.
 * @author Lombard.Finance
 * @notice This contract is a part of the Lombard.Finance protocol
 */
contract StakeAndBake is
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable
{
    /// @dev error thrown when the remaining amount after taking a fee is zero
    error ZeroDepositAmount();
    /// @dev error thrown when an unauthorized account calls an operator only function
    error UnauthorizedAccount(address account);
    /// @dev error thrown when operator is changed to zero address
    error ZeroAddress();
    /// @dev error thrown when fee is attempted to be set above hardcoded maximum
    error FeeGreaterThanMaximum();
    /// @dev error thrown when no depositor is set
    error NoDepositorSet();

    event DepositorSet(address indexed depositor);
    event BatchStakeAndBakeReverted(
        bytes32 indexed dataHash,
        StakeAndBakeData data
    );
    event FeeChanged(uint256 indexed oldFee, uint256 indexed newFee);
    event OperatorRoleTransferred(
        address indexed previousOperator,
        address indexed newOperator
    );
    event ClaimerRoleTransferred(
        address indexed previousClaimer,
        address indexed newClaimer
    );
    event PauserRoleTransferred(
        address indexed previousPauser,
        address indexed newPauser
    );

    struct StakeAndBakeData {
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
        IDepositor depositor;
        address operator;
        uint256 fee;
        address claimer;
        address pauser;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.StakeAndBake")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STAKE_AND_BAKE_STORAGE_LOCATION =
        0xd0321c9642a0f7a5931cd62db04cb9e2c0d32906ef8824eece128a7ad5e4f500;

    uint256 public constant MAXIMUM_FEE = 100000;

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

    modifier onlyClaimer() {
        if (_getStakeAndBakeStorage().claimer != _msgSender()) {
            revert UnauthorizedAccount(_msgSender());
        }
        _;
    }

    /// @dev In the case we call batchStakeAndBake, stakeAndBake will be called from address(this)
    /// so we need a separate modifier for this case.
    modifier onlyClaimerOrSelf() {
        if (
            _getStakeAndBakeStorage().claimer != _msgSender() &&
            address(this) != _msgSender()
        ) {
            revert UnauthorizedAccount(_msgSender());
        }
        _;
    }

    modifier onlyPauser() {
        if (_getStakeAndBakeStorage().pauser != _msgSender()) {
            revert UnauthorizedAccount(_msgSender());
        }
        _;
    }

    modifier depositorSet() {
        if (address(_getStakeAndBakeStorage().depositor) == address(0)) {
            revert NoDepositorSet();
        }
        _;
    }

    function initialize(
        address lbtc_,
        address owner_,
        address operator_,
        uint256 fee_,
        address claimer_,
        address pauser_
    ) external initializer {
        __ReentrancyGuard_init();

        __Pausable_init();

        __Ownable_init(owner_);
        __Ownable2Step_init();

        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        $.lbtc = LBTC(lbtc_);
        $.fee = fee_;
        $.operator = operator_;
        $.claimer = claimer_;
        $.pauser = pauser_;
    }

    /**
     * @notice Sets the claiming fee
     * @param fee The fee to set
     */
    function setFee(uint256 fee) external onlyOperator {
        if (fee > MAXIMUM_FEE) revert FeeGreaterThanMaximum();
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        uint256 oldFee = $.fee;
        $.fee = fee;
        emit FeeChanged(oldFee, fee);
    }

    /**
     * @notice Sets a depositor, allowing the contract to `stakeAndBake` to it.
     * @param depositor The address of the depositor abstraction we use to deposit to the vault
     */
    function setDepositor(address depositor) external onlyOwner {
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
    ) external onlyClaimer depositorSet whenNotPaused {
        for (uint256 i; i < data.length; ) {
            try this.stakeAndBake(data[i]) {} catch {
                bytes memory encodedData = abi.encode(
                    data[i].permitPayload,
                    data[i].depositPayload,
                    data[i].mintPayload,
                    data[i].proof
                );
                bytes32 dataHash = sha256(encodedData);
                emit BatchStakeAndBakeReverted(dataHash, data[i]);
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
    ) external nonReentrant onlyClaimerOrSelf depositorSet whenNotPaused {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();

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
        if (feeAmount > 0) $.lbtc.transfer($.lbtc.getTreasury(), feeAmount);

        uint256 remainingAmount = permitAmount - feeAmount;
        if (remainingAmount == 0) revert ZeroDepositAmount();

        // Since a vault could only work with msg.sender, the depositor needs to own the LBTC.
        // The depositor should then send the staked vault shares back to the `owner`.
        $.lbtc.approve(address($.depositor), remainingAmount);

        // Finally, deposit LBTC to the given vault.
        $.depositor.deposit(owner, remainingAmount, data.depositPayload);
    }

    function getStakeAndBakeFee() external view returns (uint256) {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        return $.fee;
    }

    function getStakeAndBakeOperator() external view returns (address) {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        return $.operator;
    }

    function getStakeAndBakeClaimer() external view returns (address) {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        return $.claimer;
    }

    function getStakeAndBakeDepositor() external view returns (address) {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        return address($.depositor);
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

    function transferClaimerRole(address newClaimer) external onlyOwner {
        if (newClaimer == address(0)) {
            revert ZeroAddress();
        }
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        address oldClaimer = $.claimer;
        $.claimer = newClaimer;
        emit ClaimerRoleTransferred(oldClaimer, newClaimer);
    }

    function transferPauserRole(address newPauser) external onlyOwner {
        if (newPauser == address(0)) {
            revert ZeroAddress();
        }
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        address oldPauser = $.pauser;
        $.pauser = newPauser;
        emit PauserRoleTransferred(oldPauser, newPauser);
    }

    function pause() external onlyPauser {
        _pause();
    }

    function unpause() external onlyPauser {
        _unpause();
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
