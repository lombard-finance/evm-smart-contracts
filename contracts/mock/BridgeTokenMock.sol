pragma solidity ^0.8.0;

import {Context} from "@openzeppelin/contracts/utils/Context.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {IERC20, IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IBridgeToken} from "../interfaces/IBridgeToken.sol";

library Roles {
    struct Role {
        mapping(address => bool) bearer;
    }

    /**
     * @dev Give an account access to this role.
     */
    function add(Role storage role, address account) internal {
        require(!has(role, account), "Roles: account already has role");
        role.bearer[account] = true;
    }

    /**
     * @dev Remove an account's access to this role.
     */
    function remove(Role storage role, address account) internal {
        require(has(role, account), "Roles: account does not have role");
        role.bearer[account] = false;
    }

    /**
     * @dev Check if an account has this role.
     * @return bool
     */
    function has(
        Role storage role,
        address account
    ) internal view returns (bool) {
        require(account != address(0), "Roles: account is the zero address");
        return role.bearer[account];
    }
}

// Ref: https://subnets.avax.network/c-chain/address/0x152b9d0FdC40C096757F570A51E494bd4b943E50?tab=code
// BTC.b token source code
contract BridgeTokenMock is ERC20Burnable, IBridgeToken {
    using Roles for Roles.Role;
    using Address for address;

    Roles.Role private bridgeRoles;

    string private constant TOKEN_NAME = "Bitcoin";
    string private constant TOKEN_SYMBOL = "BTC.b";
    uint8 private constant TOKEN_DECIMALS = 8;

    mapping(uint256 => bool) public chainIds;

    /// @dev Custom variable to store deployer of contract
    address private immutable _deployer;

    event Mint(
        address to,
        uint256 amount,
        address feeAddress,
        uint256 feeAmount,
        bytes32 originTxId,
        uint256 originOutputIndex
    );
    event Unwrap(uint256 amount, uint256 chainId);
    event AddSupportedChainId(uint256 chainId);
    event MigrateBridgeRole(address newBridgeRoleAddress);

    constructor() ERC20(TOKEN_NAME, TOKEN_SYMBOL) {
        bridgeRoles.add(msg.sender);
        chainIds[0] = true;
        _deployer = msg.sender;
    }

    function decimals()
        public
        pure
        virtual
        override(ERC20, IERC20Metadata)
        returns (uint8)
    {
        return TOKEN_DECIMALS;
    }

    /**
     * @dev Mint function used by bridge. Optional FeeAddress and FeeAmount parameters used to mint small percentage of transfered assets directly to bridge.
     * @param to Address to mint funds to.
     * @param amount Amount of funds to mint.
     * @param feeAddress Address to mint bridge fees to.
     * @param feeAmount Amount to mint as bridge fees.
     * @param originTxId Transaction ID from external network that triggered this minting.
     * @param originOutputIndex Output index of the originTxId that triggered this minting.
     */
    function mint(
        address to,
        uint256 amount,
        address feeAddress,
        uint256 feeAmount,
        bytes32 originTxId,
        uint256 originOutputIndex
    ) external override {
        require(bridgeRoles.has(msg.sender), "Unauthorized.");
        _mint(to, amount);
        if (feeAmount > 0) {
            _mint(feeAddress, feeAmount);
        }
        emit Mint(
            to,
            amount,
            feeAddress,
            feeAmount,
            originTxId,
            originOutputIndex
        );
    }

    /**
     * @dev Add new chainId to list of supported Ids.
     * @param chainId ChainId to add.
     */
    function addSupportedChainId(uint256 chainId) external {
        require(bridgeRoles.has(msg.sender), "Unauthorized.");

        // Check that the chain ID is not the chain this contract is deployed on.
        uint256 currentChainId;
        assembly {
            currentChainId := chainid()
        }
        require(chainId != currentChainId, "Cannot add current chain ID.");

        // Already supported, no-op.
        if (chainIds[chainId]) {
            return;
        }

        chainIds[chainId] = true;
        emit AddSupportedChainId(chainId);
    }

    /**
     * @dev Burns assets and signals bridge to migrate funds to the same address on the provided chainId.
     * @param amount Amount of asset to unwrap.
     * @param chainId ChainId to unwrap or migrate funds to. Only used for multi-network bridge deployment.
     *                Zero by default for bridge deployment with only 2 networks.
     */
    function unwrap(uint256 amount, uint256 chainId) external override {
        require(isContract(msg.sender), "Contract calls not supported.");
        require(chainIds[chainId], "Chain ID not supported.");
        _burn(msg.sender, amount);
        emit Unwrap(amount, chainId);
    }

    function isContract(address _addr) private returns (bool isContract) {
        uint32 size;
        assembly {
            size := extcodesize(_addr)
        }
        return (size > 0);
    }

    /**
     * @dev Provide Bridge Role (Admin Role) to new address.
     * @param newBridgeRoleAddress New bridge role address.
     */
    function migrateBridgeRole(address newBridgeRoleAddress) external {
        require(bridgeRoles.has(msg.sender), "Unauthorized.");
        bridgeRoles.remove(msg.sender);
        bridgeRoles.add(newBridgeRoleAddress);
        emit MigrateBridgeRole(newBridgeRoleAddress);
    }

    function transfer(
        address to,
        uint256 amount
    ) public virtual override(ERC20, IERC20) returns (bool) {
        require(
            to != address(this),
            "Transfer to this smart contract is not supported."
        );
        return super.transfer(to, amount);
    }

    function burn(
        uint256 value
    ) public virtual override(ERC20Burnable, IBridgeToken) {
        super.burn(value);
    }

    function burnFrom(
        address account,
        uint256 value
    ) public virtual override(ERC20Burnable, IBridgeToken) {
        super.burnFrom(account, value);
    }

    /// @dev The function used by CCIP RegistryModuleOwnerCustom to grant ownership of CCT. Made to bypass
    /// ownership delegation from CCIP team side.
    function getCCIPAdmin() external view returns (address) {
        return _deployer;
    }
}
