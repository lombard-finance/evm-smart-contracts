export const EndpointV2MockArtifact = {
    abi: [
        {
            inputs: [
                {
                    internalType: 'uint32',
                    name: '_eid',
                    type: 'uint32',
                },
            ],
            stateMutability: 'nonpayable',
            type: 'constructor',
        },
        {
            inputs: [
                {
                    internalType: 'uint256',
                    name: 'cursor',
                    type: 'uint256',
                },
            ],
            name: 'Executor_InvalidExecutorOptions',
            type: 'error',
        },
        {
            inputs: [],
            name: 'Executor_InvalidLzComposeOption',
            type: 'error',
        },
        {
            inputs: [],
            name: 'Executor_InvalidLzReceiveOption',
            type: 'error',
        },
        {
            inputs: [],
            name: 'Executor_InvalidNativeDropOption',
            type: 'error',
        },
        {
            inputs: [
                {
                    internalType: 'uint256',
                    name: 'amount',
                    type: 'uint256',
                },
                {
                    internalType: 'uint256',
                    name: 'cap',
                    type: 'uint256',
                },
            ],
            name: 'Executor_NativeAmountExceedsCap',
            type: 'error',
        },
        {
            inputs: [],
            name: 'Executor_NoOptions',
            type: 'error',
        },
        {
            inputs: [
                {
                    internalType: 'uint8',
                    name: 'optionType',
                    type: 'uint8',
                },
            ],
            name: 'Executor_UnsupportedOptionType',
            type: 'error',
        },
        {
            inputs: [],
            name: 'LZ_LzTokenUnavailable',
            type: 'error',
        },
        {
            inputs: [],
            name: 'LZ_SendReentrancy',
            type: 'error',
        },
        {
            inputs: [],
            name: 'LZ_ULN_InvalidLegacyType1Option',
            type: 'error',
        },
        {
            inputs: [],
            name: 'LZ_ULN_InvalidLegacyType2Option',
            type: 'error',
        },
        {
            inputs: [
                {
                    internalType: 'uint8',
                    name: 'workerId',
                    type: 'uint8',
                },
            ],
            name: 'LZ_ULN_InvalidWorkerId',
            type: 'error',
        },
        {
            inputs: [
                {
                    internalType: 'uint256',
                    name: 'cursor',
                    type: 'uint256',
                },
            ],
            name: 'LZ_ULN_InvalidWorkerOptions',
            type: 'error',
        },
        {
            inputs: [
                {
                    internalType: 'uint16',
                    name: 'optionType',
                    type: 'uint16',
                },
            ],
            name: 'LZ_ULN_UnsupportedOptionType',
            type: 'error',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'from',
                    type: 'address',
                },
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'to',
                    type: 'address',
                },
                {
                    indexed: false,
                    internalType: 'bytes32',
                    name: 'guid',
                    type: 'bytes32',
                },
                {
                    indexed: false,
                    internalType: 'uint16',
                    name: 'index',
                    type: 'uint16',
                },
            ],
            name: 'ComposeDelivered',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'from',
                    type: 'address',
                },
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'to',
                    type: 'address',
                },
                {
                    indexed: false,
                    internalType: 'bytes32',
                    name: 'guid',
                    type: 'bytes32',
                },
                {
                    indexed: false,
                    internalType: 'uint16',
                    name: 'index',
                    type: 'uint16',
                },
                {
                    indexed: false,
                    internalType: 'bytes',
                    name: 'message',
                    type: 'bytes',
                },
            ],
            name: 'ComposeSent',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: false,
                    internalType: 'uint32',
                    name: 'eid',
                    type: 'uint32',
                },
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'newLib',
                    type: 'address',
                },
            ],
            name: 'DefaultReceiveLibrarySet',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: false,
                    internalType: 'uint32',
                    name: 'eid',
                    type: 'uint32',
                },
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'oldLib',
                    type: 'address',
                },
                {
                    indexed: false,
                    internalType: 'uint256',
                    name: 'expiry',
                    type: 'uint256',
                },
            ],
            name: 'DefaultReceiveLibraryTimeoutSet',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: false,
                    internalType: 'uint32',
                    name: 'eid',
                    type: 'uint32',
                },
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'newLib',
                    type: 'address',
                },
            ],
            name: 'DefaultSendLibrarySet',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'sender',
                    type: 'address',
                },
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'delegate',
                    type: 'address',
                },
            ],
            name: 'DelegateSet',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: false,
                    internalType: 'uint32',
                    name: 'srcEid',
                    type: 'uint32',
                },
                {
                    indexed: false,
                    internalType: 'bytes32',
                    name: 'sender',
                    type: 'bytes32',
                },
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'receiver',
                    type: 'address',
                },
                {
                    indexed: false,
                    internalType: 'uint64',
                    name: 'nonce',
                    type: 'uint64',
                },
            ],
            name: 'InboundNonceSkipped',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'newLib',
                    type: 'address',
                },
            ],
            name: 'LibraryRegistered',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: true,
                    internalType: 'address',
                    name: 'from',
                    type: 'address',
                },
                {
                    indexed: true,
                    internalType: 'address',
                    name: 'to',
                    type: 'address',
                },
                {
                    indexed: true,
                    internalType: 'address',
                    name: 'executor',
                    type: 'address',
                },
                {
                    indexed: false,
                    internalType: 'bytes32',
                    name: 'guid',
                    type: 'bytes32',
                },
                {
                    indexed: false,
                    internalType: 'uint16',
                    name: 'index',
                    type: 'uint16',
                },
                {
                    indexed: false,
                    internalType: 'uint256',
                    name: 'gas',
                    type: 'uint256',
                },
                {
                    indexed: false,
                    internalType: 'uint256',
                    name: 'value',
                    type: 'uint256',
                },
                {
                    indexed: false,
                    internalType: 'bytes',
                    name: 'message',
                    type: 'bytes',
                },
                {
                    indexed: false,
                    internalType: 'bytes',
                    name: 'extraData',
                    type: 'bytes',
                },
                {
                    indexed: false,
                    internalType: 'bytes',
                    name: 'reason',
                    type: 'bytes',
                },
            ],
            name: 'LzComposeAlert',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: true,
                    internalType: 'address',
                    name: 'receiver',
                    type: 'address',
                },
                {
                    indexed: true,
                    internalType: 'address',
                    name: 'executor',
                    type: 'address',
                },
                {
                    components: [
                        {
                            internalType: 'uint32',
                            name: 'srcEid',
                            type: 'uint32',
                        },
                        {
                            internalType: 'bytes32',
                            name: 'sender',
                            type: 'bytes32',
                        },
                        {
                            internalType: 'uint64',
                            name: 'nonce',
                            type: 'uint64',
                        },
                    ],
                    indexed: false,
                    internalType: 'struct Origin',
                    name: 'origin',
                    type: 'tuple',
                },
                {
                    indexed: false,
                    internalType: 'bytes32',
                    name: 'guid',
                    type: 'bytes32',
                },
                {
                    indexed: false,
                    internalType: 'uint256',
                    name: 'gas',
                    type: 'uint256',
                },
                {
                    indexed: false,
                    internalType: 'uint256',
                    name: 'value',
                    type: 'uint256',
                },
                {
                    indexed: false,
                    internalType: 'bytes',
                    name: 'message',
                    type: 'bytes',
                },
                {
                    indexed: false,
                    internalType: 'bytes',
                    name: 'extraData',
                    type: 'bytes',
                },
                {
                    indexed: false,
                    internalType: 'bytes',
                    name: 'reason',
                    type: 'bytes',
                },
            ],
            name: 'LzReceiveAlert',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'token',
                    type: 'address',
                },
            ],
            name: 'LzTokenSet',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: false,
                    internalType: 'uint32',
                    name: 'srcEid',
                    type: 'uint32',
                },
                {
                    indexed: false,
                    internalType: 'bytes32',
                    name: 'sender',
                    type: 'bytes32',
                },
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'receiver',
                    type: 'address',
                },
                {
                    indexed: false,
                    internalType: 'uint64',
                    name: 'nonce',
                    type: 'uint64',
                },
                {
                    indexed: false,
                    internalType: 'bytes32',
                    name: 'payloadHash',
                    type: 'bytes32',
                },
            ],
            name: 'PacketBurnt',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    components: [
                        {
                            internalType: 'uint32',
                            name: 'srcEid',
                            type: 'uint32',
                        },
                        {
                            internalType: 'bytes32',
                            name: 'sender',
                            type: 'bytes32',
                        },
                        {
                            internalType: 'uint64',
                            name: 'nonce',
                            type: 'uint64',
                        },
                    ],
                    indexed: false,
                    internalType: 'struct Origin',
                    name: 'origin',
                    type: 'tuple',
                },
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'receiver',
                    type: 'address',
                },
            ],
            name: 'PacketDelivered',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: false,
                    internalType: 'uint32',
                    name: 'srcEid',
                    type: 'uint32',
                },
                {
                    indexed: false,
                    internalType: 'bytes32',
                    name: 'sender',
                    type: 'bytes32',
                },
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'receiver',
                    type: 'address',
                },
                {
                    indexed: false,
                    internalType: 'uint64',
                    name: 'nonce',
                    type: 'uint64',
                },
                {
                    indexed: false,
                    internalType: 'bytes32',
                    name: 'payloadHash',
                    type: 'bytes32',
                },
            ],
            name: 'PacketNilified',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: false,
                    internalType: 'bytes',
                    name: 'encodedPayload',
                    type: 'bytes',
                },
                {
                    indexed: false,
                    internalType: 'bytes',
                    name: 'options',
                    type: 'bytes',
                },
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'sendLibrary',
                    type: 'address',
                },
            ],
            name: 'PacketSent',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    components: [
                        {
                            internalType: 'uint32',
                            name: 'srcEid',
                            type: 'uint32',
                        },
                        {
                            internalType: 'bytes32',
                            name: 'sender',
                            type: 'bytes32',
                        },
                        {
                            internalType: 'uint64',
                            name: 'nonce',
                            type: 'uint64',
                        },
                    ],
                    indexed: false,
                    internalType: 'struct Origin',
                    name: 'origin',
                    type: 'tuple',
                },
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'receiver',
                    type: 'address',
                },
                {
                    indexed: false,
                    internalType: 'bytes32',
                    name: 'payloadHash',
                    type: 'bytes32',
                },
            ],
            name: 'PacketVerified',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'receiver',
                    type: 'address',
                },
                {
                    indexed: false,
                    internalType: 'uint32',
                    name: 'eid',
                    type: 'uint32',
                },
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'newLib',
                    type: 'address',
                },
            ],
            name: 'ReceiveLibrarySet',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'receiver',
                    type: 'address',
                },
                {
                    indexed: false,
                    internalType: 'uint32',
                    name: 'eid',
                    type: 'uint32',
                },
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'oldLib',
                    type: 'address',
                },
                {
                    indexed: false,
                    internalType: 'uint256',
                    name: 'timeout',
                    type: 'uint256',
                },
            ],
            name: 'ReceiveLibraryTimeoutSet',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'sender',
                    type: 'address',
                },
                {
                    indexed: false,
                    internalType: 'uint32',
                    name: 'eid',
                    type: 'uint32',
                },
                {
                    indexed: false,
                    internalType: 'address',
                    name: 'newLib',
                    type: 'address',
                },
            ],
            name: 'SendLibrarySet',
            type: 'event',
        },
        {
            anonymous: false,
            inputs: [
                {
                    indexed: true,
                    internalType: 'address',
                    name: 'to',
                    type: 'address',
                },
                {
                    indexed: true,
                    internalType: 'uint256',
                    name: 'quantity',
                    type: 'uint256',
                },
            ],
            name: 'ValueTransferFailed',
            type: 'event',
        },
        {
            inputs: [],
            name: 'EMPTY_PAYLOAD_HASH',
            outputs: [
                {
                    internalType: 'bytes32',
                    name: '',
                    type: 'bytes32',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'bytes',
                    name: '_options',
                    type: 'bytes',
                },
            ],
            name: '_executeNativeAirDropAndReturnLzGas',
            outputs: [
                {
                    internalType: 'uint256',
                    name: 'totalGas',
                    type: 'uint256',
                },
                {
                    internalType: 'uint256',
                    name: 'dstAmount',
                    type: 'uint256',
                },
            ],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '_oapp',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: '_srcEid',
                    type: 'uint32',
                },
                {
                    internalType: 'bytes32',
                    name: '_sender',
                    type: 'bytes32',
                },
                {
                    internalType: 'uint64',
                    name: '_nonce',
                    type: 'uint64',
                },
                {
                    internalType: 'bytes32',
                    name: '_payloadHash',
                    type: 'bytes32',
                },
            ],
            name: 'burn',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '_oapp',
                    type: 'address',
                },
                {
                    components: [
                        {
                            internalType: 'uint32',
                            name: 'srcEid',
                            type: 'uint32',
                        },
                        {
                            internalType: 'bytes32',
                            name: 'sender',
                            type: 'bytes32',
                        },
                        {
                            internalType: 'uint64',
                            name: 'nonce',
                            type: 'uint64',
                        },
                    ],
                    internalType: 'struct Origin',
                    name: '_origin',
                    type: 'tuple',
                },
                {
                    internalType: 'bytes32',
                    name: '_guid',
                    type: 'bytes32',
                },
                {
                    internalType: 'bytes',
                    name: '_message',
                    type: 'bytes',
                },
            ],
            name: 'clear',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: 'from',
                    type: 'address',
                },
                {
                    internalType: 'address',
                    name: 'to',
                    type: 'address',
                },
                {
                    internalType: 'bytes32',
                    name: 'guid',
                    type: 'bytes32',
                },
                {
                    internalType: 'uint16',
                    name: 'index',
                    type: 'uint16',
                },
            ],
            name: 'composeQueue',
            outputs: [
                {
                    internalType: 'bytes32',
                    name: 'messageHash',
                    type: 'bytes32',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
            ],
            name: 'defaultReceiveLibrary',
            outputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
            ],
            stateMutability: 'pure',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
            ],
            name: 'defaultReceiveLibraryTimeout',
            outputs: [
                {
                    internalType: 'address',
                    name: 'lib',
                    type: 'address',
                },
                {
                    internalType: 'uint256',
                    name: 'expiry',
                    type: 'uint256',
                },
            ],
            stateMutability: 'pure',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
            ],
            name: 'defaultSendLibrary',
            outputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
            ],
            stateMutability: 'pure',
            type: 'function',
        },
        {
            inputs: [],
            name: 'eid',
            outputs: [
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    components: [
                        {
                            internalType: 'uint32',
                            name: 'srcEid',
                            type: 'uint32',
                        },
                        {
                            internalType: 'bytes32',
                            name: 'sender',
                            type: 'bytes32',
                        },
                        {
                            internalType: 'uint64',
                            name: 'nonce',
                            type: 'uint64',
                        },
                    ],
                    internalType: 'struct Origin',
                    name: '',
                    type: 'tuple',
                },
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
            ],
            name: 'executable',
            outputs: [
                {
                    internalType: 'enum ExecutionState',
                    name: '',
                    type: 'uint8',
                },
            ],
            stateMutability: 'pure',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'bytes',
                    name: '_options',
                    type: 'bytes',
                },
            ],
            name: 'executeNativeAirDropAndReturnLzGas',
            outputs: [
                {
                    internalType: 'uint256',
                    name: 'totalGas',
                    type: 'uint256',
                },
                {
                    internalType: 'uint256',
                    name: 'dstAmount',
                    type: 'uint256',
                },
            ],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
            ],
            name: 'getConfig',
            outputs: [
                {
                    internalType: 'bytes',
                    name: 'config',
                    type: 'bytes',
                },
            ],
            stateMutability: 'pure',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'uint256',
                    name: '_payloadSize',
                    type: 'uint256',
                },
                {
                    internalType: 'bytes',
                    name: '_options',
                    type: 'bytes',
                },
            ],
            name: 'getExecutorFee',
            outputs: [
                {
                    internalType: 'uint256',
                    name: '',
                    type: 'uint256',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
            ],
            name: 'getReceiveLibrary',
            outputs: [
                {
                    internalType: 'address',
                    name: 'lib',
                    type: 'address',
                },
                {
                    internalType: 'bool',
                    name: 'isDefault',
                    type: 'bool',
                },
            ],
            stateMutability: 'pure',
            type: 'function',
        },
        {
            inputs: [],
            name: 'getRegisteredLibraries',
            outputs: [
                {
                    internalType: 'address[]',
                    name: '',
                    type: 'address[]',
                },
            ],
            stateMutability: 'pure',
            type: 'function',
        },
        {
            inputs: [],
            name: 'getSendContext',
            outputs: [
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
            ],
            name: 'getSendLibrary',
            outputs: [
                {
                    internalType: 'address',
                    name: 'lib',
                    type: 'address',
                },
            ],
            stateMutability: 'pure',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '_receiver',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: '_srcEid',
                    type: 'uint32',
                },
                {
                    internalType: 'bytes32',
                    name: '_sender',
                    type: 'bytes32',
                },
            ],
            name: 'inboundNonce',
            outputs: [
                {
                    internalType: 'uint64',
                    name: '',
                    type: 'uint64',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: 'receiver',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: 'srcEid',
                    type: 'uint32',
                },
                {
                    internalType: 'bytes32',
                    name: 'sender',
                    type: 'bytes32',
                },
                {
                    internalType: 'uint64',
                    name: 'inboundNonce',
                    type: 'uint64',
                },
            ],
            name: 'inboundPayloadHash',
            outputs: [
                {
                    internalType: 'bytes32',
                    name: 'payloadHash',
                    type: 'bytes32',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    components: [
                        {
                            internalType: 'uint32',
                            name: 'srcEid',
                            type: 'uint32',
                        },
                        {
                            internalType: 'bytes32',
                            name: 'sender',
                            type: 'bytes32',
                        },
                        {
                            internalType: 'uint64',
                            name: 'nonce',
                            type: 'uint64',
                        },
                    ],
                    internalType: 'struct Origin',
                    name: '_origin',
                    type: 'tuple',
                },
                {
                    internalType: 'address',
                    name: '_receiver',
                    type: 'address',
                },
            ],
            name: 'initializable',
            outputs: [
                {
                    internalType: 'bool',
                    name: '',
                    type: 'bool',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
            ],
            name: 'isDefaultSendLibrary',
            outputs: [
                {
                    internalType: 'bool',
                    name: '',
                    type: 'bool',
                },
            ],
            stateMutability: 'pure',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
            ],
            name: 'isRegisteredLibrary',
            outputs: [
                {
                    internalType: 'bool',
                    name: '',
                    type: 'bool',
                },
            ],
            stateMutability: 'pure',
            type: 'function',
        },
        {
            inputs: [],
            name: 'isSendingMessage',
            outputs: [
                {
                    internalType: 'bool',
                    name: '',
                    type: 'bool',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
            ],
            name: 'isSupportedEid',
            outputs: [
                {
                    internalType: 'bool',
                    name: '',
                    type: 'bool',
                },
            ],
            stateMutability: 'pure',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '_receiver',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: '_srcEid',
                    type: 'uint32',
                },
                {
                    internalType: 'address',
                    name: '_actualReceiveLib',
                    type: 'address',
                },
            ],
            name: 'isValidReceiveLibrary',
            outputs: [
                {
                    internalType: 'bool',
                    name: '',
                    type: 'bool',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: 'receiver',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: 'srcEid',
                    type: 'uint32',
                },
                {
                    internalType: 'bytes32',
                    name: 'sender',
                    type: 'bytes32',
                },
            ],
            name: 'lazyInboundNonce',
            outputs: [
                {
                    internalType: 'uint64',
                    name: 'nonce',
                    type: 'uint64',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'bytes32',
                    name: '',
                    type: 'bytes32',
                },
                {
                    internalType: 'uint16',
                    name: '',
                    type: 'uint16',
                },
                {
                    internalType: 'bytes',
                    name: '',
                    type: 'bytes',
                },
                {
                    internalType: 'bytes',
                    name: '',
                    type: 'bytes',
                },
            ],
            name: 'lzCompose',
            outputs: [],
            stateMutability: 'payable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
            ],
            name: 'lzEndpointLookup',
            outputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    components: [
                        {
                            internalType: 'uint32',
                            name: 'srcEid',
                            type: 'uint32',
                        },
                        {
                            internalType: 'bytes32',
                            name: 'sender',
                            type: 'bytes32',
                        },
                        {
                            internalType: 'uint64',
                            name: 'nonce',
                            type: 'uint64',
                        },
                    ],
                    internalType: 'struct Origin',
                    name: '',
                    type: 'tuple',
                },
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'bytes32',
                    name: '',
                    type: 'bytes32',
                },
                {
                    internalType: 'bytes',
                    name: '',
                    type: 'bytes',
                },
                {
                    internalType: 'bytes',
                    name: '',
                    type: 'bytes',
                },
            ],
            name: 'lzReceive',
            outputs: [],
            stateMutability: 'payable',
            type: 'function',
        },
        {
            inputs: [],
            name: 'lzToken',
            outputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
            ],
            stateMutability: 'pure',
            type: 'function',
        },
        {
            inputs: [],
            name: 'nativeToken',
            outputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
            ],
            stateMutability: 'pure',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
                {
                    internalType: 'bytes32',
                    name: '',
                    type: 'bytes32',
                },
            ],
            name: 'nextGuid',
            outputs: [
                {
                    internalType: 'bytes32',
                    name: '',
                    type: 'bytes32',
                },
            ],
            stateMutability: 'pure',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
                {
                    internalType: 'bytes32',
                    name: '',
                    type: 'bytes32',
                },
                {
                    internalType: 'uint64',
                    name: '',
                    type: 'uint64',
                },
                {
                    internalType: 'bytes32',
                    name: '',
                    type: 'bytes32',
                },
            ],
            name: 'nilify',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: 'sender',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: 'dstEid',
                    type: 'uint32',
                },
                {
                    internalType: 'bytes32',
                    name: 'receiver',
                    type: 'bytes32',
                },
            ],
            name: 'outboundNonce',
            outputs: [
                {
                    internalType: 'uint64',
                    name: 'nonce',
                    type: 'uint64',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    components: [
                        {
                            internalType: 'uint32',
                            name: 'dstEid',
                            type: 'uint32',
                        },
                        {
                            internalType: 'bytes32',
                            name: 'receiver',
                            type: 'bytes32',
                        },
                        {
                            internalType: 'bytes',
                            name: 'message',
                            type: 'bytes',
                        },
                        {
                            internalType: 'bytes',
                            name: 'options',
                            type: 'bytes',
                        },
                        {
                            internalType: 'bool',
                            name: 'payInLzToken',
                            type: 'bool',
                        },
                    ],
                    internalType: 'struct MessagingParams',
                    name: '_params',
                    type: 'tuple',
                },
                {
                    internalType: 'address',
                    name: '_sender',
                    type: 'address',
                },
            ],
            name: 'quote',
            outputs: [
                {
                    components: [
                        {
                            internalType: 'uint256',
                            name: 'nativeFee',
                            type: 'uint256',
                        },
                        {
                            internalType: 'uint256',
                            name: 'lzTokenFee',
                            type: 'uint256',
                        },
                    ],
                    internalType: 'struct MessagingFee',
                    name: '',
                    type: 'tuple',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: 'receiver',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: 'srcEid',
                    type: 'uint32',
                },
            ],
            name: 'receiveLibraryTimeout',
            outputs: [
                {
                    internalType: 'address',
                    name: 'lib',
                    type: 'address',
                },
                {
                    internalType: 'uint256',
                    name: 'expiry',
                    type: 'uint256',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    components: [
                        {
                            internalType: 'uint32',
                            name: 'srcEid',
                            type: 'uint32',
                        },
                        {
                            internalType: 'bytes32',
                            name: 'sender',
                            type: 'bytes32',
                        },
                        {
                            internalType: 'uint64',
                            name: 'nonce',
                            type: 'uint64',
                        },
                    ],
                    internalType: 'struct Origin',
                    name: '_origin',
                    type: 'tuple',
                },
                {
                    internalType: 'address',
                    name: '_receiver',
                    type: 'address',
                },
                {
                    internalType: 'bytes32',
                    name: '_payloadHash',
                    type: 'bytes32',
                },
                {
                    internalType: 'bytes',
                    name: '_message',
                    type: 'bytes',
                },
                {
                    internalType: 'uint256',
                    name: '_gas',
                    type: 'uint256',
                },
                {
                    internalType: 'uint256',
                    name: '_msgValue',
                    type: 'uint256',
                },
                {
                    internalType: 'bytes32',
                    name: '_guid',
                    type: 'bytes32',
                },
            ],
            name: 'receivePayload',
            outputs: [],
            stateMutability: 'payable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
            ],
            name: 'registerLibrary',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [],
            name: 'relayerFeeConfig',
            outputs: [
                {
                    internalType: 'uint128',
                    name: 'dstPriceRatio',
                    type: 'uint128',
                },
                {
                    internalType: 'uint128',
                    name: 'dstGasPriceInWei',
                    type: 'uint128',
                },
                {
                    internalType: 'uint128',
                    name: 'dstNativeAmtCap',
                    type: 'uint128',
                },
                {
                    internalType: 'uint64',
                    name: 'baseGas',
                    type: 'uint64',
                },
                {
                    internalType: 'uint64',
                    name: 'gasPerByte',
                    type: 'uint64',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    components: [
                        {
                            internalType: 'uint32',
                            name: 'dstEid',
                            type: 'uint32',
                        },
                        {
                            internalType: 'bytes32',
                            name: 'receiver',
                            type: 'bytes32',
                        },
                        {
                            internalType: 'bytes',
                            name: 'message',
                            type: 'bytes',
                        },
                        {
                            internalType: 'bytes',
                            name: 'options',
                            type: 'bytes',
                        },
                        {
                            internalType: 'bool',
                            name: 'payInLzToken',
                            type: 'bool',
                        },
                    ],
                    internalType: 'struct MessagingParams',
                    name: '_params',
                    type: 'tuple',
                },
                {
                    internalType: 'address',
                    name: '_refundAddress',
                    type: 'address',
                },
            ],
            name: 'send',
            outputs: [
                {
                    components: [
                        {
                            internalType: 'bytes32',
                            name: 'guid',
                            type: 'bytes32',
                        },
                        {
                            internalType: 'uint64',
                            name: 'nonce',
                            type: 'uint64',
                        },
                        {
                            components: [
                                {
                                    internalType: 'uint256',
                                    name: 'nativeFee',
                                    type: 'uint256',
                                },
                                {
                                    internalType: 'uint256',
                                    name: 'lzTokenFee',
                                    type: 'uint256',
                                },
                            ],
                            internalType: 'struct MessagingFee',
                            name: 'fee',
                            type: 'tuple',
                        },
                    ],
                    internalType: 'struct MessagingReceipt',
                    name: 'receipt',
                    type: 'tuple',
                },
            ],
            stateMutability: 'payable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'bytes32',
                    name: '',
                    type: 'bytes32',
                },
                {
                    internalType: 'uint16',
                    name: '',
                    type: 'uint16',
                },
                {
                    internalType: 'bytes',
                    name: '',
                    type: 'bytes',
                },
            ],
            name: 'sendCompose',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    components: [
                        {
                            internalType: 'uint32',
                            name: 'eid',
                            type: 'uint32',
                        },
                        {
                            internalType: 'uint32',
                            name: 'configType',
                            type: 'uint32',
                        },
                        {
                            internalType: 'bytes',
                            name: 'config',
                            type: 'bytes',
                        },
                    ],
                    internalType: 'struct SetConfigParam[]',
                    name: '',
                    type: 'tuple[]',
                },
            ],
            name: 'setConfig',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'uint256',
                    name: '',
                    type: 'uint256',
                },
            ],
            name: 'setDefaultReceiveLibrary',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'uint256',
                    name: '',
                    type: 'uint256',
                },
            ],
            name: 'setDefaultReceiveLibraryTimeout',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
            ],
            name: 'setDefaultSendLibrary',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
            ],
            name: 'setDelegate',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: 'destAddr',
                    type: 'address',
                },
                {
                    internalType: 'address',
                    name: 'lzEndpointAddr',
                    type: 'address',
                },
            ],
            name: 'setDestLzEndpoint',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
            ],
            name: 'setLzToken',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'uint256',
                    name: '',
                    type: 'uint256',
                },
            ],
            name: 'setReceiveLibrary',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'uint256',
                    name: '',
                    type: 'uint256',
                },
            ],
            name: 'setReceiveLibraryTimeout',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
            ],
            name: 'setSendLibrary',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'uint32',
                    name: '',
                    type: 'uint32',
                },
                {
                    internalType: 'bytes32',
                    name: '',
                    type: 'bytes32',
                },
                {
                    internalType: 'uint64',
                    name: '',
                    type: 'uint64',
                },
            ],
            name: 'skip',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
        {
            inputs: [
                {
                    components: [
                        {
                            internalType: 'uint32',
                            name: 'srcEid',
                            type: 'uint32',
                        },
                        {
                            internalType: 'bytes32',
                            name: 'sender',
                            type: 'bytes32',
                        },
                        {
                            internalType: 'uint64',
                            name: 'nonce',
                            type: 'uint64',
                        },
                    ],
                    internalType: 'struct Origin',
                    name: '_origin',
                    type: 'tuple',
                },
                {
                    internalType: 'address',
                    name: '_receiver',
                    type: 'address',
                },
            ],
            name: 'verifiable',
            outputs: [
                {
                    internalType: 'bool',
                    name: '',
                    type: 'bool',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    components: [
                        {
                            internalType: 'uint32',
                            name: 'srcEid',
                            type: 'uint32',
                        },
                        {
                            internalType: 'bytes32',
                            name: 'sender',
                            type: 'bytes32',
                        },
                        {
                            internalType: 'uint64',
                            name: 'nonce',
                            type: 'uint64',
                        },
                    ],
                    internalType: 'struct Origin',
                    name: '',
                    type: 'tuple',
                },
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'bytes32',
                    name: '',
                    type: 'bytes32',
                },
            ],
            name: 'verifiable',
            outputs: [
                {
                    internalType: 'bool',
                    name: '',
                    type: 'bool',
                },
            ],
            stateMutability: 'pure',
            type: 'function',
        },
        {
            inputs: [],
            name: 'verifierFee',
            outputs: [
                {
                    internalType: 'uint256',
                    name: '',
                    type: 'uint256',
                },
            ],
            stateMutability: 'view',
            type: 'function',
        },
        {
            inputs: [
                {
                    components: [
                        {
                            internalType: 'uint32',
                            name: 'srcEid',
                            type: 'uint32',
                        },
                        {
                            internalType: 'bytes32',
                            name: 'sender',
                            type: 'bytes32',
                        },
                        {
                            internalType: 'uint64',
                            name: 'nonce',
                            type: 'uint64',
                        },
                    ],
                    internalType: 'struct Origin',
                    name: '',
                    type: 'tuple',
                },
                {
                    internalType: 'address',
                    name: '',
                    type: 'address',
                },
                {
                    internalType: 'bytes32',
                    name: '',
                    type: 'bytes32',
                },
            ],
            name: 'verify',
            outputs: [],
            stateMutability: 'nonpayable',
            type: 'function',
        },
    ],
    bytecode:
        '0x60a060405260016000556001600a60006101000a81548160ff021916908360ff1602179055503480156200003257600080fd5b50604051620059fe380380620059fe8339818101604052810190620000589190620002a4565b8063ffffffff1660808163ffffffff16815250506040518060a001604052806402540be4006fffffffffffffffffffffffffffffffff1681526020016402540be4006fffffffffffffffffffffffffffffffff168152602001678ac7230489e800006fffffffffffffffffffffffffffffffff168152602001606467ffffffffffffffff168152602001600167ffffffffffffffff16815250600560008201518160000160006101000a8154816fffffffffffffffffffffffffffffffff02191690836fffffffffffffffffffffffffffffffff16021790555060208201518160000160106101000a8154816fffffffffffffffffffffffffffffffff02191690836fffffffffffffffffffffffffffffffff16021790555060408201518160010160006101000a8154816fffffffffffffffffffffffffffffffff02191690836fffffffffffffffffffffffffffffffff16021790555060608201518160010160106101000a81548167ffffffffffffffff021916908367ffffffffffffffff16021790555060808201518160010160186101000a81548167ffffffffffffffff021916908367ffffffffffffffff1602179055509050506040518060400160405280670de0b6b3a764000081526020016103e881525060076000820151816000015560208201518160010155905050662386f26fc1000060098190555050620002d6565b600080fd5b600063ffffffff82169050919050565b6200027e8162000263565b81146200028a57600080fd5b50565b6000815190506200029e8162000273565b92915050565b600060208284031215620002bd57620002bc6200025e565b5b6000620002cd848285016200028d565b91505092915050565b6080516156fe620003006000396000818161109401528181611108015261157c01526156fe6000f3fe60806040526004361061036b5760003560e01c806391d20fa1116101c6578063c9fc7bcd116100f7578063ddc28c5811610095578063e4fe1d941161006f578063e4fe1d9414610d9d578063e8964e8114610dc8578063ef667aa114610df1578063f64be4c714610e2f5761036b565b8063ddc28c5814610cf8578063e1758bd814610d35578063e1e3a7df14610d605761036b565b8063d4b4ec8f116100d1578063d4b4ec8f14610c2c578063d70b890214610c55578063dc706a6214610c7e578063dc93c8a214610cbb5761036b565b8063c9fc7bcd14610b9b578063ca5eb5e114610bd8578063cb5026b914610c015761036b565b8063aafe5e0711610164578063c08f15a11161013e578063c08f15a114610acf578063c28e0eed14610af8578063c81b383a14610b21578063c9a54a9914610b5e5761036b565b8063aafe5e0714610a2c578063aafea31214610a69578063b96a277f14610a925761036b565b80639d7f9775116101a05780639d7f977514610960578063a0dd43fc1461099d578063a718531b146109da578063a825d74714610a035761036b565b806391d20fa1146108de5780639535ff30146108fa5780639c6d7340146109235761036b565b80635b17bb70116102a05780636f50a8031161023e578063861e1ca511610218578063861e1ca51461080a5780638e7ef0cd14610847578063907c5e7e146108845780639132e5c3146108b35761036b565b80636f50a8031461077957806379624ca9146107b65780637cb59012146107e15761036b565b80636a14d7151161027a5780636a14d715146106be5780636be8e9db146106e75780636dbd9f90146107125780636e83f5bb1461073b5761036b565b80635b17bb70146106065780636750cd4c1461064357806369d9ac39146106805761036b565b80632e80fbf31161030d57806340f80683116102e757806340f8068314610559578063416ecebf146105825780634b4b2efb146105ad578063511cc6b5146105ea5761036b565b80632e80fbf3146104b557806335d330b0146104de578063402f84681461051b5761036b565b80632637a450116103495780632637a450146103e15780632a56c1b0146104115780632b2dd27c1461043a5780632b3197b9146104785761036b565b80630c0c389e1461037057806314f651a91461038c578063183c834f146103b8575b600080fd5b61038a600480360381019061038591906135f0565b610e6c565b005b34801561039857600080fd5b506103a1610e75565b6040516103af9291906136da565b60405180910390f35b3480156103c457600080fd5b506103df60048036038101906103da9190613765565b610ea0565b005b6103fb60048036038101906103f691906137eb565b610ea6565b60405161040891906138f9565b60405180910390f35b34801561041d57600080fd5b5061043860048036038101906104339190613914565b61143a565b005b34801561044657600080fd5b50610461600480360381019061045c919061399c565b611441565b60405161046f9291906139f8565b60405180910390f35b34801561048457600080fd5b5061049f600480360381019061049a9190613a21565b6114da565b6040516104ac9190613b18565b60405180910390f35b3480156104c157600080fd5b506104dc60048036038101906104d79190613b66565b61151c565b005b3480156104ea57600080fd5b5061050560048036038101906105009190613c1b565b611523565b6040516105129190613c91565b60405180910390f35b34801561052757600080fd5b50610542600480360381019061053d9190613cac565b611562565b604051610550929190613d07565b60405180910390f35b34801561056557600080fd5b50610580600480360381019061057b9190613b66565b611573565b005b34801561058e57600080fd5b5061059761157a565b6040516105a49190613d30565b60405180910390f35b3480156105b957600080fd5b506105d460048036038101906105cf9190613d4b565b61159e565b6040516105e19190613e02565b60405180910390f35b61060460048036038101906105ff9190613e1d565b6115a6565b005b34801561061257600080fd5b5061062d60048036038101906106289190613ee1565b611868565b60405161063a9190613f43565b60405180910390f35b34801561064f57600080fd5b5061066a60048036038101906106659190613f5e565b6118ab565b6040516106779190613f8b565b60405180910390f35b34801561068c57600080fd5b506106a760048036038101906106a2919061399c565b6118b2565b6040516106b59291906139f8565b60405180910390f35b3480156106ca57600080fd5b506106e560048036038101906106e09190613765565b611b32565b005b3480156106f357600080fd5b506106fc611b38565b6040516107099190613fa6565b60405180910390f35b34801561071e57600080fd5b5061073960048036038101906107349190614017565b611b3e565b005b34801561074757600080fd5b50610762600480360381019061075d9190613f5e565b611b44565b60405161077092919061408b565b60405180910390f35b34801561078557600080fd5b506107a0600480360381019061079b9190613f5e565b611b53565b6040516107ad91906140b4565b60405180910390f35b3480156107c257600080fd5b506107cb611b5a565b6040516107d89190613f8b565b60405180910390f35b3480156107ed57600080fd5b50610808600480360381019061080391906140cf565b611b68565b005b34801561081657600080fd5b50610831600480360381019061082c9190613d4b565b611b6f565b60405161083e9190613f8b565b60405180910390f35b34801561085357600080fd5b5061086e60048036038101906108699190614157565b611c1b565b60405161087b9190613fa6565b60405180910390f35b34801561089057600080fd5b50610899611dd4565b6040516108aa9594939291906141e2565b60405180910390f35b3480156108bf57600080fd5b506108c8611e74565b6040516108d591906142f3565b60405180910390f35b6108f860048036038101906108f39190614315565b611f1b565b005b34801561090657600080fd5b50610921600480360381019061091c91906143e4565b611f25565b005b34801561092f57600080fd5b5061094a60048036038101906109459190613ee1565b611f2a565b6040516109579190613f43565b60405180910390f35b34801561096c57600080fd5b50610987600480360381019061098291906143e4565b611f6d565b6040516109949190613f8b565b60405180910390f35b3480156109a957600080fd5b506109c460048036038101906109bf9190613ee1565b611f7a565b6040516109d19190613f43565b60405180910390f35b3480156109e657600080fd5b50610a0160048036038101906109fc9190614437565b612007565b005b348015610a0f57600080fd5b50610a2a6004803603810190610a25919061448a565b61200c565b005b348015610a3857600080fd5b50610a536004803603810190610a4e9190613ee1565b612011565b604051610a609190613c91565b60405180910390f35b348015610a7557600080fd5b50610a906004803603810190610a8b91906144dd565b612020565b005b348015610a9e57600080fd5b50610ab96004803603810190610ab49190613cac565b612024565b604051610ac691906140b4565b60405180910390f35b348015610adb57600080fd5b50610af66004803603810190610af1919061451d565b61202c565b005b348015610b0457600080fd5b50610b1f6004803603810190610b1a919061455d565b6120ae565b005b348015610b2d57600080fd5b50610b486004803603810190610b43919061455d565b6120b1565b604051610b5591906140b4565b60405180910390f35b348015610b6a57600080fd5b50610b856004803603810190610b809190613d4b565b6120e4565b604051610b929190613f8b565b60405180910390f35b348015610ba757600080fd5b50610bc26004803603810190610bbd919061458a565b612190565b604051610bcf9190613c91565b60405180910390f35b348015610be457600080fd5b50610bff6004803603810190610bfa919061455d565b6121cf565b005b348015610c0d57600080fd5b50610c166121d2565b604051610c239190613c91565b60405180910390f35b348015610c3857600080fd5b50610c536004803603810190610c4e9190614437565b6121d9565b005b348015610c6157600080fd5b50610c7c6004803603810190610c77919061458a565b6121de565b005b348015610c8a57600080fd5b50610ca56004803603810190610ca0919061455d565b6121e4565b604051610cb29190613f8b565b60405180910390f35b348015610cc757600080fd5b50610ce26004803603810190610cdd9190613cac565b6121eb565b604051610cef9190613f8b565b60405180910390f35b348015610d0457600080fd5b50610d1f6004803603810190610d1a91906137eb565b6121f3565b604051610d2c9190614620565b60405180910390f35b348015610d4157600080fd5b50610d4a61220d565b604051610d5791906140b4565b60405180910390f35b348015610d6c57600080fd5b50610d876004803603810190610d82919061463b565b612212565b604051610d949190613f8b565b60405180910390f35b348015610da957600080fd5b50610db261221c565b604051610dbf91906140b4565b60405180910390f35b348015610dd457600080fd5b50610def6004803603810190610dea919061455d565b612221565b005b348015610dfd57600080fd5b50610e186004803603810190610e139190613cac565b612224565b604051610e2692919061408b565b60405180910390f35b348015610e3b57600080fd5b50610e566004803603810190610e519190613f5e565b612275565b604051610e6391906140b4565b60405180910390f35b50505050505050565b600080610e80611b5a565b610e8c57600080610e98565b610e9760005461227c565b5b915091509091565b50505050565b610eae61345e565b826000016020810190610ec19190613f5e565b33600160005414610efe576040517fee120b0900000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b8073ffffffffffffffffffffffffffffffffffffffff1660a08363ffffffff16901b17600081905550846080016020810190610f3a91906146ce565b15610f71576040517f5af6d2aa00000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b600060016000610f84886020013561228e565b73ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060009054906101000a900473ffffffffffffffffffffffffffffffffffffffff169050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1603611050576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016110479061477e565b60405180910390fd5b6000611073338860000160208101906110699190613f5e565b896020013561229b565b905060006040518060e001604052808367ffffffffffffffff1681526020017f000000000000000000000000000000000000000000000000000000000000000063ffffffff1681526020013373ffffffffffffffffffffffffffffffffffffffff1681526020018960000160208101906110ed9190613f5e565b63ffffffff16815260200189602001358152602001611145847f0000000000000000000000000000000000000000000000000000000000000000338d600001602081019061113b9190613f5e565b8e60200135612352565b815260200189806040019061115a91906147ad565b8080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f8201169050808301925050505050505081525090508060a001518660000181815250508060000151866020019067ffffffffffffffff16908167ffffffffffffffff16815250506111de88336123ac565b8660400181905250856040015160000151341015611231576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161122890614882565b60405180910390fd5b60008660400151600001513461124791906148d1565b905060008111156113005760008873ffffffffffffffffffffffffffffffffffffffff168260405161127890614936565b60006040518083038185875af1925050503d80600081146112b5576040519150601f19603f3d011682016040523d82523d6000602084013e6112ba565b606091505b50509050806112fe576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016112f590614997565b60405180910390fd5b505b60008061131b8b806060019061131691906147ad565b611441565b809250819350505060006040518060600160405280866020015163ffffffff168152602001611363876040015173ffffffffffffffffffffffffffffffffffffffff1661249b565b8152602001866000015167ffffffffffffffff1681525090506000611387866124be565b90506000818051906020012090508873ffffffffffffffffffffffffffffffffffffffff1663511cc6b585856113c08b6080015161228e565b858c60c001518b8b8f60a001516040518963ffffffff1660e01b81526004016113ef9796959493929190614a08565b6000604051808303818588803b15801561140857600080fd5b505af115801561141c573d6000803e3d6000fd5b50505050505050505050505050506001600081905550505092915050565b5050505050565b600080600061145085856124f1565b5090503073ffffffffffffffffffffffffffffffffffffffff166369d9ac39826040518263ffffffff1660e01b815260040161148c9190613b18565b60408051808303816000875af11580156114aa573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906114ce9190614a95565b92509250509250929050565b60606040518060400160405280600281526020017f30780000000000000000000000000000000000000000000000000000000000008152509050949350505050565b5050505050565b600b6020528360005260406000206020528260005260406000206020528160005260406000206020528060005260406000206000935093505050505481565b600080600080915091509250929050565b5050505050565b7f000000000000000000000000000000000000000000000000000000000000000081565b600092915050565b600160ff16600a60009054906101000a900460ff1660ff16146115fe576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004016115f590614b47565b60405180910390fd5b6002600a60006101000a81548160ff021916908360ff16021790555085600360008973ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060008a600001602081019061166f9190613f5e565b63ffffffff1663ffffffff16815260200190815260200160002060008a60200135815260200190815260200160002060008a60400160208101906116b39190614b67565b67ffffffffffffffff1667ffffffffffffffff168152602001908152602001600020819055506000821115611795578673ffffffffffffffffffffffffffffffffffffffff166313137d658385908b858a8a60006040518863ffffffff1660e01b8152600401611727959493929190614c92565b6000604051808303818589803b15801561174057600080fd5b5088f19450505050508015611753575060015b61178f573d8060008114611783576040519150601f19603f3d011682016040523d82523d6000602084013e611788565b606091505b5050611790565b5b611842565b8673ffffffffffffffffffffffffffffffffffffffff166313137d65848a84898960006040518763ffffffff1660e01b81526004016117d8959493929190614c92565b600060405180830381600088803b1580156117f257600080fd5b5087f193505050508015611804575060015b611840573d8060008114611834576040519150601f19603f3d011682016040523d82523d6000602084013e611839565b606091505b5050611841565b5b5b6001600a60006101000a81548160ff021916908360ff1602179055505050505050505050565b6002602052826000526040600020602052816000526040600020602052806000526040600020600092509250509054906101000a900467ffffffffffffffff1681565b6000919050565b600080600084849050036118f1576040517e575ea100000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b60005b84849050811015611ae35760003660008061191a858a8a6127809290919263ffffffff16565b9350935093509350809450600160ff168460ff160361198b576000806119408585612800565b91509150816fffffffffffffffffffffffffffffffff16896119629190614cf3565b9850806fffffffffffffffffffffffffffffffff16886119829190614cf3565b97505050611ada565b600260ff168460ff1603611a9c576000806119a6858561289c565b9150915060006119b58261228e565b73ffffffffffffffffffffffffffffffffffffffff16836fffffffffffffffffffffffffffffffff166040516119ea90614936565b60006040518083038185875af1925050503d8060008114611a27576040519150601f19603f3d011682016040523d82523d6000602084013e611a2c565b606091505b5050905080611a9457826fffffffffffffffffffffffffffffffff16611a518361228e565b73ffffffffffffffffffffffffffffffffffffffff167f2c7a964ca3de5ec1d42d9822f9bbd0eb142a59cc9f855e9d93813b773192c7a360405160405180910390a35b505050611ad9565b836040517f052e5515000000000000000000000000000000000000000000000000000000008152600401611ad09190614d43565b60405180910390fd5b5b505050506118f4565b848490508114611b2a57806040517f990776ea000000000000000000000000000000000000000000000000000000008152600401611b219190613fa6565b60405180910390fd5b509250929050565b50505050565b60095481565b50505050565b60008060008091509150915091565b6000919050565b600060016000541415905090565b5050505050565b6000611c138383600260008673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000206000876000016020810190611bca9190613f5e565b63ffffffff1663ffffffff16815260200190815260200160002060008760200135815260200190815260200160002060009054906101000a900467ffffffffffffffff16612913565b905092915050565b600080600080611c2b86866129ac565b91509150600081600560010160109054906101000a900467ffffffffffffffff1667ffffffffffffffff16611c609190614cf3565b600560000160109054906101000a90046fffffffffffffffffffffffffffffffff166fffffffffffffffffffffffffffffffff16611c9e9190614d5e565b90508083611cac9190614cf3565b84611cb79190614cf3565b935060006402540be400600560000160009054906101000a90046fffffffffffffffffffffffffffffffff166fffffffffffffffffffffffffffffffff1686611d009190614d5e565b611d0a9190614dcf565b90506000896402540be400600560000160009054906101000a90046fffffffffffffffffffffffffffffffff16600560010160189054906101000a900467ffffffffffffffff1667ffffffffffffffff16600560000160109054906101000a90046fffffffffffffffffffffffffffffffff16611d879190614e00565b611d919190614e00565b611d9b9190614e3d565b6fffffffffffffffffffffffffffffffff16611db79190614d5e565b90508082611dc59190614cf3565b96505050505050509392505050565b60058060000160009054906101000a90046fffffffffffffffffffffffffffffffff16908060000160109054906101000a90046fffffffffffffffffffffffffffffffff16908060010160009054906101000a90046fffffffffffffffffffffffffffffffff16908060010160109054906101000a900467ffffffffffffffff16908060010160189054906101000a900467ffffffffffffffff16905085565b60606000600167ffffffffffffffff811115611e9357611e92614e6e565b5b604051908082528060200260200182016040528015611ec15781602001602082028036833780820191505090505b509050600081600081518110611eda57611ed9614e9d565b5b602002602001019073ffffffffffffffffffffffffffffffffffffffff16908173ffffffffffffffffffffffffffffffffffffffff16815250508091505090565b5050505050505050565b505050565b6004602052826000526040600020602052816000526040600020602052806000526040600020600092509250509054906101000a900467ffffffffffffffff1681565b6000600190509392505050565b6000600260008573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060008463ffffffff1663ffffffff168152602001908152602001600020600083815260200190815260200160002060009054906101000a900467ffffffffffffffff1690509392505050565b505050565b505050565b60008060001b90509392505050565b5050565b600092915050565b80600160008473ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060006101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505050565b50565b60016020528060005260406000206000915054906101000a900473ffffffffffffffffffffffffffffffffffffffff1681565b60006121888383600260008673ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff168152602001908152602001600020600087600001602081019061213f9190613f5e565b63ffffffff1663ffffffff16815260200190815260200160002060008760200135815260200190815260200160002060009054906101000a900467ffffffffffffffff16612c86565b905092915050565b60036020528360005260406000206020528260005260406000206020528160005260406000206020528060005260406000206000935093505050505481565b50565b6000801b81565b505050565b50505050565b6000919050565b600092915050565b6121fb613492565b61220583836123ac565b905092915050565b600090565b6000949350505050565b600090565b50565b600c602052816000526040600020602052806000526040600020600091509150508060000160009054906101000a900473ffffffffffffffffffffffffffffffffffffffff16908060010154905082565b6000919050565b60008060a083901c8391509150915091565b60008160001c9050919050565b6000600460008573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff16815260200190815260200160002060008463ffffffff1663ffffffff1681526020019081526020016000206000838152602001908152602001600020600081819054906101000a900467ffffffffffffffff1660010191906101000a81548167ffffffffffffffff021916908367ffffffffffffffff160217905590509392505050565b600085856123758673ffffffffffffffffffffffffffffffffffffffff16612d82565b858560405160200161238b959493929190614f59565b60405160208183030381529060405280519060200120905095945050505050565b6123b4613492565b60006123ce8480606001906123c991906147ad565b612da5565b50905060003073ffffffffffffffffffffffffffffffffffffffff16638e7ef0cd8680604001906123ff91906147ad565b9050846040518363ffffffff1660e01b815260040161241f929190614fb8565b602060405180830381865afa15801561243c573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906124609190614fe8565b9050600061247082600954612ec5565b9050600084602001818152505080826124899190614cf3565b84600001818152505050505092915050565b60008173ffffffffffffffffffffffffffffffffffffffff1660001b9050919050565b60608160a001518260c001516040516020016124db929190615046565b6040516020818303038152906040529050919050565b606080600284849050101561253e5760006040517f6592671c00000000000000000000000000000000000000000000000000000000815260040161253591906150b3565b60405180910390fd5b60008484600090600292612554939291906150d8565b9061255f9190615157565b60f01c9050600060029050600361ffff168261ffff160361276957600081905060005b878790508310156126de5760008888859060018701926125a4939291906150d8565b906125af91906151e2565b60f81c905060008160ff16036125fd5760006040517f6780cfaf0000000000000000000000000000000000000000000000000000000081526004016125f49190615272565b60405180910390fd5b60008260ff160361261057809150612655565b8160ff168160ff1614612654573660008a8a86908892612632939291906150d8565b915091506126438989868585612ef8565b809950819a50505085945082935050505b5b8360010193506000898986906002880192612672939291906150d8565b9061267d9190615157565b60f01c905060008161ffff16036126cb57846040517f6592671c0000000000000000000000000000000000000000000000000000000081526004016126c29190613fa6565b60405180910390fd5b6002810161ffff16850194505050612582565b87879050831461272557826040517f6592671c00000000000000000000000000000000000000000000000000000000815260040161271c9190613fa6565b60405180910390fd5b600288889050111561276257366000898985908792612746939291906150d8565b915091506127578888858585612ef8565b809850819950505050505b5050612777565b612774828787613063565b93505b50509250929050565b60003660008060018501905060006127a38289896132889290919263ffffffff16565b90506002820191506127c08289896132bb9290919263ffffffff16565b9450600060018301905060008261ffff16840190508989839083926127e7939291906150d8565b955095508261ffff168401935050505093509350935093565b6000806010848490501415801561281b575060208484905014155b15612852576040517f4796aee100000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b612868600085856132e69290919263ffffffff16565b91506020848490501461287c576000612893565b612892601085856132e69290919263ffffffff16565b5b90509250929050565b600080603084849050146128dc576040517fc3a1858e00000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b6128f2600085856132e69290919263ffffffff16565b915061290a601085856133199290919263ffffffff16565b90509250929050565b6000808267ffffffffffffffff1611806129a357508273ffffffffffffffffffffffffffffffffffffffff1663ff7bd03d856040518263ffffffff1660e01b8152600401612961919061528d565b602060405180830381865afa15801561297e573d6000803e3d6000fd5b505050506040513d601f19601f820116820180604052508101906129a291906152bd565b5b90509392505050565b600080600084849050036129eb576040517e575ea100000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b6000600560010160109054906101000a900467ffffffffffffffff1667ffffffffffffffff1691505b84849050811015612b9d57600036600080612a3a858a8a6127809290919263ffffffff16565b9350935093509350809450600160ff168460ff1603612aab57600080612a608585612800565b91509150806fffffffffffffffffffffffffffffffff1689612a829190614cf3565b9850816fffffffffffffffffffffffffffffffff1688612aa29190614cf3565b97505050612b94565b600260ff168460ff1603612aee576000612ac5848461289c565b509050806fffffffffffffffffffffffffffffffff1688612ae69190614cf3565b975050612b93565b600360ff168460ff1603612b5557600080612b098585613349565b9250925050806fffffffffffffffffffffffffffffffff1689612b2c9190614cf3565b9850816fffffffffffffffffffffffffffffffff1688612b4c9190614cf3565b97505050612b92565b836040517f052e5515000000000000000000000000000000000000000000000000000000008152600401612b899190614d43565b60405180910390fd5b5b5b50505050612a14565b848490508114612be457806040517f990776ea000000000000000000000000000000000000000000000000000000008152600401612bdb9190613fa6565b60405180910390fd5b600560010160009054906101000a90046fffffffffffffffffffffffffffffffff166fffffffffffffffffffffffffffffffff16831115612c7e5782600560010160009054906101000a90046fffffffffffffffffffffffffffffffff166040517e84ce02000000000000000000000000000000000000000000000000000000008152600401612c7592919061531b565b60405180910390fd5b509250929050565b60008167ffffffffffffffff16846040016020810190612ca69190614b67565b67ffffffffffffffff161180612d7957506000801b600360008573ffffffffffffffffffffffffffffffffffffffff1673ffffffffffffffffffffffffffffffffffffffff1681526020019081526020016000206000866000016020810190612d0f9190613f5e565b63ffffffff1663ffffffff1681526020019081526020016000206000866020013581526020019081526020016000206000866040016020810190612d539190614b67565b67ffffffffffffffff1667ffffffffffffffff1681526020019081526020016000205414155b90509392505050565b60008173ffffffffffffffffffffffffffffffffffffffff1660001b9050919050565b606080600080612db586866124f1565b915091506000815103612e235781600067ffffffffffffffff811115612dde57612ddd614e6e565b5b604051908082528060200260200182016040528015612e1757816020015b612e046134ac565b815260200190600190039081612dfc5790505b50935093505050612ebe565b6000600167ffffffffffffffff811115612e4057612e3f614e6e565b5b604051908082528060200260200182016040528015612e7957816020015b612e666134ac565b815260200190600190039081612e5e5790505b5090506040518060400160405280600260ff1681526020018381525081600081518110612ea957612ea8614e9d565b5b60200260200101819052508281945094505050505b9250929050565b60006127106007600101548385612edc9190614cf3565b612ee69190614d5e565b612ef09190614dcf565b905092915050565b606080600160ff168560ff1603612f88576000875114612f3b57868484604051602001612f2793929190615369565b604051602081830303815290604052612f81565b83838080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050505b9650613053565b600260ff168560ff1603613015576000865114612fc857858484604051602001612fb493929190615369565b60405160208183030381529060405261300e565b83838080601f016020809104026020016040519081016040528093929190818152602001838380828437600081840152601f19601f820116905080830192505050505050505b9550613052565b846040517f6780cfaf0000000000000000000000000000000000000000000000000000000081526004016130499190614d43565b60405180910390fd5b5b8686915091509550959350505050565b6060600161ffff168461ffff160361311157602283839050146130b2576040517f0dc652a800000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b60006130de84846002906022926130cb939291906150d8565b906130d6919061538f565b60001c6133ff565b9050600160116001836040516020016130fa9493929190615490565b604051602081830303815290604052915050613281565b600261ffff168461ffff1603613243576042838390501115806131375750606283839050115b1561316e576040517fc0927c5600000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b600061319a8484600290602292613187939291906150d8565b90613192919061538f565b60001c6133ff565b905060006131c885856022906042926131b5939291906150d8565b906131c0919061538f565b60001c6133ff565b9050600080604287879050039050868660429080926131e9939291906150d8565b906131f4919061538f565b91508060200360080282901c91505060016011600185600160316002888860405160200161322a999897969594939291906154de565b6040516020818303038152906040529350505050613280565b836040517f417051300000000000000000000000000000000000000000000000000000000081526004016132779190615590565b60405180910390fd5b5b9392505050565b6000806002830190508484849083926132a3939291906150d8565b906132ae9190615157565b60f01c9150509392505050565b60008383838181106132d0576132cf614e9d565b5b9050013560f81c60f81b60f81c90509392505050565b600080601083019050848484908392613301939291906150d8565b9061330c91906155d7565b60801c9150509392505050565b600080602083019050848484908392613334939291906150d8565b9061333f919061538f565b9150509392505050565b600080600060128585905014158015613366575060228585905014155b1561339d576040517f8b4aa70b00000000000000000000000000000000000000000000000000000000815260040160405180910390fd5b6133b3600086866132889290919263ffffffff16565b92506133cb600286866132e69290919263ffffffff16565b9150602285859050146133df5760006133f6565b6133f5601286866132e69290919263ffffffff16565b5b90509250925092565b60006fffffffffffffffffffffffffffffffff8016821115613456576040517f08c379a000000000000000000000000000000000000000000000000000000000815260040161344d906156a8565b60405180910390fd5b819050919050565b604051806060016040528060008019168152602001600067ffffffffffffffff16815260200161348c613492565b81525090565b604051806040016040528060008152602001600081525090565b6040518060400160405280600060ff168152602001606081525090565b600080fd5b600080fd5b600080fd5b6000606082840312156134ee576134ed6134d3565b5b81905092915050565b600073ffffffffffffffffffffffffffffffffffffffff82169050919050565b6000613522826134f7565b9050919050565b61353281613517565b811461353d57600080fd5b50565b60008135905061354f81613529565b92915050565b6000819050919050565b61356881613555565b811461357357600080fd5b50565b6000813590506135858161355f565b92915050565b600080fd5b600080fd5b600080fd5b60008083601f8401126135b0576135af61358b565b5b8235905067ffffffffffffffff8111156135cd576135cc613590565b5b6020830191508360018202830111156135e9576135e8613595565b5b9250929050565b600080600080600080600060e0888a03121561360f5761360e6134c9565b5b600061361d8a828b016134d8565b975050606061362e8a828b01613540565b965050608061363f8a828b01613576565b95505060a088013567ffffffffffffffff8111156136605761365f6134ce565b5b61366c8a828b0161359a565b945094505060c088013567ffffffffffffffff81111561368f5761368e6134ce565b5b61369b8a828b0161359a565b925092505092959891949750929550565b600063ffffffff82169050919050565b6136c5816136ac565b82525050565b6136d481613517565b82525050565b60006040820190506136ef60008301856136bc565b6136fc60208301846136cb565b9392505050565b61370c816136ac565b811461371757600080fd5b50565b60008135905061372981613703565b92915050565b6000819050919050565b6137428161372f565b811461374d57600080fd5b50565b60008135905061375f81613739565b92915050565b6000806000806080858703121561377f5761377e6134c9565b5b600061378d87828801613540565b945050602061379e8782880161371a565b93505060406137af87828801613540565b92505060606137c087828801613750565b91505092959194509250565b600060a082840312156137e2576137e16134d3565b5b81905092915050565b60008060408385031215613802576138016134c9565b5b600083013567ffffffffffffffff8111156138205761381f6134ce565b5b61382c858286016137cc565b925050602061383d85828601613540565b9150509250929050565b61385081613555565b82525050565b600067ffffffffffffffff82169050919050565b61387381613856565b82525050565b6138828161372f565b82525050565b60408201600082015161389e6000850182613879565b5060208201516138b16020850182613879565b50505050565b6080820160008201516138cd6000850182613847565b5060208201516138e0602085018261386a565b5060408201516138f36040850182613888565b50505050565b600060808201905061390e60008301846138b7565b92915050565b600080600080600060c086880312156139305761392f6134c9565b5b600061393e88828901613540565b955050602061394f888289016134d8565b945050608061396088828901613576565b93505060a086013567ffffffffffffffff811115613981576139806134ce565b5b61398d8882890161359a565b92509250509295509295909350565b600080602083850312156139b3576139b26134c9565b5b600083013567ffffffffffffffff8111156139d1576139d06134ce565b5b6139dd8582860161359a565b92509250509250929050565b6139f28161372f565b82525050565b6000604082019050613a0d60008301856139e9565b613a1a60208301846139e9565b9392505050565b60008060008060808587031215613a3b57613a3a6134c9565b5b6000613a4987828801613540565b9450506020613a5a87828801613540565b9350506040613a6b8782880161371a565b9250506060613a7c8782880161371a565b91505092959194509250565b600081519050919050565b600082825260208201905092915050565b60005b83811015613ac2578082015181840152602081019050613aa7565b60008484015250505050565b6000601f19601f8301169050919050565b6000613aea82613a88565b613af48185613a93565b9350613b04818560208601613aa4565b613b0d81613ace565b840191505092915050565b60006020820190508181036000830152613b328184613adf565b905092915050565b613b4381613856565b8114613b4e57600080fd5b50565b600081359050613b6081613b3a565b92915050565b600080600080600060a08688031215613b8257613b816134c9565b5b6000613b9088828901613540565b9550506020613ba18882890161371a565b9450506040613bb288828901613576565b9350506060613bc388828901613b51565b9250506080613bd488828901613576565b9150509295509295909350565b600061ffff82169050919050565b613bf881613be1565b8114613c0357600080fd5b50565b600081359050613c1581613bef565b92915050565b60008060008060808587031215613c3557613c346134c9565b5b6000613c4387828801613540565b9450506020613c5487828801613540565b9350506040613c6587828801613576565b9250506060613c7687828801613c06565b91505092959194509250565b613c8b81613555565b82525050565b6000602082019050613ca66000830184613c82565b92915050565b60008060408385031215613cc357613cc26134c9565b5b6000613cd185828601613540565b9250506020613ce28582860161371a565b9150509250929050565b60008115159050919050565b613d0181613cec565b82525050565b6000604082019050613d1c60008301856136cb565b613d296020830184613cf8565b9392505050565b6000602082019050613d4560008301846136bc565b92915050565b60008060808385031215613d6257613d616134c9565b5b6000613d70858286016134d8565b9250506060613d8185828601613540565b9150509250929050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052602160045260246000fd5b60048110613dcb57613dca613d8b565b5b50565b6000819050613ddc82613dba565b919050565b6000613dec82613dce565b9050919050565b613dfc81613de1565b82525050565b6000602082019050613e176000830184613df3565b92915050565b600080600080600080600080610120898b031215613e3e57613e3d6134c9565b5b6000613e4c8b828c016134d8565b9850506060613e5d8b828c01613540565b9750506080613e6e8b828c01613576565b96505060a089013567ffffffffffffffff811115613e8f57613e8e6134ce565b5b613e9b8b828c0161359a565b955095505060c0613eae8b828c01613750565b93505060e0613ebf8b828c01613750565b925050610100613ed18b828c01613576565b9150509295985092959890939650565b600080600060608486031215613efa57613ef96134c9565b5b6000613f0886828701613540565b9350506020613f198682870161371a565b9250506040613f2a86828701613576565b9150509250925092565b613f3d81613856565b82525050565b6000602082019050613f586000830184613f34565b92915050565b600060208284031215613f7457613f736134c9565b5b6000613f828482850161371a565b91505092915050565b6000602082019050613fa06000830184613cf8565b92915050565b6000602082019050613fbb60008301846139e9565b92915050565b60008083601f840112613fd757613fd661358b565b5b8235905067ffffffffffffffff811115613ff457613ff3613590565b5b6020830191508360208202830111156140105761400f613595565b5b9250929050565b60008060008060608587031215614031576140306134c9565b5b600061403f87828801613540565b945050602061405087828801613540565b935050604085013567ffffffffffffffff811115614071576140706134ce565b5b61407d87828801613fc1565b925092505092959194509250565b60006040820190506140a060008301856136cb565b6140ad60208301846139e9565b9392505050565b60006020820190506140c960008301846136cb565b92915050565b6000806000806000608086880312156140eb576140ea6134c9565b5b60006140f988828901613540565b955050602061410a88828901613576565b945050604061411b88828901613c06565b935050606086013567ffffffffffffffff81111561413c5761413b6134ce565b5b6141488882890161359a565b92509250509295509295909350565b6000806000604084860312156141705761416f6134c9565b5b600061417e86828701613750565b935050602084013567ffffffffffffffff81111561419f5761419e6134ce565b5b6141ab8682870161359a565b92509250509250925092565b60006fffffffffffffffffffffffffffffffff82169050919050565b6141dc816141b7565b82525050565b600060a0820190506141f760008301886141d3565b61420460208301876141d3565b61421160408301866141d3565b61421e6060830185613f34565b61422b6080830184613f34565b9695505050505050565b600081519050919050565b600082825260208201905092915050565b6000819050602082019050919050565b61426a81613517565b82525050565b600061427c8383614261565b60208301905092915050565b6000602082019050919050565b60006142a082614235565b6142aa8185614240565b93506142b583614251565b8060005b838110156142e65781516142cd8882614270565b97506142d883614288565b9250506001810190506142b9565b5085935050505092915050565b6000602082019050818103600083015261430d8184614295565b905092915050565b60008060008060008060008060c0898b031215614335576143346134c9565b5b60006143438b828c01613540565b98505060206143548b828c01613540565b97505060406143658b828c01613576565b96505060606143768b828c01613c06565b955050608089013567ffffffffffffffff811115614397576143966134ce565b5b6143a38b828c0161359a565b945094505060a089013567ffffffffffffffff8111156143c6576143c56134ce565b5b6143d28b828c0161359a565b92509250509295985092959890939650565b6000806000606084860312156143fd576143fc6134c9565b5b600061440b86828701613540565b935050602061441c8682870161371a565b925050604061442d86828701613540565b9150509250925092565b6000806000606084860312156144505761444f6134c9565b5b600061445e8682870161371a565b935050602061446f86828701613540565b925050604061448086828701613750565b9150509250925092565b600080600060a084860312156144a3576144a26134c9565b5b60006144b1868287016134d8565b93505060606144c286828701613540565b92505060806144d386828701613576565b9150509250925092565b600080604083850312156144f4576144f36134c9565b5b60006145028582860161371a565b925050602061451385828601613540565b9150509250929050565b60008060408385031215614534576145336134c9565b5b600061454285828601613540565b925050602061455385828601613540565b9150509250929050565b600060208284031215614573576145726134c9565b5b600061458184828501613540565b91505092915050565b600080600080608085870312156145a4576145a36134c9565b5b60006145b287828801613540565b94505060206145c38782880161371a565b93505060406145d487828801613576565b92505060606145e587828801613b51565b91505092959194509250565b6040820160008201516146076000850182613879565b50602082015161461a6020850182613879565b50505050565b600060408201905061463560008301846145f1565b92915050565b60008060008060c08587031215614655576146546134c9565b5b6000614663878288016134d8565b945050606061467487828801613540565b935050608061468587828801613540565b92505060a061469687828801613576565b91505092959194509250565b6146ab81613cec565b81146146b657600080fd5b50565b6000813590506146c8816146a2565b92915050565b6000602082840312156146e4576146e36134c9565b5b60006146f2848285016146b9565b91505092915050565b600082825260208201905092915050565b7f4c617965725a65726f4d6f636b3a2064657374696e6174696f6e204c6179657260008201527f5a65726f20456e64706f696e74206e6f7420666f756e64000000000000000000602082015250565b60006147686037836146fb565b91506147738261470c565b604082019050919050565b600060208201905081810360008301526147978161475b565b9050919050565b600080fd5b600080fd5b600080fd5b600080833560016020038436030381126147ca576147c961479e565b5b80840192508235915067ffffffffffffffff8211156147ec576147eb6147a3565b5b602083019250600182023603831315614808576148076147a8565b5b509250929050565b7f4c617965725a65726f4d6f636b3a206e6f7420656e6f756768206e617469766560008201527f20666f7220666565730000000000000000000000000000000000000000000000602082015250565b600061486c6029836146fb565b915061487782614810565b604082019050919050565b6000602082019050818103600083015261489b8161485f565b9050919050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601160045260246000fd5b60006148dc8261372f565b91506148e78361372f565b92508282039050818111156148ff576148fe6148a2565b5b92915050565b600081905092915050565b50565b6000614920600083614905565b915061492b82614910565b600082019050919050565b600061494182614913565b9150819050919050565b7f4c617965725a65726f4d6f636b3a206661696c656420746f20726566756e6400600082015250565b6000614981601f836146fb565b915061498c8261494b565b602082019050919050565b600060208201905081810360008301526149b081614974565b9050919050565b6149c0816136ac565b82525050565b6060820160008201516149dc60008501826149b7565b5060208201516149ef6020850182613847565b506040820151614a02604085018261386a565b50505050565b600061012082019050614a1e600083018a6149c6565b614a2b60608301896136cb565b614a386080830188613c82565b81810360a0830152614a4a8187613adf565b9050614a5960c08301866139e9565b614a6660e08301856139e9565b614a74610100830184613c82565b98975050505050505050565b600081519050614a8f81613739565b92915050565b60008060408385031215614aac57614aab6134c9565b5b6000614aba85828601614a80565b9250506020614acb85828601614a80565b9150509250929050565b7f4c617965725a65726f4d6f636b3a206e6f2072656365697665207265656e747260008201527f616e637900000000000000000000000000000000000000000000000000000000602082015250565b6000614b316024836146fb565b9150614b3c82614ad5565b604082019050919050565b60006020820190508181036000830152614b6081614b24565b9050919050565b600060208284031215614b7d57614b7c6134c9565b5b6000614b8b84828501613b51565b91505092915050565b6000614ba3602084018461371a565b905092915050565b6000614bba6020840184613576565b905092915050565b6000614bd16020840184613b51565b905092915050565b60608201614bea6000830183614b94565b614bf760008501826149b7565b50614c056020830183614bab565b614c126020850182613847565b50614c206040830183614bc2565b614c2d604085018261386a565b50505050565b82818337600083830152505050565b6000614c4e8385613a93565b9350614c5b838584614c33565b614c6483613ace565b840190509392505050565b6000614c7c600083613a93565b9150614c8782614910565b600082019050919050565b600060e082019050614ca76000830188614bd9565b614cb46060830187613c82565b8181036080830152614cc7818587614c42565b9050614cd660a08301846136cb565b81810360c0830152614ce781614c6f565b90509695505050505050565b6000614cfe8261372f565b9150614d098361372f565b9250828201905080821115614d2157614d206148a2565b5b92915050565b600060ff82169050919050565b614d3d81614d27565b82525050565b6000602082019050614d586000830184614d34565b92915050565b6000614d698261372f565b9150614d748361372f565b9250828202614d828161372f565b91508282048414831517614d9957614d986148a2565b5b5092915050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052601260045260246000fd5b6000614dda8261372f565b9150614de58361372f565b925082614df557614df4614da0565b5b828204905092915050565b6000614e0b826141b7565b9150614e16836141b7565b9250828202614e24816141b7565b9150808214614e3657614e356148a2565b5b5092915050565b6000614e48826141b7565b9150614e53836141b7565b925082614e6357614e62614da0565b5b828204905092915050565b7f4e487b7100000000000000000000000000000000000000000000000000000000600052604160045260246000fd5b7f4e487b7100000000000000000000000000000000000000000000000000000000600052603260045260246000fd5b60008160c01b9050919050565b6000614ee482614ecc565b9050919050565b614efc614ef782613856565b614ed9565b82525050565b60008160e01b9050919050565b6000614f1a82614f02565b9050919050565b614f32614f2d826136ac565b614f0f565b82525050565b6000819050919050565b614f53614f4e82613555565b614f38565b82525050565b6000614f658288614eeb565b600882019150614f758287614f21565b600482019150614f858286614f42565b602082019150614f958285614f21565b600482019150614fa58284614f42565b6020820191508190509695505050505050565b6000604082019050614fcd60008301856139e9565b8181036020830152614fdf8184613adf565b90509392505050565b600060208284031215614ffe57614ffd6134c9565b5b600061500c84828501614a80565b91505092915050565b600061502082613a88565b61502a8185614905565b935061503a818560208601613aa4565b80840191505092915050565b60006150528285614f42565b6020820191506150628284615015565b91508190509392505050565b6000819050919050565b6000819050919050565b600061509d6150986150938461506e565b615078565b61372f565b9050919050565b6150ad81615082565b82525050565b60006020820190506150c860008301846150a4565b92915050565b600080fd5b600080fd5b600080858511156150ec576150eb6150ce565b5b838611156150fd576150fc6150d3565b5b6001850283019150848603905094509492505050565b600082905092915050565b60007fffff00000000000000000000000000000000000000000000000000000000000082169050919050565b600082821b905092915050565b60006151638383615113565b8261516e813561511e565b925060028210156151ae576151a97fffff0000000000000000000000000000000000000000000000000000000000008360020360080261514a565b831692505b505092915050565b60007fff0000000000000000000000000000000000000000000000000000000000000082169050919050565b60006151ee8383615113565b826151f981356151b6565b92506001821015615239576152347fff000000000000000000000000000000000000000000000000000000000000008360010360080261514a565b831692505b505092915050565b600061525c6152576152528461506e565b615078565b614d27565b9050919050565b61526c81615241565b82525050565b60006020820190506152876000830184615263565b92915050565b60006060820190506152a26000830184614bd9565b92915050565b6000815190506152b7816146a2565b92915050565b6000602082840312156152d3576152d26134c9565b5b60006152e1848285016152a8565b91505092915050565b60006153056153006152fb846141b7565b615078565b61372f565b9050919050565b615315816152ea565b82525050565b600060408201905061533060008301856139e9565b61533d602083018461530c565b9392505050565b60006153508385614905565b935061535d838584614c33565b82840190509392505050565b60006153758286615015565b9150615382828486615344565b9150819050949350505050565b600061539b8383615113565b826153a68135613555565b925060208210156153e6576153e17fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff8360200360080261514a565b831692505b505092915050565b60008160f81b9050919050565b6000615406826153ee565b9050919050565b61541e61541982614d27565b6153fb565b82525050565b60008160f01b9050919050565b600061543c82615424565b9050919050565b61545461544f82613be1565b615431565b82525050565b60008160801b9050919050565b60006154728261545a565b9050919050565b61548a615485826141b7565b615467565b82525050565b600061549c828761540d565b6001820191506154ac8286615443565b6002820191506154bc828561540d565b6001820191506154cc8284615479565b60108201915081905095945050505050565b60006154ea828c61540d565b6001820191506154fa828b615443565b60028201915061550a828a61540d565b60018201915061551a8289615479565b60108201915061552a828861540d565b60018201915061553a8287615443565b60028201915061554a828661540d565b60018201915061555a8285615479565b60108201915061556a8284614f42565b6020820191508190509a9950505050505050505050565b61558a81613be1565b82525050565b60006020820190506155a56000830184615581565b92915050565b60007fffffffffffffffffffffffffffffffff0000000000000000000000000000000082169050919050565b60006155e38383615113565b826155ee81356155ab565b9250601082101561562e576156297fffffffffffffffffffffffffffffffff000000000000000000000000000000008360100360080261514a565b831692505b505092915050565b7f53616665436173743a2076616c756520646f65736e27742066697420696e203160008201527f3238206269747300000000000000000000000000000000000000000000000000602082015250565b60006156926027836146fb565b915061569d82615636565b604082019050919050565b600060208201905081810360008301526156c181615685565b905091905056fea2646970667358221220bf8e79bec584f80ce608e3e9269e9bc0662fc4eed426eee6e5ecf7e29c0f0b1564736f6c63430008160033',
};
