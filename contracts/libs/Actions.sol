// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library Actions {
    struct MintAction {
        uint256 toChain;
        address toContract;
        address recipient;
        uint256 amount;
        bytes uniqueActionData;
    }

    struct BurnAction {
        uint256 fromChain;
        address fromContract;
        uint256 toChain;
        address toContract;
        address recipient;
        uint256 amount;
        bytes uniqueActionData;
    }

    struct ValidatorSetAction {
        address[] validators;
        uint256[] weights;
        uint256 threshold;
        uint256 epoch;
    }

    /// @dev Error thrown when invalid public key is provided
    error InvalidPublicKey(bytes pubKey);

    /// @dev Error thrown when signatures length is not equal to signers length
    error LengthMismatch();

    /// @dev Error thrown when threshold is invalid
    error InvalidThreshold();

    /// @dev Error thrown when validator set size is invalid
    error InvalidValidatorSetSize();

    /// @dev Error thrown when validator set is not increasing
    error NotIncreasingValidatorSet();

    /// @dev Error thrown when zero validator is provided
    error ZeroValidator();

    /// @dev Error thrown when wrong chain id is provided
    error WrongChainId();

    /// @dev Error thrown when wrong contract is provided
    error WrongContract();

    /// @dev Error thrown when zero address is provided
    error ZeroAddress();

    /// @dev Error thrown when zero amount is provided
    error ZeroAmount();

    /// @dev Error thrown when zero weight is provided
    error ZeroWeight();

    // bytes4(keccak256("mint(uint256,address,address,uint256,bytes)"))
    bytes4 internal constant MINT_ACTION = 0x2adfefeb;
    // bytes4(keccak256("burn(uint256,address,uint256,address,address,uint256,bytes)"))
    bytes4 internal constant BURN_ACTION = 0xca2443c0;
    // bytes4(keccak256("setValidators(bytes[],uint256[],uint256,uint256)"))
    bytes4 internal constant SET_VALIDATORS_ACTION = 0x8ece3b88;

     /// @dev Maximum number of validators allowed in the consortium.
    /// @notice This value is determined by the minimum of CometBFT consensus limitations and gas considerations:
    /// - CometBFT has a hard limit of 10,000 validators (https://docs.cometbft.com/v0.38/spec/core/state)
    /// - Gas-based calculation:
    ///   - Assumes 4281 gas per ECDSA signature verification
    ///   - Uses a conservative 30 million gas block limit
    ///   - Maximum possible signatures: 30,000,000 / 4,281 ≈ 7007
    ///   - Reverse calculated for BFT consensus (2/3 + 1):
    ///     7,007 = (10,509 * 2/3 + 1) rounded down
    /// - The lower value of 10,000 (CometBFT limit) and 10,509 (gas calculation) is chosen
    /// @dev This limit ensures compatibility with CometBFT while also considering gas limitations
    ///      for signature verification within a single block.
    uint256 private constant MAX_VALIDATOR_SET_SIZE = 102;

    /// @dev Minimum number of validators allowed in the system.
    /// @notice While set to 1 to allow for non-distributed scenarios, this configuration
    /// does not provide Byzantine fault tolerance. For a truly distributed and
    /// fault-tolerant system, a minimum of 4 validators would be recommended to tolerate
    /// at least one Byzantine fault.
    /// @dev TODO: Review if needed
    uint256 private constant MIN_VALIDATOR_SET_SIZE = 1;

    /**
     * @notice Returns decoded mint payload
     * @dev Payload should not contain the selector
     * @param payload Body of the mint payload
     */
    function mint(bytes memory payload) internal view returns (MintAction memory) {
        (
            uint256 toChain, 
            address toContract, 
            address recipient, 
            uint256 amount, 
            bytes memory uniqueActionData
        ) = abi.decode(
            payload, 
            (uint256, address, address, uint256, bytes)
        );

        if (toChain != block.chainid) {
            revert WrongChainId();
        }
        if (toContract != address(this)) {
            revert WrongContract();
        }
        if (recipient == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        return MintAction(toChain, toContract, recipient, amount, uniqueActionData);
    }

    /**
     * @notice Returns decoded burn payload
     * @dev Payload should not contain the selector
     * @param payload Body of the burn payload
     */
    function burn(bytes memory payload) internal view returns (BurnAction memory) {
        (   
            uint256 fromChain, 
            address fromContract, 
            uint256 toChain, 
            address toContract, 
            address recipient, 
            uint256 amount, 
            bytes memory uniqueActionData
        ) = abi.decode(
            payload, 
            (uint256, address, uint256, address, address, uint256, bytes)
        );

        if (toChain != block.chainid) {
            revert WrongChainId();
        }
        if (toContract != address(this)) {
            revert WrongContract();
        }
        if (recipient == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        return BurnAction(fromChain, fromContract, toChain, toContract, recipient, amount, uniqueActionData);
    }

    /**
     * @notice Returns decoded validator set
     * @dev Payload should not contain the selector
     * @param payload Body of the set validators set payload
     */
    function setValidatorSet(bytes memory payload) internal pure returns (ValidatorSetAction memory) {
        (
            bytes[] memory pubKeys, 
            uint256[] memory weights, 
            uint256 threshold,
            uint256 epoch
        ) = abi.decode(payload, (bytes[], uint256[], uint256, uint256));

        return validateValidatorSet(pubKeys, weights, threshold, epoch);
    }

    function validateValidatorSet(bytes[] memory pubKeys, uint256[] memory weights, uint256 threshold, uint256 epoch) internal pure returns (ValidatorSetAction memory) {
        if(pubKeys.length < MIN_VALIDATOR_SET_SIZE || pubKeys.length > MAX_VALIDATOR_SET_SIZE) 
            revert InvalidValidatorSetSize();  

        if(pubKeys.length != weights.length) 
            revert LengthMismatch();

        if(threshold == 0) 
            revert InvalidThreshold();

        uint256 sum = 0;
        for(uint256 i; i < weights.length;) {
            if(weights[i] == 0) { 
                revert ZeroWeight();
            }
            sum += weights[i];
            unchecked { ++i; }
        }
        if(sum < threshold) 
            revert InvalidThreshold();

        address[] memory validators = pubKeysToAddress(pubKeys);

        address curValidator = validators[0];
        if(curValidator == address(0)) revert ZeroValidator();
        for(uint256 i = 1; i < validators.length;) {
            if(curValidator <= validators[i]) {
                revert NotIncreasingValidatorSet();
            }
            curValidator = validators[i];
            unchecked { ++i; }
        }

        return ValidatorSetAction(validators, weights, threshold, epoch);
    }

    function pubKeysToAddress(bytes[] memory _pubKeys) internal pure returns (address[] memory) {
        address[] memory addresses = new address[](_pubKeys.length);
        for(uint256 i; i < _pubKeys.length;) {
            if(_pubKeys[i].length != 64) {
                revert InvalidPublicKey(_pubKeys[i]);
            }
            addresses[i] = address(uint160(uint256(keccak256(_pubKeys[i]))));
            unchecked { ++i; }
        }
        return addresses;
    }
}