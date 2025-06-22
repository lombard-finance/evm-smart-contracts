// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IBaseLBTC {
    error RedeemForBtcDisabled();
    error PayloadAlreadyUsed();
    error InvalidMintAmount();
    error AssetRouterNotSet();

    event RedeemRequest(
        address indexed from,
        uint256 indexed nonce,
        uint256 amount,
        uint256 fee,
        bytes payload
    );
    event RedeemsForBtcEnabled(bool);
    event NameAndSymbolChanged(string name, string symbol);
    event ConsortiumChanged(address indexed prevVal, address indexed newVal);
    event TreasuryAddressChanged(
        address indexed prevValue,
        address indexed newValue
    );
    event BurnCommissionChanged(
        uint64 indexed prevValue,
        uint64 indexed newValue
    );
    event DustFeeRateChanged(uint256 indexed oldRate, uint256 indexed newRate);
    event BasculeChanged(address indexed prevVal, address indexed newVal);
    event FeeCharged(uint256 indexed fee, bytes userSignature);
    event FeeChanged(uint256 indexed oldFee, uint256 indexed newFee);
    event RedeemFeeChanged(uint256 indexed oldFee, uint256 indexed newFee);

    event MintProofConsumed(
        address indexed recipient,
        bytes32 indexed payloadHash,
        bytes payload
    );

    event BatchMintSkipped(bytes32 indexed payloadHash, bytes payload);
    event AssetRouterChanged(address indexed newVal, address indexed prevVal);

    function burn(uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function transfer(address from, address to, uint256 amount) external;
    function mint(address to, uint256 amount) external;
    function getTreasury() external view returns (address);
    function getAssetRouter() external view returns (address);
    function isNative() external view returns (bool);
    function getRedeemFee() external view returns (uint256);
    function getFeeDigest(
        uint256 fee,
        uint256 expiry
    ) external view returns (bytes32);
    function isRedeemsEnabled() external view returns (bool);
}
