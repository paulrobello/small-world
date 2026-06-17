import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES } from '../src/biomes.js';

// src/flora.js is now a registry. The fern, dandylion, and berrybush builders
// all live in garden.js. After the split, `rock` moved to rocks.js and
// `lantern` moved to structures.js, so the fern block now terminates at the
// next builder in garden.js (`reed()`) and the berrybush block runs to the end
// of garden.js (berrybush is the last builder there). The original cross-file
// "before" ordering (fern<rock, berrybush<lantern) is now expressed in the
// FLORA_BUILDERS registry in src/flora.js, which we read separately.
const floraSource = readFileSync(new URL('../src/flora/garden.js', import.meta.url), 'utf8');
const floraRegistry = readFileSync(new URL('../src/flora.js', import.meta.url), 'utf8');
const biomesSource = readFileSync(new URL('../src/biomes.js', import.meta.url), 'utf8');
const inspectSource = readFileSync(new URL('../src/inspect.js', import.meta.url), 'utf8');

const builderStart = floraSource.indexOf('fern(biome)');
const builderEnd = floraSource.indexOf('reed()', builderStart);
const builderBlock = floraSource.slice(builderStart, builderEnd);
const dandyStart = floraSource.indexOf('dandylion(biome)');
const dandyEnd = floraSource.indexOf('cactus()', dandyStart);
const dandyBlock = floraSource.slice(dandyStart, dandyEnd);
const berryStart = floraSource.indexOf('berrybush(biome)');
// berrybush is the last builder in garden.js; slice to end of file.
const berryBlock = floraSource.slice(berryStart);

assert(builderStart >= 0 && builderEnd > builderStart, 'Fern builder block should be present in garden.js.');
assert(dandyStart >= 0 && dandyEnd > dandyStart, 'Dandylion builder should live before cactus flora.');
assert(berryStart >= 0, 'Berrybush builder block should be present in garden.js.');
assert(
  floraRegistry.indexOf('fern:') < floraRegistry.indexOf('rock:'),
  'Fern builder should still be registered before rock flora in the FLORA_BUILDERS registry.'
);
assert(
  floraRegistry.indexOf('berrybush:') < floraRegistry.indexOf('lantern:'),
  'Berrybush builder should still be registered before lantern flora in the FLORA_BUILDERS registry.'
);

const fernBiomes = BIOMES.filter((biome) => biome.flora.includes('fern')).map((biome) => biome.id);
assert(
  fernBiomes.length > 0 && BIOMES.every((biome) => !biome.flora.some((kind) => kind.includes('fern') && kind !== 'fern')),
  'All biome fern entries should continue to route through the shared fern flora kind.'
);

assert(
  builderBlock.includes('fern.frond.stem.geo')
    && builderBlock.includes('fern.frond.leaflet.geo')
    && builderBlock.includes('buildLeafGeo')
    && builderBlock.includes('leafletPairs')
    && builderBlock.includes('frond.quaternion.setFromUnitVectors'),
  'Fern builder should use the updated frond generator with stems and paired curved leaflets.'
);

assert(
  builderBlock.includes('applyWindSway')
    && builderBlock.includes('flatShading: false')
    && builderBlock.includes('leaflet.rotation.z')
    && builderBlock.includes('leaflet.rotation.y'),
  'Updated fern fronds should be smooth-shaded, wind-swaying, and varied per leaflet.'
);

assert(
  !builderBlock.includes('new THREE.ConeGeometry(0.06, 0.5, 4)')
    && !builderBlock.includes('fern.blade.geo')
    && !builderBlock.includes('const blades = 4 + Math.floor(Math.random() * 3)'),
  'Fern builder should not use the old cone-blade generator.'
);

assert(
  inspectSource.includes('"fern"'),
  'Inspect flora catalog should continue exposing the shared fern specimen.'
);

const verdantBlock = biomesSource.slice(
  biomesSource.indexOf('id: "verdant"'),
  biomesSource.indexOf('id: "desert"')
);
assert(
  verdantBlock.includes('microFloraShadows: false'),
  'Verdant grove should opt out of real shadow-map shadows for dense micro-flora.'
);

assert(
  builderBlock.includes('const castMicroShadow = shouldCastMicroFloraShadow(biome);')
    && builderBlock.includes('stem.castShadow = castMicroShadow;')
    && builderBlock.includes('leaflet.castShadow = castMicroShadow;')
    && builderBlock.includes('tip.castShadow = castMicroShadow;'),
  'Fern stems and leaflets should respect the biome micro-flora shadow LOD flag.'
);

assert(
  dandyBlock.includes('const castMicroShadow = shouldCastMicroFloraShadow(biome);')
    && dandyBlock.includes('stem.castShadow = castMicroShadow;')
    && dandyBlock.includes('leaf.castShadow = castMicroShadow;')
    && dandyBlock.includes('core.castShadow = castMicroShadow;'),
  'Dandylion stems, base leaves, and heads should respect the biome micro-flora shadow LOD flag.'
);

assert(
  berryBlock.includes('const castMicroShadow = shouldCastMicroFloraShadow(biome);')
    && berryBlock.includes('makeInstancedLeafBatch(leafGeo, leafMats[i], leafBuckets[i], castMicroShadow)')
    && berryBlock.includes('berry.castShadow = castMicroShadow;'),
  'Berrybush leaf batches and berries should respect the biome micro-flora shadow LOD flag.'
);
