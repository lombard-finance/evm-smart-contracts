// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IDepositor} from "./IDepositor.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {TellerWithMultiAssetSupportMock} from "../../mock/TellerWithMultiAssetSupportMock.sol";

/**
 * @title Depositor for the `BoringVault` vault.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
contract TellerWithMultiAssetSupportDepositor is
    IDepositor,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable
{
    /// @dev error thrown when the passed depositAmount is zero
    error ZeroAssets();
    error ApproveFailed();

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();

        __ReentrancyGuard_init();
    }

    /**
     * @notice Deposit function.
     * @param teller The address of the BoringVault's associated teller
     * @param depositPayload The ABI encoded parameters for the vault deposit function
     */
    function deposit(
        address teller,
        bytes calldata depositPayload
    ) external nonReentrant {
        (address owner, address depositAsset, uint256 depositAmount) = abi
            .decode(depositPayload, (address, address, uint256));

        // Take the owner's LBTC.
        ERC20(depositAsset).transferFrom(owner, address(this), depositAmount);

        // Give the vault the needed allowance.
        address vault = this.destination(teller);
        ERC20(depositAsset).approve(vault, depositAmount);

        // Deposit and obtain vault shares.
        uint256 shares = ITeller(teller).deposit(
            ERC20(depositAsset),
            depositAmount,
            0
        );

        // Transfer vault shares to owner.
        ERC20(vault).transfer(owner, shares);
    }

    /**
     * @notice Retrieves the final vault address. Used for granting allowance to the right address.
     */
    function destination(address teller) external returns (address) {
        bytes4 selector = bytes4(keccak256(bytes("vault()")));
        (bool success, bytes memory result) = teller.call(
            abi.encodeWithSelector(selector)
        );
        require(success);
        return abi.decode(result, (address));
    }
}

/**
 * @title An interface over the TellerWithMultiAssetSupport contract.
 * @author Lombard.Finance
 * @notice This contract is part of the Lombard.Finance protocol
 */
interface ITeller {
    function deposit(
        ERC20 depositAsset,
        uint256 depositAmount,
        uint256 minimumMint
    ) external returns (uint256);
}
