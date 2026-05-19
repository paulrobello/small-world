import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES } from '../src/biomes.js';

const frozen = BIOMES.find((biome) => biome.id === 'frozen');
const environmentSource = readFileSync(new URL('../src/environment.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const sizeMapStart = environmentSource.indexOf('const sizeMap = {');
const sizeMapEnd = environmentSource.indexOf('const opacityMap = {', sizeMapStart);
const sizeMapBlock = environmentSource.slice(sizeMapStart, sizeMapEnd);
const baseCountStart = environmentSource.indexOf('const baseCount = {');
const baseCountEnd = environmentSource.indexOf('}[kind] || 200;', baseCountStart);
const baseCountBlock = environmentSource.slice(baseCountStart, baseCountEnd);

assert(frozen, 'frozen vale biome should exist.');
assert.equal(frozen.particle, 'snow', 'frozen vale should use snow particles.');
assert.equal(frozen.noFlyerNests, true, 'frozen vale should not spawn flyer nests.');
assert.equal(
  frozen.flora.filter((kind) => kind === 'snowpine').length,
  3,
  'frozen vale should use snow-covered pine trees in its former leafball tree slots.'
);
assert.equal(
  frozen.flora.includes('leafballtree'),
  false,
  'frozen vale should not spawn leafball trees.'
);
assert.equal(
  Object.hasOwn(frozen, 'leafballTreePalette'),
  false,
  'frozen vale should not keep a leafball palette once it uses snow pine trees.'
);
assert(
  baseCountBlock.includes('snow: 900'),
  'snow particles should be denser than the previous 500 count.'
);
assert(
  sizeMapBlock.includes('snow: 0.16'),
  'snow particles should be larger than the previous 0.1 base size.'
);
assert(
  worldSource.includes('tree: 0.28, leafballtree: 0.32, pine: 0.28, snowpine: 0.28'),
  'snowpine should use the same slope-plant footprint as pine.'
);
assert(
  worldSource.includes('"tree", "leafballtree", "pine", "snowpine", "deadtree"'),
  'snowpine should be treated as a solid tree for obstacle and canopy spacing logic.'
);
assert(
  worldSource.includes('kind === "tree" || kind === "leafballtree" || kind === "pine" || kind === "snowpine"'),
  'snowpine should get the same world scale multiplier as pine.'
);
