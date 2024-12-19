# Redeem LBTC

This action initiate process of redeem of `LBTC` to `BTC`.

## Prepare payment script
> **IMPORTANT**: The Lombard team has no plans to support legacy scripts.

`LBTC` currently supports only `p2wpkh`, `p2wsh` and `p2tr` [payment scripts](https://learnmeabitcoin.com/technical/script/#standard-scripts). In other words bitcoin address is representation of script.

**Example:**
```js
import bitcoin, {initEccLib} from "bitcoinjs-lib";
import * as ecc from 'tiny-secp256k1';

initEccLib(ecc)

const example = () => {
  
  // Example of p2tr (Taproot)
  const p2tr = bitcoin.payments.p2tr({
    address: "tb1pnxwcmkt979yxvtwr326lfmsvgww2m0xq4dwfg6j9zk0rpvm389rsj2ju3v",
    network: bitcoin.networks.testnet,
  })
  const p2trOutputScript = p2tr.output.toString("hex");

  // Example of p2wpkh (segwit)
  const p2wpkh = bitcoin.payments.p2wpkh({
    address: "tb1q8hhxzk92ex6qe4mxkgdpawy4d6vmrlcrlyxhxv",
    network: bitcoin.networks.testnet,
  })

  const p2wpkhOutputScript = p2wpkh.output.toString('hex');

  // Example of p2wsh script (segwit)
  const p2wsh = bitcoin.payments.p2wsh({
    address: "tb1q8hhxzk92ex6qe4mxkgdpawy4d6vmrlcrlyxhxv",
    network: bitcoin.networks.testnet,
  })

  const p2wshOutputScript = p2wsh.output.toString('hex');
}
```

## Validate payment script and amount

`LBTC` smart-contract provides the method to validate your payment script and amount to satisfy dust and fee requirements.

### Function: `calcUnstakeRequestAmount(bytes calldata scriptPubkey,uint256 amount)`
Calculate the amount that will be redeemed and check if it's above the dust limit.

**Returns:** 
* `uint256 amountAfterFee` - the amount that will be sent to the payment script after subtracting the security fee;
* `bool isAboveDust` - the flag shows that the final amount exceeds the dust and can be paid to the payment script.

**Example:**

```typescript
const [amountAfterFee, isAboveDust] = await lbtc.calcUnstakeRequestAmount(
  p2wshOutputScript,
  amount
);
```

## Send redeem tx

After transaction sent it requires some time to process your request. In 7 days you should receive final amount of `BTC` to your bitcoin address.

### Function: `redeem(bytes calldata scriptPubkey, uint256 amount)`
> **IMPORTANT**: function doesn't require approval to LBTC contract.

Burns `LBTC` and emits an `UnstakeRequest` event to be notarized by the `Notary Consortium`.

**Example:**

```typescript
await lbtc.redeem(p2wshOutputScript, amount)
```
[Prod tx](https://etherscan.io/tx/0xccb03348177fac623f866ae9e77a2678dd9b2572d2bdd205029d17e11e5394b0)