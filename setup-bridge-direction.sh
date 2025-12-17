BRIDGE="0x451c54981C7DA5d95901b770C540547cF5FE0A2D"
MAILBOX="0x964677F337d6528d659b1892D0045B8B27183fc0"
REMOTE_BRIDGE="0x451c54981C7DA5d95901b770C540547cF5FE0A2D"
REMOTE_MAILBOX="0x964677F337d6528d659b1892D0045B8B27183fc0"
NETWORK="katana"

TOKEN_ADDRESS="0xecAc9C5F704e954931349Da37F60E39f515c11c1"
REMOTE_TOKEN_ADDRESS="0xecAc9C5F704e954931349Da37F60E39f515c11c1"
TOKEN_POOL="0xD9527ffE58CbEcC9A64511Fc559e0C0825Df940a"

REMOTE_SELECTOR="6433500567565415381"
REMOTE_CHAIN_ID="0x000000000000000000000000000000000000000000000000000000000000a86a"
REMOTE_TOKEN_POOL="0xd24658051aa6c8ACf874F686D5dA325a87d2D146"
LEGACY="--legacy"

yarn hardhat setup-token-pool-v2 "$TOKEN_POOL" --remote-token "$REMOTE_TOKEN_ADDRESS" --remote-selector "$REMOTE_SELECTOR" --remote-chain "$REMOTE_CHAIN_ID" --remote-pool "$REMOTE_TOKEN_POOL" --network "$NETWORK" --populate "$LEGACY"
yarn hardhat setup-token-pool-rate-limits "$TOKEN_POOL" --remote-selector "$REMOTE_SELECTOR" --inbound-limit-rate 462963 --inbound-limit-cap 5000000000 --outbound-limit-rate 462963 --outbound-limit-cap 5000000000 --network "$NETWORK" --populate
yarn hardhat setup-destination-bridge "$BRIDGE" --dest-chain-id "$REMOTE_CHAIN_ID" --dest-bridge "$REMOTE_BRIDGE" --network "$NETWORK" --populate
yarn hardhat setup-destination-token "$BRIDGE" --dest-chain-id "$REMOTE_CHAIN_ID" --destination-token "$REMOTE_TOKEN_ADDRESS" --source-token "$TOKEN_ADDRESS" --network "$NETWORK" --populate
yarn hardhat setup-token-rate-limits "$BRIDGE" "$TOKEN_ADDRESS" --chain-id "$REMOTE_CHAIN_ID" --window 10800 --limit 10000000000 --network "$NETWORK" --populate
yarn hardhat mailbox-enable-path --target "$MAILBOX" --remote-chain-id "$REMOTE_CHAIN_ID" --remote-mailbox "$REMOTE_MAILBOX" --direction both --populate --network "$NETWORK"
