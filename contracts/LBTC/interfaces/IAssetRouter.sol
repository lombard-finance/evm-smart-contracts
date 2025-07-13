// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBascule} from "../../bascule/interfaces/IBascule.sol";
import {IMailbox} from "../../gmp/IMailbox.sol";
import {IOracle} from "../interfaces/IOracle.sol";

interface IAssetRouter {
    // Describes types of possible routes. UNKNOWN means no route or disabled route
    enum RouteType {
        UNKNOWN, // unknown must be '0'
        DEPOSIT,
        REDEEM
    }

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
    error AssertRouter_UnauthorizedAccount();
    error AssertRouter_WrongRedeemDestinationChain();
    error AssertRouter_WrongRouteType();
    error AssertRouter_WrongToken();

    event AssetRouter_FeeCharged(uint256 indexed fee, bytes userSignature);
    event AssetRouter_RedeemFeeChanged(
        address indexed token,
        uint256 oldFee,
        uint256 newFee
    );
    event AssetRouter_RedeemForBtcMinAmountChanged(
        address indexed token,
        uint256 oldMinAmount,
        uint256 newMinAmount
    );
    event AssetRouter_RedeemEnabled(address indexed token, bool enabled);

    event AssetRouter_RouteSet(
        bytes32 indexed fromToken,
        bytes32 indexed fromChainId,
        bytes32 indexed toToken,
        bytes32 toChainId,
        RouteType routeType
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
    event AssetRouter_DustFeeRateChanged(
        uint256 indexed oldRate,
        uint256 indexed newRate
    );

    function getRouteType(
        bytes32 fromToken,
        bytes32 fromChainId,
        bytes32 toChainId,
        bytes32 toToken
    ) external view returns (RouteType);

    function maxMintCommission() external view returns (uint256);
    function ratio(address token) external view returns (uint256);
    function getRate(address token) external view returns (uint256);
    function bitcoinChainId() external view returns (bytes32);
    function bascule() external view returns (IBascule);
    function oracle() external view returns (IOracle);
    function mailbox() external view returns (IMailbox);
    function toNativeCommission() external view returns (uint64);
    function nativeToken() external view returns (address);
    function tokenConfig(
        address token
    )
        external
        view
        returns (
            uint256 redeemFee,
            uint256 redeemForBtcMinAmount,
            bool isRedeemEnabled
        );

    function deposit(
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
        bytes32 toToken,
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
        address token,
        bytes calldata scriptPubkey,
        uint256 amount
    ) external view returns (uint256 amountAfterFee, bool isAboveDust);

    function changeRedeemFee(uint256 fee) external;

    function changeRedeemForBtcMinAmount(uint256 minAmount) external;

    function toggleRedeem() external;
}
