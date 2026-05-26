/** Known values for the optional `destinationType` field in ruleset files.
 *
 * Add new entries here when integrating a new protocol so the vocabulary stays
 * in sync across all ruleset files and tooling.  The list is used only for
 * documentation and build-time validation; it has no on-chain encoding.
 */
export const KNOWN_DESTINATION_TYPES = [
  'ERC20',
  'AAVE_v3',
  'AAVE_v4',
  'Morpho',
  'Uniswap_v2',
  'Uniswap_v3',
  'Compound_v2',
  'Compound_v3',
  'Curve',
  'Balancer',
  'BoringVault',
] as const;

export type DestinationType = (typeof KNOWN_DESTINATION_TYPES)[number];

const DESTINATION_TYPE_SET = new Set<string>(KNOWN_DESTINATION_TYPES);

export function isKnownDestinationType(value: string): value is DestinationType {
  return DESTINATION_TYPE_SET.has(value);
}
