<div>
    <img alt="Lombard" src="https://img.shields.io/badge/v2-version?label=Lombard&labelColor=62C9B9&color=white"/>
    <img alt="Solidity" src="https://img.shields.io/badge/0.8.24-solidity-purple">
    <img alt="Node.js" src="https://img.shields.io/badge/>=18-node.js-green">
    <img alt="TypeScript" src="https://img.shields.io/badge/>=4.5.0-typescript-blue">
    <img alt="Hardhat" src="https://img.shields.io/badge/^2.22.12-hardhat-yellow">
    <img alt="Ethers" src="https://img.shields.io/badge/^6.4.0-ethers-darkblue">
</div>

<div>
    <img alt="Page cover image" src="https://docs.lombard.finance/~gitbook/image?url=https%3A%2F%2F2727780006-files.gitbook.io%2F%7E%2Ffiles%2Fv0%2Fb%2Fgitbook-x-prod.appspot.com%2Fo%2Fspaces%252FshysQ5d1rHU8C0eDQoLF%252Fuploads%252FR5w80vSnwar9rZZVywo7%252FGitbook%2520cover.png%3Falt%3Dmedia%26token%3Dab258017-4138-4430-8e63-d17ecd35f7b6&amp;width=1248&amp;dpr=4&amp;quality=100&amp;sign=16bc71e&amp;sv=2"/>
</div>

# Lombard Finance EVM smart-contracts
[Website](https://www.lombard.finance/) | [Docs](https://docs.lombard.finance/)

## Content
1. [Overview](https://github.com/lombard-finance/evm-smart-contracts?tab=readme-ov-file#overview)
2. [One-time setup](https://github.com/lombard-finance/evm-smart-contracts?tab=readme-ov-file#one-time-setup)
3. [Deployment](https://github.com/lombard-finance/evm-smart-contracts?tab=readme-ov-file#deployment)
4. [Audit](https://github.com/lombard-finance/evm-smart-contracts?tab=readme-ov-file#audit)
5. [Misc](https://github.com/lombard-finance/evm-smart-contracts?tab=readme-ov-file#misc)

## Overview
LBTC is liquid Bitcoin; it's yield-bearing, cross-chain, and 1:1 backed by BTC. LBTC enables yield-bearing BTC to move cross-chain without fragmenting liquidity, and is designed to seamlessly integrate Bitcoin into the decentralized finance (DeFi) ecosystem while maintaining the security and integrity of the underlying asset.

| Smart contract   | Description                                                                                                                            |
|------------------|----------------------------------------------------------------------------------------------------------------------------------------|
| Bascule          | Bascule drawbridge designed to prevent bridge hacks before they hit the chain.                                                         |
| Consortium       | The contract utilizes notary consortium multi-signature verification.                                                                  |
| LombardTimelock  | Safeguard helps to perform delayed transactions (e.g. implementation upgrade).                                                         |
| LBTC             | ERC20 token to interact with protocol.                                                                                                 |
| GnosisSafeProxy  | Lombard governance, pauser and treasury wallets.                                                                                       |      
| Bridge           | Lombard multi-factor bridge. Supports different adapters (like [CCIP](https://docs.chain.link/ccip) as second factor to bridge `LBTC`. |
| OFTAdapters      | LayerZero adapters for `LBTC` with different strategies.                                                                               |
| ProxyFactory     | CREATE3 factory allows to deploy proxies with same address.                                                                            |
| FBTCPartnerVault | Allows to stake `FBTC` token.                                                                                                          |
| PMMs             | Swap pools to accept wrapped BTC ERC20 tokens (like `cbBTC` and `BTCb`).                                                               |
| PoR              | Bitcoin addresses storage with the ownership proof system.                                                                             |
| StakeAndBake     | Convenience contract for users who wish to stake their `BTC` and deposit `LBTC` in a vault in the same transaction.                    |


### BTC deposit flow
Graph below represents BTC to LBTC flow

```mermaid
graph TD
    user_btc_wallet(User BTC wallet) -.-> btc{{BTC}}
    btc -- deposit --> btc_wallet(Lombard controlled BTC address)
    btc_wallet -. notarization request .-> consortium[Notary Consortium]
    consortium -. notarization result .-> sc[Smart Contracts]
    sc -- mint --> lbtc{{LBTC}}
    lbtc -.-> user_evm_wallet(User EVM wallet)
```

### BTC redeem flow
Graph below represents LBTC to BTC flow
```mermaid
graph TD
    user_evm_wallet(User EVM wallet) -.-> lbtc{{LBTC}}
    lbtc -- redeem --> sc[Smart Contracts]
    sc -. notarization request .-> consortium[Notary Consortium]
    consortium -. notarization result .-> custody[Custody approvers]
    custody -.-> btc{{BTC}}
    btc --> user_btc_wallet(User BTC wallet)
```

## One-time setup

Install [nodejs](https://nodejs.org/en/download/package-manager). Run node -v to check your installation.

Support Node.js 18.x and higher.

### 1. Clone this repo:
```bash
git clone https://github.com/lombard-finance/evm-smart-contracts.git
```
### 2. Install dependencies
```bash
yarn
```

### 3. Compile smart contracts

```bash
yarn hardhat compile
```

### 4. Run tests

```bash
yarn hardhat test
```

## Deployment

Learn available scripts:
```bash
yarn hardhat
```

* `deploy-*` - scripts to deploy smart-contracts.
* `setup-*` - scripts to setup or change configuration of smart-contracts.
* `upgrade-proxy` - script to upgrade existing proxy with new implementation.

## Audit

Find the latest audit reports in [docs/audit](https://github.com/lombard-finance/evm-smart-contracts/tree/main/docs/audit)

## Misc

Follow [docs](https://github.com/lombard-finance/evm-smart-contracts/tree/main/docs) in more in-depth study of contracts.