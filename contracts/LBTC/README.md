# LBTC (Lombard Staked Bitcoin)

Core ERC20 token contracts representing Lombard Staked Bitcoin.

## Contracts

### StakedLBTC.sol
The main ERC20 token contract for LBTC on non-native chains. Features:
- Consortium-based minting with signature verification
- Asset router integration for deposits and redemptions
- Pausable operations for emergency scenarios
- Role-based access control (minters, claimers, operators)

### NativeLBTC.sol
Native LBTC implementation for the primary chain with direct BTC deposit handling.

### BaseLBTC.sol
Abstract base contract providing common functionality for all LBTC variants.

### AssetRouter.sol
Routes assets between different token contracts and handles cross-chain operations.

### StakedLBTCOracle.sol
Price oracle for StakedLBTC ratio calculations.

### BridgeTokenAdapter.sol
Adapter for bridging LBTC tokens across chains.

## Libraries

- **Assert.sol**: Common assertion utilities
- **Validation.sol**: Input validation helpers
- **Redeem.sol**: Redemption logic utilities

## Interfaces

See `interfaces/` directory for contract interfaces.
