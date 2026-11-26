// Loads the shared test vectors, which are the same files the Python tests use.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const vector = (name) => JSON.parse(readFileSync(join(here, '..', '..', 'tests', 'vectors', name), 'utf8'));
