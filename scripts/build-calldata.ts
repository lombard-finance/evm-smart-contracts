/**
 * Encode contract calldata from a Human-Readable ABI function line + JSON arguments.
 *
 * Hardhat `run` does not forward extra CLI flags; use env vars:
 *
 *   CALLDATA_FRAGMENT='function NAME(...)' CALLDATA_ARGS='[...]' yarn hardhat run scripts/build-calldata.ts
 *
 * Example (StakedLBTC.migrateToAccessControl):
 *
 *   CALLDATA_FRAGMENT='function migrateToAccessControl(address[] minters_, address[] claimers_)' \
 *   CALLDATA_ARGS='[["0xAa4bc534bc7Be0E28a0686Ab6910A9B21dFdc2B1"],["0xAa4bc534bc7Be0E28a0686Ab6910A9B21dFdc2B1"]]' yarn hardhat run scripts/build-calldata.ts
 *
 * Both env vars are required when running the script.
 *
 * Import `encodeCalldata` from this module for programmatic use.
 */

import { ethers, type FunctionFragment } from 'ethers';

/**
 * ABI-encodes a single function call. `functionFragment` is one Human-Readable ABI line, e.g.
 * `function migrateToAccessControl(address[] minters_, address[] claimers_)`.
 */
export function encodeCalldata(functionFragment: string, args: readonly unknown[]): string {
  const iface = new ethers.Interface([functionFragment.trim()]);
  const fn = iface.fragments.find((f): f is FunctionFragment => f.type === 'function');
  if (!fn) {
    throw new Error('functionFragment must declare exactly one function');
  }
  return iface.encodeFunctionData(fn, args);
}

function parseEnv(): { fragment: string; args: unknown[] } {
  const fragment = process.env.CALLDATA_FRAGMENT?.trim();
  const raw = process.env.CALLDATA_ARGS;
  if (!fragment || !raw) {
    throw new Error('Set CALLDATA_FRAGMENT and CALLDATA_ARGS.');
  }
  const args = JSON.parse(raw) as unknown;
  if (!Array.isArray(args)) {
    throw new Error('CALLDATA_ARGS must be a JSON array');
  }
  return { fragment, args };
}

async function main(): Promise<void> {
  const { fragment, args } = parseEnv();
  console.log('Calldata: ' + encodeCalldata(fragment, args));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
