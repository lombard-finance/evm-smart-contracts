# Consortium

## Notarization Blacklist

This is a simple on-chain storage to track blacklisted transaction outputs that made a
deposit to a Lombard-managed deposit address and must not be notarized to create new LBTCs.

Transaction outputs may be blacklisted because connected to a sanctioned address, because
referring to refunded deposits, or similar reasons.

Notaryd process from the ledger repository is supposed to query this contract before
notarizing any Deposit.