import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../main.js', import.meta.url), 'utf8');

assert(
  !mainSource.includes('camera.position.y - Math.sin(camera.rotation.x) * 8'),
  'Photo-mode tilt-shift focus must not mirror camera pitch; use the camera forward vector instead.'
);
assert(
  mainSource.includes('camera.getWorldDirection(_focusDir)'),
  'Photo-mode tilt-shift focus should derive the focus point from camera.getWorldDirection().'
);
assert(
  mainSource.includes('_focusProj.copy(camera.position).addScaledVector(_focusDir, focusZ).project(camera)'),
  'Photo-mode tilt-shift focus should project the point along the camera focus direction.'
);

assert(
  mainSource.includes('function shouldApplyTiltShift()'),
  'Tilt-shift should be gated by the current camera/view mode each frame.'
);
assert(
  mainSource.includes('if (isPhotoFP()) return state.userSettings.tiltShift;'),
  'Photo mode should keep tilt-shift available.'
);
assert(
  mainSource.includes('return state.userSettings.tiltShift && !isStrolling() && !isFlyMode() && !getFollowTarget();'),
  'Tilt-shift should be disabled in first-person stroll, fly camera, and creature-follow views.'
);
assert(
  mainSource.includes('postfx.setTiltShift(shouldApplyTiltShift());\n    if (postfx.isActive && postfx.isActive())'),
  'The tilt-shift pass should be disabled before checking whether post-FX is active.'
);
