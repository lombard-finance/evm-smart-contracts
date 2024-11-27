# Lombard Stake and Bake contracts

## Summary of contracts
* "StakeAndBake.sol" implements the generic stake and bake logic - it wraps over the LBTC 'automint' functionality and takes in some extra aparameters to `permit` the minted LBTC to a vault, and then deposits it.
* "depositor/IDepositor.sol" provides a generic interface for a depositor implementation.
* "depositor/TellerWithMultiAssetSupportDepositor.sol" provides an implementation of a depositor for a TellerWithMultiAssetSupport vault.
