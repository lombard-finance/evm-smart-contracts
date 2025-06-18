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

    event AssetRouter_RouteSet(
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
    event AssetRouter_FeeChanged(
        uint256 indexed oldFee,
        uint256 indexed newFee
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
    ) external returns (bool, address);
}
