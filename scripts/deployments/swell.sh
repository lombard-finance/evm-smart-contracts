#!/bin/bash

set -ex

# Process command line arguments
deployer=

while [ $# -gt 0 ]; do
    case "$1" in
    --deployer=*)
        deployer="${1#*=}"
        ;;
    *)
        echo "Unknown arg $1"
        exit
    esac
    shift
done

if [ -z "$deployer" ]; then
    echo "Deployer not set! Please set it with --deployer."
    exit
fi

echo "Deploying adapter on ETH"
ethAdapter=

# ETH Mainnet side
if [ ! -f .eth_adapter ]; then
    yarn hardhat deploy-oft --admin deployer --lz-endpoint 30101 --lbtc 0x8236a87084f8B84306f72007F36F2618A5634494 --network mainnet

    echo 'Please copy and paste the proxy address of the deployed OFT adapter.'
    read -p '> ' ethAdapter

    touch .eth_adapter
    echo $ethAdapter > .eth_adapter
else
    ethAdapter=$(cat .eth_adapter)
fi

# Swell side
echo "Deploying proxy factory on Swell"
swellProxy=

if [ ! -f .swell_proxy ]; then
    yarn hardhat deploy-proxy-factory --network swell

    echo 'Please copy and paste the address of the Swell proxy factory.'
    read -p '> ' swellProxy

    touch .swell_proxy
    echo $swellProxy > .swell_proxy
else
    swellProxy=$(cat .swell_proxy)
fi

echo "Deploying consortium on Swell"
swellConsortium=

if [ ! -f .swell_consortium ]; then
    yarn hardhat deploy-consortium --admin deployer --proxy-factory-addr swellProxy --network swell

    echo 'Please copy and paste the proxy address of the Swell consortium contract.'
    read -p '> ' swellConsortium

    touch .swell_consortium
    echo $swellConsortium > .swell_consortium
else
    swellConsortium=$(cat .swell_consortium)
fi

echo "Deploying LBTC on Swell"
swellLbtc=

if [ ! -f .swell_lbtc ]; then
    yarn hardhat deploy-lbtc --consortium swellConsortium --burnCommission 10000 --treasury deployer --admin deployer --proxy-factory-addr swellProxy --network swell

    echo 'Please copy and paste the proxy address of the Swell LBTC contract.'
    read -p '> ' swellLbtc

    touch .swell_lbtc
    echo $swellLbtc > .swell_lbtc
else
    swellLbtc=$(cat .swell_lbtc)
fi

echo "Deploying burn & mint OFT adapter on Swell"
swellAdapter=

if [ ! -f .swell_adapter ]; then
    yarn hardhat deploy-oft --admin deployer --lz-endpoint 30335 --lbtc swellLbtc --burn-mint --network swell

    echo 'Please copy and paste the proxy address of the deployed OFT adapter.'
    read -p '> ' swellAdapter

    touch .swell_adapter
    echo $swellAdapter > .swell_adapter
else
    swellAdapter=$(cat .swell_adapter)
fi

echo "Setting Swell OFT Adapter as minter on LBTC"

if [ ! -f .swell_minter ]; then
    yarn hardhat setup-oft-add-minter --lbtc swellLbtc --adapter swellAdapter
    touch .swell_minter
fi

echo "Setting peer on Swell"

if [ ! -f swell_peer_set ]; then
    yarn hardhat setup-oft-set-peer --eid 30101 --peer
    touch .swell_peer_set
fi

echo "Setting inbound rate limit on Swell"

if [ ! -f .swell_irl ]; then
    yarn hardhat setup-oft-rate-limits --eids 30101 --window 86400 --limit 500000000 --oapp-address swellAdapter --inbound yes
    touch .swell_irl
fi

echo "Setting outbound rate limit on Swell"

if [ ! -f .swell_orl ]; then
    yarn hardhat setup-oft-rate-limits --eids 30101 --window 86400 --limit 500000000 --oapp-address swellAdapter --outbound yes
    touch .swell_orl
fi

echo "Setting peer on ETH"

if [ ! -f .eth_peer_set ]; then
    yarn hardhat setup-oft-set-peer --target ethAdapter --eid 30335 --peer swellAdapter --network mainnet
    touch .eth_peer_set
fi

echo "Setting inbound rate limit on ETH"

if [ ! -f .eth_irl ]; then
    yarn hardhat setup-oft-rate-limits --eids 30335 --window 86400 --limit 500000000 --oapp-address ethAdapter --inbound yes --network mainnet
    touch .eth_irl
fi

echo "Setting outbound rate limit on ETH"

if [ ! -f .eth_orl ]; then
    yarn hardhat setup-oft-rate-limits --eids 30335 --window 86400 --limit 500000000 --oapp-address ethAdapter --outbound yes --network mainnet
    touch .eth_orl
fi

echo "Setting OFT Adapter admin on ETH to 0x251a604E8E8f6906d60f8dedC5aAeb8CD38F4892"

if [ ! -f .eth_admin ]; then
    yarn hardhat setup-oft-transfer-ownership --target ethAdapter --owner 0x251a604E8E8f6906d60f8dedC5aAeb8CD38F4892
    touch .eth_admin
fi

echo "Setting OFT Adapter admin on Swell to 0xE6444CD0A7eD89f98634B641faC5a58864F05B60"

if [ ! -f .swell_admin ]; then
    yarn hardhat setup-oft-transfer-ownership --target swellAdapter --owner 0xE6444CD0A7eD89f98634B641faC5a58864F05B60
    touch .swell_admin
fi
