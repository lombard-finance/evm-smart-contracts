// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IVault} from "../vault/interfaces/IVault.sol";
import {IStrategyExecValidator} from "../vault/interfaces/IStrategyExecValidator.sol";

/// @dev Test ERC-20 for `MockVaultForStrategy`.
contract MockVaultToken is ERC20 {
    constructor() ERC20("VaultTok", "VTK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Minimal `IVault` for Strategy pipe tests.
contract MockVaultForStrategy is IVault {
    IERC20 private immutable _token;
    mapping(address => bool) private _registered;

    constructor(IERC20 token_) {
        _token = token_;
    }

    /// @inheritdoc IVault
    function asset() external view returns (address) {
        return address(_token);
    }

    function registerStrategy(address strategy) external {
        _registered[strategy] = true;
        _token.approve(strategy, type(uint256).max);
    }

    function isRegisteredStrategy(
        address strategy
    ) external view returns (bool) {
        return _registered[strategy];
    }

    function version() external pure override returns (string memory) {
        return "Mock";
    }
}

/// @dev Configurable `IStrategyExecValidator` stub for `exec` tests.
contract MockStrategyValidator is IStrategyExecValidator {
    bool public globalAllow;
    mapping(address => bool) public senderAllowed;

    function setGlobalAllow(bool allow) external {
        globalAllow = allow;
    }

    function setSenderAllowed(address account, bool allowed) external {
        senderAllowed[account] = allowed;
    }

    /// @inheritdoc IStrategyExecValidator
    function isAllowed(
        address sender,
        address,
        uint256,
        bytes calldata,
        bytes calldata
    ) external view returns (bool) {
        if (globalAllow) return true;
        return senderAllowed[sender];
    }
}

/// @dev Payable target for `exec` tests.
contract ExecTargetMock {
    uint256 public pingCount;
    uint256 public lastValueReceived;

    receive() external payable {}

    function ping() external payable {
        pingCount++;
        lastValueReceived = msg.value;
    }
}
