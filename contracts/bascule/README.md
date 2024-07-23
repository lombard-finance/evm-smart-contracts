# Bascule drawbridge

This repo is a Bascule drawbridge designed to prevent bridge hacks before they
hit the chain. It has an off-chain component and an on-chain component. The
off-chain component watches chains to which a system bridges. Whenever it sees a
deposit on one chain, it notifies the on-chain contract that the deposit has
happened.  Then, when a user tries to withdraw funds from a bridge contract,
that bridge contract can first check with the bascule contract. If the contract
validates the withdrawal, it's safe: a deposit corresponding to the withdrawal
already happened on the other chain. If not, the withdrawal is either early or
malicious. The next sections outline considerations for both the off-chain and
on-chain code.

## Off-chain code

The off-chain code invokes the `reportDeposit`(contracts/Bascule.sol) function
with a list `bytes32[] depositIDs`.  In order for the bascule to be secure, two
things must be true of this invocation:

1. The off-chain code must only invoke *one* instance of the bascule contract.
If the bascule is deployed on multiple chains and there's a bug in the bridge,
violating this invariant could allow an attacker to mint on many chains for the
same deposit.

2. Each `depositID` must be a unique identifier that includes (e.g., by hashing)
all relevant fields of the on-chain deposit.  For example, if the hash does not
include the amount of the deposit, a bridge bug could allow an attacker to
deposit a small amount on one chain and redeem a much larger amount on a
different chain.

To keep the off-chain simple, the `depositID` should, in general, be a hash of
source-chain data (i.e., the deposit transaction details) and the
destination-chain data (e.g., the destination chain-id, bridge contract address,
withdrawal address). In other words the depositID should be unique to a deposit
and globally meaningful, across chains. This makes it extremely easy to enforce
the first invariant.
   
## On-chain code

The on-chain code includes functionality for reporting deposits and validating
withdrawals. In order for the bascule to be secure and usable, the following
conditions must be met:

1. The bridge contract must hold a reference to the bascule, and any admin keys
the allow an upgrade must be kept extremely safe.

2. The bridge contract should do all internal vetting BEFORE calling
`validateWithdrawal`. This function clears transactions from the deposit
history.

3. The withdrawal amount to `validateWithdrawal` MUST be correct if the
validation threshold is not `0` (i.e., if the bascule is configured to only
validate withdrawals greater than or equal to a threshold amount).

> NOTE: A validation guardian can raise the validation threshold from `0` (i.e., validate all withdrawals) with `updateValidateThreshold`; the contract allows all withdrawals below the configured threshold. This makes additional assumptions about the `validateWithdrawal` callee, namely, that the supplied amount MUST be correct (otherwise, e.g., the callee could report 0 for all amounts and bypass validation entirely). Thus, the threshold should be adjusted only with extreme caution.

## Installing and testing

### Installing dependencies

`npm ci`

### Running tests and coverage

```bash
npm run build
npm run test
npm run coverage
```

## Gas estimate of reporting deposits

```
DEPOSIT_NUM=1000 npm run report-gas-estimate
```