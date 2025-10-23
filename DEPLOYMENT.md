# Deployment

## Envs
| Ledger network | Name    | json            |
|----------------|---------|-----------------|
| devnet         | staging | devnet.json     |
| gastald        | testnet | gastald.json    |
| mainnet        | mainnet | mainnet.json    |
| bft            | bft     | devnet-bft.json |
| ibc            | ibc     | devnet-ibc.json |

## Prerequisites
Use Node 18+

Install dependencies
```bash
yarn
```
Compile contracts
```bash
yarn hardhat compile
```
Set either `DEPLOYER_SK` or `TESTNET_DEPLOYER_SK` secret key
```bash
yarn hardhat vars set ${KEY_NAME} ${SK}
```

Set premium rpc.
```bash
yarn hardhat vars set ${RPC_NAME} ${RPC_URL}
```
`RPC_VAR` can be found in `hardhat.config.ts`

Set explorer api key if required
```bash
yarn hardhat vars set ${NAME_API_KEY} ${API_KEY}
```
`NAME_API_KEY` can be found in `hardhat.config.ts`

For some commands `--populate` flag available.
The result of script will be calldata that can be sent from multisig.

## Proxy factory
Before any *deterministic* deployment `ProxyFactory` should be deployed.
Switch secret key to special once
```bash
yarn hardhat vars set ${KEY_NAME} ${SK}
```

Deploy `ProxyFactory` contract
```bash
yarn hardhat deploy-proxy-factory --admin ${OWNER} --deployer ${DEPLOYER} --network ${NETWORK}
```

Switch key back.

Using owner add more accounts with deployer role if needed.

## Consortium (deterministic)
Deploy `Consortium` contract
```bash
yarn hardhat deploy-consortium --ledger-network ${ENV} --network ${NETWORK}
```
Write proxy address to json file.

### Configuration

```bash
hardhat setup-initial-valset --target ${CONSORTIUM} --populate --network ${NETWORK} --valset ${VALSET}
```

## LBTC (deterministic)
> Because of `Consortium` address is deterministic it can be set using generated address without deployment.

Deploy `LBTC` contract
```bash
yarn hardhat deploy-lbtc --ledger-network ${ENV} --admin ${OWNER} --consortium ${CONSORTIUM} --network ${NETWORK} --treasury ${OWNER}
```
Write proxy address to json file.

### Configuration

#### Bascule
Set `Bascule` using `changeBascule` if required.

#### Claimer
Set claimer
```bash
yarn hardhat setup-claimer --target ${LBTC} --claimer ${CLAIMER} --network ${NETWORK}
```

#### Operator
Set operator using `transferOperatorRole`.

#### Pauser
```bash
yarn hardhat setup-transfer-pauser-role --target ${LBTC} --pauser ${PAUSER} --network ${NETWORK}
```

#### Mint fee
Set mint fee from operator
```bash
yarn hardhat setup-mint-fee --target ${LBTC} --fee ${MINT_FEE} --network ${NETWORK}
```

#### Redeem
Enable redeem using `toggleWithdrawals` if required.

## Oracle

Deploy `StakedLBTCOracle` contract
```bash
yarn hardhat deploy-oracle [--ledger-network ${ENV}] [--admin ${OWNER}] --consortium ${CONSORTIUM} --network ${NETWORK} --token ${TOKEN} --denom ${DENOM_HASH} [--ratio ${INITIAL_RATIO}] [--switch-time ${SWITCH_TIME}] [--max-interval ${MAX_SWITCH_INTERVAL}] [--proxy-factory-addr ${PROXY_FACTORY}]
```
Write proxy address to json file.

### Configuration

## Mailbox (GMP)

Deploy `Mailbox` contract
```bash
yarn hardhat deploy-gmp-mailbox --ledger-network ${ENV} --fee ${WEI_PER_BYTE} --admin ${OWNER} --consortium ${CONSORTIUM} --network ${NETWORK} --proxy-factory-addr ${PROXY_FACTORY}
```
Write proxy address to json file.

### Configuration

Set pauser and treasury:
```bash
yarn hardhat role grant ${MAILBOX} PAUSER_ROLE ${PAUSER_ADDR} --network ${NETWORK}
yarn hardhat role grant ${MAILBOX} TREASURER_ROLE ${TREASURY_ADDR} --network ${NETWORK}
```

Enable pathway:
```bash
yarn hardhat mailbox-enable-path --target ${MAILBOX} --remote-chain-id ${REMOTE_CHAIN} --remote-mailbox ${REMOTE_MAILBOX} --direction {inbound|outbound|both} [--populate] --network ${NETWORK}
```

Pathway to Ledger is required for GMP minting and redeeming.
The gmp module address (Mailbox on Ledger): `0x000000000000000000000000cc0bbbee7c9dd4f3f30e01c7f1fcbeb839f30c47`

## Bridge V2 (GMP)

Deploy `BridgeV2` contract
```bash
yarn hardhat deploy-gmp-bridge [--ledger-network ${ENV}] [--admin ${OWNER}] --mailbox ${MAILBOX} --network ${NETWORK} [--proxy-factory-addr ${PROXY_FACTORY}]
```
Write proxy address to json file.

### Configuration

Add Bridge as Minter for token:
```bash
yarn hardhat role grant ${TOKEN} MINTER_ROLE ${BRIDGE} --network ${NETWORK} [--populate]
```

Allowlist Bridge in Mailbox:
```bash
yarn hardhat mailbox-set-config --target ${MAILBOX} --sender ${BRIDGE} --max-payload-size 388 --fee-disabled [--populate] --network ${NETWORK}
```

Set destination bridge address:
```bash
yarn hardhat setup-destination-bridge ${BRIDGE} --dest-chain-id ${DEST_CHAIN} --dest-bridge ${DEST_BRIDGE} [--populate] --network ${NETWORK}
```

Allowlist token:
```bash
yarn hardhat setup-destination-token ${BRIDGE} --dest-chain-id ${DEST_CHAIN} --destination-token ${DST_TOKEN} --source-token ${SRC_TOKEN} [--populate] --network ${NETWORK}
```

Set token rate limits:
```bash
yarn hardhat setup-token-rate-limits ${BRIDGE} ${TOKEN} --chain-id ${FROM_CHAIN} --window ${SEC} --limit ${LIMIT} [--populate] --network ${NETWORK}
```

Make allowance to token adapter if presented.

Allowlist senders (such as CCIP Token Pool).

## Asset Router

Deploy `AssetRouter` contract
```bash
yarn hardhat deploy-asset-router --ledger-chain-id ${LEDGER_CHAIN_ID} --bitcoin-chain-id ${BITCOIN_CHAIN_ID} --mailbox ${MAILBOX} --network ${NETWORK} [--ledger-network ${ENV}] [--admin ${OWNER}] [--proxy-factory-addr ${PROXY_FACTORY}] [--bascule ${BASCULE}] [--admin-change-delay ${ADMIN_CHANGE_DELAY}]
```
Write proxy address to json file.

### Configuration

Set callers:
```bash
yarn hardhat role grant ${ASSET_ROUTER} CALLER_ROLE ${STAKED_LBTC} --network ${NETWORK}
yarn hardhat role grant ${ASSET_ROUTER} CALLER_ROLE ${NATIVE_LBTC} --network ${NETWORK}
```

Set claimer:
```bash
yarn hardhat role grant ${ASSET_ROUTER} CLAIMER_ROLE ${CLAIMER_ADDR} --network ${NETWORK}
```

Set operator:
```bash
yarn hardhat role grant ${ASSET_ROUTER} OPERATOR_ROLE ${OPERATOR_ADDR} --network ${NETWORK}
```

Set redeem routes:
```bash
yarn hardhat asset-router-set-route --target ${ASSET_ROUTER} --from-token ${FROM_TOKEN} --from-chain ${FROM_CHAIN} --to-token ${TO_TOKEN} --to-chain ${TO_CHAIN} --route-type 2 --network ${NETWORK} [--populate]
```
Bitcoin token address: `0x0000000000000000000000000000000000000001`

Whitelist asset router in mailbox:
```bash
yarn hardhat mailbox-set-config --target ${MAILBOX} --sender ${ASSET_ROUTER} --max-payload-size 600 --fee-disabled --network ${NETWORK} [--populate]
```

## NativeLBTC (deterministic)
> Because of `Consortium` address is deterministic it can be set using generated address without deployment.

Deploy `NativeLBTC` contract
```bash
yarn hardhat deploy-native-lbtc --ledger-network ${ENV} --admin ${OWNER} --consortium ${CONSORTIUM} --network ${NETWORK} --treasury ${OWNER} --name "Native LBTC" --symbol "nativeLBTC"
```
Write proxy address to json file.

### Configuration

Set burn commission

```bash
yarn hardhat setup-burn-commission --target ${TOKEN} --value ${COMMISSION} --network ${NETWORK}
```

Enable withdrawals

```bash
yarn hardhat setup-toggle-withdrawals --target ${TOKEN} --network ${NETWORK}
````

## Bridge Token Adapter
Replaces `NativeLBTC` contract with custom integration for BridgeToken (BTC.b).

Deploy `AssetRouter` contract
```bash
yarn hardhat deploy-bridge-token-adapter --consortium ${CONSORTIUM} --network ${NETWORK} [--bridge-token ${BRIDGE_TOKEN}] [--admin ${OWNER}] [--treasury ${TREASURY}] [--admin-change-delay ${ADMIN_CHANGE_DELAY}]
```
Write proxy address to json file.

### Configuration

Set `AssetRouter` and `BridgeV2` as minters.
```bash
yarn hardhat role grant ${ADAPTER} MINTER_ROLE ${ROUTER} --network ${NETWORK}
yarn hardhat role grant ${ADAPTER} MINTER_ROLE ${BRIDGE} --network ${NETWORK}
```

Set allowance for adapter to spend from bridge.

## Bridge (deterministic)
> `LBTC` should be deployer before start

Deploy `Bridge` contract
```bash
yarn hardhat deploy-bridge --ledger-network ${ENV} --admin ${OWNER} --lbtc ${LBTC} --treasury ${OWNER} --network ${NETWORK}
```
Write proxy address to json file.

## CCIP
> `Bridge` should be deployed before start

Use `ccip-token-pool-1.5.0` tag to deploy v1.5.0 token pool.

### Adapter & TokenPool (v1.5.0)
> The version of TokenPool compatbile only with BridgeV1 through adapter.

Deploy `Adapter` (`TokenPool` will be deployed by adapter) on each chain
```bash
yarn hardhat deploy-chainlink-adapter --admin ${OWNER} --router ${CCIP_ROUTER} --bridge ${BRIDGE} --rmn ${CCIP_RMN} --network ${NETWORK}
```
Write contracts address to json file.

Claim admin rights over `LBTC token` in ccip and set the pool:

Call `registerAdminViaOwner` in blockchain explorer on `RegistryModuleOwnerCustom` contract (address should be provided by CCIP), `localToken` address = `LTBC` token address

Call `acceptAdminRole` in blockchain explorer on `TokenAdminRegistry` contract (address should be provided by CCIP), `localToken` address = `LTBC` token address

Call `setPool` in blockchain explorer on `TokenAdminRegistry` contract (address should be provided by CCIP), `localToken` address = `LTBC` token address, `pool` address = `LombardTokenPool` address

### Token Pool (v1.6.1)
> The version of TokenPool compatible only with BridgeV2.

Deploy `LombardTokenPoolV2` contract on each chain for each token.
```bash
yarn hardhat deploy-ccip-token-pool-v2 --bridge ${BRIDGE} --token ${TOKEN} --rmn ${RMN} --router ${ROUTER} --network ${NETWORK} [--token-adapter ${TOKEN_ADAPTER}] [--fallback-decimals ${FALLBACK_DECIMALS}]
```
**Write contracts address to json file.**

#### Configuration

Claim admin rights over token in CCIP and set the pool:
* Call from token owner `registerAdminViaOwner` (or `registerAdminViaGetCCIPAdmin` if presented) in blockchain explorer on `RegistryModuleOwnerCustom` contract (address presented in [ChainLink directory](https://docs.chain.link/ccip/directory)).
* Call from token owner `acceptAdminRole` in blockchain explorer on `TokenAdminRegistry` contract (address presented in [ChainLink directory](https://docs.chain.link/ccip/directory)).
* Call from token owner `setPool` in blockchain explorer on `TokenAdminRegistry` contract (address presented in [ChainLink directory](https://docs.chain.link/ccip/directory)).

Call `setSenderConfig` on `BridgeV2` contract for each Token Pool to set 100% (`100_00`) fee discount and allowlist it.

Apply chain updates, set path and add remote token pool:
```bash
yarn hardhat setup-token-pool-v2 ${TOKEN_POOL} --remote-token ${REMOTE_TOKEN} --remote-selector ${REMOTE_SELECTOR} --remote-chain ${REMOTE_CHAIN_ID} --remote-pool ${REMOTE_POOL} --network ${NETWORK} [--populate]
```

Set `TokenPool` rate limits
> TODO: rate limits script for new pool

### Bridge

Setup Bridge destinations using adapters
```bash
yarn hardhat setup-add-destination --target ${SOURCE_BRIDGE} --chain-id ${TO_CHAIN_ID} --contract ${DESTINATION_BRIDGE} --rel-commission ${RELATIVE_COMMISSION} --abs-commission ${ABSOLUTE_COMMISSION} --adapter ${SOURCE_ADAPTER} --require-consortium --network ${NETWORK} [--populate]
```
Chain ids can be viewed [here](https://chainlist.org)

Enable `TokenPool`
```bash
yarn hardhat setup-token-pool --cl-adapter ${SOURCE_ADAPTER} --lbtc ${REMOTE_LBTC} --remote-selector ${DESTINATION_CCIP_SELECTOR} --chain ${DESTINATION_CHAIN_ID} --remote-pool ${DESTINATION_TOKEN_POOL} --network ${NETWORK} [--populate]
```
Remote selector can be viewed [here](https://docs.chain.link/ccip/directory/mainnet)

Set `TokenPool` rate limits
```bash
yarn hardhat setup-ccip-apply-updates --cl-adapter ${SOURCE_ADAPTER} --remote-selector ${DESTINATION_CCIP_SELECTOR} --inbound-limit-rate ${INBOUND_REFILL_PER_SECOND} --inbound-limit-cap ${INBOUND_BUCKET_LIMIT} --outbound-limit-rate ${OUTBOUND_REFILL_PER_SECOND} --outbound-limit-cap ${OUTBOUND_BUCKET_LIMIT} --network ${NETWORK} [--populate]
```

Setup `Bridge` rate limits, they should ~2x from `TokenPool` limits.
```bash
yarn hardhat setup-bridge-rate-limits --bridge ${SOURCE_BRIDGE} --chain-id ${TO_CHAIN_ID} --network ${NETWORK} --window ${WINDOW_SECONDS} --limit ${WINDOW_LIMIT} [--populate]
```

Grant minting ability to bridge
```bash
yarn hardhat setup-minter --target ${LBTC} --minter ${SOURCE_BRIDGE} --network ${NETWORK}
```

## LayerZero

> **LBTC** should be deployed on both chains before start

### Oft adapters

Deploy oft-adapter to home chain (usually ethereum).
```bash
yarn hardhat deploy-oft-adapter --admin ${OWNER} --lz-endpoint ${LZ_ENDPOINT} --lbtc ${LBTC_ADDRESS} --network ${NETWORK}
```
Endpoint address [here](https://docs.layerzero.network/v2/deployments/deployed-contracts)
Write address of adapter to json file as `layerZero.LBTCOFTAdapter_destination-chain`.

Deploy oft-adapter to destination chain.
```bash
yarn hardhat deploy-oft-adapter --network ${NETWORK} --admin ${OWNER} --lz-endpoint ${LZ_ENDPOINT} --lbtc ${LBTC} --burn-mint
```
Endpoint address [here](https://docs.layerzero.network/v2/deployments/deployed-contracts)
Write address of adapter to json file as `layerZero.LBTCBurnMintOFTAdapter`.


Setup oft-adapters on both chains
```bash
yarn hardhat setup-oft-set-peer --network ${NETWORK} --target ${ADAPTER} --eid ${DESTINATION_EID} --peer ${DESTINATION_ADAPTER}
```

Setup oft rate limits on both chains
```bash
yarn hardhat setup-oft-rate-limits --network ${NETWORK} --eids ${DESTINATION_EID} --limit ${LIMIT} --window ${WINDOW_IN_SEC} --inbound --oapp-address ${ADAPTER}
yarn hardhat setup-oft-rate-limits --network ${NETWORK} --eids ${DESTINATION_EID} --limit ${LIMIT} --window ${WINDOW_IN_SEC} --outbound --oapp-address ${ADAPTER}
```

Set [DVNs](https://docs.layerzero.network/v2/deployments/dvn-addresses) on both chains.
Usually we use 2 DVNs: LayerZero Labs and Nethermind, but good to have more if available.
> DVN address is different for each chain

`REQUIRED_DVN_COUNT` usually equal to total count of used DVNs, no threshold.
`ULN_LIB_ADDRESS` and `LZ_ENDPOINT` presented [here](https://docs.layerzero.network/v2/deployments/deployed-contracts)
`ULN_CONFIRMATIONS` confirmations required for bridge.
It should match on both chains (e.g. 30 confirmation for receive lib on chain A and 30 confirmation to send on chain B)
```bash
# use send lib, it means that you change send config
yarn hardhat setup-endpoint-config --lz-endpoint ${LZ_ENDPOINT} --remote-eid ${DESTINATION_EID} --oapp-address ${ADAPTER} --uln-required-dvn-count ${REQUIRED_DVN_COUNT} --uln-required-dvns ${DVN1},${DVN2} --network ${NETWORK} --uln-lib-address ${ULN_LIB_ADDRESS} --uln-confirmations ${ULN_CONFIRMATIONS}

# use receive lib here, it means that you change receive config
yarn hardhat setup-endpoint-config --lz-endpoint ${LZ_ENDPOINT} --remote-eid ${DESTINATION_EID} --oapp-address ${ADAPTER} --uln-required-dvn-count ${REQUIRED_DVN_COUNT} --uln-required-dvns ${DVN1},${DVN2} --network ${NETWORK} --uln-lib-address ${ULN_LIB_ADDRESS} --uln-confirmations ${ULN_CONFIRMATIONS} --uln-receive
```

Grant mint ability to `LBTCBurnMintOFTAdapter` on chain where it's deployed.
```bash
yarn hardhat setup-minter --target ${LBTC} --minter ${ADAPTER} --network ${NETWORK}
```

Example of endpoint config setup
```bash
yarn hardhat setup-endpoint-config --lz-endpoint 0xAaB5A48CFC03Efa9cC34A2C1aAcCCB84b4b770e4 --remote-eid 30101 --oapp-address 0xC832183d4d5fc5831daaC892a93dBBfd798034E3 --uln-required-dvn-count 2 --uln-required-dvns 0x7a23612f07d81f16b26cf0b5a4c3eca0e8668df2,0xc097ab8cd7b053326dfe9fb3e3a31a0cce3b526f --network etherlink --uln-lib-address 0xc1B621b18187F74c8F6D52a6F709Dd2780C09821 --uln-confirmations 33
yarn hardhat setup-endpoint-config --lz-endpoint 0xAaB5A48CFC03Efa9cC34A2C1aAcCCB84b4b770e4 --remote-eid 30101 --oapp-address 0xC832183d4d5fc5831daaC892a93dBBfd798034E3 --uln-required-dvn-count 2 --uln-required-dvns 0x7a23612f07d81f16b26cf0b5a4c3eca0e8668df2,0xc097ab8cd7b053326dfe9fb3e3a31a0cce3b526f --network etherlink --uln-lib-address 0x377530cdA84DFb2673bF4d145DCF0C4D7fdcB5b6 --uln-confirmations 33 --uln-receive

yarn hardhat setup-endpoint-config --lz-endpoint 0x1a44076050125825900e736c501f859c50fE728c --remote-eid 30292 --oapp-address 0x3a7647c1323144a16e7D0D71A581E3FE5BD95299 --uln-required-dvn-count 2 --uln-required-dvns 0x589dedbd617e0cbcb916a9223f4d1300c294236b,0xa59ba433ac34d2927232918ef5b2eaafcf130ba5 --network mainnet --uln-lib-address 0xc02Ab410f0734EFa3F14628780e6e695156024C2 --uln-confirmations 33 --uln-receive
yarn hardhat setup-endpoint-config --lz-endpoint 0x1a44076050125825900e736c501f859c50fE728c --remote-eid 30292 --oapp-address 0x3a7647c1323144a16e7D0D71A581E3FE5BD95299 --uln-required-dvn-count 2 --uln-required-dvns 0x589dedbd617e0cbcb916a9223f4d1300c294236b,0xa59ba433ac34d2927232918ef5b2eaafcf130ba5 --network mainnet --uln-lib-address 0xbB2Ea70C9E858123480642Cf96acbcCE1372dCe1 --uln-confirmations 33
```


## Upgrades

Use the script
```bash
yarn hardhat upgrade-proxy --proxy ${PROXY_ADDRESS} ${CONTRACT_NAME} --network ${NETWORK}
```
