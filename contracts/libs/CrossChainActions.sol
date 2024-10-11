// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

library CrossChainActions {
    // bytes4(keccak256("mint(uint256,address,address,uint256,bytes)"))
    bytes4 internal constant MINT_ACTION = 0x2adfefeb;
    // bytes4(keccak256("burn(uint256,address,uint256,address,address,uint256,bytes)"))
    bytes4 internal constant BURN_ACTION = 0xca2443c0;
    // bytes4(keccak256("setValidators(bytes[],uint256[],uint256)"))
    bytes4 internal constant SET_VALIDATORS_ACTION = 0x333b09c0;

    struct MintAction {
        uint256 toChain;
        address toContract;
        address recipient;
        uint256 amount;
        bytes extraData;
    }

    struct BurnAction {
        uint256 fromChain;
        address fromContract;
        uint256 toChain;
        address toContract;
        address recipient;
        uint256 amount;
        bytes extraData;
    }

    struct ValidatorSetAction {
        bytes[] validators;
        uint256[] weights;
        uint256 threshold;
    }

    /**
     * @notice Returns decoded mint payload
     * @dev Payload should not contain the selector
     * @param payload Body of the mint payload
     */
    function mint(bytes memory payload) internal pure returns (MintAction memory) {
        (
            uint256 toChain, 
            address toContract, 
            address recipient, 
            uint256 amount, 
            bytes memory extraData
        ) = abi.decode(
            payload, 
            (uint256, address, address, uint256, bytes)
        );
        return MintAction(toChain, toContract, recipient, amount, extraData);
    }

    /**
     * @notice Returns decoded burn payload
     * @dev Payload should not contain the selector
     * @param payload Body of the burn payload
     */
    function burn(bytes memory payload) internal pure returns (BurnAction memory) {
        (   
            uint256 fromChain, 
            address fromContract, 
            uint256 toChain, 
            address toContract, 
            address recipient, 
            uint256 amount, 
            bytes memory extraData
        ) = abi.decode(
            payload, 
            (uint256, address, uint256, address, address, uint256, bytes)
        );
        return BurnAction(fromChain, fromContract, toChain, toContract, recipient, amount, extraData);
    }

    /**
     * @notice Returns decoded validator set
     * @dev Payload should not contain the selector
     * @param payload Body of the set validators payload
     */
    function setValidatorSet(bytes memory payload) internal pure returns (ValidatorSetAction memory) {
        (
            bytes[] memory validators, 
            uint256[] memory weights, 
            uint256 threshold
        ) = abi.decode(payload, (bytes[], uint256[], uint256));
        return ValidatorSetAction(validators, weights, threshold);
    }
}