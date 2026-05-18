import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES, FLOWER_DENSITY, WILDFLOWER_PALETTES } from '../src/biomes.js';

const TREE_KINDS = new Set(['tree', 'leafballtree', 'pine', 'snowpine', 'balloontree']);
const ashen = BIOMES.find((biome) => biome.id === 'ashen');
const floraSource = readFileSync(new URL('../src/flora.js', import.meta.url), 'utf8');

assert(ashen, 'ashen wastes biome should exist.');
assert(
  ashen.flora.includes('deadtree'),
  'Ashen wastes should use deadtree flora.'
);
assert(
  !ashen.flora.includes('dandylion'),
  'Ashen wastes should not spawn dandy lion flora.'
);
assert.equal(
  FLOWER_DENSITY.ashen,
  0,
  'Ashen wastes should not spawn wildflower ground cover.'
);
assert.equal(
  Object.hasOwn(WILDFLOWER_PALETTES, 'ashen'),
  false,
  'Ashen wastes should not keep a wildflower palette when flowers are disabled.'
);
assert.equal(
  ashen.flora.filter((kind) => kind === 'lavafissure').length / ashen.flora.length,
  0.4,
  'Ashen wastes should weight lava fissures at 40% of flora picks, 20% below the old 50% mix.'
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

const deadTreeStart = floraSource.indexOf('deadtree(biome)');
const deadTreeEnd = floraSource.indexOf('skull()', deadTreeStart);
const deadTreeBlock = floraSource.slice(deadTreeStart, deadTreeEnd);

assert(deadTreeStart >= 0 && deadTreeEnd > deadTreeStart, 'Dead tree builder should live before skull flora.');
assert(
  deadTreeBlock.includes('deadtree.mat.smooth')
    && deadTreeBlock.includes('flatShading: false')
    && deadTreeBlock.match(/computeVertexNormals\(\)/g)?.length >= 2,
  'Dead tree trunk and branches should use smooth-shaded normals/materials.'
);
