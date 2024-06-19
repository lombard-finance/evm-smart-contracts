// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC20Upgradeable, IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import { BitcoinUtils, OutputType } from "../libs/BitcoinUtils.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import "./ILBTC.sol";
import "../libs/OutputCodec.sol";
import "../libs/EIP1271SignatureUtils.sol";
import "../libs/EthereumVerifier.sol";
import "../libs/ProofParser.sol";

/**
 * @title ERC20 representation of Lombard Staked Bitcoin
 * @author Lombard.Finance
 * @notice The contracts is a part of Lombard.Finace protocol
 */
contract LBTC is ILBTC, ERC20PausableUpgradeable, Ownable2StepUpgradeable, ReentrancyGuardUpgradeable {

    /// @custom:storage-location erc7201:lombardfinance.storage.LBTC
    struct LBTCStorage {
        mapping(bytes32 => bool) usedProofs;

        string name;
        string symbol;

        bool isWithdrawalsEnabled;
        address consortium;
        bool isWBTCEnabled;

        IERC20 wbtc;
        address treasury;
        mapping(uint256 => address) destinations;
        mapping(uint256 => uint16) depositCommission;
        mapping(bytes32 => bool) usedBridgeProofs;
        uint256 globalNonce;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.LBTC")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant LBTC_STORAGE_LOCATION = 0xa9a2395ec4edf6682d754acb293b04902817fdb5829dd13adb0367ab3a26c700;
    uint16 public constant MAX_COMMISSION = 10000; // 100.00%

    function _getLBTCStorage() private pure returns (LBTCStorage storage $) {
        assembly {
            $.slot := LBTC_STORAGE_LOCATION
        }
    }

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function __LBTC_init(string memory name_, string memory symbol_, address consortium_) internal onlyInitializing {
        _changeNameAndSymbol(name_, symbol_);
        _changeConsortium(consortium_);
    }

    function initialize(address consortium_) external initializer {
        __ERC20_init("LBTC", "LBTC");
        __ERC20Pausable_init();

        __Ownable_init(_msgSender());
        __Ownable2Step_init();

        __ReentrancyGuard_init();

        __LBTC_init("Lombard Staked Bitcoin", "LBTC", consortium_);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function changeWBTC(address wbtc_) external onlyOwner {
        if (wbtc_ == address(0)) {
            revert ZeroAddress();
        }

        uint8 expectedDecimals = decimals();
        uint8 tokenDecimals = IERC20Metadata(wbtc_).decimals();

        if (expectedDecimals != tokenDecimals) {
            revert WBTCDecimalsMissmatch(expectedDecimals, tokenDecimals);
        }

        LBTCStorage storage $ = _getLBTCStorage();
        emit WBTCChanged(address($.wbtc), wbtc_);
        $.wbtc = IERC20(wbtc_);
    }

    function enableWBTCStaking() external onlyOwner {
        LBTCStorage storage $ = _getLBTCStorage();
        bool isEnabled = $.isWBTCEnabled;
        if (!isEnabled && address($.wbtc) == address(0)) {
            revert WBTCNotSet();
        }
        $.isWBTCEnabled = !isEnabled;
        emit WBTCStakingEnabled($.isWBTCEnabled);
    }

    function toggleWithdrawals() external onlyOwner {
        LBTCStorage storage $ = _getLBTCStorage();
        $.isWithdrawalsEnabled = !$.isWithdrawalsEnabled;
        emit WithdrawalsEnabled($.isWithdrawalsEnabled);
    }

    function changeNameAndSymbol(string calldata name_, string calldata symbol_) external onlyOwner {
        _changeNameAndSymbol(name_, symbol_);
    }

    function _changeNameAndSymbol(string memory name_, string memory symbol_) internal {
        LBTCStorage storage $ = _getLBTCStorage();
        $.name = name_;
        $.symbol = symbol_;
        emit NameAndSymbolChanged(name_, symbol_);
    }

    function changeConsortium(address newVal) external onlyOwner {
        _changeConsortium(newVal);
    }

    function _changeConsortium(address newVal) internal {
        if (newVal == address(0)) {
            revert ZeroAddress();
        }
        LBTCStorage storage $ = _getLBTCStorage();
        emit ConsortiumChanged($.consortium, newVal);
        $.consortium = newVal;
    }

    function stakeWBTC(uint256 amount) external nonReentrant {
        _stakeWBTC(amount, _msgSender());
    }

    function stakeWBTCFor(uint256 amount, address to) external nonReentrant {
        _stakeWBTC(amount, to);
    }

    function _stakeWBTC(uint256 amount, address to) internal {
        LBTCStorage storage $ = _getLBTCStorage();
        if (!$.isWBTCEnabled) {
            revert WBTCStakingDisabled();
        }
        SafeERC20.safeTransferFrom($.wbtc, _msgSender(), address(this), amount);
        _mint(to, amount);
        emit WBTCStaked(_msgSender(), to, amount);
    }

    function mint(
        bytes calldata data,
        bytes memory proofSignature
    ) external nonReentrant {
        LBTCStorage storage $ = _getLBTCStorage();

        bytes32 proofHash = keccak256(data);

        if ($.usedProofs[proofHash]) {
            revert ProofAlreadyUsed();
        }

        // we can trust data only if proof is signed by Consortium
        EIP1271SignatureUtils.checkSignature($.consortium, proofHash, proofSignature);
        // We can save the proof, because output with index in unique pair
        $.usedProofs[proofHash] = true;

        // parse deposit
        OutputWithPayload memory output = OutputCodec.decode(data);

        // verify chainId
        uint256 chainId = block.chainid;
        if (chainId != output.chainId) {
            revert BadChainId(chainId, output.chainId);
        }

        // verify amount
        if (output.amount == 0) {
            revert ZeroAmount();
        }

        _mint(output.to, uint256(output.amount));

        emit OutputProcessed(output.txId, output.index, proofHash);
    }

    /**
     * @dev Burns LBTC to initiate withdrawal of BTC to provided `scriptPubkey` with `amount`
     * 
     * @param scriptPubkey scriptPubkey for output
     * @param amount Amount of LBTC to burn
     */
    function burn(bytes calldata scriptPubkey, uint256 amount) external {
        OutputType outType = BitcoinUtils.getOutputType(scriptPubkey);

        if (outType == OutputType.UNSUPPORTED) {
            revert ScriptPubkeyUnsupported();
        }

        LBTCStorage storage $ = _getLBTCStorage();

        if (!$.isWithdrawalsEnabled) {
            revert WithdrawalsDisabled();
        }

        address fromAddress = address(_msgSender());
        _burn(fromAddress, amount);

        emit UnstakeRequest(
            fromAddress,
            scriptPubkey,
            amount
        );
    }

    function isUsed(bytes32 proof) external view returns (bool) {
        return _getLBTCStorage().usedProofs[proof];
    }

    function consortium() external view virtual returns (address) {
        return _getLBTCStorage().consortium;
    }

    function WBTC() external view returns (IERC20) {
        return _getLBTCStorage().wbtc;
    }

    /**
     * @dev Returns the number of decimals used to get its user representation.
     *
     * Because LBTC repsents BTC we use the same decimals.
     *
     */
    function decimals() public override view virtual returns (uint8) {
        return 8;
    }

    /**
     * @dev Returns the name of the token.
     */
    function name() public override view virtual returns (string memory) {
        return _getLBTCStorage().name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public override view virtual returns (string memory) {
        return _getLBTCStorage().symbol;
    }

    // --- Bridge ---
    function depositToBridge(uint256 toChain, address toAddress, uint256 amount) external override nonReentrant whenNotPaused {
        if (getDestination(toChain) != address(0)) {
            _depositEVM(toChain, toAddress, amount);
        } else revert UnknownDestination();
    }
    /**
     * @dev Tokens on source and destination chains are linked with independent supplies.
     * Burns tokens on source chain (to later mint on destination chain).
     * @param toChain one of many destination chain ID.
     * @param toAddress claimer of 'totalAmount' on destination chain.
     * @param totalAmount amout of tokens to be bridged.
     */
    function _depositEVM(uint256 toChain, address toAddress, uint256 totalAmount) internal {
        uint256 fee = Math.mulDiv(
            totalAmount,
            getDepositCommission(toChain),
            MAX_COMMISSION,
            Math.Rounding.Ceil
        );

        address fromAddress = msg.sender;
        _transfer(fromAddress, getTreasury(), fee);
        uint256 amountWithoutFee = totalAmount - fee;
        _burn(fromAddress, amountWithoutFee);

        emit DepositToBridge(
            toChain, fromAddress, toAddress, address(this),
            getDestination(toChain), amountWithoutFee, _incrementNonce());
    }

    function withdrawFromBridge(bytes calldata, /* encodedProof */ bytes calldata rawReceipt, bytes memory proofSignature) external override nonReentrant whenNotPaused {
        uint256 proofOffset;
        uint256 receiptOffset;
        assembly {
            proofOffset := add(0x4, calldataload(4))
            receiptOffset := add(0x4, calldataload(36))
        }
        /* we must parse and verify that tx and receipt matches */
        (EthereumVerifier.State memory state, EthereumVerifier.PegInType pegInType) = EthereumVerifier.parseTransactionReceipt(receiptOffset);

        if (state.chainId != block.chainid) {
            revert BadChainId(block.chainid, state.chainId);
        }

        ProofParser.Proof memory proof = ProofParser.parseProof(proofOffset);
        if (state.contractAddress == address(0)) {
            revert InvalidContractAddress();
        }

        if (getDestination(proof.chainId) != state.contractAddress) {
            revert EventFromUnknownContract();
        }
        if (state.contractAddress != state.fromToken) {
            revert BadFromToken();
        }

        state.receiptHash = keccak256(rawReceipt);
        proof.status = 0x01;
        proof.receiptHash = state.receiptHash;

        bytes32 proofHash;
        assembly {
            proofHash := keccak256(proof, 0x100)
        }

        LBTCStorage storage $ = _getLBTCStorage();


        // we can trust receipt only if proof is signed by consortium
        EIP1271SignatureUtils.checkSignature($.consortium, proofHash, proofSignature);

        if ($.usedBridgeProofs[proofHash]) {
            revert ProofAlreadyUsed();
        }
        $.usedBridgeProofs[proofHash] = true;

        _withdraw(state, pegInType);
    }

    function _withdraw(EthereumVerifier.State memory state, EthereumVerifier.PegInType pegInType) internal {
        if (pegInType == EthereumVerifier.PegInType.Bridged) {
            _mint(state.toAddress, state.totalAmount);
            emit WithdrawFromBridge(state.receiptHash, state.fromAddress, state.toAddress, state.fromToken, state.toToken, state.totalAmount);
        } else revert InvalidType();
    }


    function _incrementNonce() internal returns (uint256) {
        LBTCStorage storage $ = _getLBTCStorage();
        $.globalNonce += 1;
        return $.globalNonce;
    }

    function addDestination(uint256 toChain, address toToken, uint16 commission) external onlyOwner {
        if (toToken == address(0)) {
            revert ZeroAddress();
        }
        LBTCStorage storage $ = _getLBTCStorage();
        if ($.destinations[toChain] != address(0)) {
            revert KnownDestination();
        }
        $.destinations[toChain] = toToken;
        $.depositCommission[toChain] = commission;
        emit DepositCommissionChanged(commission, toChain);
        emit BridgeDestinationAdded(toChain, toToken);
    }

    function removeDestination(uint256 toChain) external onlyOwner {
        LBTCStorage storage $ = _getLBTCStorage();
        address toToken = $.destinations[toChain];
        if (toToken == address(0)) {
            revert ZeroAddress();
        }
        delete $.destinations[toChain];
        delete $.depositCommission[toChain];

        emit BridgeDestinationRemoved(toChain, toToken);
    }


    /**
     * @dev Get destination token for bridging for chainId
     *
     * @param chain Id of the destination chain
     */
    function getDestination(uint256 chain) public view returns (address) {
        return _getLBTCStorage().destinations[chain];
    }

    function getTreasury() public view returns (address) {
        return _getLBTCStorage().treasury;
    }

    function getDepositCommission(uint256 toChain)
    public
    view
    returns (uint16 commission)
    {
        LBTCStorage storage $ = _getLBTCStorage();
        commission = $.depositCommission[toChain];
    }

    function changeDepositCommission(uint16 newValue, uint256 chain)
    external
    onlyOwner
    {
        if (newValue > MAX_COMMISSION) {
            revert BadCommission();
        }
        LBTCStorage storage $ = _getLBTCStorage();
        $.depositCommission[chain] = newValue;
        emit DepositCommissionChanged(newValue, chain);
    }

    function changeTreasuryAddress(address newValue)
    external
    onlyOwner
    {
        if (newValue == address(0)) {
            revert ZeroAddress();
        }
        LBTCStorage storage $ = _getLBTCStorage();
        address prevValue = $.treasury;
        $.treasury = newValue;
        emit TreasuryAddressChanged(prevValue, newValue);
    }
}
