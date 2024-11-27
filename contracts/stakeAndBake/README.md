# Lombard Stake and Bake contracts

## Summary of contracts
* "StakeAndBake.sol" implements the generic stake and bake logic - it wraps over the LBTC 'automint' functionality and takes in some extra aparameters to `permit` the minted LBTC to a vault, and then deposits it.
* "depositor/IDepositor.sol" provides a generic interface for a depositor implementation. The general idea is that `IDepositor` allows the `StakeAndBake` contract to swap out different function selectors for different vaults and thus remain abstracted over the actual implementation detail of the vault we are using.
* "depositor/BoringVaultDepositor.sol" provides an implementation of a depositor for a BoringVault. We use the associated Teller address to ensure we perform all checks properly (using the Teller directly to deposit would lead to issues) and all contracts are called dynamically with function selectors.
