// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IBaseLBTC {
    error WithdrawalsDisabled();
    error PayloadAlreadyUsed();
    error InvalidMintAmount();

    event UnstakeRequest(
        address indexed fromAddress,
        bytes scriptPubKey,
        uint256 amount
    );
    event WithdrawalsEnabled(bool);
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
    error FeeGreaterThanAmount();

    event MintProofConsumed(
        address indexed recipient,
        bytes32 indexed payloadHash,
        bytes payload
    );

    event BatchMintSkipped(bytes32 indexed payloadHash, bytes payload);

    function burn(uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function mint(address to, uint256 amount) external;
    function mint(bytes calldata payload, bytes calldata proof) external;
    function getTreasury() external returns (address);
}
