// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AbstractAdapter} from "./AbstractAdapter.sol";
import {OAppReceiver} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OAppReceiver.sol";
import {OAppSender} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OAppSender.sol";
import {OAppCore} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OAppCore.sol";
import {MessagingFee, Origin} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oapp/OApp.sol";

/**
 * @title LayerZero bridge adapter
 * @author Lombard.finance
 * @notice LZAdapter implements Omnichain Application (OApp) in order to communicate
 * with LayerZero protocol to send and receive bridge payloads.
 */
contract LZAdapter is AbstractAdapter, OAppReceiver, OAppSender {
    error LZZeroChain();
    error LZZeroEID();
    error AttemptToOverrideEID();
    error AttemptToOverrideChain();

    event LZMessageReceived(
        bytes32 indexed guid,
        uint64 indexed nonce,
        address indexed executor
    );
    event LZEIDSet(bytes32 indexed chain, uint32 indexed eid);

    bool internal constant PAY_IN_LZ_TOKEN = false;

    mapping(bytes32 => uint32) public getEID;
    mapping(uint32 => bytes32) public getChain;

    // @param _endpoint Endpoint from https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts
    constructor(
        address _owner,
        address _endpoint
    ) AbstractAdapter(_owner) OAppCore(_endpoint, _owner) {}

    function oAppVersion()
        public
        view
        virtual
        override(OAppReceiver, OAppSender)
        returns (uint64 senderVersion, uint64 receiverVersion)
    {
        senderVersion = OAppSender.SENDER_VERSION;
        receiverVersion = OAppReceiver.RECEIVER_VERSION;
    }

    function getFee(
        bytes32 _toChain,
        bytes32,
        bytes32,
        uint256,
        bytes memory _payload
    ) external view override returns (uint256) {
        bytes memory options;
        MessagingFee memory fee = _quote(
            getEID[_toChain],
            _payload,
            options,
            PAY_IN_LZ_TOKEN
        );
        return fee.nativeFee;
    }

    /**
     * @notice Sends a payload from the source to destination chain.
     * @param _toChain Destination chain's.
     * @param _payload The payload to send.
     * @param _refundAddress The address where to pay excess fee
     */
    function _deposit(
        bytes32 _toChain,
        bytes memory _payload,
        address _refundAddress
    ) internal override {
        uint32 _dstEid = getEID[_toChain];
        bytes memory _options;

        _lzSend(
            _dstEid,
            _payload,
            _options,
            // fee verification implemented on LayerZero side
            MessagingFee(msg.value, 0),
            payable(_refundAddress)
        );
    }

    /**
     * @dev Called when data is received from the protocol. It overrides the equivalent function in the parent contract.
     * Protocol messages are defined as packets, comprised of the following parameters.
     * @param _origin A struct containing information about where the packet came from.
     * @param _guid A global unique identifier for tracking the packet.
     * @param payload Encoded message.
     */
    function _lzReceive(
        Origin calldata _origin,
        bytes32 _guid,
        bytes calldata payload,
        address executor, // Executor address as specified by the OApp.
        bytes calldata // Any extra data or options to trigger on receipt.
    ) internal override {
        bytes32 fromChain = getChain[_origin.srcEid];
        emit LZMessageReceived(_guid, _origin.nonce, executor);
        _receive(fromChain, _origin.sender, payload);
    }

    /**
     * @notice Allows owner set eid for chain id
     * @param chain ABI encoded chain id
     * @param eid EID of chain id (https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts)
     */
    function setEid(bytes32 chain, uint32 eid) external onlyOwner {
        if (chain == bytes32(0)) {
            revert LZZeroChain();
        }
        if (eid == 0) {
            revert LZZeroEID();
        }
        if (getEID[chain] != 0) {
            revert AttemptToOverrideEID();
        }
        if (getChain[eid] != bytes32(0)) {
            revert AttemptToOverrideChain();
        }
        getEID[chain] = eid;
        getChain[eid] = chain;
        emit LZEIDSet(chain, eid);
    }
}
