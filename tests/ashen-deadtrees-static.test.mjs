import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES, FLOWER_DENSITY, WILDFLOWER_PALETTES } from '../src/biomes.js';

const TREE_KINDS = new Set(['tree', 'leafballtree', 'pine', 'snowpine', 'balloontree']);
const ashen = BIOMES.find((biome) => biome.id === 'ashen');
// src/flora.js is now a registry. The deadtree builder lives in structures.js
// (the next builder in that file is `crystal`, so the deadtree block slice now
// terminates there instead of at `skull`, which moved to rocks.js). deadtree
// and skull still keep their relative order in the FLORA_BUILDERS registry
// (src/flora.js), which we read separately for the ordering assertion.
const floraSource = readFileSync(new URL('../src/flora/structures.js', import.meta.url), 'utf8');
const floraRegistry = readFileSync(new URL('../src/flora.js', import.meta.url), 'utf8');
const pbrSource = readFileSync(new URL('../src/pbr.js', import.meta.url), 'utf8');

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
const deadTreeEnd = floraSource.indexOf('crystal(biome)', deadTreeStart);
const deadTreeBlock = floraSource.slice(deadTreeStart, deadTreeEnd);

assert(deadTreeStart >= 0 && deadTreeEnd > deadTreeStart, 'Dead tree builder block should be present in structures.js.');
// deadtree and skull used to be adjacent in one flora file; after the split
// (deadtree -> structures.js, skull -> rocks.js) their relative order is now
// expressed in the FLORA_BUILDERS registry in src/flora.js.
assert(
  floraRegistry.indexOf('deadtree:') < floraRegistry.indexOf('skull:'),
  'Dead tree builder should still be registered before skull flora in the FLORA_BUILDERS registry.'
);
assert(
  deadTreeBlock.includes('deadtree.mat.smooth')
    && deadTreeBlock.includes('flatShading: false')
    && deadTreeBlock.match(/computeVertexNormals\(\)/g)?.length >= 2,
  'Dead tree trunk and branches should use smooth-shaded normals/materials.'
);

assert(
  floraSource.includes('makeDeadTreePBRMaterial')
    && deadTreeBlock.includes('makeDeadTreePBRMaterial'),
  'Dead tree flora should build its trunk and branch material through the dead-bark PBR helper.'
);

assert(
  pbrSource.includes('export function makeDeadTreePBRMaterial')
    && pbrSource.includes('buildDeadTreeBarkTextures')
    && pbrSource.includes('cachedDetailTextures("deadtree-bark", buildDeadTreeBarkTextures)'),
  'Dead tree PBR should expose a dedicated cached procedural bark texture helper.'
);

assert(
  pbrSource.includes('deadTreeNormalCanvas')
    && pbrSource.includes('deadWoodCrack')
    && pbrSource.includes('charredRidge')
    && pbrSource.includes('silveryAshGrain'),
  'Dead tree bark PBR should generate cracked, charred, ashy normal/material texture detail.'
);

assert(
  pbrSource.includes('specularIntensity: 0.34')
    && pbrSource.includes('material.normalScale.set(1.18, 1.18)'),
  'Dead tree bark PBR should have enough normal and subtle specular response to read under inspect lighting.'
);
