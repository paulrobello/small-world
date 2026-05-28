import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const grassSource = readFileSync(new URL('../src/grass.js', import.meta.url), 'utf8');

assert(
  stateSource.includes('grassDensity: 25'),
  'Default grass density should double the previous 12.5 baseline for all grass-enabled biomes.'
);

assert(
  uiSource.includes('const GRASS_DENSITY_BASE = 25'),
  'The grass density slider 100% baseline should match the new default density.'
);

assert(
  stateSource.includes('grassDensityBase: 25')
    && uiSource.includes('"grassDensityBase"')
    && uiSource.includes('const savedGrassDensityBase = Number(saved.grassDensityBase ?? 12.5);')
    && uiSource.includes('state.userSettings.grassDensity = saved.grassDensity * (GRASS_DENSITY_BASE / savedGrassDensityBase);')
    && uiSource.includes('state.userSettings.grassDensityBase = GRASS_DENSITY_BASE;'),
  'Saved grass-density settings should migrate from the previous baseline so existing users also get the doubled grass density.'
);

assert(
  grassSource.includes('const MAX_DENSITY_MULTIPLIER = 75'),
  'Grass field preallocation should match the density slider max of 300% × 25 = 75.'
);
