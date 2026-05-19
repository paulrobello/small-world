import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/fauna/creature.js', import.meta.url), 'utf8');

assert(
  source.includes('const recoveringStrayFlier =') &&
    source.includes('c.flies &&') &&
    source.includes('currentDist > nextDist') &&
    source.includes('pos.x = nx;') &&
    source.includes('pos.z = nz;'),
  'A flier already beyond the island edge should be allowed to commit inward movement instead of freezing outside.'
);

assert(
  source.includes('c.flies && c.landState !== "landed"'),
  'Edge recovery should apply to airborne fliers across flying, descending, and ascending states.'
);
