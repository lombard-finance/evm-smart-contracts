// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IAssetRouter {
    error AssetRouter_ZeroMailbox();
    error AssetRouter_MailboxExpected();
    error AssetRouter_PayloadAlreadyUsed();
    error AssetRouter_ZeroAddress();
    error AssetRouter_Unauthorized();
    error AssetRouter_WrongOperation();
    error AssetRouter_WrongSender();
    error AssetRouter_WrongNativeToken();
    error AssetRouter_MintProcessingError();
    error AssetRouter_FeeGreaterThanAmount();

    event AssetRouter_FeeCharged(uint256 indexed fee, bytes userSignature);

    event AssetRouter_RouteSet(
        bytes32 indexed fromToken,
        bytes32 indexed fromChainId,
        bytes32 indexed toToken,
        bool isToTokenNative,
        bytes32 toChainId
    );

    event AssetRouter_RouteRemoved(
        bytes32 indexed fromToken,
        bytes32 indexed fromChainId,
        bytes32 indexed toToken,
        bytes32 toChainId
    );
    event AssetRouter_BasculeChanged(
        address indexed prevVal,
        address indexed newVal
    );
    event AssetRouter_OracleChanged(
        address indexed prevVal,
        address indexed newVal
    );
    event AssetRouter_MailboxChanged(
        address indexed prevVal,
        address indexed newVal
    );
    event AssetRouter_MintFeeChanged(
        uint256 indexed oldFee,
        uint256 indexed newFee
    );
    event AssetRouter_ToNativeCommissionChanged(
        uint256 indexed oldCommission,
        uint256 indexed newCommission
    );
    event AssetRouter_NativeTokenChanged(
        address indexed oldAddress,
        address indexed newAddress
    );
    event AssetRouter_BatchMintError(
        bytes32 indexed payloadHash,
        string reason,
        bytes customError
    );

    function isAllowedRoute(
        bytes32 fromToken,
        bytes32 toChainId,
        bytes32 toToken,
        bool toNative
    ) external view returns (bool);

    function getMintFee() external view returns (uint256);
    function getRatio(address token) external view returns (uint256);
    function getBitcoinChainId() external view returns (bytes32);
    function getBascule() external view returns (address);
    function getOracle() external view returns (address);
    function getMailbox() external view returns (address);
    function getToNativeCommission() external view returns (uint64);
    function getNativeToken() external view returns (address);

    function deposit(
        address fromAddress,
        bytes32 tolChainId,
        bytes32 toToken,
        bytes32 recipient,
        uint256 amount
    ) external;

    function deposit(
        address fromAddress,
        address toToken,
        uint256 amount
    ) external;

    function redeemForBtc(
        address fromAddress,
        address fromToken,
        bytes calldata recipient,
        uint256 amount
    ) external;

    function redeem(
        address fromAddress,
        bytes32 tolChainId,
        address fromToken,
        bytes32 recipient,
        uint256 amount
    ) external;

    function redeem(
        address fromAddress,
        address fromToken,
        uint256 amount
    ) external;

    function mint(
        bytes calldata rawPayload,
        bytes calldata proof
    ) external returns (address);

    function mintWithFee(
        bytes calldata mintPayload,
        bytes calldata proof,
        bytes calldata feePayload,
        bytes calldata userSignature
    ) external;

    function batchMint(
        bytes[] calldata payload,
        bytes[] calldata proof
    ) external;

    function batchMintWithFee(
        bytes[] calldata mintPayload,
        bytes[] calldata proof,
        bytes[] calldata feePayload,
        bytes[] calldata userSignature
    ) external;

    function calcUnstakeRequestAmount(
        bytes calldata scriptPubkey,
        uint256 amount
    ) external view returns (uint256 amountAfterFee, bool isAboveDust);
}
