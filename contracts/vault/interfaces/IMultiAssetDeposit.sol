// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IMultiAssetDeposit
interface IMultiAssetDeposit is IERC165 {
    event DepositAssetAdded(address indexed caller, address indexed token);

    event Deposit(
        address indexed caller,
        address indexed receiver,
        address indexed depositAsset,
        uint256 assets,
        uint256 shares
    );

    event DepositAssetRemoved(address indexed token);

    event DepositFeeBpsSet(address indexed token, uint16 depositFeeBps);

    event DepositAssetConverterSet(
        address indexed token,
        address indexed assetConverter
    );

    event DepositFeeAccrued(address indexed token, uint256 amount);

    event DepositFeesClaimed(
        address indexed token,
        address indexed to,
        uint256 amount
    );

    error DepositAssetNotListed(address token);

    error AssetConverterZero();

    error DepositFeeBpsTooHigh();

    error AccruedFeesNotClaimed(address token);

    error SharesPreviewMismatch();

    error MintRequiresAssets(address assetToken);
    error ClaimExceedsAccrued();

    error ExceededMaxDeposit(
        address receiver,
        address depositAsset,
        uint256 assets,
        uint256 maxAssets
    );
    error ExceededMaxMint(
        address receiver,
        address depositAsset,
        uint256 shares,
        uint256 maxShares
    );
    error DepositAssetAlreadyAdded(address depositAsset);

    function deposit(
        address depositAsset,
        uint256 assets,
        address receiver
    ) external returns (uint256);

    function mint(
        address depositAsset,
        uint256 shares,
        address receiver
    ) external returns (uint256);

    function previewDeposit(
        address depositAsset,
        uint256 assets
    ) external view returns (uint256);

    function previewMint(
        address depositAsset,
        uint256 shares
    ) external view returns (uint256);

    function maxDeposit(
        address depositAsset,
        address receiver
    ) external view returns (uint256);

    function maxMint(
        address depositAsset,
        address receiver
    ) external view returns (uint256);

    function convertToAssets(
        address depositAsset,
        uint256 shares
    ) external view returns (uint256);

    function convertToShares(
        address depositAsset,
        uint256 assets
    ) external view returns (uint256);
}
