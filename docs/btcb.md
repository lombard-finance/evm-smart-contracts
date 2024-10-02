# BTCBPMM Documentation

## Overview

The BTCBPMM (BTCB Private Market Maker) contract allows users to swap BTCB for LBTC and manages the amount of BTCB that can be staked.

## Key Methods

### 1. Swap BTCB to LBTC

**Method:** `swapBTCBToLBTC(uint256 amount)`

**Description:** Allows users to swap BTCB for an equivalent amount of LBTC.

**Parameters:**

- `amount`: The amount of BTCB to swap (in wei)

**Preconditions:**

- User must have approved the BTCBPMM contract to spend their BTCB
- Contract must not be paused
- The swap amount plus current total stake must not exceed the stake limit

**Example:**

```javascript
const amount = ethers.utils.parseUnits("1.0", 18); // 1 BTCB
await btcbContract
  .connect(user)
  .approve(await btcbpmmContract.getAddress(), amount);
await btcbpmmContract.connect(user).swapBTCBToLBTC(amount);
```

**Emits:**

- Transfer event on BTCB
- Transfer event on LBTC

**Error Handling:**

- Check for `StakeLimitExceeded` error
- Check for `EnforcedPause` error

### 2. Check Remaining Stake

**Method:** `remainingStake()`

**Description:** Returns the amount of additional BTCB that can be staked before reaching the limit.

**Returns:** `uint256` - Remaining stake amount in wei

**Example:**

```javascript
const remainingStake = await btcbpmmContract.remainingStake();
console.log(Remaining stake: ${ethers.utils.formatUnits(remainingStake, 18)} BTCB);
```

### 3. Get Current Stake Limit

**Method:** `stakeLimit()`

**Description:** Returns the current maximum total stake allowed.

**Returns:** `uint256` - Stake limit in wei

**Example:**

```javascript
const stakeLimit = await btcbpmmContract.stakeLimit();
console.log(Stake limit: ${ethers.utils.formatUnits(stakeLimit, 18)} BTCB);
```

### 4. Check Contract Pause Status

**Method:** `paused()`

**Description:** Checks if the contract is currently paused.

**Returns:** `boolean` - True if paused, false otherwise

**Example:**

```javascript
const isPaused = await btcbpmmContract.paused();
console.log(Contract is ${isPaused ? 'paused' : 'not paused'});
```

## Administrative Functions

These functions are restricted to accounts with specific roles and are typically not accessible to regular users. However, frontend developers should be aware of them for administrative interfaces or to handle potential state changes.

### 5. Pause Contract

**Method:** `pause()`

**Description:** Pauses the contract, preventing swaps and withdrawals.

**Restrictions:**

- Only callable by accounts with PAUSER_ROLE

**Example:**

```javascript
await btcbpmmContract.connect(pauser).pause();
```

**Emits:**

- Paused event

### 6. Unpause Contract

**Method:** `unpause()`

**Description:** Unpauses the contract, allowing swaps and withdrawals to resume.

**Restrictions:**

- Only callable by accounts with DEFAULT_ADMIN_ROLE

**Example:**

```javascript
await btcbpmmContract.connect(admin).unpause();
```

**Emits:**

- Unpaused event

### 7. Set Withdrawal Address

**Method:** `setWithdrawalAddress(address newWithdrawAddress)`

**Description:** Sets a new address for BTCB withdrawals.

**Parameters:**

- `newWithdrawAddress`: The new address to receive withdrawals

**Restrictions:**

- Only callable by accounts with TIMELOCK_ROLE

**Example:**

```javascript
await timelock.execute(
  await btcbpmmContract.getAddress(),
  0,
  btcbpmmContract.interface.encodeFunctionData("setWithdrawalAddress", [newWithdrawAddress]),
  "0x",
  ethers.utils.formatBytes32String("change-withdrawal-address");
);
```

**Emits:**

- WithdrawalAddressSet event

### 8. Set Stake Limit

**Method:** `setStakeLimit(uint256 newStakeLimit)`

**Description:** Sets a new maximum total stake limit.

**Parameters:**

- `newStakeLimit`: The new maximum total stake allowed (in wei)

**Restrictions:**

- Only callable by accounts with TIMELOCK_ROLE

**Example:**

```javascript
await timelock.execute(
  await btcbpmmContract.getAddress(),
  0,
  btcbpmmContract.interface.encodeFunctionData("setStakeLimit", [newStakeLimit]),
  "0x",
  ethers.utils.formatBytes32String("change-stake-limit");
);
```

**Emits:**

- StakeLimitSet event
