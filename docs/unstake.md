# Unstake LBTC

## Prepare output script
LBTC currently supports only `p2wpkh`, `p2wsh` and `p2tr` scripts

```js
import bitcoin, {initEccLib} from "bitcoinjs-lib";
import * as ecc from 'tiny-secp256k1';

initEccLib(ecc)

const example = () => {
  const p2tr = bitcoin.payments.p2tr({
    address: "tb1pnxwcmkt979yxvtwr326lfmsvgww2m0xq4dwfg6j9zk0rpvm389rsj2ju3v",
    network: bitcoin.networks.testnet,
  })
  const p2trOutputScript = p2tr.output.toString("hex");


  const p2wpkh = bitcoin.payments.p2wpkh({
    address: "tb1q8hhxzk92ex6qe4mxkgdpawy4d6vmrlcrlyxhxv",
    network: bitcoin.networks.testnet,
  })

  const p2wpkhOutputScript = p2wpkh.output.toString('hex');
}
```

## Make transaction

## Validate unstake

Call the function `calcUnstakeRequestAmount(bytes calldata scriptPubkey, uint256 amount) public view returns (uint256 amountAfterFee, bool isAboveDust)` to validate unstake amount and payment script.

Call the function `redeem(bytes calldata scriptPubkey, uint256 amount)`

**Params**

* `scriptPubkey` - output script from [previous step](#prepare-output-script)
* `amount` - amount of LBTC to unstake (*Important: Lombard takes fee from the final amount which will be paid to cover BTC transaction fees*)

[Example](TBD)


