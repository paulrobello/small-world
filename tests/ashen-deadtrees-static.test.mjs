import assert from 'node:assert/strict';
import { BIOMES } from '../src/biomes.js';

const TREE_KINDS = new Set(['tree', 'leafballtree', 'pine', 'snowpine', 'balloontree']);
const ashen = BIOMES.find((biome) => biome.id === 'ashen');

assert(ashen, 'ashen wastes biome should exist.');
assert(
  ashen.flora.includes('deadtree'),
  'Ashen wastes should use deadtree flora.'
);
assert.deepEqual(
  ashen.flora.filter((kind) => TREE_KINDS.has(kind)),
  [],
  'Ashen wastes should not spawn living tree flora; use deadtree instead.'
);

const nonAshenDeadTreeBiomes = BIOMES
  .filter((biome) => biome.id !== 'ashen' && biome.flora.includes('deadtree'))
  .map((biome) => biome.id);

assert.deepEqual(
  nonAshenDeadTreeBiomes,
  [],
  'Only ashen wastes should include deadtree in its biome flora list.'
);
