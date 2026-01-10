# GMP (General Message Passing)

Cross-chain messaging infrastructure for the Lombard protocol.

## Overview

The GMP module provides general message passing capabilities for cross-chain operations, enabling LBTC to be bridged securely across different blockchain networks.

## Structure

- **libs/**: Library contracts for message encoding and path management
  - `GMPUtils.sol`: Utility functions for GMP operations
  - `MessagePath.sol`: Message routing and path definitions

## Features

- Cross-chain message encoding and decoding
- Message path validation
- Integration with bridge adapters
