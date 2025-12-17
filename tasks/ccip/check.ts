import * as fs from 'node:fs';
import { HardhatRuntimeEnvironment, RunSuperFunction } from 'hardhat/types';
import path from 'node:path';
import { AddressList, LChainBasicData, NativeTokenData, RuleFunc } from './types';

const RULESET: Array<RuleFunc> = [checkMailbox, checkBridge, checkTokenPool];

const LOMBARD_SECTION = 'lombard';
const AVALANCHE_SECTION = 'avalanche';
const CCIP_SECTION = 'chainlink';
const CHAIN_ID_SECTION = 'chainId';
const AVALANCHE_CHAIN = 'avalanche';
const MAILBOX_CONTRACT = 'Mailbox';
const BRIDGE_CONTRACT = 'BridgeV2';
const TOKEN_POOL_CONTRACT = 'LombardTokenPoolV2';
const BRIDGE_TOKEN_POOL = 'BridgeTokenPool';
const NATIVE_LBTC_CONTRACT = 'NativeLBTC';
const BRIDGE_TOKEN = 'BridgeToken';
const TOKEN_ADAPTER_CONTRACT = 'BridgeTokenAdapter';
const STAKED_LBTC_CONTRACT = 'StakedLBTC';
const LBTC_CONTRACT = 'LBTC';
const CCIP_CHAIN_SELECTOR = 'ChainSelector';
const CCIP_ROUTER = 'Router';
const CCIP_RMN = 'RMN';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const CHAINS_TO_SKIP = ['ink', 'inkTestnet', 'holesky', 'sonicTestnet'];

export async function check(taskArgs: any, hre: HardhatRuntimeEnvironment, runSuper: RunSuperFunction<any>) {
  const p = path.join(taskArgs.filename);
  if (!fs.existsSync(p)) {
    throw new Error(`${p} does not exist`);
  }
  const addresses: AddressList = JSON.parse(fs.readFileSync(p, 'utf8'));
  const mailboxes: Map<string, string> = new Map();
  const bridges: Map<string, string> = new Map();
  const tokenPools: Map<string, string[]> = new Map();
  const nativeTokens: Map<string, NativeTokenData> = new Map();
  const stakedTokens: Map<string, string> = new Map();
  const chainSelectors: Map<string, LChainBasicData> = new Map();
  const routers: Map<string, string> = new Map();
  const rmns: Map<string, string> = new Map();
  const chains: string[] = [];

  Object.entries(addresses).forEach(value => {
    let needToCheckChain = false;
    let bridgeFound = false;
    const chain = value[0];
    if (CHAINS_TO_SKIP.includes(chain)) {
      return;
    }
    const config = value[1];
    const chainId = config[CHAIN_ID_SECTION] ?? '';
    // console.log(`chain: ${chain}, config: ${JSON.stringify(config)}`);
    const lombardConfig = config[LOMBARD_SECTION];
    if (lombardConfig) {
      Object.entries(lombardConfig).forEach(value => {
        const name = value[0];
        const address: string = value[1] as string;
        // console.log(`Lombard data ---> chain: ${chain}, name: ${name}, value: ${address}`);
        switch (true) {
          case name == BRIDGE_CONTRACT:
            bridges.set(chain, address.toLowerCase());
            bridgeFound = address.length > 2;
            break;
          case name == MAILBOX_CONTRACT:
            mailboxes.set(chain, address.toLowerCase());
            break;
          case name == STAKED_LBTC_CONTRACT:
          case name == LBTC_CONTRACT:
            if (address.length > 0) {
              stakedTokens.set(chain, address.toLowerCase());
            }
            break;
          case name == NATIVE_LBTC_CONTRACT:
            if (address.length > 0) {
              setOrUpdateNativeToken(chain, nativeTokens, address.toLowerCase());
            }
            break;
          case name == TOKEN_ADAPTER_CONTRACT:
            if (address.length > 0) {
              setOrUpdateNativeToken(chain, nativeTokens, undefined, address.toLowerCase());
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
          setOrUpdateNativeToken(chain, nativeTokens, bridgeToken.toLowerCase());
          console.log(`native token: ${JSON.stringify(nativeTokens.get(chain))}`);
        }
      }
    }

    const ccipConfig = config[CCIP_SECTION];
    if (ccipConfig && bridgeFound) {
      Object.entries(ccipConfig).forEach(value => {
        const name = value[0];
        const data: string = value[1] as string;
        // console.log(`CCIP data ---> chain: ${chain}, name: ${name}, value: ${data}`);
        switch (true) {
          case name.startsWith(TOKEN_POOL_CONTRACT) || name == BRIDGE_TOKEN_POOL:
            if (data.length < 1) {
              return;
            }
            let tokenPoollist = tokenPools.get(chain);
            if (!tokenPoollist) {
              tokenPoollist = [];
            }
            tokenPoollist = tokenPoollist.concat([data.toLowerCase()]);
            tokenPools.set(chain, tokenPoollist);
            needToCheckChain = true;
            break;
          case name == CCIP_CHAIN_SELECTOR:
            chainSelectors.set(chain, {
              chainSelector: BigInt(data),
              lChainId: chainId
            });
            needToCheckChain = true;
            break;
          case name == CCIP_ROUTER:
            routers.set(chain, data.toLowerCase());
            needToCheckChain = true;
            break;
          case name == CCIP_RMN:
            rmns.set(chain, data.toLowerCase());
            needToCheckChain = true;
            break;
          default:
          // Do nothing
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
      await f(
        hre,
        targetChain,
        chainsLocal,
        chainSelectorsLocal,
        rmns,
        routers,
        mailboxes,
        bridges,
        tokenPools,
        stakedTokens,
        nativeTokens
      );
    }
  }
}

// rules
async function checkMailbox(
  hre: HardhatRuntimeEnvironment,
  chain: string,
  chains: string[],
  chainSelectors: Map<string, LChainBasicData>,
  rmns: Map<string, string>,
  routers: Map<string, string>,
  mailboxes: Map<string, string>,
  bridges: Map<string, string>,
  tokenPools: Map<string, string[]>,
  stakedTokens: Map<string, string>,
  nativeTokens: Map<string, NativeTokenData>
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
  console.log(
    `Mailbox(${mailboxAddress}) config for BridgeV2(${bridgeAddress}): maxPayloadSize ${res.maxPayloadSize}, feeDisabled ${res.feeDisabled}`
  );

  // ToDO: implement check for inbound and outboud paths

  return;
}

async function checkBridge(
  hre: HardhatRuntimeEnvironment,
  chain: string,
  chains: string[],
  chainSelectors: Map<string, LChainBasicData>,
  rmns: Map<string, string>,
  routers: Map<string, string>,
  mailboxes: Map<string, string>,
  bridges: Map<string, string>,
  tokenPools: Map<string, string[]>,
  stakedTokens: Map<string, string>,
  nativeTokens: Map<string, NativeTokenData>
) {
  const bridgeAddress = bridges.get(chain);
  if (!bridgeAddress) {
    console.log(`\t⚠️\tbridge is not present on this chain`);
    return;
  }
  console.log(`Checking bridge ${bridgeAddress}`);
  const bridge = await hre.ethers.getContractAt(BRIDGE_CONTRACT, bridgeAddress);
  // check sender config
  const myTokenPools = tokenPools.get(chain);
  if (myTokenPools) {
    for (const tp of myTokenPools) {
      const res = await bridge['getSenderConfig'](tp);
      if (!res.whitelisted) {
        console.log(`\t📛\ttoken pool ${tp} is not whitelisted`);
      }
      if (res.feeDiscount != 10000n) {
        console.log(`\t⚠️\tunexpected fee discount for token pool ${tp}`);
      }
    }
  }
  const localStakedToken = stakedTokens.get(chain);
  const localNativeToken = nativeTokens.get(chain);
  for (const [chain, item] of chainSelectors) {
    // check destination bridge
    const expectedDstBridge = bridges.get(chain);
    let dstBridge = await bridge['destinationBridge'](item.lChainId);
    dstBridge = '0x' + dstBridge.substring(dstBridge.length - 40).toLowerCase();
    if (!(dstBridge == expectedDstBridge || (!expectedDstBridge && dstBridge == ZERO_ADDRESS))) {
      console.log(`\t📛\twrong destination bridge: ${dstBridge} vs. expected ${expectedDstBridge} for ${chain}`);
    }
    const nativeToken = nativeTokens.get(chain);
    if (nativeToken && localNativeToken) {
      let targetToken = localNativeToken.adapter ?? localNativeToken.token;
      targetToken = targetToken ? targetToken : '';
      const config = await bridge['getTokenRateLimit'](targetToken, item.lChainId);
      if (config.amountCanBeSent == 0n) {
        console.log(`\t📛\trate limit is not set for ${targetToken} of ${chain}`);
      } else {
        console.log(`\trate limit for ${targetToken} of ${chain}: ${config.amountCanBeSent}`);
      }
    }
    const stakedToken = stakedTokens.get(chain);
    if (stakedToken && localStakedToken) {
      const config = await bridge['getTokenRateLimit'](localStakedToken, item.lChainId);
      if (config.amountCanBeSent == 0n) {
        console.log(`\t📛\trate limit is not set for ${localStakedToken} of ${chain}`);
      } else {
        console.log(`\trate limit for ${localStakedToken} of ${chain}: ${config.amountCanBeSent}`);
      }
    }
  }

  return;
}

async function checkTokenPool(
  hre: HardhatRuntimeEnvironment,
  chain: string,
  chains: string[],
  chainSelectorsGlobal: Map<string, LChainBasicData>,
  rmns: Map<string, string>,
  routers: Map<string, string>,
  mailboxes: Map<string, string>,
  bridges: Map<string, string>,
  tokenPools: Map<string, string[]>,
  stakedTokens: Map<string, string>,
  nativeTokens: Map<string, NativeTokenData>
) {
  const tokenPoolAddresses = tokenPools.get(chain);
  if (!tokenPoolAddresses || tokenPoolAddresses.length < 1) {
    console.log(`\t⚠️\ttoken pools are not present on this chain`);
    return;
  }
  for (const address of tokenPoolAddresses) {
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
    const nativeTokenData = nativeTokens.get(chain);
    const isNativeToken = nativeTokenData ? nativeTokenData.token == tokenAddress : false;
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
    const supportedChains = await tokenPool['getSupportedChains']();
    supportedChains.forEach(chn => {
      let found = false;
      chainSelectors.forEach((v, k) => {
        if (v.chainSelector == chn) {
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
    chainSelectors.forEach((item, chn) => {
      const isTokenPresent = (isStakedToken && stakedTokens.get(chn)) || (isNativeToken && nativeTokens.get(chn));
      if (!supportedChains.includes(item.chainSelector)) {
        if (isTokenPresent) {
          console.log(`\t⚠️\tchain ${chn} is not configured as destination in token pool`);
        }
        chainSelectors.delete(chn);
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
    for (const [chn, item] of chainSelectors) {
      const remotePools = await tokenPool['getRemotePools'](item.chainSelector);
      let remoteToken = await tokenPool['getRemoteToken'](item.chainSelector);
      if (remoteToken == '0x') {
        console.log(`\t📛\tno remote token set for chain ${chn}`);
        continue;
      }
      remoteToken = '0x' + remoteToken.substring(remoteToken.length - 40).toLowerCase();
      let expectedToken = '';
      if (isNativeToken) {
        const nativeTokenData = nativeTokens.get(chn);
        expectedToken = nativeTokenData ? (nativeTokenData.token ?? '') : '';
      } else {
        expectedToken = stakedTokens.get(chn) || '';
      }
      if (remoteToken != expectedToken) {
        console.log(
          `\t📛\tunexpected token ${remoteToken} set as remote for chain ${chn}   expected token: ${expectedToken}`
        );
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
      const inboundConfig = await tokenPool['getCurrentInboundRateLimiterState'](item.chainSelector);
      console.log(`Rate limit config for remote chain ${chn} and token ${remoteToken}:`);
      console.log(`Inbound:`);
      console.log(`\tenabled: ${inboundConfig.isEnabled}`);
      console.log(`\tcapacity: ${inboundConfig.capacity}`);
      console.log(`\trate: ${inboundConfig.rate}`);
      const outboundConfig = await tokenPool['getCurrentOutboundRateLimiterState'](item.chainSelector);
      console.log(`Outbound:`);
      console.log(`\tenabled: ${outboundConfig.isEnabled}`);
      console.log(`\tcapacity: ${outboundConfig.capacity}`);
      console.log(`\trate: ${outboundConfig.rate}`);
    }
  }
  return;
}

function setOrUpdateNativeToken(
  chain: string,
  nativeTokens: Map<string, NativeTokenData>,
  token: string | undefined = undefined,
  adapter: string | undefined = undefined
) {
  let nt = nativeTokens.get(chain);
  if (nt) {
    nt.token = token ? token : nt.token;
    nt.adapter = adapter ? adapter : nt.adapter;
  } else {
    nt = { token, adapter };
  }
  nativeTokens.set(chain, nt);
}
