# Deployment

## Envs
| Ledger network | Name     | json        |
|----------------|----------|-------------|
| devnet         | staging  | devnet.json |

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

### Adapter & TokenPool
TBD


## Upgrades


