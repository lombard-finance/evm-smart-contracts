# Tasks

## Ownership

### Check

Check addresses from `filename` (default: mainnet.json) for ownership.

**Usage**: `yarn hardhat [GLOBAL OPTIONS] ownership check [filename] --network <network_name>`

**Example**:
```
for net in mainnet base bsc; do yarn hardhat ownership check --network $net; done
```