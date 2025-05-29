// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import "./IBARD.sol";


/**
 * @title ERC20 representation of Lombard Governance Token (BARD)
 * @author Lombard.Finance
 * @notice The contracts is a part of Lombard.Finace protocol
 */
contract BARD is Ownable2Step, ERC20Burnable, ERC20Permit, ERC20Votes, IBARD {
    // Maximum inflation rate per year (percentage) expressed as an integer
    uint8 public constant MAX_INFLATION = 10;

    // The frequency limit on inflationary mint invocations
    uint32 public constant MINT_WAIT_PERIOD = 365 days;

    //The last time the mint function was called
    uint40 public lastMintTimestamp;

    constructor(address _initialOwner, address _treasury) ERC20("Lombard", "BARD") ERC20Permit("BARD") Ownable(_initialOwner) {
        // first mint not allowed until 1 year after deployment
        lastMintTimestamp = uint40(block.timestamp);
        if (_treasury == address(0)) revert ZeroAddressException();
        // mint initial supply
        _mint(_treasury, 1_000_000_000 * 1 ether);
    }

    /**
     * @notice Mints new BARD tokens
     * @param to The address to mint tokens to
     * @param amount The amount of tokens to mint
     * @dev Only callable by the owner once per year and amount must be less than max inflation rate
     */
    function mint(address to, uint256 amount) external onlyOwner {
        if (block.timestamp - lastMintTimestamp < MINT_WAIT_PERIOD) revert MintWaitPeriodNotClosed(MINT_WAIT_PERIOD - (block.timestamp - lastMintTimestamp));
        uint256 _maxInflationAmount = totalSupply() * MAX_INFLATION / 100;
        if (amount > _maxInflationAmount) revert MaxInflationExceeded(_maxInflationAmount);
        lastMintTimestamp = uint40(block.timestamp);
        _mint(to, amount);
        emit Mint(to, amount);
    }

    /// @notice Prevents the owner from renouncing ownership
    function renounceOwnership() public view override onlyOwner {
        revert CantRenounceOwnership();
    }

    /**
     * @dev Override of the _update function to satisfy both ERC20 and ERC20Votes
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal virtual override(ERC20, ERC20Votes) {
        super._update(from, to, value);
    }

    /**
     * @dev Override of the nonces function to satisfy both IERC20Permit and Nonces
     */
    function nonces(address owner) public view virtual override(ERC20Permit, Nonces) returns (uint256) {
        return super.nonces(owner);
    }
}
