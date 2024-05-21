// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { ERC20Upgradeable, IERC20 } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC20PausableUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "./ILBTC.sol";
import "../libs/OutputCodec.sol";
import "../libs/EIP1271SignatureUtils.sol";

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
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.LBTC")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant LBTC_STORAGE_LOCATION = 0xa9a2395ec4edf6682d754acb293b04902817fdb5829dd13adb0367ab3a26c700;

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
        LBTCStorage storage $ = _getLBTCStorage();
        _changeNameAndSymbol(name_, symbol_);
        $.consortium = consortium_;
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

    function stake(uint256 amount) external nonReentrant {
        _stake(amount, _msgSender());
    }

    function stakeFor(uint256 amount, address to) external nonReentrant {
        _stake(amount, to);
    }

    function _stake(uint256 amount, address to) internal {
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
     * @dev Burns LBTC to initiate withdrawal of BTC to provided `script` with `amount`
     * 
     * @param btcAddress BigEndian Bitcoin ScriptPubKey address
     * @param amount Amount of LBTC to burn
     */
    function burn(bytes32 btcAddress, uint256 amount) external {
        LBTCStorage storage $ = _getLBTCStorage();

        if (!$.isWithdrawalsEnabled) {
            revert WithdrawalsDisabled();
        }

        address fromAddress = address(_msgSender());
        _burn(fromAddress, amount);

        emit UnstakeRequest(
            fromAddress,
            btcAddress,
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
}
