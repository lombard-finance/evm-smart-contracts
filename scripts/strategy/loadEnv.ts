import { config } from 'dotenv';
import * as path from 'path';

/** Load repo-root `.env` for CLI scripts; does not override existing env vars. */
config({ path: path.resolve(__dirname, '.env') });
