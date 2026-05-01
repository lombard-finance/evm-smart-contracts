/**
 * Merkle tree builder for MerkleCallAllowlist rule sets.
 *
 * Usage:
 *   npx ts-node scripts/vault/merkleTreeBuilder.ts \
 *     --rules <path/to/rules.json|rules.yaml> \
 *     --chain-id <chainId> \
 *     --contract <validatorAddress> \
 *     --mode build
 *
 *   npx ts-node scripts/vault/merkleTreeBuilder.ts \
 *     --rules <path/to/rules.json|rules.yaml> \
 *     --chain-id <chainId> \
 *     --contract <validatorAddress> \
 *     --mode proof \
 *     --rule-name <ruleName>
 *
 * Modes:
 *   build  — print the Merkle root (and domain separator) for all rules in the file
 *   proof  — print ruleEncoded + merkleProof for the named rule, ready to pass to isAllowed()
 *
 * Rule flags are inferred from field presence:
 *   - sender, to, value : flag set when the field is present and non-empty
 *   - dataLength        : flag set when the field is present and non-zero
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { ethers } from 'ethers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

// ─── Rule schema ─────────────────────────────────────────────────────────────

interface RuleConstraint {
  offset: number;
  mask: string;
  expected: string;
}

interface RuleJson {
  sender?: string;
  to?: string;
  value?: string | number; // decimal ("100"), hex ("0x64"), or unquoted YAML number
  dataLength?: string | number; // quoted ("68") or unquoted YAML number
  constraints?: RuleConstraint[];
}

type RulesFile = Record<string, RuleJson>;

// ─── File loading ─────────────────────────────────────────────────────────────

function loadRulesFile(filePath: string): RulesFile {
  const content = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    return yaml.parse(content) as RulesFile;
  }
  return JSON.parse(content) as RulesFile;
}

// ─── Encoding ────────────────────────────────────────────────────────────────

function inferFlags(rule: RuleJson): number {
  return (
    (rule.sender ? 0x01 : 0) |
    (rule.to ? 0x02 : 0) |
    (rule.value !== undefined && rule.value !== '' ? 0x04 : 0) |
    (rule.dataLength !== undefined ? 0x08 : 0)
  );
}

function encodeRule(rule: RuleJson): string {
  const flags = inferFlags(rule);
  const sender = rule.sender || ethers.ZeroAddress;
  const to = rule.to || ethers.ZeroAddress;
  const value = rule.value !== undefined && rule.value !== '' ? BigInt(rule.value) : 0n;
  const dataLength = rule.dataLength !== undefined ? Number(rule.dataLength) >>> 0 : 0;
  const constraints = rule.constraints ?? [];

  const types: string[] = ['uint8', 'uint8', 'address', 'address', 'uint256', 'uint32', 'uint16'];
  const values: Array<string | bigint | number> = [0x01, flags, sender, to, value, dataLength, constraints.length];
  for (const c of constraints) {
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

  const rules = loadRulesFile(fullPath);
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
