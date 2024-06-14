// // SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.16;

interface ILBTCBridge {

    // --- Structs ---
    struct Metadata {
        bytes32 symbol;
        bytes32 name;
        uint256 originChain;
        address originAddress;
    }

    // --- Events ---
    event WarpDestinationAdded(address indexed fromToken, uint256 indexed toChain, address indexed toToken);
    event WarpDestinationRemoved(address indexed fromToken, uint256 indexed toChain, address indexed toToken);
    event DepositWarped(uint256 chainId, address indexed fromAddress, address indexed toAddress, address fromToken, address toToken, uint256 totalAmount, uint256 nonce, Metadata metadata);
    event WithdrawMinted(bytes32 receiptHash, address indexed fromAddress, address indexed toAddress, address fromToken, address toToken, uint256 totalAmount);
    event DefaultDepositCommissionChanged(uint16 prevValue, uint16 newValue);
    event DepositCommissionChanged(uint16 newValue, uint256 toChain);
    event TreasuryAddressChanged(address prevValue, address newValue);

    // --- Functions ---
    function depositToken(uint256 toChain, address toAddress, uint256 amount) external;

    function withdraw(bytes calldata encodedProof, bytes calldata rawReceipt, bytes memory receiptRootSignature) external;


    error InvalidContractAddress();
    error EventFromUnknownContract();
    error BadFromToken();
    error InvalidType();
    error KnownDestination();
    error UnknownDestination();
    error BadChain();
    error BadSignature();
    error BadCommission();
}
