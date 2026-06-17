import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
// Grass-density persistence + the GRASS_DENSITY_BASE constant moved from
// src/ui.js into src/ui/storage.js as part of ARC-003 / QA-004 (ui.js split).
// The migration logic and slider baseline now live there; assert against it.
const storageSource = readFileSync(new URL('../src/ui/storage.js', import.meta.url), 'utf8');
const grassSource = readFileSync(new URL('../src/grass.js', import.meta.url), 'utf8');

assert(
  stateSource.includes('grassDensity: 25'),
  'Default grass density should double the previous 12.5 baseline for all grass-enabled biomes.'
);

assert(
  storageSource.includes('const GRASS_DENSITY_BASE = 25'),
  'The grass density slider 100% baseline should match the new default density.'
);

assert(
  stateSource.includes('grassDensityBase: 25')
    && storageSource.includes('"grassDensityBase"')
    && storageSource.includes('const savedGrassDensityBase = Number(saved.grassDensityBase ?? 12.5);')
    && storageSource.includes('state.userSettings.grassDensity = saved.grassDensity * (GRASS_DENSITY_BASE / savedGrassDensityBase);')
    && storageSource.includes('state.userSettings.grassDensityBase = GRASS_DENSITY_BASE;'),
  'Saved grass-density settings should migrate from the previous baseline so existing users also get the doubled grass density.'
);

assert(
  grassSource.includes('const MAX_DENSITY_MULTIPLIER = 75'),
  'Grass field preallocation should match the density slider max of 300% × 25 = 75.'
);
