import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert(
  htmlSource.includes('id="setting-bloom-radius" min="0" max="110" step="1" value="100"')
    && htmlSource.includes('id="setting-bloom-radius-value">100%</span>'),
  'Bloom radius control should present 100% as the default UI value.'
);

assert(
  stateSource.includes('bloomRadius: 1.0'),
  'Default persisted bloom radius should start at 100%, not a muted 15%.'
);
