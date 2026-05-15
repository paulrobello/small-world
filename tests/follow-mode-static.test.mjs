import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const helpSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert(
  !uiSource.includes('setFollowTarget(creature, { transient: true })'),
  'Direct creature clicks should start persistent follow, not transient focus.'
);
assert(
  !uiSource.includes('TRANSIENT_FOCUS_MS'),
  'Follow mode should not auto-release after a fixed transient timeout.'
);
assert(
  !helpSource.includes('for a few seconds of close camera focus'),
  'Help text should not describe creature clicks as temporary focus.'
);
