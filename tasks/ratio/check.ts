import * as fs from 'node:fs';
import { HardhatRuntimeEnvironment, RunSuperFunction } from 'hardhat/types';
import path from 'node:path';
import { Contract } from 'ethers';
import { AddressList, LedgerRatio, LedgerRatioResponse, RuleFunc } from './types';

const RULESET: Array<RuleFunc> = [getRatio];

const IGNORE_SCOPE_LIST: string[] = [
  'admin' // ignored, because used as source of possible admins
];
const TARGET_CONTRACT_LIST = ['StakedLBTCOracle'];

export async function check(taskArgs: any, hre: HardhatRuntimeEnvironment, runSuper: RunSuperFunction<any>) {
  const p = path.join(taskArgs.filename);
  if (!fs.existsSync(p)) {
    throw new Error(`${p} does not exist`);
  }
  const addresses: AddressList = JSON.parse(fs.readFileSync(p, 'utf8'));

  const addressList = addresses[hre.network.name];
  if (!addressList) {
    throw new Error(`no addresses found for ${hre.network.name}`);
  }

  const response = await fetch(
    'https://mainnet-rest.lombard-fi.com/lombard-finance/ledger/btcstaking/current_ratio/uclbtc'
  );
  const ratioData = (await response.json()) as LedgerRatioResponse;
  console.log(`Expected raio: ${ratioData.ratio.value}, expected timestamp: ${ratioData.ratio.timestamp}`);

  for (const scope in addressList) {
    if (IGNORE_SCOPE_LIST.includes(scope)) continue;
    const contracts = addressList[scope];
    if (!contracts || typeof contracts != 'object') {
      console.warn(`scope ${scope} ignored`);
      continue;
    }

    for (const contractName in contracts) {
      if (!TARGET_CONTRACT_LIST.includes(contractName)) continue;

      const contractAddr = contracts[contractName];
      if (!hre.ethers.isAddress(contractAddr)) {
        continue;
      }

      const code = await hre.ethers.provider.getCode(contractAddr);
      if (code === '0x') {
        console.warn(`no code at address ${contractAddr} of ${contractName}`);
        continue;
      }

      const contractArtifactName = contractName.split('_')[0];

      const contract = await hre.ethers.getContractAt(contractArtifactName, contracts[contractName]);

      console.log(`Checking ${contractName} at ${contractAddr}...`);

      for (const f of RULESET) {
        await f(hre, contract, ratioData.ratio);
      }
    }
  }
}

// rules
async function getRatio({ ethers }: HardhatRuntimeEnvironment, contract: Contract, ledgerRatio: LedgerRatio) {
  if (!contract.interface.hasFunction('nextRatio')) return;
  const res = await contract['nextRatio']();
  const ts = res[1];
  const ratio = res[0];
  const expectedRatio = ledgerRatio.value;
  const expectedTs = ledgerRatio.timestamp;
  console.log(`ratio: ${ratio}, timestamp: ${ts}`);
  switch (true) {
    case ts == expectedTs && ratio == expectedRatio:
      console.log(`\t✅\tratio is correct and up-to-date`);
      break;
    case ts < expectedTs:
      console.log(`\t⚠️\tratio is not updated`);
      break;
    case ts == expectedTs && ratio != expectedRatio:
      console.log(`\t📛\tratio is wrong!`);
      break;
    case ts > expectedTs:
      console.log(`\t📛\tratio timestamp is wrong!`);
      break;
    default:
      console.log(`\t📛\tunexpected outcome`);
  }
}
