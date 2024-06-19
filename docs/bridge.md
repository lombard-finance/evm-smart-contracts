# Bridge of LBTC

## Prerequisites

### Smart-contracts
| Contract / Chain | Holesky (17000) | Scroll Testnet (534351) |
| ---------------- | ------- | -------------- |
| LBTC             | [0xED7bfd5C1790576105Af4649817f6d35A75CD818](https://holesky.etherscan.io/address/0xED7bfd5C1790576105Af4649817f6d35A75CD818)      | [0xea0f056059B895a7B29f6D78ADBC18485fC073f5](https://sepolia.scrollscan.com/address/0xea0f056059B895a7B29f6D78ADBC18485fC073f5)             |

### Base64
Consortium works only with base64 representation of binary data. But ETH libraries (such as web3 or ethers) use hex.
For some request you need to convert data to needed format

#### From base64
```js
let base64 = Buffer.from("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQmgAAAAAAAAAAAAAAADnWqHbC2ruhb+FLX1GIMQEDI2q0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPowSHQTQoeIaaktL6/SBHHq4CunZtpedjPPVtVlYG/NOIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ==", "base64");
const hex = `0x${base64.toString("hex")}`
```
[Online converter](https://base64.guru/converter/decode/hex)

#### To base64
[Online converter](https://base64.guru/converter/encode/hex)

## Deposit

Call the function `depositToBridge(uint256 toChain, address toAddress, uint256 amount)`

**Params**

* toChain - destination chain id
* toAddress - destination address
* amount - amount of LBTC

[Example](https://holesky.etherscan.io/tx/0xc0cabb621114d42f324976069bdcd9746aad9633da33027f77a1a11201be1e42)

## Notarize

### Request notarization of deposit making
`POST https://staging.prod.lombard.finance/v1alpha/notarize/transaction`
```json
{
  "threshold_key": "d6594eb1-5740-4c2f-bcde-76bb15d85649",
  "chain_id": 17000,
  "transaction_hash": "wMq7YhEU1C8ySXYGm9zZdGqtljPaMwJ/d6GhEgG+HkI="
}
```

**Params**
* `threshold_key` - current threshold key for consortium
* `chain_id` - chain id of network where transaction is presented
* `transaction_hash` - base64 encoded hash of transaction  

**Response**
```json
{
    "notarized_transaction": {
        "id": "d487803b-62e5-498a-a88d-eaeed62ae9bb",
        "status": "NOTARIZED_TRANSACTION_STATUS_CONFIRMED",
        "blockchain": "BLOCKCHAIN_TYPE_EVM",
        "transaction_hash": "wMq7YhEU1C8ySXYGm9zZdGqtljPaMwJ/d6GhEgG+HkI=",
        "block_number": "1761284",
        "block_hash": "Z/INcUVwE+E3OqwGqEFnSkV/fYpCejxWLGJv+aKFRKA=",
        "transaction_index": "33",
        "receipt_hash": "mtrv1ibthnYntbekTdJrNwFSoGTXboi+O+eFQOTqFGk=",
        "transferred_amount": "0",
        "chain_id": "17000",
        "threshold_key": "d6594eb1-5740-4c2f-bcde-76bb15d85649",
        "proposal": "cc7321ff-7f12-4d01-99f5-e32061b883c6",
        "payload": "2JSjPEdf3nusbDwC4sRTsZPnt19wK0FOWHpBfQSk6LM=",
        "signature": "PaJQCQJEeqwCYF66JXNv5B3x6PN5E35iL1UZcCuyLNx0v10Zm97un5sFbxGSDbvEaM4NljNYAZXaCXWEk6WkzgA=",
        "raw_payload": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQmgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcDKu2IRFNQvMkl2Bpvc2XRqrZYz2jMCf3ehoRIBvh5CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAa4ARn8g1xRXAT4Tc6rAaoQWdKRX99ikJ6PFYsYm/5ooVEoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAhmtrv1ibthnYntbekTdJrNwFSoGTXboi+O+eFQOTqFGkAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="
    }
}
```

**Fields**

* `signature` - base64 encoded signature ([modify](#modify-signature) before usage)
* `raw_payload` - base64 encoded raw payload (use as-is in [Withdraw](#withdraw))

### Modify signature

Before usage you need to modify `signature`

```js
const proofSignature = Buffer.from("PaJQCQJEeqwCYF66JXNv5B3x6PN5E35iL1UZcCuyLNx0v10Zm97un5sFbxGSDbvEaM4NljNYAZXaCXWEk6WkzgA=", "base64");
  proofSignature[proofSignature.length - 1] += 27;
  const signature = proofSignature.toString("hex");
```

### Encode transaction receipt

```js
import Web3 from "web3";
import * as rlp from "rlp";

function encodeTransactionReceipt(txReceipt) {
  txReceipt.logs.forEach((l) => console.log(l.data))
  const rlpLogs = txReceipt.logs.map((log) => {
    return [
      log.address,
      log.topics,
      Buffer.from(log.data.substr(2), "hex"),
    ];
  });
  const rlpReceipt = [
    Web3.utils.numberToHex(Number(txReceipt.status)),
    Web3.utils.numberToHex(txReceipt.cumulativeGasUsed),
    rlpLogs,
  ];
  const encodedReceipt = Web3.utils.bytesToHex(rlp.encode(rlpReceipt));

}
```

## Withdraw

Call the function `withdrawFromBridge(bytes rawPayload, bytes rawReceipt, bytes proofSignature)`

**Params**

* rawPayload - hex encoded `raw_payload` from [previous step](#request-notarization-of-deposit-making)
* rawReceipt - [rlp encoded receipt](#encode-transaction-receipt) (`encodedReceipt` from `encodeTransactionReceipt()`
* proofSignature - hex encoded `signature` from [previous step](#modify-signature)

[Example](https://sepolia.scrollscan.com/tx/0x87ec0b78679c21a4d5acdf4cc317fcf1c11ad1218e00ac8b0531d37a94510c72)