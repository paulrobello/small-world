import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES, FLOWER_DENSITY, WILDFLOWER_PALETTES } from '../src/biomes.js';

const desert = BIOMES.find((biome) => biome.id === 'desert');
const ashen = BIOMES.find((biome) => biome.id === 'ashen');
const environmentSource = readFileSync(new URL('../src/environment.js', import.meta.url), 'utf8');
// src/flora.js is now a registry. The pillar builder (asserted here for the
// crimson dunes nest-host cap radius) lives in rocks.js.
const floraSource = readFileSync(new URL('../src/flora/rocks.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const sizeMapStart = environmentSource.indexOf('const sizeMap = {');
const sizeMapEnd = environmentSource.indexOf('const opacityMap = {', sizeMapStart);
const sizeMapBlock = environmentSource.slice(sizeMapStart, sizeMapEnd);
const baseCountStart = environmentSource.indexOf('const baseCount = {');
const baseCountEnd = environmentSource.indexOf('}[kind] || 200;', baseCountStart);
const baseCountBlock = environmentSource.slice(baseCountStart, baseCountEnd);
const cinderStart = environmentSource.indexOf('} else if (kind === "cinder") {');
const cinderEnd = environmentSource.indexOf('} else if (kind === "bubble") {', cinderStart);
const cinderBlock = environmentSource.slice(cinderStart, cinderEnd);
assert(desert, 'crimson dunes biome should exist.');
assert(ashen, 'ashen wastes biome should exist.');
assert(sizeMapStart >= 0 && sizeMapEnd > sizeMapStart, 'Particle sizeMap should be present.');
assert(baseCountStart >= 0 && baseCountEnd > baseCountStart, 'Particle baseCount should be present.');
assert(cinderStart >= 0 && cinderEnd > cinderStart, 'Cinder particle update block should be present.');
assert.equal(desert.particle, 'sand', 'crimson dunes should use wind-blown sand particles.');
assert.equal(ashen.particle, 'cinder', 'ashen wastes should use ember-like cinder particles.');

assert(desert.edgeAura, 'crimson dunes should define a terrain-colored mist ring.');
assert.equal(desert.edgeAura.pattern, 'mist', 'crimson dunes edge aura should be a mist ring.');
assert.deepEqual(
  desert.edgeAura.colors,
  desert.ground,
  'crimson dunes mist ring should match the terrain ground colors.'
);

assert.equal(
  FLOWER_DENSITY.desert,
  0,
  'crimson dunes should not spawn wildflower ground cover.'
);
assert.equal(
  Object.hasOwn(WILDFLOWER_PALETTES, 'desert'),
  false,
  'crimson dunes should not keep a wildflower palette when flowers are disabled.'
);

assert(
  floraSource.includes('const pillarHorizontalScale = biome.id === "desert" ? 1 + Math.random() : 1')
    && floraSource.includes('const capRadius = 0.22 * 1.1 * pillarHorizontalScale')
    && floraSource.includes('g.userData.nestHostRadius = capRadius'),
  'crimson dunes pillars should roll up to +1 horizontal radius and expose their wide cap for flyer nests.'
);

assert(
  worldSource.includes('const NEST_HOST_KINDS = new Set(["tree", "leafballtree", "pine", "snowpine", "balloontree", "bigmushroom", "pillar"])')
    && worldSource.includes('const MIN_NEST_HOST_RADIUS')
    && worldSource.includes('const nestHostRadius = (f.userData.nestHostRadius ?? f.userData.perchRadius ?? 0) * s')
    && worldSource.includes('if (kind !== "pillar" || nestHostRadius >= MIN_NEST_HOST_RADIUS)'),
  'world generation should allow nests to use only the wider pillar instances as hosts.'
);

assert(
  environmentSource.includes('sand: 3120')
    && environmentSource.includes('PARTICLE_KIND == 11')
    && environmentSource.includes('windBand')
    && environmentSource.includes('groundY + 0.08')
    && environmentSource.includes('if (length(c) > 0.34) discard;')
    && environmentSource.includes('kind === "sand" ? _sandParticleVS : _particleVS')
    && environmentSource.includes('kind === "sand" ? _sandParticleFS : _particleFS')
    && environmentSource.includes('sand: 0.28')
    && environmentSource.includes('sand: 0.58')
    && environmentSource.includes('depthTest: true'),
  'sand particles should be dense, tiny, low grit that does not depth-fade away.'
);

assert(
  environmentSource.includes('if (total <= 0) return [];'),
  'zero flower density should prevent fallback wildflower meshes from spawning.'
);

assert(
  sizeMapBlock.includes('cinder: 0.95'),
  'Ashen ember-like cinder particles should be 5x larger than their previous 0.19 base size.'
);

assert(
  baseCountBlock.includes('cinder: 260'),
  'Ashen ember-like cinder particles should use half the previous 520 count.'
);
assert(
  environmentSource.includes('kind === "cinder" ? 0.1 + Math.random() * 5.6 : Math.random() * 14'),
  'Ashen ember-like cinder particles should spawn across twice the previous 2.8-unit vertical range.'
);

assert(
  environmentSource.includes('function cinderFissureLiftAt(x, z)')
    && environmentSource.includes('obstacle.kind !== "lavafissure"')
    && environmentSource.includes('const fissureLift = cinderFissureLiftAt(x, z)')
    && cinderBlock.includes('const verticalDrift = -0.18 + fissureLift * 0.74')
    && !cinderBlock.includes('4.2 * gust'),
  'Ashen cinders should float with fissure-driven lift instead of directional wind.'
);
assert(
  cinderBlock.includes('const groundY = state.heightFn ? state.heightFn(x, z) : 0')
    && cinderBlock.includes('const ceil = groundY + 5.8')
    && cinderBlock.includes('if (y > ceil) y = ceil;')
    && !cinderBlock.includes('if (y < floor)')
    && !cinderBlock.includes('floor + Math.random()'),
  'Ashen cinders should not snap to a terrain floor; let them drift through the ground.'
);
assert(
  environmentSource.includes('if (kind === "cinder") points.layers.enable(BLOOM_LAYER);'),
  'Ashen cinders should opt into the bloom render layer.'
);
assert(
  environmentSource.includes('const cinderBloomBoost = kind === "cinder" ? 3.2 : 1.0')
    && environmentSource.includes('new THREE.Color(colorMap[kind]).multiplyScalar(cinderBloomBoost)')
    && environmentSource.includes('new THREE.Color(color2Map[kind] ?? colorMap[kind]).multiplyScalar(cinderBloomBoost)'),
  'Ashen cinder particles should use HDR color energy so bloom is visibly effective.'
);
assert(
  environmentSource.includes('const cinderLifeRate = 0.16')
    && environmentSource.includes('} else if (kind === "cinder") {')
    && environmentSource.includes('lifes[i] = Math.min(1, (lifes[i] ?? 0) + dt * cinderLifeRate);')
    && !environmentSource.includes('kind === "ember" || kind === "spark" || kind === "cinder"'),
  'Ashen cinders should use a slower, separate lifetime rate so they have time to drift.'
);
