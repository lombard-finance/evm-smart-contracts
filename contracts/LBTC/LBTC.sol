// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

// Uncomment this line to use console.log
import "hardhat/console.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "./ILBTC.sol";
import "../libs/DepositDataCodec.sol";
import "../libs/EIP1271SignatureUtils.sol";

/**
 * @title ERC20 representation of Lombard Staked Bitcoin
 * @author Lombard.Finance
 * @notice The contracts is a part of Lombard.Finace protocol
 */
contract LBTC is ILBTC, ERC20PausableUpgradeable, Ownable2StepUpgradeable, ReentrancyGuardUpgradeable {

    /// @custom:storage-location erc7201:lombardfinance.storage.LBTC
    struct LBTCStorage {
        uint256 _globalNonce;

        mapping(bytes32 => bool) _usedProofs;

        string _name;
        string _symbol;

        bool isWithdrawalsEnabled;
    }

    // keccak256(abi.encode(uint256(keccak256("lombardfinance.storage.LBTC")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 private constant LBTCStorageLocation = 0xa9a2395ec4edf6682d754acb293b04902817fdb5829dd13adb0367ab3a26c700;

    function _getLBTCStorage() private pure returns (LBTCStorage storage $) {
        assembly {
            $.slot := LBTCStorageLocation
        }
    }

    /// @dev https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable#initializing_the_implementation_contract
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function __LBTC_init(string memory name_, string memory symbol_) internal onlyInitializing {
        LBTCStorage storage $ = _getLBTCStorage();
        $._name = name_;
        $._symbol = symbol_;
    }

    function initialize(address consortium_) external initializer {
        __ERC20_init("LBTC", "LBTC");
        __ERC20Pausable_init();

        __Ownable_init(consortium_);
        __Ownable2Step_init();

        __ReentrancyGuard_init();

        __LBTC_init("Lombard Staked Bitcoin", "LBTC");
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function toggleWithdrawals() external onlyOwner {
        LBTCStorage storage $ = _getLBTCStorage();
        $.isWithdrawalsEnabled = !$.isWithdrawalsEnabled;
        emit WithdrawalsEnabled($.isWithdrawalsEnabled);
    }

    function changeNameAndSymbol(string calldata name_, string calldata symbol_) external onlyOwner {
        _changeNameAndSymbol(name_, symbol_);
    }

    function _changeNameAndSymbol(string calldata name_, string calldata symbol_) internal {
        LBTCStorage storage $ = _getLBTCStorage();
        $._name = name_;
        $._symbol = symbol_;
        emit NameAndSymbolChanged(name_, symbol_);
    }

    function mint(
        bytes calldata data,
        bytes memory proofSignature
    ) external nonReentrant {
        LBTCStorage storage $ = _getLBTCStorage();

        bytes32 proofHash = keccak256(data);

        // The problem is if we will change signer its open ability to reuse same signatures
        // But Consortium save signature forever and it will not be changed if we change signer
        bytes32 signatureHash = keccak256(proofSignature);

        if ($._usedProofs[signatureHash]) {
            revert ProofAlreadyUsed();
        }

        // we can trust data only if proof is signed by Consortium
        EIP1271SignatureUtils.checkSignature(owner(), proofHash, proofSignature);
        $._usedProofs[signatureHash] = true;

        // parse deposit
        DepositData memory depositData = DepositDataCodec.decode(data);

        // verify chainId
        uint256 chainId = block.chainid;
        if (chainId != depositData.chainId) {
            revert BadChainId(chainId, depositData.chainId);
        }

        // verify amount
        if (depositData.amount == 0) {
            revert ZeroAmount();
        }

        _mint(depositData.to, uint256(depositData.amount));
    }

    /**
     * @dev Burns LBTC to initiate withdrawal of BTC to provided `script` with `amount`
     * 
     * @param script BigEndian Bitcoin ScriptPubKey address
     * @param amount Amount of LBTC to burn
     */
    function burn(bytes32 script, uint256 amount) external {
        LBTCStorage storage $ = _getLBTCStorage();

        if (!$.isWithdrawalsEnabled) {
            revert WithdrawalsDisabled();
        }

        // TODO: verify script

        address fromAddress = address(_msgSender());
        _burn(fromAddress, amount);

        emit Burned(
            fromAddress,
            script,
            amount,
            $._globalNonce++
        );
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
        return _getLBTCStorage()._name;
    }

    /**
     * @dev Returns the symbol of the token, usually a shorter version of the
     * name.
     */
    function symbol() public override view virtual returns (string memory) {
        return _getLBTCStorage()._symbol;
    }
}
