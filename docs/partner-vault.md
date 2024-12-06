# FBTC Partner Vault contract

## Prerequisites

- LBTC
- FBTC0
- LockedFBTC

## Overview

The FBTC Partner Vault contract is for users who wish to lock their FBTC to receive LBTC.

## Key methods

There are 3 key user methods, 3 setter functions, a pause functionality and 3 getter functions on this contract.

### 1. setLockedFbtc

**Method:** `setLockedFbtc(address lockedFbtc_)`

**Description:** Sets the lockedFbtc contract address to the partner vault.

**Restrictions:**

- Only callable by contract owner

**Example:**

```javascript
const lockedFbtcAddress = await lockedFbtc.getAddress();
await partnerVault.setLockedFbtc(lockedFbtcAddress);
```

### 2. setStakeLimit

**Method:** `setStakeLimit(uint256 newStakeLimit)`

**Description:** Updates the stake limit of the partner vault.

**Restrictions:**

- Only callable by operator role

**Example:**

```javascript
const stakeLimit = 100000000000;
await partnerVault.setStakeLimit(stakeLimit);
```

### 3. setAllowMintLbtc

**Method:** `setAllowMintLbtc(bool shouldMint)`

**Description:** Sets whether or not the contract will mint LBTC when locking FBTC0.

**Restrictions:**

- Only callable by contract owner

**Example:**

```javascript
const shouldMint = true;
await partnerVault.setAllowMintLbtc(shouldMint);
```

**Emits:**

- `StakeLimitSet(amount)` event
  - `amount`: New amount of the stake limit

### 4. mint

**Method:** `mint(uint256 amount)`

**Description:** Locks up the user's FBTC and mints LBTC to them.

**Prerequisites:** User will need to have an approval of their FBTC balance of at least `amount` to the partner vault contract.

**Returns:** 

- `uint256` The amount of LBTC minted.

**Example:**

```javascript
const amount = 10000;
await partnerVault.mint(amount);
```

### 5. initializeBurn

**Method:** `initializeBurn(address recipient, uint256 amount, bytes32 depositTxId, uint256 outputIndex)`

**Description:** Starts the Locked FBTC burning process.

**Parameters:**

- `address recipient` The recipient of the FBTC
- `uint256 amount` The amount of Locked FBTC to burn
- `bytes32 depositTxId` The transaction ID of the bitcoin network deposit corresponding to the burn
- `uint256 outputIndex` The user's nonce

**Prerequisites:** We will need to have moved `amount` of BTC back to the FBTC `depositAddress` before calling this function.

**Restrictions:**

- Only callable by operator role

**Example:**

```javascript
const recipient = "0x94d62fBbFcb82B38bA28DB4f4bd3B111BaF4175a";
const amount = 10000;
const depositTxId = "0x97667070c54ef182b0f5858b034beac1b6f3089aa2d3188bb1e8929f4fa9b929";
const outputIndex = 0;
await partnerVault.initializeBurn(recipient, amount, depositTxId, outputIndex)
```

### 6. finalizeBurn

**Method:** `finalizeBurn(address recipient)`

**Description:** Finalizes the burning of Locked FBTC after all off-chain bookkeeping is performed.

**Parameters:**

- `address recipient` The recipient of the FBTC

**Prerequisites:** FBTC team should have approved this redeemal.

**Restrictions:**

- Only callable by operator role

**Example:**

```javascript
const recipient = "0x94d62fBbFcb82B38bA28DB4f4bd3B111BaF4175a";
await partnerVault.finalizeBurn(recipient);
```

### 7. stakeLimit

**Method:** `stakeLimit()`

**Description:** Returns the current stake limit.

**Example:**

```javascript
const stakeLimit = await partnerVault.stakeLimit();
```

### 8. remainingStake

**Method:** `remainingStake()`

**Description:** Returns the current amount that can still be staked to the contract.

**Example:**

```javascript
const remainingStake = await partnerVault.remainingStake();
```

### 9. allowMintLbtc

**Method:** `allowMintLbtc()`

**Description:** Returns whether or not the contract will mint LBTC when locking FBTC0.

**Example:**

```javascript
const remainingStake = await partnerVault.allowMintLbtc();
```
