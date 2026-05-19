import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');
const creaturePovSource = readFileSync(new URL('../src/creaturePov.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const grassSource = readFileSync(new URL('../src/grass.js', import.meta.url), 'utf8');

const enterStrollStart = uiSource.indexOf('function enterStroll()');
const exitStrollStart = uiSource.indexOf('function exitStroll()');
assert(enterStrollStart > -1 && exitStrollStart > enterStrollStart, 'test should locate first-person stroll entry body');
const enterStrollBody = uiSource.slice(enterStrollStart, exitStrollStart);

assert(
  !enterStrollBody.includes('setFollowTarget(null);'),
  'Entering first-person stroll while following a creature should preserve that follow target for creature POV.'
);

assert(
  mainSource.includes('syncCreaturePovCamera(camera, controls, followedCreature)'),
  'First-person camera updates should switch to the followed creature POV when a follow target exists.'
);

assert(
  mainSource.includes('setCreaturePovRenderHidden(followedCreature)'),
  'The followed creature render group should be hidden while first-person creature POV is active.'
);

assert.match(
  creaturePovSource,
  /const\s+POV_EYE_LIFT\s*=\s*0\.35;/,
  'Creature POV camera should sit 0.25 units higher than the initial 0.10 eye lift.'
);

assert(
  uiSource.includes('canvas.requestPointerLock?.().catch(() => {});'),
  'First-person entry should swallow pointer-lock rejection so unsupported browser contexts do not emit an unhandled error.'
);

assert(
  grassSource.includes('for (const c of state.creatures)') &&
    !grassSource.includes('if (!c.group || !c.group.visible) continue;'),
  'Grass pushers should still be populated from creature state even when a followed creature is hidden from rendering.'
);
