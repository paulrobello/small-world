import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES } from '../src/biomes.js';

// src/flora.js is now a registry. The seaweed and grass builders both live in
// garden.js; the slice (seaweed -> grass) resolves within that one file.
const floraSource = readFileSync(new URL('../src/flora/garden.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const inspectSource = readFileSync(new URL('../src/inspect.js', import.meta.url), 'utf8');

const coral = BIOMES.find((biome) => biome.id === 'coral');
assert(coral, 'coral atoll biome should exist.');
assert(
  coral.flora.includes('seaweed'),
  'coral atoll should include seaweed in its flora mix.'
);
assert.equal(
  coral.flora.filter((kind) => kind === 'seaweed').length,
  16,
  'coral atoll should double seaweed weighting from 8 to 16 flora slots.'
);
assert.equal(
  coral.flora.filter((kind) => kind === 'coral').length,
  4,
  'coral atoll should double branching coral weighting from 2 to 4 flora slots.'
);
assert.equal(
  coral.flora.filter((kind) => kind === 'braincoral').length,
  2,
  'coral atoll should double brain coral weighting from 1 to 2 flora slots.'
);
assert.equal(
  coral.flora.filter((kind) => kind === 'cupcoral').length,
  2,
  'coral atoll should double cup coral weighting from 1 to 2 flora slots.'
);

for (const biome of BIOMES) {
  if (biome.id === 'coral') continue;
  assert.equal(
    biome.flora.includes('seaweed'),
    false,
    `${biome.id} should not spawn seaweed yet.`
  );
}

const builderStart = floraSource.indexOf('seaweed(biome)');
const builderEnd = floraSource.indexOf('grass(biome)', builderStart);
const builderBlock = floraSource.slice(builderStart, builderEnd);
assert(builderStart >= 0 && builderEnd > builderStart, 'Seaweed builder should live before grass flora.');

assert(
  builderBlock.includes('const SEAWEED_SEGMENTS = 6')
    && builderBlock.includes('new THREE.PlaneGeometry(w, h, 1, SEAWEED_SEGMENTS)')
    && builderBlock.includes('position.setX(i, x + bow * 0.025 * Math.sin(t * Math.PI * 1.5))')
    && builderBlock.includes('position.setZ(i, z + bow * 0.018 * Math.sin(t * Math.PI * 2.0 + 0.6))')
    && builderBlock.includes('applyWindSway')
    && builderBlock.includes('g.userData.surfaceReachRange = [0.5, 0.95]')
    && builderBlock.includes('g.userData.baseHeight = SEAWEED_BASE_HEIGHT'),
  'Seaweed should use multi-segment blades with baked curve and wind sway metadata for water-surface fitting.'
);

assert(
  worldSource.includes('const MEDIUM_DEEP_WATER_FLORA = new Set(["seaweed"])')
    && worldSource.includes('const WATER_FLORA_DEPTH_RANGE = {')
    && worldSource.includes('seaweed: [2.1, 3.7]')
    && worldSource.includes('const surfaceReach = f.userData.surfaceReachRange')
    && worldSource.includes('const targetReach = surfaceReach[0] + Math.random() * (surfaceReach[1] - surfaceReach[0])')
    && worldSource.includes('const WATER_FLORA_SURFACE_CLEARANCE = 0.10')
    && worldSource.includes('const maxHeight = Math.max(0, depth - WATER_FLORA_SURFACE_CLEARANCE)')
    && worldSource.includes('const targetHeight = Math.min(depth * targetReach, maxHeight)')
    && worldSource.includes('s = targetHeight / baseHeight')
    && !worldSource.includes('s *= targetHeight / baseHeight'),
  'World placement should restrict seaweed to medium/deep water and replace random scale with a surface-clamped height.'
);

assert(
  inspectSource.includes('"reed", "seaweed", "grass"'),
  'Inspect flora catalog should expose the seaweed specimen.'
);
