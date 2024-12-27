# Notarization Blacklist

This is a simple on-chain storage to track blacklisted UTXO and avoid them to be notarized. Notaryd process from the ledger repository is supposed to query this contract before notarizing any Deposit.