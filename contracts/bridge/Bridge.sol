// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Actions} from "../libs/Actions.sol";
import {FeeUtils} from "../libs/FeeUtils.sol";
import {IAdapter} from "./adapters/IAdapter.sol";
import {LBTC} from "../LBTC/LBTC.sol";
import {IBridge} from "./IBridge.sol";

contract Bridge is
    IBridge,
    Ownable2StepUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for LBTC;

    /// @custom:storage-location erc7201:lombardfinance.storage.Bridge
    struct BridgeStorage {
        address treasury;
        LBTC lbtc;
        // Increments with each cross chain operation and should be part of the payload
        uint256 crossChainOperationsNonce;
        mapping(bytes32 => bytes32) destinations;
        mapping(bytes32 => uint16) depositRelativeCommission; // relative to amount commission to charge on bridge deposit
        mapping(bytes32 => uint64) depositAbsoluteCommission; // absolute commission to charge on bridge deposit
        /// @notice Bridge adapter
        IAdapter adapter;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.Bridge")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant BRIDGE_STORAGE_LOCATION =
        0x577a31cbb7f7b010ebd1a083e4c4899bcd53b83ce9c44e72ce3223baedbbb600;
    uint16 private constant MAX_COMMISSION = 10000; // 100.00%

    /// PUBLIC FUNCTIONS ///

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address lbtc_,
        address treasury_,
        address adapter_,
        address owner_
    ) external initializer {
        __Ownable_init(owner_);
        __Ownable2Step_init();
        __ReentrancyGuard_init();

        __Bridge_init(lbtc_, treasury_, adapter_);
    }

    /// GETTERS ///

    function getTreasury() external view returns (address) {
        return _getBridgeStorage().treasury;
    }

    /**
     * @dev Get destination contract for chain id
     * @param chainId Chain id of the destination chain
     */
    function getDestination(bytes32 chainId) public view returns (bytes32) {
        return _getBridgeStorage().destinations[chainId];
    }

    function getDepositAbsoluteCommission(
        bytes32 toChain
    ) public view returns (uint64) {
        return _getBridgeStorage().depositAbsoluteCommission[toChain];
    }

    function getDepositRelativeCommission(
        bytes32 toChain
    ) public view returns (uint16) {
        return _getBridgeStorage().depositRelativeCommission[toChain];
    }

    /**
     * @notice Returns the address of the configured adapter
     */
    function getAdapter() external view returns (IAdapter) {
        return _getBridgeStorage().adapter;
    }

    /// ACTIONS ///

    function deposit(
        bytes32 toChain,
        bytes32 toAddress,
        uint64 amount
    ) external payable nonReentrant returns (uint256, bytes memory) {
        if (toChain == bytes32(0)) {
            revert ZeroChainId();
        }

        bytes32 toContract = getDestination(toChain);

        if (toContract == bytes32(0)) {
            revert UnknownDestination();
        }

        if (toAddress == bytes32(0)) {
            revert ZeroAddress();
        }

        return _deposit(toChain, toContract, toAddress, amount);
    }

    function withdraw(
        bytes calldata payload,
        bytes calldata proof
    ) external nonReentrant {
        BridgeStorage storage $ = _getBridgeStorage();

        // payload validation
        if (bytes4(payload) != Actions.DEPOSIT_BRIDGE_ACTION) {
            revert UnexpectedAction(bytes4(payload));
        }
        Actions.DepositBridgeAction memory action = Actions.depositBridge(
            payload[4:]
        );

        // extra checks
        if (
            $.destinations[bytes32(action.fromChain)] !=
            bytes32(uint256(uint160(action.fromContract))) &&
            action.fromContract != address(0)
        ) {
            revert UnknownOriginContract(
                bytes32(action.fromChain),
                bytes32(uint256(uint160(action.fromContract)))
            );
        }

        bytes32 payloadHash = sha256(payload);
        $.lbtc.withdraw(action, payloadHash, proof);

        emit WithdrawFromBridge(action.recipient, payloadHash, payload);
    }

    /// ONLY OWNER ///

    function addDestination(
        bytes32 toChain,
        bytes32 toContract,
        uint16 relCommission,
        uint64 absCommission
    ) external onlyOwner {
        if (toContract == bytes32(0)) {
            revert ZeroContractHash();
        }
        if (toChain == bytes32(0)) {
            revert ZeroChainId();
        }

        if (getDestination(toChain) != bytes32(0)) {
            revert KnownDestination();
        }
        // do not allow 100% commission or higher values
        FeeUtils.validateCommission(relCommission);

        BridgeStorage storage $ = _getBridgeStorage();
        $.destinations[toChain] = toContract;
        $.depositRelativeCommission[toChain] = relCommission;
        $.depositAbsoluteCommission[toChain] = absCommission;

        emit DepositAbsoluteCommissionChanged(absCommission, toChain);
        emit DepositRelativeCommissionChanged(relCommission, toChain);
        emit BridgeDestinationAdded(toChain, toContract);
    }

    function removeDestination(bytes32 toChain) external onlyOwner {
        _validDestination(toChain);

        BridgeStorage storage $ = _getBridgeStorage();
        bytes32 toContract = $.destinations[toChain];
        delete $.destinations[toChain];
        delete $.depositRelativeCommission[toChain];
        delete $.depositAbsoluteCommission[toChain];

        emit DepositAbsoluteCommissionChanged(0, toChain);
        emit DepositRelativeCommissionChanged(0, toChain);
        emit BridgeDestinationRemoved(toChain, toContract);
    }

    function changeDepositAbsoluteCommission(
        uint64 newValue,
        bytes32 chain
    ) external onlyOwner {
        _validDestination(chain);

        BridgeStorage storage $ = _getBridgeStorage();
        $.depositAbsoluteCommission[chain] = newValue;
        emit DepositAbsoluteCommissionChanged(newValue, chain);
    }

    function changeDepositRelativeCommission(
        uint16 newValue,
        bytes32 chain
    ) external onlyOwner {
        _validDestination(chain);

        FeeUtils.validateCommission(newValue);

        BridgeStorage storage $ = _getBridgeStorage();
        $.depositRelativeCommission[chain] = newValue;
        emit DepositRelativeCommissionChanged(newValue, chain);
    }

    function changeAdapter(address newAdapter) external onlyOwner {
        _changeAdapter(newAdapter);
    }

    /// PRIVATE FUNCTIONS ///

    function __Bridge_init(
        address lbtc_,
        address treasury_,
        address adapter_
    ) internal onlyInitializing {
        _changeTreasury(treasury_);
        _changeAdapter(adapter_);

        BridgeStorage storage $ = _getBridgeStorage();
        $.lbtc = LBTC(lbtc_);
    }

    function _changeTreasury(address treasury_) internal {
        BridgeStorage storage $ = _getBridgeStorage();
        address previousTreasury = $.treasury;
        $.treasury = treasury_;
        emit TreasuryChanged(previousTreasury, treasury_);
    }

    function _changeAdapter(address newAdapter) internal {
        if (newAdapter == address(0)) {
            revert ZeroAddress();
        }
        BridgeStorage storage $ = _getBridgeStorage();
        address previousAdapter = address($.adapter);
        $.adapter = IAdapter(newAdapter);
        emit AdapterChanged(previousAdapter, newAdapter);
    }

    /**
     * @dev LBTC on source and destination chains are linked with independent supplies.
     * Burns tokens on source chain (to later mint on destination chain).
     * @param toChain one of many destination chain ID.
     * @param toAddress claimer of 'amount' on destination chain.
     * @param amount amount of tokens to be bridged.
     */
    function _deposit(
        bytes32 toChain,
        bytes32 toContract,
        bytes32 toAddress,
        uint64 amount
    ) internal returns (uint256, bytes memory) {
        BridgeStorage storage $ = _getBridgeStorage();

        // relative fee
        uint256 fee = FeeUtils.getRelativeFee(
            amount,
            getDepositRelativeCommission(toChain)
        );
        // absolute fee
        fee += $.depositAbsoluteCommission[toChain];

        if (fee >= amount) {
            revert AmountLessThanCommission(fee);
        }

        address fromAddress = _msgSender();
        uint256 amountWithoutFee = amount - fee;
        {
            LBTC lbtc = $.lbtc;
            lbtc.safeTransferFrom(fromAddress, $.treasury, fee);
            // adapter will handle the burn
            lbtc.safeTransferFrom(
                fromAddress,
                address($.adapter),
                amountWithoutFee
            );
        }

        // prepare burn payload
        bytes memory payload = abi.encodeWithSelector(
            Actions.DEPOSIT_BRIDGE_ACTION,
            block.chainid,
            address(this),
            toChain,
            toContract,
            toAddress,
            amountWithoutFee,
            bytes32($.crossChainOperationsNonce++)
        );

        $.adapter.deposit{
            value: $.adapter.getFee(
                toChain,
                toContract,
                toAddress,
                amountWithoutFee,
                payload
            )
        }(
            fromAddress,
            toChain,
            toContract,
            toAddress,
            amountWithoutFee,
            payload
        );

        emit DepositToBridge(fromAddress, toAddress, sha256(payload), payload);
        return (amountWithoutFee, payload);
    }

    function _calcRelativeFee(
        uint64 amount,
        uint16 commission
    ) internal pure returns (uint256 fee) {
        return
            Math.mulDiv(amount, commission, MAX_COMMISSION, Math.Rounding.Ceil);
    }

    function _getBridgeStorage()
        private
        pure
        returns (BridgeStorage storage $)
    {
        assembly {
            $.slot := BRIDGE_STORAGE_LOCATION
        }
    }

    function _validDestination(bytes32 chain) internal view {
        BridgeStorage storage $ = _getBridgeStorage();
        if ($.destinations[chain] == bytes32(0)) {
            revert NotValidDestination();
        }
    }
}
