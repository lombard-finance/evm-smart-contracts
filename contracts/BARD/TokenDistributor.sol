// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TokenDistributor is Ownable2Step {
    using SafeERC20 for IERC20;

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /// @notice Emitted when a user claims tokens.
    /// @param user The user address.
    /// @param amount The amount of tokens claimed.
    event Claimed(address indexed user, uint256 amount);

    /// @notice Emitted when the owner withdraws tokens.
    /// @param owner The owner address.
    /// @param amount The amount of tokens withdrawn.
    event Withdrawn(address indexed owner, uint256 amount);

    /// @notice Emitted when the owner changes the vault.
    /// @param oldVault The address of old vault.
    /// @param newVault The address of new vault.
    event VaultChanged(address indexed oldVault, address indexed newVault);

    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    error InvalidAmount();
    error AlreadyClaimed();
    error InvalidProof();
    error InvalidToken();
    error InvalidMerkleRoot();
    error EmptyProof();
    error ClaimFinished();
    error ClaimNotFinished();
    error StakingNotEnabled();

    /*//////////////////////////////////////////////////////////////
                           IMMUTABLE STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice The merkle root hash.
    bytes32 public immutable MERKLE_ROOT;

    /// @notice The token contract.
    IERC20 public immutable TOKEN;

    /// @notice The timestamp when the claim period ends.
    uint256 public immutable CLAIM_END;

    /// @notice The vault to deposit token for staking.
    IERC4626 public VAULT;

    /*//////////////////////////////////////////////////////////////
                                STORAGE
    //////////////////////////////////////////////////////////////*/

    /// @notice Mapping of claimed status.
    mapping(address user => bool claimed) public hasClaimed;

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /// @notice Define the merkle root, base signer, token and owner.
    /// @param _merkleRoot The merkle root hash.
    /// @param _token The token address.
    /// @param _owner The owner address.
    /// @param _claimEnd The timestamp when the claim period ends.
    /// @param _vault The address of the vault to be deposit destination in case of claim and stake.
    constructor(
        bytes32 _merkleRoot,
        address _token,
        address _owner,
        uint256 _claimEnd,
        address _vault
    ) Ownable(_owner) {
        if (_token == address(0)) revert InvalidToken();
        if (_merkleRoot == bytes32(0)) revert InvalidMerkleRoot();

        MERKLE_ROOT = _merkleRoot;
        TOKEN = IERC20(_token);
        CLAIM_END = _claimEnd;
        VAULT = IERC4626(_vault);
    }

    /*//////////////////////////////////////////////////////////////
                           EXTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /// @notice Claim tokens using a signature and merkle proof.
    /// @param _account The account to claim tokens for.
    /// @param _amount Amount of tokens to claim.
    /// @param _merkleProof Merkle proof of claim.
    function claim(
        address _account,
        uint256 _amount,
        bytes32[] calldata _merkleProof
    ) external {
        _validateClaim(_account, _amount, _merkleProof);

        // Mark as claimed and send the tokens
        hasClaimed[_account] = true;
        TOKEN.safeTransfer(_account, _amount);

        emit Claimed(_account, _amount);
    }

    /// @notice Claim tokens using a signature and merkle proof and stake them with predefined vault.
    /// @param _account The account to claim tokens for.
    /// @param _amount Amount of tokens to claim.
    /// @param _merkleProof Merkle proof of claim.
    function claimAndStake(
        address _account,
        uint256 _amount,
        bytes32[] calldata _merkleProof
    ) external {
        if (address(VAULT) == address(0)) revert StakingNotEnabled();
        _validateClaim(_account, _amount, _merkleProof);

        // Mark as claimed and send the tokens
        hasClaimed[_account] = true;
        TOKEN.safeIncreaseAllowance(address(VAULT), _amount);
        VAULT.deposit(_amount, _account);

        emit Claimed(_account, _amount);
    }

    /// @notice Withdraw tokens from the contract.
    function withdraw() external onlyOwner {
        if (block.timestamp < CLAIM_END) revert ClaimNotFinished();

        uint256 balance = TOKEN.balanceOf(address(this));
        TOKEN.safeTransfer(msg.sender, balance);

        emit Withdrawn(msg.sender, balance);
    }

    /// @notice Change Vault to stake claimed tokens.
    function changeVault(address _newVault) external onlyOwner {
        address oldVault = address(VAULT);
        VAULT = IERC4626(_newVault);
        emit VaultChanged(oldVault, _newVault);
    }

    /*//////////////////////////////////////////////////////////////
                           INTERNAL FUNCTIONS
    //////////////////////////////////////////////////////////////*/
    function _validateClaim(
        address _account,
        uint256 _amount,
        bytes32[] calldata _merkleProof
    ) internal view {
        if (_amount == 0) revert InvalidAmount();
        if (hasClaimed[_account]) revert AlreadyClaimed();
        if (_merkleProof.length == 0) revert EmptyProof();
        if (block.timestamp >= CLAIM_END) revert ClaimFinished();

        // Generate the leaf
        bytes32 leaf = keccak256(
            bytes.concat(keccak256(abi.encode(_account, _amount)))
        );

        // Verify the merkle proof
        if (!MerkleProof.verify(_merkleProof, MERKLE_ROOT, leaf))
            revert InvalidProof();
    }
}
