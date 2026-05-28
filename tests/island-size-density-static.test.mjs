import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const environmentSource = readFileSync(new URL('../src/environment.js', import.meta.url), 'utf8');
const grassSource = readFileSync(new URL('../src/grass.js', import.meta.url), 'utf8');

assert(
  stateSource.includes('export const ISLAND_SIZE_BASE = 100;')
    && stateSource.includes('export const ISLAND_RADIUS_BASE = ISLAND_SIZE_BASE * 0.462;'),
  'Base island radius should be doubled through the shared island-size constant.'
);

assert(
  stateSource.includes('export const DENSITY_BASE = 76;')
    && stateSource.includes('absolute spawn counts stay near the old world size instead of doubling'),
  'Density anchor should double with island size so creature/flora counts do not increase.'
);

assert(
  worldSource.includes('const densityScale = worldState.ISLAND_SIZE / DENSITY_BASE;')
    && worldSource.includes('Math.round(biome.floraCount * densityScale)')
    && worldSource.includes('Math.round(randInt(...biome.creatureCount) * densityScale)'),
  'World generation should keep flora and creature budgets tied to DENSITY_BASE.'
);

assert(
  environmentSource.includes('state.ISLAND_SIZE / DENSITY_BASE')
    && grassSource.includes('state.ISLAND_SIZE / DENSITY_BASE'),
  'Ground cover and grass should use the same density anchor as flora/creatures.'
);
