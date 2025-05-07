// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20Upgradeable, IERC20} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BitcoinUtils, OutputType} from "../libs/BitcoinUtils.sol";
import {IBascule} from "../bascule/interfaces/IBascule.sol";
import {ILBTC} from "./ILBTC.sol";
import {FeeUtils} from "../libs/FeeUtils.sol";
import {Consortium} from "../consortium/Consortium.sol";
import {Actions} from "../libs/Actions.sol";
import {EIP1271SignatureUtils} from "../libs/EIP1271SignatureUtils.sol";

/**
 * @title Base contract for LBTC tokens
 * @author Lombard.Finance
 * @notice This contract is a part of the Lombard.Finance protocol
 */
abstract contract LBTCBase is
    ILBTC,
    ERC20PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    ERC20PermitUpgradeable
{
    struct DecodedPayload {
        address recipient;
        uint256 amount;
    }

    /**
     * @dev Override of the _update function to satisfy both ERC20Upgradeable and ERC20PausableUpgradeable
     */
    function _update(
        address from,
        address to,
        uint256 value
    ) internal virtual override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        super._update(from, to, value);
    }
}
