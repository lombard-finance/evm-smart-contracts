# PoR (Proof of Reserve)

Proof of Reserve contracts for tracking and verifying Bitcoin addresses backing LBTC.

## Overview

The Proof of Reserve system maintains an on-chain registry of Bitcoin addresses that hold the BTC backing LBTC tokens. This enables transparent verification of the 1:1 backing.

## Contracts

### PoR.sol
Main Proof of Reserve contract featuring:
- Root pubkey management for address derivation
- Bitcoin address registration with ownership proofs
- Operator role for address management
- Query functions for address enumeration

### IPoR.sol
Interface defining the PoR contract API and custom errors.

## Key Features

- **Root Pubkey Registry**: Store and manage root public keys for address derivation
- **Address Tracking**: Register Bitcoin addresses with cryptographic ownership proofs
- **Access Control**: Role-based permissions for operators and administrators
- **Enumeration**: Query registered addresses with pagination support
