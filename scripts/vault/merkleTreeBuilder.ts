/**
 * Merkle tree builder for MerkleCallAllowlist rule sets.
 *
 * Usage:
 *   npx ts-node scripts/vault/merkleTreeBuilder.ts \
 *     --rules <path/to/rules.json> \
 *     --chain-id <chainId> \
 *     --contract <validatorAddress> \
 *     --mode build
 *
 *   npx ts-node scripts/vault/merkleTreeBuilder.ts \
 *     --rules <path/to/rules.json> \
 *     --chain-id <chainId> \
 *     --contract <validatorAddress> \
 *     --mode proof \
 *     --rule-name <ruleName>
 *
 * Modes:
 *   build  — print the Merkle root (and domain separator) for all rules in the file
 *   proof  — print ruleEncoded + merkleProof for the named rule, ready to pass to isAllowed()
 */

import * as fs from 'fs';
import * as path from 'path';
import { ethers } from 'ethers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

// ─── JSON rule schema ────────────────────────────────────────────────────────

interface RuleConstraintJson {
  offset: number;
  mask: string;
  expected: string;
}

interface RuleFlagsJson {
  senderSet: boolean;
  toSet: boolean;
  valueSet: boolean;
  dataLengthSet: boolean;
}

interface RuleJson {
  flags: RuleFlagsJson;
  sender: string;
  to: string;
  value?: string;
  dataLength: number;
  constraints: RuleConstraintJson[];
}

type RulesFile = Record<string, RuleJson>;

// ─── Encoding ────────────────────────────────────────────────────────────────

function flagsToBitmask(f: RuleFlagsJson): number {
  return (f.senderSet ? 0x01 : 0) | (f.toSet ? 0x02 : 0) | (f.valueSet ? 0x04 : 0) | (f.dataLengthSet ? 0x08 : 0);
}

function encodeRule(rule: RuleJson): string {
  const flags = flagsToBitmask(rule.flags);
  const sender = rule.sender && rule.sender !== '' ? rule.sender : ethers.ZeroAddress;
  const to = rule.to && rule.to !== '' ? rule.to : ethers.ZeroAddress;
  const value = rule.value && rule.value !== '' ? BigInt(rule.value) : 0n;

  const types: string[] = ['uint8', 'uint8', 'address', 'address', 'uint256', 'uint32', 'uint16'];
  const values: Array<string | bigint | number> = [
    0x01,
    flags,
    sender,
    to,
    value,
    rule.dataLength >>> 0,
    rule.constraints.length
  ];
  for (const c of rule.constraints) {
    types.push('uint16', 'bytes32', 'bytes32');
    values.push(c.offset, c.mask, c.expected);
  }
  return ethers.solidityPacked(types, values);
}

// ─── Domain separator (§8) ───────────────────────────────────────────────────

function computeDomainSeparator(chainId: bigint, contractAddress: string): string {
  const packed = ethers.solidityPacked(
    ['bytes4', 'uint8', 'uint256', 'address'],
    ['0x414c4c57', 1, chainId, contractAddress]
  );
  return ethers.keccak256(packed);
}

// ─── Tree ────────────────────────────────────────────────────────────────────

type TreeRow = [number, string, Uint8Array];

function buildTree(
  rules: RulesFile,
  domainSeparator: string
): {
  tree: StandardMerkleTree<TreeRow>;
  encoded: Record<string, string>;
} {
  const encoded: Record<string, string> = {};
  const rows: TreeRow[] = [];

  for (const [name, rule] of Object.entries(rules)) {
    const ruleEncoded = encodeRule(rule);
    encoded[name] = ruleEncoded;
    rows.push([0, domainSeparator, ethers.getBytes(ruleEncoded)]);
  }

  if (rows.length === 0) {
    throw new Error('Rules file is empty — cannot build a Merkle tree with no leaves.');
  }

  const tree = StandardMerkleTree.of(rows, ['uint8', 'bytes32', 'bytes']);
  return { tree, encoded };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      result[argv[i].slice(2)] = argv[++i];
    }
  }
  return result;
}

function require_arg(args: Record<string, string>, key: string): string {
  const v = args[key];
  if (!v) {
    console.error(`Error: missing required argument --${key}`);
    process.exit(1);
  }
  return v;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const rulesPath = require_arg(args, 'rules');
  const mode = require_arg(args, 'mode');
  const chainId = BigInt(require_arg(args, 'chain-id'));
  const contractAddress = require_arg(args, 'contract');

  if (mode !== 'build' && mode !== 'proof') {
    console.error('Error: --mode must be "build" or "proof"');
    process.exit(1);
  }

  const fullPath = path.resolve(rulesPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`Error: rules file not found: ${fullPath}`);
    process.exit(1);
  }

  const rules: RulesFile = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const ds = computeDomainSeparator(chainId, contractAddress);
  const { tree, encoded } = buildTree(rules, ds);

  if (mode === 'build') {
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
  const row: TreeRow = [0, ds, ethers.getBytes(ruleEncoded)];
  const merkleProof = tree.getProof(row);

  console.log(
    JSON.stringify(
      {
        ruleName,
        root: tree.root,
        ruleEncoded,
        merkleProof
      },
      null,
      2
    )
  );
}

main();
