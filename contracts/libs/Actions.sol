// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library Actions {
    struct DepositBtcAction {
        uint256 toChain;
        address recipient;
        uint256 amount;
        bytes32 txid;
        uint32 vout;
    }

    struct DepositBridgeAction {
        uint256 fromChain;
        bytes32 fromContract;
        uint256 toChain;
        address toContract;
        address recipient;
        uint64 amount;
        uint256 nonce;
    }

    struct ValSetAction {
        uint256 epoch;
        address[] validators;
        uint256[] weights;
        uint256 weightThreshold;
        uint256 height;
    }

    struct FeeApprovalAction {
        uint256 fee;
        uint256 expiry;
    }

    /// @dev Error thrown when invalid public key is provided
    error InvalidPublicKey(bytes pubKey);

    /// @dev Error thrown when signatures length is not equal to signers length
    error Actions_LengthMismatch();

    /// @dev Error thrown when threshold is invalid
    error InvalidThreshold();

    /// @dev Error thrown when validator set size is invalid
    error InvalidValidatorSetSize();

    /// @dev Error thrown when zero validator is provided
    error ZeroValidator();

    /// @dev Error thrown when wrong chain id is provided
    error WrongChainId();

    /// @dev Error thrown when wrong contract is provided
    error WrongContract();

    /// @dev Error thrown when zero address is provided
    error Actions_ZeroAddress();

    /// @dev Error thrown when zero amount is provided
    error ZeroAmount();

    /// @dev Error thrown when zero weight is provided
    error ZeroWeight();

    /// @dev Error thrown when fee approval is expired
    error UserSignatureExpired(uint256 expiry);

    /// @dev Error thrown when amount is below fee
    error NotEnoughAmountToUseApproval();

    /// @dev Error thrown when zero fee is used
    error ZeroFee();

    /// @dev Error thrown when payload length is too big
    error PayloadTooLarge();

    // bytes4(keccak256("feeApproval(uint256,uint256)"))
    bytes4 internal constant FEE_APPROVAL_ACTION = 0x8175ca94;
    // keccak256("feeApproval(uint256 chainId,uint256 fee,uint256 expiry)")
    bytes32 internal constant FEE_APPROVAL_EIP712_ACTION =
        0x40ac9f6aa27075e64c1ed1ea2e831b20b8c25efdeb6b79fd0cf683c9a9c50725;
    // bytes4(keccak256("payload(bytes32,bytes32,uint64,bytes32,uint32)"))
    bytes4 internal constant DEPOSIT_BTC_ACTION = 0xf2e73f7c;
    // bytes4(keccak256("payload(bytes32,bytes32,bytes32,bytes32,bytes32,uint64,uint256)"))
    bytes4 internal constant DEPOSIT_BRIDGE_ACTION = 0x5c70a505;
    // bytes4(keccak256("payload(uint256,bytes[],uint256[],uint256,uint256)"))
    bytes4 internal constant NEW_VALSET = 0x4aab1d6f;

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
    uint256 private constant MIN_VALIDATOR_SET_SIZE = 1;

    /// @dev A constant representing the number of bytes for a slot of information in a payload.
    uint256 internal constant ABI_SLOT_SIZE = 32;

    /**
     * @notice Returns decoded deposit btc msg
     * @dev Message should not contain the selector
     * @param payload Body of the mint payload
     */
    function depositBtc(
        bytes memory payload
    ) internal view returns (DepositBtcAction memory) {
        if (payload.length != ABI_SLOT_SIZE * 5) revert PayloadTooLarge();

        (
            uint256 toChain,
            address recipient,
            uint256 amount,
            bytes32 txid,
            uint32 vout
        ) = abi.decode(payload, (uint256, address, uint256, bytes32, uint32));

        if (toChain != block.chainid) {
            revert WrongChainId();
        }
        if (recipient == address(0)) {
            revert Actions_ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        return DepositBtcAction(toChain, recipient, amount, txid, vout);
    }

    /**
     * @notice Returns decoded bridge payload
     * @dev Payload should not contain the selector
     * @param payload Body of the burn payload
     */
    function depositBridge(
        bytes memory payload
    ) internal view returns (DepositBridgeAction memory) {
        if (payload.length != ABI_SLOT_SIZE * 7) revert PayloadTooLarge();

        (
            uint256 fromChain,
            bytes32 fromContract,
            uint256 toChain,
            address toContract,
            address recipient,
            uint64 amount,
            uint256 nonce
        ) = abi.decode(
                payload,
                (uint256, bytes32, uint256, address, address, uint64, uint256)
            );

        if (toChain != block.chainid) {
            revert WrongChainId();
        }
        if (recipient == address(0)) {
            revert Actions_ZeroAddress();
        }
        if (amount == 0) {
            revert ZeroAmount();
        }

        return
            DepositBridgeAction(
                fromChain,
                fromContract,
                toChain,
                toContract,
                recipient,
                amount,
                nonce
            );
    }

    /**
     * @notice Returns decoded validator set
     * @dev Payload should not contain the selector
     * @param payload Body of the set validators set payload
     */
    function validateValSet(
        bytes memory payload
    ) internal pure returns (ValSetAction memory) {
        (
            uint256 epoch,
            bytes[] memory pubKeys,
            uint256[] memory weights,
            uint256 weightThreshold,
            uint256 height
        ) = abi.decode(
                payload,
                (uint256, bytes[], uint256[], uint256, uint256)
            );

        // Since dynamic arrays can variably insert more slots of data for things such as data length,
        // offset etc., we will just encode the received variables again and check for a length match.
        bytes memory reEncodedPayload = abi.encode(
            epoch,
            pubKeys,
            weights,
            weightThreshold,
            height
        );
        if (reEncodedPayload.length != payload.length) revert PayloadTooLarge();

        if (
            pubKeys.length < MIN_VALIDATOR_SET_SIZE ||
            pubKeys.length > MAX_VALIDATOR_SET_SIZE
        ) revert InvalidValidatorSetSize();

        if (pubKeys.length != weights.length) revert Actions_LengthMismatch();

        if (weightThreshold == 0) revert InvalidThreshold();

        uint256 sum = 0;
        for (uint256 i; i < weights.length; ) {
            if (weights[i] == 0) {
                revert ZeroWeight();
            }
            sum += weights[i];
            unchecked {
                ++i;
            }
        }
        if (sum < weightThreshold) revert InvalidThreshold();

        address[] memory validators = pubKeysToAddress(pubKeys);

        return
            ValSetAction(epoch, validators, weights, weightThreshold, height);
    }

    function pubKeysToAddress(
        bytes[] memory _pubKeys
    ) internal pure returns (address[] memory) {
        address[] memory addresses = new address[](_pubKeys.length);
        for (uint256 i; i < _pubKeys.length; ) {
            // each pubkey represented as uncompressed

            if (_pubKeys[i].length == 65) {
                bytes memory data = _pubKeys[i];

                // Ensure that first byte of pubkey is 0x04
                if (_pubKeys[i][0] != 0x04)
                    revert InvalidPublicKey(_pubKeys[i]);

                // create a new array with length - 1 (excluding the first 0x04 byte)
                bytes memory result = new bytes(data.length - 1);

                // use inline assembly for memory manipulation
                assembly {
                    // calculate the start of the `result` and `data` in memory
                    let resultData := add(result, 0x20) // points to the first byte of the result
                    let dataStart := add(data, 0x21) // points to the second byte of data (skip 0x04)

                    // copy 64 bytes from input (excluding the first byte) to result
                    mstore(resultData, mload(dataStart)) // copy the first 32 bytes
                    mstore(add(resultData, 0x20), mload(add(dataStart, 0x20))) // copy the next 32 bytes
                }

                addresses[i] = address(uint160(uint256(keccak256(result))));
            } else {
                revert InvalidPublicKey(_pubKeys[i]);
            }

            unchecked {
                ++i;
            }
        }
        return addresses;
    }

    /**
     * @notice Returns decoded fee approval
     * @dev Payload should not contain the selector
     * @param payload Body of the fee approval payload
     */
    function feeApproval(
        bytes memory payload
    ) internal view returns (FeeApprovalAction memory) {
        if (payload.length != ABI_SLOT_SIZE * 2) revert PayloadTooLarge();

        (uint256 fee, uint256 expiry) = abi.decode(payload, (uint256, uint256));

        if (block.timestamp > expiry) {
            revert UserSignatureExpired(expiry);
        }
        if (fee == 0) {
            revert ZeroFee();
        }

        return FeeApprovalAction(fee, expiry);
    }
}
