// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Bridge} from "../Bridge.sol";
import {LombardConsortium} from "../../consortium/LombardConsortium.sol";
import {IBascule} from "../../bascule/interfaces/IBascule.sol";
import {CrossChainActions} from "../../libs/CrossChainActions.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

contract Ledger is Ownable2Step {
    LombardConsortium consortium;
    IBascule bascule;
    Bridge bridge;

    /// @notice Emitted when the address provided is not validi
    error InvalidAddress();

    /// @notice Emitted when the action is invalid
    error InvalidAction();

    /// @notice Emitted when the mint proof is consumed
    event MintProofConsumed(address indexed recipient, uint256 amount, bytes32 proofHash);

    /// @notice Emitted when the deposit proof is consumed
    event DepositProofConsumed(address indexed recipient, uint256 amount, bytes32 proofHash);

    /// PUBLIC FUNCTIONS ///

    constructor(address _consortium, address _bascule, address _bridge, address _owner) Ownable(_owner) {
        consortium = LombardConsortium(_consortium);
        bascule = IBascule(_bascule);
        bridge = Bridge(_bridge);
    }

    /// ACTIONS ///

    /**
     * @notice Validates and route the mint to LBTC contract
     * @param payload message with mint details
     * @param proof signatures allowing the mint
     */
    function mint(bytes calldata payload, bytes calldata proof) external {
        if(bytes4(payload) != CrossChainActions.MINT_ACTION) {
            revert InvalidAction();
        }
        CrossChainActions.MintAction memory action = CrossChainActions.mint(payload[4:]);

        _validateAndSend(payload, proof, action.amount);

        emit MintProofConsumed(action.recipient, action.amount, keccak256(proof));
    }

    function depositToBridge(bytes calldata payload, bytes calldata proof) internal {
        if(bytes4(payload) != CrossChainActions.BURN_ACTION) {
            revert InvalidAction();
        }
        CrossChainActions.BurnAction memory action = CrossChainActions.burn(payload[4:]);

        _validateAndSend(payload, proof, action.amount);

        emit DepositProofConsumed(action.recipient, action.amount, keccak256(proof));
    }

    /// ONLY OWNER FUNCTIONS ///

    function changeConsortium(address _consortium) external onlyOwner {
        if(_consortium == address(0)) {
            revert InvalidAddress();
        }
        consortium = LombardConsortium(_consortium);
    }

    function changeBascule(address _bascule) external onlyOwner {
        if(_bascule == address(0)) {
            revert InvalidAddress();
        }
        bascule = IBascule(_bascule);
    }

    /// PRIVATE FUNCTIONS ///

    function _validateAndSend(bytes calldata payload, bytes calldata proof, uint256 amount) internal {
        // check proof validity
        consortium.checkProof(keccak256(payload), proof);

        bytes32 proofHash = keccak256(proof);

        if (address(bascule) != address(0)) {
            bascule.validateWithdrawal(proofHash, amount);
        }

        // Send to Bridge
        bridge.receiveMessage(payload);
    }
}
