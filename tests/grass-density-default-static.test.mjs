import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const grassSource = readFileSync(new URL('../src/grass.js', import.meta.url), 'utf8');

assert(
  stateSource.includes('grassDensity: 12.5'),
  'Default grass density should be 25% higher than the previous 10.0 baseline.'
);

assert(
  uiSource.includes('const DENSITY_BASE = 12.5'),
  'The grass density slider 100% baseline should match the new default density.'
);

assert(
  grassSource.includes('const MAX_DENSITY_MULTIPLIER = 37.5'),
  'Grass field preallocation should match the density slider max of 300% × 12.5 = 37.5.'
);
