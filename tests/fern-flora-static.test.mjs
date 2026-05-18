import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES } from '../src/biomes.js';

const floraSource = readFileSync(new URL('../src/flora.js', import.meta.url), 'utf8');
const inspectSource = readFileSync(new URL('../src/inspect.js', import.meta.url), 'utf8');

const builderStart = floraSource.indexOf('fern(biome)');
const builderEnd = floraSource.indexOf('rock(biome)', builderStart);
const builderBlock = floraSource.slice(builderStart, builderEnd);

assert(builderStart >= 0 && builderEnd > builderStart, 'Fern builder should live before rock flora.');

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
