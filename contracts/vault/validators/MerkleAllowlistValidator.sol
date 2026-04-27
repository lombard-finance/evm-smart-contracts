// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {CallVerificationInput, IMerkleCallAllowlist} from "../interfaces/IMerkleCallAllowlist.sol";
import {IStrategyExecValidator} from "../interfaces/IStrategyExecValidator.sol";

/// @title MerkleAllowlistValidator
/// @notice On-chain verification per `docs/spec/001-merkle-call-data-allowlist.md`.
contract MerkleAllowlistValidator is
    IMerkleCallAllowlist,
    IStrategyExecValidator
{
    /// @dev Upper bound on `constraintCount` for rule version `0x03` (`docs/spec/001-merkle-call-data-allowlist.md` §14).
    uint256 public constant MAX_CONSTRAINTS = 64;

    bytes32 private _allowlistRoot;

    /// @inheritdoc IMerkleCallAllowlist
    function allowlistRoot() external view override returns (bytes32) {
        return _allowlistRoot;
    }

    /// @inheritdoc IMerkleCallAllowlist
    function setAllowlistRoot(bytes32 newRoot) external override {
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
                    bytes4(0x414c4c57),
                    uint8(1),
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
                        abi.encode(uint8(0), _domainSeparator(), ruleEncoded)
                    )
                )
            );
    }

    /// @dev §5: left-align up to 32 bytes from `data[offset:]`, right-pad with zero.
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
            assembly {
                loaded := calldataload(add(data.offset, offset))
            }
            if (n == 32) {
                return bytes32(loaded);
            }
            return bytes32(loaded & (type(uint256).max << (256 - 8 * n)));
        }
    }

    /// @dev §4, §6, §7, §14: structural and canonical checks only.
    function _isCanonicallyValidRule(
        bytes calldata r
    ) private pure returns (bool) {
        if (r.length < 80) {
            return false;
        }

        if (uint8(r[0]) != 0x03) {
            return false;
        }

        uint8 flags = uint8(r[1]);
        if (flags & 0xF0 != 0) {
            return false;
        }

        address ruleSender = _readAddress(r, 2);
        address ruleTo = _readAddress(r, 22);
        uint256 ruleValue = _readUint256(r, 42);
        uint32 ruleDataLength = _readUint32BE(r, 74);
        uint256 cCount = uint256(_readUint16BE(r, 78));

        if (cCount > MAX_CONSTRAINTS) {
            return false;
        }
        if (r.length != 80 + 66 * cCount) {
            return false;
        }

        if ((flags & 0x01) == 0 && ruleSender != address(0)) {
            return false;
        }
        if ((flags & 0x02) == 0 && ruleTo != address(0)) {
            return false;
        }
        if ((flags & 0x04) == 0 && ruleValue != 0) {
            return false;
        }
        if ((flags & 0x08) == 0 && ruleDataLength != 0) {
            return false;
        }

        return _constraintsCanonicallyValid(r, cCount);
    }

    function _constraintsCanonicallyValid(
        bytes calldata r,
        uint256 cCount
    ) private pure returns (bool) {
        uint256 base = 80;
        uint16 prevOffset;
        bool havePrev;

        for (uint256 i = 0; i < cCount; ) {
            uint16 cOff = _readUint16BE(r, base);
            bytes32 mask = _readBytes32(r, base + 2);
            bytes32 expected = _readBytes32(r, base + 34);

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
                base += 66;
                ++i;
            }
        }
        return true;
    }

    /// @dev §11 matching (caller must ensure `_isCanonicallyValidRule(r)` already passed).
    function _matchesRule(
        bytes calldata r,
        address sender,
        address to,
        uint256 value,
        bytes calldata data
    ) private pure returns (bool) {
        uint8 flags = uint8(r[1]);
        address ruleSender = _readAddress(r, 2);
        address ruleTo = _readAddress(r, 22);
        uint256 ruleValue = _readUint256(r, 42);
        uint32 ruleDataLength = _readUint32BE(r, 74);
        uint256 cCount = uint256(_readUint16BE(r, 78));

        if ((flags & 0x01) != 0 && sender != ruleSender) {
            return false;
        }
        if ((flags & 0x02) != 0 && to != ruleTo) {
            return false;
        }
        if ((flags & 0x04) != 0 && value != ruleValue) {
            return false;
        }
        if ((flags & 0x08) != 0 && data.length != uint256(ruleDataLength)) {
            return false;
        }

        return _constraintsMatchCalldata(r, cCount, data);
    }

    function _constraintsMatchCalldata(
        bytes calldata r,
        uint256 cCount,
        bytes calldata data
    ) private pure returns (bool) {
        uint256 base = 80;
        for (uint256 i; i < cCount; ) {
            uint16 cOff = _readUint16BE(r, base);
            bytes32 mask = _readBytes32(r, base + 2);
            bytes32 expected = _readBytes32(r, base + 34);
            if ((_wordAt(data, uint256(cOff)) & mask) != expected) {
                return false;
            }
            unchecked {
                base += 66;
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
