import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { ethers } from 'ethers';
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { isKnownDestinationType, KNOWN_DESTINATION_TYPES } from './destinationTypes';

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
  /**
   * When set, pins `data[0:4]` and sets `FLAG_SELECTOR` (0x10).
   * Use `name(types)` (e.g. `transfer(address,uint256)`); optional spaces around commas are stripped.
   * Or hex `bytes4` (`0x` + 8 hex digits), including explicit `0x00000000` to pin an all-zero selector.
   * Omit or use `""` for wildcard (`packRuleSelector` returns `''`, distinct from a real zero hash).
   */
  selector?: string;
  constraints?: RuleConstraint[];
  /**
   * When `true`, this rule is excluded from the Merkle tree entirely.
   * Use to temporarily retire a rule without deleting it from the file.
   */
  disabled?: boolean;
  /**
   * Human-readable label describing what the `to` address is (e.g. `AAVE_v3`, `ERC20`).
   * Not used in Merkle root calculation; always validated at build time (including disabled rules)
   * against the known-types vocabulary in `destinationTypes.yaml`.
   * Omit when the target is a wildcard or the type is not in the list.
   */
  destinationType?: string;
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

/** `name(types)` only; collapse whitespace (commas may be spaced in the source string). */
function normalizeSelectorSignature(raw: string): string {
  return raw.trim().replace(/\s+/g, '');
}

/**
 * Canonical selector preimage for rules.
 * @returns `''` when the rule omits a selector (wildcard); otherwise `0x`-prefixed 4-byte hex
 *         (including `0x00000000` for explicit zero bytes or a signature that hashes to zero).
 */
export function packRuleSelector(selector?: string): string {
  if (selector === undefined || selector === '') return '';
  const trimmed = selector.trim();
  if (trimmed === '') return '';
  if (trimmed.includes('(')) {
    const sig = normalizeSelectorSignature(trimmed);
    const hash = ethers.keccak256(ethers.toUtf8Bytes(sig));
    return ethers.dataSlice(hash, 0, 4);
  }
  let b = ethers.getBytes(trimmed);
  if (b.length > 4) b = b.slice(0, 4);
  if (b.length < 4) return ethers.zeroPadValue(b, 4);
  return ethers.hexlify(b);
}

/** `solidityPacked` needs four bytes; maps wildcard (`''` from `packRuleSelector`) to canonical zeros. */
export function packedSelectorToBytes4(packed: string): string {
  return packed === '' ? '0x00000000' : packed;
}

export function inferFlags(rule: RuleJson): number {
  return (
    (rule.sender ? 0x01 : 0) |
    (rule.to ? 0x02 : 0) |
    (rule.value !== undefined && rule.value !== '' ? 0x04 : 0) |
    (rule.dataLength !== undefined ? 0x08 : 0) |
    (rule.selector !== undefined && rule.selector.trim() !== '' ? 0x10 : 0)
  );
}

export function encodeRule(rule: RuleJson): string {
  const flags = inferFlags(rule);
  const selectorHex = packedSelectorToBytes4(packRuleSelector(rule.selector));
  const sender = rule.sender || ethers.ZeroAddress;
  const to = rule.to || ethers.ZeroAddress;
  const value = rule.value !== undefined && rule.value !== '' ? BigInt(rule.value) : 0n;
  const dataLength = rule.dataLength !== undefined ? Number(rule.dataLength) >>> 0 : 0;
  const constraints = rule.constraints ?? [];

  const types: string[] = ['uint8', 'uint8', 'bytes4', 'address', 'address', 'uint256', 'uint32', 'uint16'];
  const values: Array<string | bigint | number> = [
    0x01,
    flags,
    selectorHex,
    sender,
    to,
    value,
    dataLength,
    constraints.length
  ];
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
): { tree: StandardMerkleTree<TreeRow>; encoded: Record<string, string>; skipped: string[] } {
  const encoded: Record<string, string> = {};
  const rows: TreeRow[] = [];
  const skipped: string[] = [];
  for (const [name, rule] of Object.entries(rules)) {
    if (rule.destinationType !== undefined && !isKnownDestinationType(rule.destinationType)) {
      throw new Error(
        `Rule "${name}": unknown destinationType "${rule.destinationType}". ` +
          `Known types: ${KNOWN_DESTINATION_TYPES.join(', ')}`
      );
    }
    if (rule.disabled === true) {
      skipped.push(name);
      continue;
    }
    const ruleEncoded = encodeRule(rule);
    encoded[name] = ruleEncoded;
    rows.push([0, domainSeparator, ethers.getBytes(ruleEncoded)]);
  }
  if (rows.length === 0) throw new Error('Rules file is empty — cannot build a Merkle tree with no leaves.');
  return { tree: StandardMerkleTree.of(rows, ['uint8', 'bytes32', 'bytes']), encoded, skipped };
}

// ─── Ruleset path resolution ──────────────────────────────────────────────────

const DEFAULT_RULESET_ROOT = path.join(__dirname, 'ruleset');

/** Ruleset directory: `STRATEGY_RULESET_ROOT`, else `./ruleset` next to this file. */
export function rulesetRoot(): string {
  return process.env.STRATEGY_RULESET_ROOT ?? DEFAULT_RULESET_ROOT;
}

export function chainIdToFolder(chainId: bigint): string {
  return '0x' + chainId.toString(16).padStart(64, '0');
}

export function resolveRulesetPath(chainId: bigint, contractAddress: string): string {
  const root = rulesetRoot();
  const dir = path.join(root, chainIdToFolder(chainId));
  for (const ext of ['.json', '.yaml', '.yml']) {
    const candidate = path.join(dir, contractAddress + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `No ruleset file found for contract ${contractAddress} on chain ${chainId}.\n` +
      `Searched in: ${dir}\n` +
      `Expected one of: ${['.json', '.yaml', '.yml'].map(e => contractAddress + e).join(', ')}`
  );
}

/**
 * Resolves the ruleset file path from parsed CLI args.
 * If --rules is given, use it directly.
 * Otherwise derive from --chain-id and --contract using STRATEGY_RULESET_ROOT (see rulesetRoot()).
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
