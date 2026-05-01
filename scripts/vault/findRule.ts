/**
 * findRule.ts — given a transaction's parameters, find the matching rule and
 * return ruleEncoded + merkleProof ready to pass to the validator's isAllowed().
 * Optionally emits a ready-to-broadcast exec() transaction.
 *
 * Usage (derive ruleset from validator address):
 *   npx ts-node scripts/vault/findRule.ts \
 *     --chain-id <chainId>          chain ID (decimal or hex)
 *     --contract <validatorAddress> deployed MerkleAllowlistValidator address
 *     --to       <address>          call target (default: zero address)
 *     --sender   <address>          msg.sender   (default: zero address)
 *     --value    <decimal>          msg.value in wei (default: 0)
 *     --calldata <hex>              calldata (default: 0x for native coin transfers)
 *     --strategy <address>          strategy contract address — when provided, adds
 *                                   execTx to the output (ready-to-broadcast exec() call)
 *
 * Usage (explicit rules file):
 *   npx ts-node scripts/vault/findRule.ts \
 *     --rules    <path/to/rules.[json|yaml]> \
 *     --chain-id <chainId> \
 *     --contract <validatorAddress> \
 *     [--to / --sender / --value / --calldata / --strategy as above]
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

// ─── Transaction matching ─────────────────────────────────────────────────────

function readWord(data: Uint8Array, offset: number): bigint {
  const bytes = new Uint8Array(32);
  if (offset < data.length) {
    const len = Math.min(32, data.length - offset);
    bytes.set(data.slice(offset, offset + len), 0);
  }
  return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}

function txMatchesRule(rule: RuleJson, calldataHex: string, value: bigint, to: string, sender: string): boolean {
  if (rule.to && rule.to.toLowerCase() !== to.toLowerCase()) return false;
  if (rule.sender && rule.sender.toLowerCase() !== sender.toLowerCase()) return false;

  const data = ethers.getBytes(calldataHex);
  if (rule.dataLength !== undefined && data.length !== Number(rule.dataLength)) return false;
  if (rule.value !== undefined && rule.value !== '' && BigInt(rule.value) !== value) return false;

  for (const c of rule.constraints ?? []) {
    if ((readWord(data, c.offset) & BigInt(c.mask)) !== BigInt(c.expected)) return false;
  }

  return true;
}

// ─── exec() transaction builder ───────────────────────────────────────────────

const EXEC_IFACE = new ethers.Interface([
  'function exec(address to, uint256 value, bytes calldata data, bytes calldata validatorArgs) external payable returns (bytes)'
]);

function buildExecTx(
  strategyAddress: string | undefined,
  to: string,
  value: bigint,
  calldataHex: string,
  ruleEncoded: string,
  merkleProof: string[]
): { to: string | null; value: string; data: string } {
  // validatorArgs = abi.encode(CallVerificationInput{ruleEncoded, merkleProof})
  const validatorArgs = ethers.AbiCoder.defaultAbiCoder().encode(
    ['tuple(bytes ruleEncoded, bytes32[] merkleProof)'],
    [[ruleEncoded, merkleProof]]
  );
  const data = EXEC_IFACE.encodeFunctionData('exec', [to, value, calldataHex, validatorArgs]);
  return { to: strategyAddress ?? null, value: ethers.toBeHex(value), data };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv.slice(2));

  const chainId = BigInt(require_arg(args, 'chain-id'));
  const contractAddress = require_arg(args, 'contract');
  const to = args['to'] ?? ethers.ZeroAddress;
  const sender = args['sender'] ?? ethers.ZeroAddress;
  const value = BigInt(args['value'] ?? '0');
  const calldataHex = args['calldata'] ?? '0x';
  const strategyAddress = args['strategy'];

  const rulesetPath = resolveRulesetFromArgs(args);
  const rules = loadRulesFile(rulesetPath);
  const ds = computeDomainSeparator(chainId, contractAddress);
  const { tree, encoded } = buildTree(rules, ds);

  const match = Object.entries(rules).find(([, rule]) => txMatchesRule(rule, calldataHex, value, to, sender));
  if (!match) {
    console.error('Error: no rule in the ruleset matches the given transaction parameters');
    console.error('Rules checked:', Object.keys(rules).join(', '));
    process.exit(1);
  }

  const [ruleName] = match;
  const ruleEncoded = encoded[ruleName];
  const merkleProof = tree.getProof([0, ds, ethers.getBytes(ruleEncoded)] as [number, string, Uint8Array]);

  const execTx = buildExecTx(strategyAddress, to, value, calldataHex, ruleEncoded, merkleProof);
  console.log(JSON.stringify({ ruleName, root: tree.root, ruleEncoded, merkleProof, execTx }, null, 2));
}

main();
