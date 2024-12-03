# Lombard Stake and Bake contracts

## Summary of contracts
* "StakeAndBake.sol" implements the generic stake and bake logic - it wraps over the LBTC 'automint' functionality and takes in some extra aparameters to `permit` the minted LBTC to a depositor, and then deposits it. The depositor then returns the staked tokens back to the `owner` such that they can take it out when they wish.
* "depositor/IDepositor.sol" provides a generic interface for a depositor implementation. The general idea is that `IDepositor` allows the `StakeAndBake` contract to swap out different function selectors for different vaults and thus remain abstracted over the actual implementation detail of the vault we are using.
* "depositor/TellerWithMultiAssetSupportDepositor.sol" provides an implementation of a depositor for a BoringVault with a TellerWithMultiAssetSupport overlaying it.
