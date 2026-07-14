import * as fs from 'fs';
import * as yaml from 'yaml';

let cachedTypes: string[] | undefined;
let cachedSet: Set<string> | undefined;

function destinationTypesPath(): string {
  const typesPath = process.env.STRATEGY_DESTINATION_TYPES_PATH;
  if (!typesPath) {
    console.error('Error: STRATEGY_DESTINATION_TYPES_PATH must be set to destinationTypes.yaml');
    console.error('Export the absolute path to the vocabulary file from the live ruleset repository.');
    process.exit(1);
  }
  return typesPath;
}

function loadKnownDestinationTypes(): string[] {
  if (cachedTypes) return cachedTypes;
  const content = fs.readFileSync(destinationTypesPath(), 'utf8');
  cachedTypes = yaml.parse(content) as string[];
  cachedSet = new Set(cachedTypes);
  return cachedTypes;
}

/** Known values for `destinationType` — loaded from `STRATEGY_DESTINATION_TYPES_PATH`. */
export function getKnownDestinationTypes(): string[] {
  return loadKnownDestinationTypes();
}

export function isKnownDestinationType(value: string): boolean {
  loadKnownDestinationTypes();
  return cachedSet!.has(value);
}
