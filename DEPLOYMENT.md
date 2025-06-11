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

Use explorer to set initial validator set.

## LBTC (deterministic)
> Because of `Consortium` address is deterministic it can be set using generated address without deployment.

Deploy `LBTC` contract
```bash
yarn hardhat deploy-lbtc --ledger-network ${ENV} --admin ${OWNER} --consortium ${CONSORTIUM} --burn-commission ${BURN_COMMISSION} --network ${NETWORK} --treasury ${OWNER}
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

## NativeLBTC (deterministic)
> Because of `Consortium` address is deterministic it can be set using generated address without deployment.

Deploy `NativeLBTC` contract
```bash
yarn hardhat deploy-native-lbtc --ledger-network ${ENV} --admin ${OWNER} --consortium ${CONSORTIUM} --burn-commission ${BURN_COMMISSION} --network ${NETWORK} --treasury ${OWNER}
```
Write proxy address to json file.

## Bridge (deterministic)
> `LBTC` should be deployer before start

Deploy `Bridge` contract
```bash
yarn hardhat deploy-bridge --ledger-network gastald --admin ${OWNER} --lbtc ${LBTC} --treasury ${OWNER} --network ${NETWORK}
```
Write proxy address to json file.

## CCIP
> `Bridge` should be deployed before start

Use `ccip-token-pool-1.5.0` tag to deploy v1.5.0 token pool.

### Adapter & TokenPool
Deploy `Adapter` (`TokenPool` will be deployed by adapter) on each chain
```bash
yarn hardhat deploy-chainlink-adapter --admin ${OWNER} --router ${CCIP_ROUTER} --bridge ${BRIDGE} --rmn ${CCIP_RMN} --network ${NETWORK}
```
Write contracts address to json file.

### Bridge

Setup Bridge destinations using adapters
```bash
yarn hardhat setup-add-destination --target ${SOURCE_BRIDGE} --chain-id ${TO_CHAIN_ID} --contract ${DESTINATION_BRIDGE} --rel-commission ${RELATIVE_COMMISSION} --abs-commission ${ABSOLUTE_COMMISSION} --adapter ${SOURCE_ADAPTER} --require-consortium --network ${NETWORK}
```
Chain ids can be viewed [here](https://chainlist.org)

Enable `TokenPool`
```bash
yarn hardhat setup-token-pool --cl-adapter ${SOURCE_ADAPTER} --lbtc ${LBTC} --remote-selector ${DESTINATION_CCIP_SELECTOR} --chain ${DESTINATION_CHAIN_ID} --remote-pool ${DESTINATION_TOKEN_POOL} --network ${NETWORK} 
```
Remote selector can be viewed [here](https://docs.chain.link/ccip/directory/mainnet)

Set `TokenPool` rate limits
```bash
yarn hardhat setup-ccip-apply-updates --cl-adapter ${SOURCE_ADAPTER} --remote-selector ${DESTINATION_CCIP_SELECTOR} --inbound-limit-rate ${INBOUND_REFILL_PER_SECOND} --inbound-limit-cap ${INBOUND_BUCKET_LIMIT} --outbound-limit-rate ${OUTBOUND_REFILL_PER_SECOND} --outbound-limit-cap ${OUTBOUND_BUCKET_LIMIT} --network ${NETWORK} 
```

Setup `Bridge` rate limits, they should ~2x from `TokenPool` limits.
```bash
yarn hardhat setup-bridge-rate-limits --bridge ${SOURCE_BRIDGE} --chain-id ${TO_CHAIN_ID} --network ${NETWORK} --window ${WINDOW_SECONDS} --limit ${WINDOW_LIMIT} [--populate]
```

Grant minting ability to bridge
```bash
yarn hardhat setup-minter --target ${LBTC} --minter ${SOURCE_BRIDGE} --network ${NETWORK}
```

## Upgrades


