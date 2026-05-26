import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

const TYPES_FILE = path.join(__dirname, 'destinationTypes.yaml');

/** Known values for `destinationType` — loaded from `destinationTypes.yaml`. */
export const KNOWN_DESTINATION_TYPES: string[] = yaml.parse(fs.readFileSync(TYPES_FILE, 'utf8')) as string[];

const DESTINATION_TYPE_SET = new Set<string>(KNOWN_DESTINATION_TYPES);

export function isKnownDestinationType(value: string): boolean {
  return DESTINATION_TYPE_SET.has(value);
}
