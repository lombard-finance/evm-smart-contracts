# Stake and Bake contract

## Prerequisites

- LBTC

## Overview

The stake and bake contract can be used by users who wish to, in one single transaction, use the 'automint' functionality and immediately deposit their received LBTC into a vault. For this, the contract makes use of an abstraction and can therefore point at any vault, but so far, only implementation for the Veda vault is provided (`contracts/stakeAndBake/depositor/TellerWithMultiAssetSupportDepositor`).

## Key methods

There are 4 key methods for this contract. Two of them are concerned with properly notarizing depositor abstractions for vaults, and the other two are for staking and baking user tokens.

### 1. addDepositor

**Method:** `addDepositor(address vault, address depositor)`

**Description:** Links a vault address to a depositor contract, which will independently take care of interacting with the vault.

**Restrictions:**

- Only callable by contract owner

**Example:**

```javascript
const vaultAddress = await vault.getAddress()
const depositorAddress = await depositor.getAddress()
await stakeAndBake.addDepositor(vaultAddress, depositorAddress);
```

**Emits:**

- `DepositorAdded(vault, depositor)` event
  - `vault`: Address of the vault
  - `depositor`: Address of the depositor contract

### 2. removeDepositor

**Method:** `removeDepositor(address vault)`

**Description:** Remove the link between a vault contract and a depositor contract.

**Restrictions:**

- Only callable by contract owner

**Example:**

```javascript
const vaultAddress = await vault.getAddress()
await stakeAndBake.removeDepositor(vaultAddress);
```

**Emits:**

- `DepositorRemoved(vault)` event
  - `vault`: Address of the vault

### 3. stakeAndBake

**Method:** `stakeAndBake(StakeAndBakeData calldata data)`

**Description:** Performs mint for a user, and immediately sends his LBTC into a given vault, and returns the vault's shares to the user. Funds should be permitted to be transferred to the `StakeAndBake` contract, or there should be an outstanding allowance to the `StakeAndBake` contract in order to make this function work.

**Parameter layout:**

The function uses a struct to take the arguments in, to avoid `stack too deep` errors. The struct is defined as follows:

```solidity
struct StakeAndBakeData {
    /// @notice vault Address of the vault we will deposit the minted LBTC to
    address vault;
    /// @notice owner Address of the user staking and baking
    address owner;
    /// @notice permitPayload Contents of permit approval signed by the user
    bytes permitPayload;
    /// @notice depositPayload Contains the parameters needed to complete a deposit
    bytes depositPayload;
    /// @notice mintPayload The message with the stake data
    bytes mintPayload;
    /// @notice proof Signature of the consortium approving the mint
    bytes proof;
}
```

The lower 2 fields are identical to the parameters for the `mint` functionality on `LBTC`. The first address should point at the vault the user wishes to deposit in, and the second address should be the user address.

The layout for `permitLayout` is as follows:

```solidity
(uint256 value, uint256 deadline, uint8 v, uint256 r, uint256 s)
```

This conforms with the information needed for `ERC20.permit`.

The layout for `depositPayload` is as follows:

```solidity
(address depositAsset, uint256 depositAmount)
```

`depositAsset` should be the address of the asset we are wishing to deposit to the vault, in this case it should be the `LBTC` address. The `depositAmount` is simply the amount of satoshis we wish to deposit.

**Example:**

```javascript
const permitPayload = encode(
    ['uint256', 'uint256', 'uint8', 'uint256', 'uint256'],
    [depositValue, deadline, v, r, s]
);

const depositPayload = encode(
    ['address', 'uint256'],
    [await lbtc.getAddress(), depositValue]
);
const mintPayload = '0x...'
const proof = '0x...'
const feePayload = '0x...'
const userSignature = '0x...'
await stakeAndBake.stakeAndBake({
    vault: await teller.getAddress(),
    owner: owner.address,
    permitPayload: permitPayload,
    depositPayload: depositPayload,
    mintPayload: data.payload,
    proof: data.proof,
    feePayload: approval,
    userSignature: userSignature,
})
```

### 4. batchStakeAndBake

**Method:** `batchStakeAndBake(StakeAndBakeData[] calldata data)`

**Description:** Bundles multiple `stakeAndBake` calls into one transaction.

**Example:**

```javascript
await stakeAndBake.batchStakeAndBake([
    {
        vault: await teller.getAddress(),
        owner: owner1.address,
        permitPayload: permitPayload1,
        depositPayload: depositPayload1,
        mintPayload: data.payload1,
        proof: data.proof1,
    },
    {
        vault: await teller.getAddress(),
        owner: owner2.address,
        permitPayload: permitPayload2,
        depositPayload: depositPayload2,
        mintPayload: data.payload2,
        proof: data.proof2,
    }
])
```
