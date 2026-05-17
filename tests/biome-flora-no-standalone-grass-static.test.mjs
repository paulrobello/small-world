import assert from 'node:assert/strict';
import { BIOMES } from '../src/biomes.js';

const offenders = BIOMES
  .filter((biome) => biome.flora.includes('grass'))
  .map((biome) => biome.id);

assert.deepEqual(
  offenders,
  [],
  'Biomes should not spawn standalone grass flora; use the instanced grass field instead.'
);
