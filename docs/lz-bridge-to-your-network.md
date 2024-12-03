# Bring LBTC to your network

## Prerequisites
* EVM compatible chain with Solidity **0.8.24** support.
* Node.js 18+
* Familiarize yourself with **Hardhat**
* *(Optional)* Fork this repo to your org.
* Prepare **Deployer** EOA wallet with sufficient balance.
* (Optional) Prepare **Factory Deployer** EOA wallet with sufficient balance and zero nonce.
* Prepare non-EOA smart-contract accounts (e.g. [Safe wallet](https://app.safe.global))
  * **Owner** account (who operate smart-contracts).
  * **Pauser** account (who can pause LBTC token).
* LayerZero [EndpointV2](https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts) deployer to your chain.
* At least one [DVN](https://docs.layerzero.network/v2/developers/evm/technical-reference/dvn-addresses) supported your chain and Ethereum

## Deployment

### Add your network
1. Add your network to `hardhat.config.js` in `networks` section
2. Add verification config for your chain
   1. If `@nomicfoundation/hardhat-verify` support your chain add apiKey to `etherscan.apiKey`. Update plugin to latest version if needed.
   2. If explorer require **sourcify** set `enabled` to `true`.
   3. If plugin not support your chain add configuration to `etherscan.customChains`.

### Compile contracts
```yarn hardhat compile```

### Deploy contracts

| Variable                   | Description                                                                                              |
|----------------------------|----------------------------------------------------------------------------------------------------------|
| `OWNER`                    | Owner of smart-contracts                                                                                 |
| `PROXY_FACTORY`            | Address of Proxy Factory deployed to your chain                                                          |
| `YOUR_NETWORK`             | The name of your network from `hardhat.config.ts`                                                        |
| `LBTC`                     | Address of LBTC proxy                                                                                    |
| `LZ_ENDPOINT`              | [EndpointV2](https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts)    |
| `ETH_OFT_ADAPTER`          | OFTAdapter address deployed on Ethereum by your or Lombard team                                          |
| `YOUR_OFT_ADAPTER`         | OFTAdapter deployed to `YOUR_NETWORK`                                                                    |
| `ULN_RECEIVE_LIB`          | [ReceiveUln302](https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts) |
| `ULN_SEND_LIB`             | [SendUln302](https://docs.layerzero.network/v2/developers/evm/technical-reference/deployed-contracts)    |
| `YOUR_EID`                 | EID of `YOUR_NETWORK`                                                                                    |
| `REQUIRED_DVN_COUNT`       | Required count of DVN to confirm bridge                                                                  |
| `REQUIRED_DVNS`            | List of required DVNs, separated by comma                                                                |
| `YOUR_CHAIN_CONFIRMATIONS` | Number of blocks to assume that transction confirmed on your chain                                       |



#### Proxy factory
> WARNING: Perform this step only if factory not provided by Lombard team

Using **Factory Deployer** private key.
```bash
yarn hardhat deploy-proxy-factory --network <YOUR_NETWORK>
```

#### LBTC on your chain

Using **Deployer** private key.
```bash
yarn hardhat deploy-lbtc --consortium 0xf1Bf46D38B16573Ef5CdD44d584888E3f5A9f691 --burn-commission 18446744073709551615 --admin <OWNER> --proxy-factory-addr <PROXY_FACTORY> --network <YOUR_NETWORK>
```

#### LayerZero OFTAdapter on your chain

Using **Deployer** private key.
```bash
yarn hardhat deploy-oft-adapter --admin <OWNER> --lz-endpoint <LZ_ENDPOINT> --lbtc <LBTC> --burn-mint --network <YOUR_NETWORK>
```

#### LayerZero OFTAdapter on Ethereum
> WARNING: Perform this step only if OFTAdapter not provided by Lombard team

```bash
yarn hardhat deploy-oft-adapter --admin <OWNER> --lz-endpoint 0x1a44076050125825900e736c501f859c50fE728c --lbtc 0x8236a87084f8B84306f72007F36F2618A5634494 --network mainnet
```

### Setup contracts
Trigger a bunch of transactions from owner

#### LBTC on your chain
* `transferPauserRole(address newPauser)` with address of **Pauser**
* `addMinter(address newMinter)` with address of **OFTAdapter**

#### LayerZero OFTAdapter on your chain

Using **Owner** send transactions below:

Set Ethereum peer.

`setPeer(uint32 _eid,bytes32 _peer)` where `_eid=30101` and `_peer=<ETH_OFT_ADAPTER>`

Generate input data for inbound limits.
```bash
yarn hardhat setup-oft-rate-limit --eids=30101 --limit <LIMIT> --window <WINDOW> --oapp-address=<YOUR_OFT_ADAPTER> --inbound --network <YOUR_NETWORK> --populate
```

Generate input data for outbound limits.
```bash
yarn hardhat setup-oft-rate-limit --eids=30101 --limit <LIMIT> --window <WINDOW> --oapp-address=<YOUR_OFT_ADAPTER> --outbound --network <YOUR_NETWORK> --populate
```

> WARNING: Next steps are optional, LayerZero set default configs for each OFTAdapter

Generate input data for Send Endpoint config (see `hardhat setup-endpoint-config --help` to get more params).
```bash
yarn hardhat setup-endpoint-config --lz-endpoint <LZ_ENDPOINT> --remote-eid 30101 --oapp-address <YOUR_OFT_ADAPTER> --uln-required-dvn-count <REQUIRED_DVN_COUNT> --uln-required-dvns <REQUIRED_DVNS> --network <YOUR_NETWORK> --uln-lib-address <ULN_RECEIVE_LIB> --uln-confirmations <YOUR_CHAIN_CONFIRMATIONS> --populate
```

Generate input data for Receive Endpoint config (see `hardhat setup-endpoint-config --help` to get more params).
```bash
yarn hardhat setup-endpoint-config --lz-endpoint <LZ_ENDPOINT> --remote-eid 30101 --oapp-address <YOUR_OFT_ADAPTER> --uln-required-dvn-count <REQUIRED_DVN_COUNT> --uln-required-dvns <REQUIRED_DVNS> --network <YOUR_NETWORK> --uln-lib-address <ULN_SEND_LIB> --uln-confirmations 65 --populate
```

#### LayerZero OFTAdapter on Ethereum
> WARNING: Perform this step only if OFTAdapter not provided by Lombard team

Set your chain peer.

`setPeer(uint32 _eid,bytes32 _peer)` where `_eid=<YOUR_EID>` and `_peer=<YOUR_OFT_ADAPTER>`

Generate input data for inbound limits.
```bash
yarn hardhat setup-oft-rate-limit --eids=<YOUR_EID> --limit <LIMIT> --window <WINDOW> --oapp-address=<ETH_OFT_ADAPTER> --inbound --network mainnet --populate
```

Generate input data for outbound limits.
```bash
yarn hardhat setup-oft-rate-limit --eids=<YOUR_EID> --limit <LIMIT> --window <WINDOW> --oapp-address=<ETH_OFT_ADAPTER> --outbound --network mainnet --populate
```

> WARNING: Next steps are optional, LayerZero set default configs for each OFTAdapter

Generate input data for Send Endpoint config (see `hardhat setup-endpoint-config --help` to get more params).
```bash
yarn hardhat setup-endpoint-config --lz-endpoint 0x1a44076050125825900e736c501f859c50fE728c --remote-eid <YOUR_EID> --oapp-address <ETH_OFT_ADAPTER> --uln-required-dvn-count <REQUIRED_DVN_COUNT> --uln-required-dvns <REQUIRED_DVNS> --network mainnet --uln-lib-address 0xbB2Ea70C9E858123480642Cf96acbcCE1372dCe1 --uln-confirmations 65 --populate
```

Generate input data for Receive Endpoint config (see `hardhat setup-endpoint-config --help` to get more params).
```bash
yarn hardhat setup-endpoint-config --lz-endpoint 0x1a44076050125825900e736c501f859c50fE728c --remote-eid <YOUR_EID> --oapp-address <ETH_OFT_ADAPTER> --uln-required-dvn-count <REQUIRED_DVN_COUNT> --uln-required-dvns <REQUIRED_DVNS> --network mainnet --uln-lib-address 0xc02Ab410f0734EFa3F14628780e6e695156024C2 --uln-confirmations <YOUR_CHAIN_CONFIRMATIONS> --populate
```