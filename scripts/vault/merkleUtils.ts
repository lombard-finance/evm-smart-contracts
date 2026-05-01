import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { ethers } from 'ethers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

// ─── Rule schema ──────────────────────────────────────────────────────────────

export interface RuleConstraint {
  offset: number;
  mask: string;
  expected: string;
}

export interface RuleJson {
  sender?: string;
  to?: string;
  value?: string | number;
  dataLength?: string | number;
  constraints?: RuleConstraint[];
}

export type RulesFile = Record<string, RuleJson>;

export type TreeRow = [number, string, Uint8Array];

// ─── File loading ─────────────────────────────────────────────────────────────

export function loadRulesFile(filePath: string): RulesFile {
  const content = fs.readFileSync(filePath, 'utf8');
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') return yaml.parse(content) as RulesFile;
  return JSON.parse(content) as RulesFile;
}

// ─── Encoding ─────────────────────────────────────────────────────────────────

export function inferFlags(rule: RuleJson): number {
  return (
    (rule.sender ? 0x01 : 0) |
    (rule.to ? 0x02 : 0) |
    (rule.value !== undefined && rule.value !== '' ? 0x04 : 0) |
    (rule.dataLength !== undefined ? 0x08 : 0)
  );
}

export function encodeRule(rule: RuleJson): string {
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

// ─── Domain separator ─────────────────────────────────────────────────────────

export function computeDomainSeparator(chainId: bigint, contractAddress: string): string {
  const packed = ethers.solidityPacked(
    ['bytes4', 'uint8', 'uint256', 'address'],
    ['0x414c4c57', 1, chainId, contractAddress]
  );
  return ethers.keccak256(packed);
}

// ─── Tree ─────────────────────────────────────────────────────────────────────

export function buildTree(
  rules: RulesFile,
  domainSeparator: string
): { tree: StandardMerkleTree<TreeRow>; encoded: Record<string, string> } {
  const encoded: Record<string, string> = {};
  const rows: TreeRow[] = [];
  for (const [name, rule] of Object.entries(rules)) {
    const ruleEncoded = encodeRule(rule);
    encoded[name] = ruleEncoded;
    rows.push([0, domainSeparator, ethers.getBytes(ruleEncoded)]);
  }
  if (rows.length === 0) throw new Error('Rules file is empty — cannot build a Merkle tree with no leaves.');
  return { tree: StandardMerkleTree.of(rows, ['uint8', 'bytes32', 'bytes']), encoded };
}

// ─── Ruleset path resolution ──────────────────────────────────────────────────

const DEFAULT_RULESET_ROOT = path.join(__dirname, 'ruleset');

export function chainIdToFolder(chainId: bigint): string {
  return '0x' + chainId.toString(16).padStart(64, '0');
}

export function resolveRulesetPath(chainId: bigint, vaultAddress: string): string {
  const root = process.env.VAULT_RULESET_ROOT ?? DEFAULT_RULESET_ROOT;
  const dir = path.join(root, chainIdToFolder(chainId));
  for (const ext of ['.json', '.yaml', '.yml']) {
    const candidate = path.join(dir, vaultAddress + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `No ruleset file found for vault ${vaultAddress} on chain ${chainId}.\n` +
      `Searched in: ${dir}\n` +
      `Expected one of: ${['.json', '.yaml', '.yml'].map(e => vaultAddress + e).join(', ')}`
  );
}

/**
 * Resolves the ruleset file path from parsed CLI args.
 * If --rules is given, use it directly.
 * Otherwise derive from --chain-id and --contract using VAULT_RULESET_ROOT.
 */
export function resolveRulesetFromArgs(args: Record<string, string>): string {
  if (args['rules']) return path.resolve(args['rules']);

  const chainIdStr = args['chain-id'];
  const contractAddress = args['contract'];
  if (!chainIdStr || !contractAddress) {
    console.error('Error: provide either --rules <path> or both --chain-id and --contract');
    process.exit(1);
  }
  return resolveRulesetPath(BigInt(chainIdStr), contractAddress);
}

// ─── CLI helpers ──────────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      result[argv[i].slice(2)] = argv[++i];
    }
  }
  return result;
}

export function require_arg(args: Record<string, string>, key: string): string {
  const v = args[key];
  if (!v) {
    console.error(`Error: missing required argument --${key}`);
    process.exit(1);
  }
  return v;
}
