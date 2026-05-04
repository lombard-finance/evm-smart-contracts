/**
 * Merkle tree builder for MerkleCallAllowlist rule sets.
 *
 * Usage (explicit rules file):
 *   npx ts-node scripts/vault/merkleTreeBuilder.ts \
 *     --rules    <path/to/rules.[json|yaml]> \
 *     --chain-id <chainId> \
 *     --contract <validatorAddress> \
 *     --mode     build
 *
 * Usage (derive ruleset from validator address):
 *   npx ts-node scripts/vault/merkleTreeBuilder.ts \
 *     --chain-id <chainId> \
 *     --contract <validatorAddress> \
 *     --mode     build
 *
 * Modes:
 *   build  — print the Merkle root (and domain separator) for all rules in the file
 *   proof  — print ruleEncoded + merkleProof for a named rule, ready to pass to isAllowed()
 *            requires --rule-name <name>
 *
 * Ruleset file resolution (in order of priority):
 *   1. --rules <path>       — use this file directly
 *   2. --chain-id + --contract — derive:
 *        ${VAULT_RULESET_ROOT}/<chainId-32-byte-hex>/<validatorAddress>.[json|yaml]
 *      VAULT_RULESET_ROOT defaults to scripts/vault/ruleset/
 *
 * Rule flags are inferred from field presence:
 *   - sender, to, value : flag set when the field is present and non-empty
 *   - dataLength        : flag set when the field is present
 */

import { ethers } from 'ethers';
import {
  loadRulesFile,
  computeDomainSeparator,
  buildTree,
  parseArgs,
  require_arg,
  resolveRulesetFromArgs
} from './merkleUtils';

function main() {
  const args = parseArgs(process.argv.slice(2));

  const mode = require_arg(args, 'mode');
  const chainId = BigInt(require_arg(args, 'chain-id'));
  const contractAddress = require_arg(args, 'contract');

  if (mode !== 'build' && mode !== 'proof') {
    console.error('Error: --mode must be "build" or "proof"');
    process.exit(1);
  }

  const rulesetPath = resolveRulesetFromArgs(args);
  const rules = loadRulesFile(rulesetPath);
  const ds = computeDomainSeparator(chainId, contractAddress);
  const { tree, encoded } = buildTree(rules, ds);

  if (mode === 'build') {
    console.log('Rulest path:', rulesetPath);
    console.log('Domain separator:', ds);
    console.log('Rules processed: ', Object.keys(rules).join(', '));
    console.log('Merkle root:     ', tree.root);
    return;
  }

  // proof mode
  const ruleName = args['rule-name'];
  if (!ruleName) {
    console.error('Error: --rule-name is required in proof mode');
    process.exit(1);
  }
  if (!(ruleName in encoded)) {
    console.error(`Error: rule "${ruleName}" not found in rules file`);
    console.error('Available rules:', Object.keys(rules).join(', '));
    process.exit(1);
  }

  const ruleEncoded = encoded[ruleName];
  const row: [number, string, Uint8Array] = [0, ds, ethers.getBytes(ruleEncoded)];
  const merkleProof = tree.getProof(row);

  console.log(JSON.stringify({ ruleName, root: tree.root, ruleEncoded, merkleProof }, null, 2));
}

main();
