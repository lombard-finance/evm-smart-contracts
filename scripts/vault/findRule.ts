/**
 * findRule.ts — given a call's calldata (and optionally value), find the matching
 * rule and return ruleEncoded + merkleProof ready to pass to the validator's isAllowed().
 *
 * Usage (derive ruleset from validator address):
 *   npx ts-node scripts/vault/findRule.ts \
 *     --chain-id <chainId>          chain ID (decimal or hex)
 *     --contract <validatorAddress> deployed MerkleAllowlistValidator address
 *     --calldata <hex>              calldata (omit or pass 0x for native coin transfers)
 *     --value    <decimal>          msg.value in wei (optional, default 0)
 *
 * Usage (explicit rules file):
 *   npx ts-node scripts/vault/findRule.ts \
 *     --rules    <path/to/rules.[json|yaml]> \
 *     --chain-id <chainId> \
 *     --contract <validatorAddress> \
 *     --calldata <hex> \
 *     --value    <decimal>
 *
 * Ruleset file resolution (in order of priority):
 *   1. --rules <path>          — use this file directly
 *   2. --chain-id + --contract — derive:
 *        ${VAULT_RULESET_ROOT}/<chainId-32-byte-hex>/<validatorAddress>.[json|yaml]
 *      VAULT_RULESET_ROOT defaults to scripts/vault/ruleset/
 */

import { ethers } from 'ethers';
import {
  RuleJson,
  loadRulesFile,
  computeDomainSeparator,
  buildTree,
  parseArgs,
  require_arg,
  resolveRulesetFromArgs
} from './merkleUtils';

// ─── Calldata + value matching ────────────────────────────────────────────────

function readWord(data: Uint8Array, offset: number): bigint {
  const bytes = new Uint8Array(32);
  if (offset < data.length) {
    const len = Math.min(32, data.length - offset);
    bytes.set(data.slice(offset, offset + len), 0);
  }
  return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}

function txMatchesRule(rule: RuleJson, calldataHex: string, value: bigint): boolean {
  const data = ethers.getBytes(calldataHex);

  if (rule.dataLength !== undefined && data.length !== Number(rule.dataLength)) return false;

  // Check value only when the rule explicitly constrains it.
  if (rule.value !== undefined && rule.value !== '' && BigInt(rule.value) !== value) return false;

  for (const c of rule.constraints ?? []) {
    if ((readWord(data, c.offset) & BigInt(c.mask)) !== BigInt(c.expected)) return false;
  }

  return true;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  const chainId = BigInt(require_arg(args, 'chain-id'));
  const contractAddress = require_arg(args, 'contract');
  const calldataHex = args['calldata'] ?? '0x';
  const value = BigInt(args['value'] ?? '0');

  const rulesetPath = resolveRulesetFromArgs(args);
  const rules = loadRulesFile(rulesetPath);
  const ds = computeDomainSeparator(chainId, contractAddress);
  const { tree, encoded } = buildTree(rules, ds);

  const match = Object.entries(rules).find(([, rule]) => txMatchesRule(rule, calldataHex, value));
  if (!match) {
    console.error('Error: no rule in the ruleset matches the given calldata/value');
    console.error('Rules checked:', Object.keys(rules).join(', '));
    process.exit(1);
  }

  const [ruleName] = match;
  const ruleEncoded = encoded[ruleName];
  const proof = tree.getProof([0, ds, ethers.getBytes(ruleEncoded)] as [number, string, Uint8Array]);

  console.log(JSON.stringify({ ruleName, root: tree.root, ruleEncoded, merkleProof: proof }, null, 2));
}

main();
