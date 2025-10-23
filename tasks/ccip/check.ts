import * as fs from 'node:fs';
import { HardhatRuntimeEnvironment, RunSuperFunction } from 'hardhat/types';
import path from 'node:path';
import { AddressList, RuleFunc } from './types';

const RULESET: Array<RuleFunc> = [checkMailbox, checkBridge, checkTokenPool];

const MAILBOX_CONTRACT = 'Mailbox';
const BRIDGE_CONTRACT = 'BridgeV2';
const TOKEN_POOL_CONTRACT = 'LombardTokenPoolV2';
const BRIDGE_TOKEN_POOL = 'BridgeTokenPool';
const NATIVE_LBTC_CONTRACT = 'NativeLBTC';
const BRIDGE_TOKEN = 'BridgeToken';
const TOKEN_ADAPTER_CONTRACT = 'BridgeTokenAdapter';
const STAKED_LBTC_CONTRACT = 'StakedLBTC';
const LBTC_CONTRACT = 'LBTC';
const LOMBARD_SECTION = 'lombard';
const AVALANCHE_SECTION = 'avalanche';
const CCIP_SECTION = 'chainlink';
const CCIP_CHAIN_SELECTOR = 'ChainSelector';
const CCIP_ROUTER = 'Router';
const CCIP_RMN = 'RMN';
const AVALANCHE_CHAIN = 'avalanche';

const CHAINS_TO_SKIP = ['ink'];

export async function check(taskArgs: any, hre: HardhatRuntimeEnvironment, runSuper: RunSuperFunction<any>) {
  const p = path.join(taskArgs.filename);
  if (!fs.existsSync(p)) {
    throw new Error(`${p} does not exist`);
  }
  const addresses: AddressList = JSON.parse(fs.readFileSync(p, 'utf8'));
  const mailboxes: Map<string, string> = new Map();
  const bridges: Map<string, string> = new Map();
  const tokenPools: Map<string, string[]> = new Map();
  const nativeTokens: Map<string, string> = new Map();
  const stakedTokens: Map<string, string> = new Map();
  const chainSelectors: Map<string, bigint> = new Map();
  const routers: Map<string, string> = new Map();
  const rmns: Map<string, string> = new Map();
  const chains: string[] = [];

  Object.entries(addresses).forEach(value => {
    let needToCheckChain = false;
    const chain = value[0];
    if (CHAINS_TO_SKIP.includes(chain)) {
      return;
    }
    const config = value[1];
    // console.log(`chain: ${chain}, config: ${JSON.stringify(config)}`);
    const lombardConfig = config[LOMBARD_SECTION];
    if (lombardConfig) {
      Object.entries(lombardConfig).forEach(value => {
        const name = value[0];
        const address: string = value[1] as string;
        // console.log(`Lombard data ---> chain: ${chain}, name: ${name}, value: ${address}`);
        switch (true) {
          case (name == BRIDGE_CONTRACT):
            const bridge = address;
            bridges.set(chain, bridge.toLowerCase());
            break;
          case (name == MAILBOX_CONTRACT):
            mailboxes.set(chain, address.toLowerCase());
            break;
          case (name == STAKED_LBTC_CONTRACT):
          case (name == LBTC_CONTRACT):
            if (address.length > 0) {
              stakedTokens.set(chain, address.toLowerCase());
            }
            break;
          case (name == NATIVE_LBTC_CONTRACT):
          case (name == BRIDGE_TOKEN):
            if (address.length > 0) {
              nativeTokens.set(chain, address.toLowerCase());
            }
            break;
          default:
            // Do nothing
        }
      });
    }

    if (chain.startsWith(AVALANCHE_CHAIN)) {
      const avalancheConfig = config[AVALANCHE_SECTION];
      if (avalancheConfig) {
        const bridgeToken = avalancheConfig[BRIDGE_TOKEN];
        if (bridgeToken && bridgeToken.length > 0) {
          nativeTokens.set(chain, bridgeToken.toLowerCase());
        }
      }
    }

    const ccipConfig =config[CCIP_SECTION];
    if (ccipConfig) {
      Object.entries(ccipConfig).forEach(value => {
        const name = value[0];
        const data: string = value[1] as string;
        // console.log(`CCIP data ---> chain: ${chain}, name: ${name}, value: ${data}`);
        if (name.startsWith(TOKEN_POOL_CONTRACT) || name == BRIDGE_TOKEN_POOL) {
          if (data.length < 1) {
            return;
          }
          let tokenPoollist = tokenPools.get(chain)
          if (!tokenPoollist) {
            tokenPoollist = [];
          }
          tokenPoollist = tokenPoollist.concat([data.toLowerCase()]);
          tokenPools.set(chain, tokenPoollist);
          needToCheckChain = true;
        } else if (name == CCIP_CHAIN_SELECTOR) {
          chainSelectors.set(chain, BigInt(data))
          needToCheckChain = true;
        } else if (name == CCIP_ROUTER) {
          routers.set(chain, data.toLowerCase())
          needToCheckChain = true;
        } else if (name == CCIP_RMN) {
          rmns.set(chain, data.toLowerCase())
          needToCheckChain = true;
        }
      });
    }
    if (needToCheckChain) {
      chains.push(chain);
    }
  });

  const targetChain = hre.network.name;

  if (chains.includes(targetChain)) {
    console.log(`Checking ${targetChain}...`);
    const chainsLocal = Array.from(chains);
    chainsLocal.splice(chains.indexOf(targetChain), 1);
    const chainSelectorsLocal = new Map(chainSelectors);
    chainSelectorsLocal.delete(targetChain);
    // console.log(`chains to check ${chainsLocal}`);

    for (const f of RULESET) {
      await f(hre, targetChain, chainsLocal, chainSelectorsLocal, rmns, routers, mailboxes, bridges, tokenPools, stakedTokens, nativeTokens);
    }
  }
}

// rules
async function checkMailbox(
  hre: HardhatRuntimeEnvironment,
  chain: string,
  chains: string[],
  chainSelectors: Map<string, bigint>,
  rmns: Map<string, string>,
  routers: Map<string, string>,
  mailboxes: Map<string, string>,
  bridges: Map<string, string>,
  tokenPools: Map<string, string[]>,
  stakedTokens: Map<string, string>,
  nativeTokens: Map<string, string>,  
) {
  const mailboxAddress = mailboxes.get(chain);
  if (!mailboxAddress) {
    console.log(`\t⚠️\tmailbox is not present on this chain`);
    return;
  }
  const maibox = await hre.ethers.getContractAt(MAILBOX_CONTRACT, mailboxAddress);
  const bridgeAddress = bridges.get(chain);
  if (!bridgeAddress) {
    console.log(`\t⚠️\tbridge is not present on this chain`);
    return;
  }
  if (!maibox.interface.hasFunction('getSenderConfigWithDefault')) return;
  const res = await maibox['getSenderConfigWithDefault'](bridgeAddress);
  if (res.maxPayloadSize < 388) {
    console.log(`\t📛\tpayload size is less than expected! (${res.maxPayloadSize} vs. 388)`);
  }
  if (!res.feeDisabled) {
    console.log(`\t📛\tmailbox fee is NOT disabled!`);
  }
  console.log(`Mailbox(${mailboxAddress}) config for BridgeV2(${bridgeAddress}): maxPayloadSize ${res.maxPayloadSize}, feeDisabled ${res.feeDisabled}`);

  // ToDO: implement check for inbound and outboud paths

  return;
}

async function checkBridge(
  hre: HardhatRuntimeEnvironment,
  chain: string,
  chains: string[],
  chainSelectors: Map<string, bigint>,
  rmns: Map<string, string>,
  routers: Map<string, string>,
  mailboxes: Map<string, string>,
  bridges: Map<string, string>,
  tokenPools: Map<string, string[]>,
  stakedTokens: Map<string, string>,
  nativeTokens: Map<string, string>,  
) {
  const bridgeAddress = bridges.get(chain);
  if (!bridgeAddress) {
    console.log(`\t⚠️\tbridge is not present on this chain`);
    return;
  }
  const bridge = await hre.ethers.getContractAt(BRIDGE_CONTRACT, bridgeAddress); 
  // ToDO: implement check
  return;
}

async function checkTokenPool(
  hre: HardhatRuntimeEnvironment,
  chain: string,
  chains: string[],
  chainSelectorsGlobal: Map<string, bigint>,
  rmns: Map<string, string>,
  routers: Map<string, string>,
  mailboxes: Map<string, string>,
  bridges: Map<string, string>,
  tokenPools: Map<string, string[]>,
  stakedTokens: Map<string, string>,
  nativeTokens: Map<string, string>,  
) {
  const tokenPoolAddresses = tokenPools.get(chain);
  if (!tokenPoolAddresses || tokenPoolAddresses.length < 1) {
    console.log(`\t⚠️\ttoken pools are not present on this chain`);
    return;
  }
  for (const address of tokenPoolAddresses){
    const chainSelectors = new Map(chainSelectorsGlobal);
    console.log(`Checking token pool ${address}`);
    const tokenPool = await hre.ethers.getContractAt(TOKEN_POOL_CONTRACT, address);
    // Check if token address is set correctly
    if (!tokenPool.interface.hasFunction('getToken')) {
      console.log(`\t📛\tunexpected token pool contract version: missing "getToken()" fuction`);
      return;
    }
    const tokenAddress = (await tokenPool['getToken']())?.toLowerCase();
    const isStakedToken = stakedTokens.get(chain) == tokenAddress;
    const isNativeToken = nativeTokens.get(chain) == tokenAddress;
    if (!(isStakedToken || isNativeToken)) {
      console.log(`\t📛\twrong token set in token pool (${tokenAddress})`);
    }
    // Check if bridge is set correctly
    if (!tokenPool.interface.hasFunction('bridge')) {
      console.log(`\t📛\tunexpected token pool contract version: missing "bridge()" fuction`);
      return;
    }
    const bridgeAddress = (await tokenPool['bridge']())?.toLowerCase();
    if (bridgeAddress != bridges.get(chain)) {
      console.log(`\t📛\twrong bridge set in token pool (${bridgeAddress})`);
    }  
    // Check RMN
    if (!tokenPool.interface.hasFunction('getRmnProxy')) {
      console.log(`\t📛\tunexpected token pool contract version: missing "getRmnProxy()" fuction`);
      return;
    }
    const rmnAddress = (await tokenPool['getRmnProxy']())?.toLowerCase();
    if (rmnAddress != rmns.get(chain)) {
      console.log(`\t📛\twrong rmn set in token pool (${rmnAddress})`);
    }  
    // Check Router
    if (!tokenPool.interface.hasFunction('getRouter')) {
      console.log(`\t📛\tunexpected token pool contract version: missing "getRmnProxy()" fuction`);
      return;
    }
    const routerAddress = (await tokenPool['getRouter']())?.toLowerCase();
    if (routerAddress != routers.get(chain)) {
      console.log(`\t📛\twrong router set in token pool (${routerAddress})`);
    }  
    // Check supported chains
    if (!tokenPool.interface.hasFunction('getSupportedChains')) {
      console.log(`\t📛\tunexpected token pool contract version: missing "getSupportedChains()" fuction`);
      return;
    }
    const supportedChains =  await tokenPool['getSupportedChains']();
    supportedChains.forEach(chn => {
      let found = false;
      chainSelectors.forEach((v, k) => {
        if (v == chn) {
          found = true;
          if (k == chain) {
            console.log(`\t⚠️\tunexpected destination chain selector (${chn.toString()})`);
          }
        }
      });
      if (!found) {
        console.log(`\t⚠️\tunknown destination chain selector (${chn.toString()})`);
      }
    });
    chainSelectors.forEach((selector, chain) => {
      if (!supportedChains.includes(selector)) {
        console.log(`\t⚠️\tchain ${chain} is not configured as destination in token pool`);
        chainSelectors.delete(chain);
      }
    });
    // Check remote tokens and pools provide data rate limit config
    if (!tokenPool.interface.hasFunction('getRemotePools')) {
      console.log(`\t📛\tunexpected token pool contract version: missing "getRemotePools()" fuction`);
      return;
    }
    if (!tokenPool.interface.hasFunction('getRemoteToken')) {
      console.log(`\t📛\tunexpected token pool contract version: missing "getRemoteToken()" fuction`);
      return;
    }
    for (const [chn, selector] of chainSelectors) {
      const remotePools = await tokenPool['getRemotePools'](selector);
      let remoteToken = await tokenPool['getRemoteToken'](selector);
      if (remoteToken == '0x') {
        console.log(`\t📛\tno remote token set for chain ${chn}`);
        continue;
      }
      remoteToken = '0x' + remoteToken.substring(remoteToken.length - 40).toLowerCase();
      let expectedToken = '';
      if (isNativeToken) {
        expectedToken = nativeTokens.get(chn)!;
      } else {
        expectedToken = stakedTokens.get(chn)!;
      }
      if (remoteToken != expectedToken) {
        console.log(`\t📛\tunexpected token ${remoteToken} set as remote for chain ${chn}   expected token: ${expectedToken}`);
      }
      if (remotePools.length != 1) {
        console.log(`\t📛\tunexpected number of remote pools ${remotePools.length} set for chain ${chn}`);
      } else {
        let remotePool = '0x' + remotePools[0].substring(remotePools[0].length - 40).toLowerCase();
        const expectedRemoteTokenPools = tokenPools.get(chn);
        let found = false;
        if (expectedRemoteTokenPools) {
          for (const pool of expectedRemoteTokenPools) {
            if (pool == remotePool) {
              found = true;
              break;
            }
          }
          if (!found) {
            console.log(`\t📛\tunexpected pool ${remotePool} set as remote for chain ${chn}`);
          }
        }
      }
      const inboundConfig = await tokenPool['getCurrentInboundRateLimiterState'](selector);
      console.log(`Rate limit config for remote chain ${chn} and token ${remoteToken}:`)
      console.log(`Inbound:`)
      console.log(`\tenabled: ${inboundConfig.isEnabled}`)
      console.log(`\tcapacity: ${inboundConfig.capacity}`)
      console.log(`\trate: ${inboundConfig.rate}`)
      const outboundConfig = await tokenPool['getCurrentOutboundRateLimiterState'](selector);
      console.log(`Outbound:`)
      console.log(`\tenabled: ${outboundConfig.isEnabled}`)
      console.log(`\tcapacity: ${outboundConfig.capacity}`)
      console.log(`\trate: ${outboundConfig.rate}`)      
    }
  } 
  return;
}
