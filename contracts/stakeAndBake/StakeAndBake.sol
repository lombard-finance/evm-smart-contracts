// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {LBTC} from "../LBTC/LBTC.sol";
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

    event DepositorAdded(address indexed vault, address indexed depositor);
    event DepositorRemoved(address indexed vault);

    struct StakeAndBakeData {
        /// @notice vault Address of the vault we will deposit the minted LBTC to
        address vault;
        /// @notice owner Address of the user staking and baking
        address owner;
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
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.StakeAndBake")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant STAKE_AND_BAKE_STORAGE_LOCATION =
        0xd0321c9642a0f7a5931cd62db04cb9e2c0d32906ef8824eece128a7ad5e4f500;

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address lbtc_, address owner_) external initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();

        __ReentrancyGuard_init();

        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        $.lbtc = LBTC(lbtc_);
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
            stakeAndBake(data[i]);
            unchecked {
                i++;
            }
        }
    }

    /**
     * @notice Mint LBTC and stake directly into a given vault.
     * @param data The bundled data needed to execute this function
     */
    function stakeAndBake(StakeAndBakeData calldata data) public nonReentrant {
        IDepositor depositor = _getDepositor(data.vault);
        if (address(depositor) == address(0)) {
            revert VaultNotFound();
        }

        // First, mint the LBTC and send to owner.
        _mint(data.mintPayload, data.proof);

        // Check how much we minted.
        Actions.DepositBtcAction memory action = Actions.depositBtc(
            data.mintPayload[4:]
        );
        uint256 amount = action.amount;

        // We check if we can simply use transferFrom.
        if (_allowance(data.owner, address(depositor)) < amount) {
            // Otherwise, we permit the depositor to transfer the minted value.
            _performPermit(data.permitPayload, data.owner);
        }

        _takeMintedLbtc(data.owner, amount);

        // Take the current maximum fee from the user.
        uint256 feeAmount = _getLbtcMaximumFee();
        _transferFee(data.owner, feeAmount);

        // Since a vault could only work with msg.sender, the depositor needs to own the LBTC.
        // The depositor should then send the staked vault shares back to the `owner`.
        uint256 remainingAmount = amount - feeAmount;
        _allowToVault(address(depositor), remainingAmount);

        // Finally, deposit LBTC to the given `vault`.
        depositor.deposit(data.vault, data.owner, data.depositPayload);
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

    function _getDepositor(
        address vault
    ) private view returns (IDepositor depositor) {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        return $.depositors[vault];
    }

    function _performPermit(
        bytes calldata permitPayload,
        address owner
    ) private {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();

        (uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) = abi
            .decode(permitPayload, (uint256, uint256, uint8, bytes32, bytes32));

        $.lbtc.permit(owner, address(this), value, deadline, v, r, s);
    }

    function _mint(bytes calldata mintPayload, bytes calldata proof) private {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        $.lbtc.mint(mintPayload, proof);
    }

    function _allowance(
        address owner,
        address depositor
    ) private view returns (uint256) {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        return $.lbtc.allowance(owner, depositor);
    }

    function _takeMintedLbtc(address owner, uint256 amount) private {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        $.lbtc.transferFrom(owner, address(this), amount);
    }

    function _getLbtcMaximumFee() private view returns (uint256) {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        return $.lbtc.getMintFee();
    }

    function _transferFee(address owner, uint256 amount) private {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        address treasury = $.lbtc.getTreasury();
        $.lbtc.transfer(treasury, amount);
    }

    function _allowToVault(address depositor, uint256 amount) private {
        StakeAndBakeStorage storage $ = _getStakeAndBakeStorage();
        $.lbtc.approve(depositor, amount);
    }
}
