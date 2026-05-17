import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

assert(
  stateSource.includes('grassHeight: 0.96'),
  'Default grass height should be 20% lower than the previous 1.2 baseline.'
);

assert(
  uiSource.includes('const HEIGHT_BASE = 0.96'),
  'The grass height slider 100% baseline should match the new default height.'
);
