// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {CallVerificationInput, IMerkleCallAllowlist} from "../interfaces/IMerkleCallAllowlist.sol";
import {IShardExecValidator} from "../interfaces/IShardExecValidator.sol";

/// @title MerkleAllowlistValidator
/// @notice On-chain Merkle-based allowlist for shard `exec`: proves an encoded rule leaf is under `allowlistRoot`, then checks calldata constraints.
/// @dev Implements both `IMerkleCallAllowlist` (typed struct proofs) and `IShardExecValidator` (ABI-encoded struct calldata). Owner rotates the Merkle root.
contract MerkleAllowlistValidator is
    Ownable2Step,
    IMerkleCallAllowlist,
    IShardExecValidator
{
    /// @dev Upper bound on `constraintCount` for rule version `0x01`.
    uint256 public constant MAX_CONSTRAINTS = 64;

    // ── Rule encoding ────────────────────────────────────────────────────────

    /// @notice Version byte that must appear as byte 0 of every encoded rule.
    uint8 public constant RULE_VERSION = 0x01;

    /// @dev Byte size of the fixed rule header before the constraints array.
    /// Layout: version(1) + flags(1) + selector(4) + sender(20) + to(20) + value(32)
    ///         + dataLength(4) + constraintCount(2) = 84
    uint256 private constant _RULE_HEADER_SIZE = 84;

    /// @notice Per-constraint byte size: calldataOffset(2) + mask(32) + expected(32) = 66.
    /// Use this to validate the total length of an encoded rule:
    /// Constraint offsets are relative to calldata after the function selector (`data[_SELECTOR_LENGTH:]`).
    /// `ruleEncoded.length == _RULE_HEADER_SIZE + CONSTRAINT_SIZE * constraintCount`
    uint256 public constant CONSTRAINT_SIZE = 66;
    /// @dev Length of the EVM call selector prefix; constraints index into the bytes that follow.
    uint256 private constant _SELECTOR_LENGTH = 4;
    uint256 private constant _CONSTRAINT_OFFSET_MASK = 2;
    uint256 private constant _CONSTRAINT_OFFSET_EXPECTED = 34;

    // Rule header field byte offsets (selector @ 2 follows flags @ 1)
    uint256 private constant _RULE_OFFSET_SELECTOR = 2;
    uint256 private constant _RULE_OFFSET_SENDER = 6;
    uint256 private constant _RULE_OFFSET_TO = 26;
    uint256 private constant _RULE_OFFSET_VALUE = 46;
    uint256 private constant _RULE_OFFSET_DATA_LENGTH = 78;
    uint256 private constant _RULE_OFFSET_CONSTRAINT_COUNT = 82;

    // Flag bits (r[1]) — set the corresponding bit to pin that field to the value in the rule.
    uint8 public constant FLAG_SENDER = 0x01;
    uint8 public constant FLAG_TO = 0x02;
    uint8 public constant FLAG_VALUE = 0x04;
    uint8 public constant FLAG_DATA_LENGTH = 0x08;
    uint8 public constant FLAG_SELECTOR = 0x10;
    uint8 private constant _FLAGS_RESERVED = 0xE0;

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

    /// @inheritdoc IShardExecValidator
    function isAllowed(
        address sender,
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata validatorArgs
    ) external view override returns (bool) {
        // validatorArgs = abi.encode(CallVerificationInput), a struct with two dynamic fields.
        // abi.encode of a dynamic struct prepends an outer offset word (= 0x20) that points
        // to the tuple body; offsets within the tuple are relative to the tuple start.
        // Layout (all positions relative to validatorArgs.offset = base):
        //   [base+0x00]: 0x20            ← outer struct offset → tupleStart = base+0x20
        //   [tupleStart+0x00]: ruleOff   ← offset to ruleEncoded from tupleStart (= 0x40)
        //   [tupleStart+0x20]: proofOff  ← offset to merkleProof from tupleStart
        //   [tupleStart+ruleOff]:        ← ruleEncoded byte length
        //   [tupleStart+ruleOff+0x20]:   ← ruleEncoded data
        //   [tupleStart+proofOff]:       ← merkleProof element count
        //   [tupleStart+proofOff+0x20]:  ← merkleProof elements
        // Decode into calldata slices to reuse the calldata-optimised helpers
        // without an external self-call round-trip.
        bytes calldata ruleEncoded;
        bytes32[] calldata merkleProof;
        assembly {
            let base := validatorArgs.offset
            let tupleStart := add(base, calldataload(base))
            let ruleOff := calldataload(tupleStart)
            let rulePtr := add(tupleStart, ruleOff)
            ruleEncoded.length := calldataload(rulePtr)
            ruleEncoded.offset := add(rulePtr, 0x20)
            let proofOff := calldataload(add(tupleStart, 0x20))
            let proofPtr := add(tupleStart, proofOff)
            merkleProof.length := calldataload(proofPtr)
            merkleProof.offset := add(proofPtr, 0x20)
        }
        if (_allowlistRoot == bytes32(0)) return false;
        if (!_isCanonicallyValidRule(ruleEncoded)) return false;
        bytes32 leaf = _leaf(ruleEncoded);
        if (!MerkleProof.verifyCalldata(merkleProof, _allowlistRoot, leaf))
            return false;
        return _matchesRule(ruleEncoded, sender, to, value, data);
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
            // The load reads 32 bytes starting at data[offset], which may extend past
            // data.length into adjacent calldata; the mask below discards those extra bytes.
            assembly {
                loaded := calldataload(add(data.offset, offset))
            }
            if (n == 32) {
                return bytes32(loaded);
            }
            return bytes32(loaded & (type(uint256).max << (256 - 8 * n)));
        }
    }

    /// @dev Parsed rule header fields, shared between canonical and match checks.
    struct RuleHeader {
        uint8 flags;
        /// @dev Required calldata prefix when `FLAG_SELECTOR` is set (`bytes4(data[0:4])`).
        /// May be `bytes4(0)` — that bit-pattern can occur as `bytes4(keccak256(signature))`.
        /// When `FLAG_SELECTOR` is clear (wildcard), canonical encoding requires this slot to be zero.
        bytes4 selector;
        address sender;
        address to;
        uint256 value;
        uint32 dataLength;
        uint256 cCount;
    }

    function _readHeader(
        bytes calldata r
    ) private pure returns (RuleHeader memory h) {
        h.flags = uint8(r[1]);
        h.selector = _readBytes4(r, _RULE_OFFSET_SELECTOR);
        h.sender = _readAddress(r, _RULE_OFFSET_SENDER);
        h.to = _readAddress(r, _RULE_OFFSET_TO);
        h.value = _readUint256(r, _RULE_OFFSET_VALUE);
        h.dataLength = _readUint32BE(r, _RULE_OFFSET_DATA_LENGTH);
        h.cCount = uint256(_readUint16BE(r, _RULE_OFFSET_CONSTRAINT_COUNT));
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

        RuleHeader memory h = _readHeader(r);

        if (h.flags & _FLAGS_RESERVED != 0) {
            return false;
        }

        if (h.cCount > MAX_CONSTRAINTS) {
            return false;
        }
        if (r.length != _RULE_HEADER_SIZE + CONSTRAINT_SIZE * h.cCount) {
            return false;
        }

        if ((h.flags & FLAG_SENDER) == 0 && h.sender != address(0)) {
            return false;
        }
        if ((h.flags & FLAG_TO) == 0 && h.to != address(0)) {
            return false;
        }
        if ((h.flags & FLAG_VALUE) == 0 && h.value != 0) {
            return false;
        }
        if ((h.flags & FLAG_DATA_LENGTH) == 0 && h.dataLength != 0) {
            return false;
        }
        if ((h.flags & FLAG_SELECTOR) == 0 && h.selector != bytes4(0)) {
            return false;
        }

        return _constraintsCanonicallyValid(r, h.cCount);
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
        RuleHeader memory h = _readHeader(r);

        if ((h.flags & FLAG_SENDER) != 0 && sender != h.sender) {
            return false;
        }
        if ((h.flags & FLAG_TO) != 0 && to != h.to) {
            return false;
        }
        if ((h.flags & FLAG_VALUE) != 0 && value != h.value) {
            return false;
        }
        if (
            (h.flags & FLAG_DATA_LENGTH) != 0 &&
            data.length != uint256(h.dataLength)
        ) {
            return false;
        }

        if ((h.flags & FLAG_SELECTOR) != 0) {
            if (data.length < _SELECTOR_LENGTH) {
                return false;
            }
            bytes4 callSel = bytes4(_wordAt(data, 0));
            if (callSel != h.selector) {
                return false;
            }
        }

        return _constraintsMatchCalldata(r, h.cCount, data);
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
            uint256 offset = uint256(cOff) + _SELECTOR_LENGTH;
            // Reject offsets past calldata: _wordAt right-pads with zero, so
            // expected == 0 would spuriously match truncated payloads.
            if (offset >= data.length) {
                return false;
            }
            if ((_wordAt(data, offset) & mask) != expected) {
                return false;
            }
            unchecked {
                base += CONSTRAINT_SIZE;
                ++i;
            }
        }
        return true;
    }

    function _readBytes4(
        bytes calldata r,
        uint256 s
    ) private pure returns (bytes4 v) {
        bytes32 w;
        assembly {
            w := calldataload(add(r.offset, s))
        }
        v = bytes4(w);
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
