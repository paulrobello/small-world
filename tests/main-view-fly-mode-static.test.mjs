import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert(
  uiSource.includes('let _flyFP = null;')
    && uiSource.includes('export function isFlyMode()')
    && uiSource.includes('return _flyFP !== null;')
    && uiSource.includes('return _stroll !== null || _flyFP !== null || _photoFP !== null;'),
  'ui.js should track main-view fly mode as a first-person camera state distinct from stroll and photo mode.'
);

assert(
  uiSource.includes('function enterFlyMode()')
    && uiSource.includes('function exitFlyMode()')
    && uiSource.includes('controls.enabled = false;')
    && uiSource.includes('controls.enabled = true;')
    && uiSource.includes('fly: true,')
    && uiSource.includes('keys: { w: false, a: false, s: false, d: false, shift: false, e: false, q: false }'),
  'Main-view fly mode should disable OrbitControls, use free-flight movement, and restore orbit controls on exit.'
);

assert(
  uiSource.includes('e.key === "v" || e.key === "V"')
    && uiSource.includes('if (_flyFP) exitFlyMode();')
    && uiSource.includes('else enterFlyMode();')
    && uiSource.includes('if (_flyFP) exitFlyMode();'),
  'The global keyboard handler should toggle main-view fly mode with V and let Escape exit it.'
);

assert(
  mainSource.includes('isFlyMode,')
    && mainSource.includes('return state.userSettings.tiltShift && !isStrolling() && !isFlyMode() && !getFollowTarget();'),
  'main.js should treat main-view fly mode as first-person for tilt-shift gating.'
);

assert(
  indexSource.includes('id="setting-fly-mode"')
    && indexSource.includes('fly camera')
    && indexSource.includes('<kbd>v</kbd> toggles fly camera')
    && indexSource.includes('<kbd>e</kbd>/<kbd>q</kbd> rise or descend')
    && indexSource.includes('<dt><kbd>v</kbd></dt><dd>toggle fly camera.</dd>'),
  'Help and camera settings should document the V fly-mode toggle and free-flight controls.'
);
