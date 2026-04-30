// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {CallVerificationInput, IMerkleCallAllowlist} from "../interfaces/IMerkleCallAllowlist.sol";
import {IStrategyExecValidator} from "../interfaces/IStrategyExecValidator.sol";

/// @title MerkleAllowlistValidator
/// @notice On-chain Merkle-based call-data allowlist validator.
contract MerkleAllowlistValidator is
    Ownable2Step,
    IMerkleCallAllowlist,
    IStrategyExecValidator
{
    /// @dev Upper bound on `constraintCount` for rule version `0x01`.
    uint256 public constant MAX_CONSTRAINTS = 64;

    // ── Rule encoding ────────────────────────────────────────────────────────

    /// @notice Version byte that must appear as byte 0 of every encoded rule.
    uint8 public constant RULE_VERSION = 0x01;

    /// @dev Byte size of the fixed rule header before the constraints array.
    /// Layout: version(1) + flags(1) + sender(20) + to(20) + value(32) + dataLength(4) + constraintCount(2) = 80
    uint256 private constant _RULE_HEADER_SIZE = 80;

    /// @notice Per-constraint byte size: calldataOffset(2) + mask(32) + expected(32) = 66.
    /// Use this to validate the total length of an encoded rule:
    /// `ruleEncoded.length == _RULE_HEADER_SIZE + CONSTRAINT_SIZE * constraintCount`
    uint256 public constant CONSTRAINT_SIZE = 66;
    uint256 private constant _CONSTRAINT_OFFSET_MASK = 2;
    uint256 private constant _CONSTRAINT_OFFSET_EXPECTED = 34;

    // Rule header field byte offsets
    uint256 private constant _RULE_OFFSET_SENDER = 2;
    uint256 private constant _RULE_OFFSET_TO = 22;
    uint256 private constant _RULE_OFFSET_VALUE = 42;
    uint256 private constant _RULE_OFFSET_DATA_LENGTH = 74;
    uint256 private constant _RULE_OFFSET_CONSTRAINT_COUNT = 78;

    // Flag bits (r[1]) — set the corresponding bit to pin that field to the value in the rule.
    uint8 public constant FLAG_SENDER = 0x01;
    uint8 public constant FLAG_TO = 0x02;
    uint8 public constant FLAG_VALUE = 0x04;
    uint8 public constant FLAG_DATA_LENGTH = 0x08;
    uint8 private constant _FLAGS_RESERVED = 0xF0;

    // Domain separator
    // keccak256(abi.encodePacked(DOMAIN_MAGIC, DOMAIN_LAYOUT_VERSION, block.chainid, address(this)))
    // - DOMAIN_MAGIC: ASCII "ALLW" (ALLoWlist) — type tag that namespaces this preimage
    //   from unrelated keccak256 inputs in other protocols.
    // - DOMAIN_LAYOUT_VERSION: versions the preimage structure itself (field order/types);
    //   bump if the domain separator format ever changes.
    // - block.chainid: prevents cross-chain replay of proofs.
    // - address(this): binds every leaf to this specific deployment; the Merkle tree
    //   must be built after deploy (or against a known CREATE2 address).
    bytes4 public constant DOMAIN_MAGIC = 0x414c4c57; // "ALLW"
    uint8 public constant DOMAIN_LAYOUT_VERSION = 1;

    /// @notice Leaf type prefix used in `abi.encode` when hashing rule leaves.
    /// Leaf = keccak256(bytes.concat(keccak256(abi.encode(LEAF_TYPE, domainSeparator(), ruleEncoded))))
    uint8 public constant LEAF_TYPE = 0;

    bytes32 private _allowlistRoot;

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @inheritdoc IMerkleCallAllowlist
    function allowlistRoot() external view override returns (bytes32) {
        return _allowlistRoot;
    }

    /// @inheritdoc IMerkleCallAllowlist
    function setAllowlistRoot(bytes32 newRoot) external override onlyOwner {
        bytes32 oldRoot = _allowlistRoot;
        _allowlistRoot = newRoot;
        emit AllowlistRootUpdated(oldRoot, newRoot);
    }

    /// @inheritdoc IMerkleCallAllowlist
    function domainSeparator() external view override returns (bytes32) {
        return _domainSeparator();
    }

    /// @inheritdoc IMerkleCallAllowlist
    function isAllowed(
        address sender,
        address to,
        uint256 value,
        bytes calldata data,
        CallVerificationInput calldata input
    ) external view override returns (bool) {
        if (_allowlistRoot == bytes32(0)) {
            return false;
        }

        bytes calldata r = input.ruleEncoded;
        if (!_isCanonicallyValidRule(r)) {
            return false;
        }

        bytes32 leaf = _leaf(r);
        if (
            !MerkleProof.verifyCalldata(input.merkleProof, _allowlistRoot, leaf)
        ) {
            return false;
        }

        return _matchesRule(r, sender, to, value, data);
    }

    /// @inheritdoc IStrategyExecValidator
    function isAllowed(
        address sender,
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata validatorArgs
    ) external view override returns (bool) {
        CallVerificationInput memory input = abi.decode(
            validatorArgs,
            (CallVerificationInput)
        );
        return this.isAllowed(sender, to, value, data, input);
    }

    function _domainSeparator() private view returns (bytes32) {
        return
            keccak256(
                abi.encodePacked(
                    DOMAIN_MAGIC,
                    DOMAIN_LAYOUT_VERSION,
                    block.chainid,
                    address(this)
                )
            );
    }

    function _leaf(bytes calldata ruleEncoded) private view returns (bytes32) {
        return
            keccak256(
                bytes.concat(
                    keccak256(
                        abi.encode(LEAF_TYPE, _domainSeparator(), ruleEncoded)
                    )
                )
            );
    }

    /// @dev Left-align up to 32 bytes from `data[offset:]`, right-pad with zero.
    function _wordAt(
        bytes calldata data,
        uint256 offset
    ) private pure returns (bytes32 word) {
        uint256 len = data.length;
        if (offset >= len) {
            return bytes32(0);
        }
        unchecked {
            uint256 n = len - offset;
            if (n > 32) {
                n = 32;
            }
            uint256 loaded;
            // data.offset + offset: overflow impossible — calldata is bounded by block gas
            // limit (< 2^32 bytes), and offset < len ensures offset < data.length.
            assembly {
                loaded := calldataload(add(data.offset, offset))
            }
            if (n == 32) {
                return bytes32(loaded);
            }
            return bytes32(loaded & (type(uint256).max << (256 - 8 * n)));
        }
    }

    /// @dev Structural and canonical checks only.
    function _isCanonicallyValidRule(
        bytes calldata r
    ) private pure returns (bool) {
        if (r.length < _RULE_HEADER_SIZE) {
            return false;
        }

        if (uint8(r[0]) != RULE_VERSION) {
            return false;
        }

        uint8 flags = uint8(r[1]);
        if (flags & _FLAGS_RESERVED != 0) {
            return false;
        }

        address ruleSender = _readAddress(r, _RULE_OFFSET_SENDER);
        address ruleTo = _readAddress(r, _RULE_OFFSET_TO);
        uint256 ruleValue = _readUint256(r, _RULE_OFFSET_VALUE);
        uint32 ruleDataLength = _readUint32BE(r, _RULE_OFFSET_DATA_LENGTH);
        uint256 cCount = uint256(
            _readUint16BE(r, _RULE_OFFSET_CONSTRAINT_COUNT)
        );

        if (cCount > MAX_CONSTRAINTS) {
            return false;
        }
        if (r.length != _RULE_HEADER_SIZE + CONSTRAINT_SIZE * cCount) {
            return false;
        }

        if ((flags & FLAG_SENDER) == 0 && ruleSender != address(0)) {
            return false;
        }
        if ((flags & FLAG_TO) == 0 && ruleTo != address(0)) {
            return false;
        }
        if ((flags & FLAG_VALUE) == 0 && ruleValue != 0) {
            return false;
        }
        if ((flags & FLAG_DATA_LENGTH) == 0 && ruleDataLength != 0) {
            return false;
        }

        return _constraintsCanonicallyValid(r, cCount);
    }

    function _constraintsCanonicallyValid(
        bytes calldata r,
        uint256 cCount
    ) private pure returns (bool) {
        uint256 base = _RULE_HEADER_SIZE;
        uint16 prevOffset;
        bool havePrev;

        for (uint256 i = 0; i < cCount; ) {
            uint16 cOff = _readUint16BE(r, base);
            bytes32 mask = _readBytes32(r, base + _CONSTRAINT_OFFSET_MASK);
            bytes32 expected = _readBytes32(
                r,
                base + _CONSTRAINT_OFFSET_EXPECTED
            );

            if (mask == bytes32(0)) {
                return false;
            }
            if (expected & ~mask != bytes32(0)) {
                return false;
            }
            if (havePrev && cOff <= prevOffset) {
                return false;
            }
            prevOffset = cOff;
            havePrev = true;

            unchecked {
                base += CONSTRAINT_SIZE;
                ++i;
            }
        }
        return true;
    }

    /// @dev Rule matching (caller must ensure `_isCanonicallyValidRule(r)` already passed).
    function _matchesRule(
        bytes calldata r,
        address sender,
        address to,
        uint256 value,
        bytes calldata data
    ) private pure returns (bool) {
        uint8 flags = uint8(r[1]);
        address ruleSender = _readAddress(r, _RULE_OFFSET_SENDER);
        address ruleTo = _readAddress(r, _RULE_OFFSET_TO);
        uint256 ruleValue = _readUint256(r, _RULE_OFFSET_VALUE);
        uint32 ruleDataLength = _readUint32BE(r, _RULE_OFFSET_DATA_LENGTH);
        uint256 cCount = uint256(
            _readUint16BE(r, _RULE_OFFSET_CONSTRAINT_COUNT)
        );

        if ((flags & FLAG_SENDER) != 0 && sender != ruleSender) {
            return false;
        }
        if ((flags & FLAG_TO) != 0 && to != ruleTo) {
            return false;
        }
        if ((flags & FLAG_VALUE) != 0 && value != ruleValue) {
            return false;
        }
        if (
            (flags & FLAG_DATA_LENGTH) != 0 &&
            data.length != uint256(ruleDataLength)
        ) {
            return false;
        }

        return _constraintsMatchCalldata(r, cCount, data);
    }

    function _constraintsMatchCalldata(
        bytes calldata r,
        uint256 cCount,
        bytes calldata data
    ) private pure returns (bool) {
        uint256 base = _RULE_HEADER_SIZE;
        for (uint256 i; i < cCount; ) {
            uint16 cOff = _readUint16BE(r, base);
            bytes32 mask = _readBytes32(r, base + _CONSTRAINT_OFFSET_MASK);
            bytes32 expected = _readBytes32(
                r,
                base + _CONSTRAINT_OFFSET_EXPECTED
            );
            if ((_wordAt(data, uint256(cOff)) & mask) != expected) {
                return false;
            }
            unchecked {
                base += CONSTRAINT_SIZE;
                ++i;
            }
        }
        return true;
    }

    function _readAddress(
        bytes calldata r,
        uint256 s
    ) private pure returns (address a) {
        assembly {
            a := shr(96, calldataload(add(r.offset, s)))
        }
    }

    function _readUint256(
        bytes calldata r,
        uint256 s
    ) private pure returns (uint256 v) {
        assembly {
            v := calldataload(add(r.offset, s))
        }
    }

    function _readUint32BE(
        bytes calldata r,
        uint256 s
    ) private pure returns (uint32 v) {
        assembly {
            v := shr(224, calldataload(add(r.offset, s)))
        }
    }

    function _readUint16BE(
        bytes calldata r,
        uint256 s
    ) private pure returns (uint16 v) {
        assembly {
            v := shr(240, calldataload(add(r.offset, s)))
        }
    }

    function _readBytes32(
        bytes calldata r,
        uint256 s
    ) private pure returns (bytes32 w) {
        assembly {
            w := calldataload(add(r.offset, s))
        }
    }
}
