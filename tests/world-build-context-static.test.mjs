import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');

assert(
  worldSource.includes('export function createWorldBuildContext('),
  'world.js should expose a build-context factory so world generation can target non-global scenes.'
);

assert(
  worldSource.includes('export async function generateWorld(seed, context = createWorldBuildContext(), options = {})'),
  'generateWorld should accept optional explicit build context and generation options.'
);

assert(
  worldSource.includes('const worldState = context.state;')
    && worldSource.includes('const worldScene = context.scene;')
    && worldSource.includes('const releaseFollow = context.releaseFollow;'),
  'generateWorld should bind state, scene, and follow-release through the provided context.'
);

assert(
  worldSource.includes('worldScene.remove(worldState.world);')
    && worldSource.includes('worldScene.add(worldState.world);'),
  'The world group swap should target the context scene, not the module-level scene ref directly.'
);

const generateStart = worldSource.indexOf('export async function generateWorld');
assert.notEqual(generateStart, -1, 'generateWorld declaration not found');
const generateBody = worldSource.slice(generateStart);

for (const globalWrite of [
  'state.world.add',
  'state.heightFn',
  'state.obstacles',
  'state.creatures',
  'state.caterpillars',
  'state.flowerSpots',
  'state.currentLayout',
  'state.ISLAND_SIZE',
  'state.groundMarks',
]) {
  assert(
    !generateBody.includes(globalWrite),
    `generateWorld should not use global ${globalWrite}; it should use worldState from the context.`
  );
}

for (const contextWrite of [
  'worldState.world.add',
  'worldState.heightFn',
  'worldState.obstacles',
  'worldState.creatures',
  'worldState.caterpillars',
  'worldState.flowerSpots',
  'worldState.currentLayout',
  'worldState.ISLAND_SIZE',
  'worldState.groundMarks',
]) {
  assert(
    generateBody.includes(contextWrite),
    `generateWorld should use ${contextWrite} through the build context.`
  );
}

assert(
  generateBody.includes('worldScene.background = new THREE.Color(biome.sky);')
    && generateBody.includes('worldScene.fog = new THREE.FogExp2(new THREE.Color(biome.fog), biome.fogDensity);'),
  'generateWorld should write atmosphere to the context scene.'
);

assert(
  generateBody.includes('const pickWorldGroundPoint = (maxRadiusFrac = 0.88, opts = {}) =>')
    && generateBody.includes('pickGroundPoint(maxRadiusFrac, { ...opts, layout: worldState.currentLayout })')
    && generateBody.includes('makeTerrain(biome, worldState.heightFn, worldState)'),
  'generateWorld should pass context layout and world size into terrain helpers instead of relying on global terrain state.'
);

assert(
  generateBody.includes('const seedBiome = BIOMES[Math.floor(Math.random() * BIOMES.length)];')
    && generateBody.includes('const forcedBiome = options.biomeId ? BIOMES.find((candidate) => candidate.id === options.biomeId) : null;')
    && generateBody.includes('const biome = forcedBiome ?? seedBiome;')
    && generateBody.includes('context.writeSeed(seed, { biomeId: forcedBiome ? biome.id : null });'),
  'generateWorld should support forced-biome catalog navigation while preserving the seed RNG stream and URL state.'
);

assert(
  generateBody.includes('const shouldGuaranteeBurrower = biome.id === "marsh" && allowGroundVariants;')
    && generateBody.includes('placeOnGround(makeCreature(biome, { burrower: true }), { maxTries: 120 })'),
  'Lavender Marsh should reserve one current-world creature slot for a burrower so its catalog and locator always include one.'
);
