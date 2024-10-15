// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library Actions {
    struct DepositBtcAction {
        uint256 toChain;
        address recipient;
        uint256 amount;
        bytes bitcoinData;
    }

    struct DepositBridgeAction {
        uint256 fromChain;
        address fromContract;
        uint256 toChain;
        address toContract;
        address recipient;
        uint256 amount;
        bytes uniqueActionData;
    }

    struct ValSetAction {
        uint256 epoch;
        address[] validators;
        uint256[] weights;
        uint256 weightThreshold;
        uint256 height;
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

    // bytes4(keccak256("payload(bytes32,bytes32,uint64,bytes32,uint32)"))
    bytes4 internal constant DEPOSIT_BTC_ACTION = 0xf2e73f7c;
    // bytes4(keccak256("payload(bytes32,bytes32,bytes32,bytes32,bytes32,uint64,bytes32,uint32)"))
    bytes4 internal constant DEPOSIT_BRIDGE_ACTION = 0xb6c68fd9;
    // bytes4(keccak256("payload(uint256,uint256,tuple[])"))
    bytes4 internal constant NEW_VALSET = 0x1c455e4f;

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
     * @notice Returns decoded deposit btc msg
     * @dev Message should not contain the selector
     * @param msg Body of the mint payload
     */
    function depositBtc(bytes memory msg) internal view returns (DepositBtcAction memory) {
        (
            uint256 toChain,
            address recipient,
            uint256 amount,
            bytes memory bitcoinData // txid || vout
        ) = abi.decode(
            msg,
            (uint256, address, uint256, bytes)
        );

        if (toChain != block.chainid) {
            revert WrongChainId();
        }
        if (recipient == address(0)) {
            revert ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        return DepositBtcAction(toChain, recipient, amount, bitcoinData);
    }

    /**
     * @notice Returns decoded bridge payload
     * @dev Payload should not contain the selector
     * @param payload Body of the burn payload
     */
    function depositBridge(bytes memory payload) internal view returns (DepositBridgeAction memory) {
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

        return DepositBridgeAction(fromChain, fromContract, toChain, toContract, recipient, amount, uniqueActionData);
    }

    /**
     * @notice Returns decoded validator set
     * @dev Payload should not contain the selector
     * @param payload Body of the set validators set payload
     */
    function validateValSet(bytes memory payload) internal pure returns (ValSetAction memory) {

        (
            uint256 epoch,
            bytes[] memory pubKeys,
            uint256[] memory weights,
            uint256 weightThreshold,
            uint256 height
        ) = abi.decode(payload, (uint256, bytes[], uint256[], uint256, uint256));

        if(pubKeys.length < MIN_VALIDATOR_SET_SIZE || pubKeys.length > MAX_VALIDATOR_SET_SIZE) 
            revert InvalidValidatorSetSize();  

        if(pubKeys.length != weights.length) 
            revert LengthMismatch();

        if(weightThreshold == 0)
            revert InvalidThreshold();

        uint256 sum = 0;
        for(uint256 i; i < weights.length;) {
            if(weights[i] == 0) { 
                revert ZeroWeight();
            }
            sum += weights[i];
            unchecked { ++i; }
        }
        if(sum < weightThreshold)
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

        return ValSetAction(epoch, validators, weights, weightThreshold, height);
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