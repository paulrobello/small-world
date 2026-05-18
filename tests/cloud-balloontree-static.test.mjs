import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES, GRASS_DENSITY } from '../src/biomes.js';

const cloud = BIOMES.find((biome) => biome.id === 'cloud');
const environmentSource = readFileSync(new URL('../src/environment.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

assert(cloud, 'cloud island biome should exist.');
assert.equal(
  cloud.flora.filter((kind) => kind === 'balloontree').length,
  3,
  'cloud island should use the cloud-specific balloontree in its tree slots.'
);
assert.equal(
  cloud.flora.includes('leafballtree'),
  false,
  'cloud island should not use leafballtree canopies, which read as flattened regular trees in this biome.'
);
assert.equal(
  Object.hasOwn(cloud, 'leafballTreePalette'),
  false,
  'cloud island should not keep a leafballTreePalette once it uses only balloontree for tree slots.'
);
assert.equal(cloud.flora.includes('rock'), false, 'cloud island should not spawn rock flora.');
assert.equal(GRASS_DENSITY.cloud, 0, 'cloud island should disable the instanced grass field.');
assert.equal(cloud.bloom, false, 'cloud island should opt out of bloom post-processing.');
assert.equal(
  environmentSource.includes('cloud-puff-pads'),
  false,
  'cloud island should not place flattened ground cloud pads that read as crushed trees.'
);
assert.equal(
  environmentSource.includes('variant: "cloudpuff"'),
  false,
  'cloud puff ambiance should not shift-click into unsupported cloudpuff inspect URLs that normalize to tree.'
);
assert(
  environmentSource.includes('yOffset: 0.16'),
  'cloud puff ambiance should sit partially sunk into the cloud terrain.'
);
assert(
  worldSource.includes('state.userSettings.bloom && biome.bloom !== false'),
  'world generation should keep bloom disabled for biomes that opt out.'
);
assert(
  uiSource.includes('bloomEl.checked && state.currentBiome?.bloom !== false'),
  'the FX toggle should not re-enable bloom while the current biome opts out.'
);
