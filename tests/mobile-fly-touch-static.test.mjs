import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const touchControls = indexSource.slice(
  indexSource.indexOf('id="fly-touch-controls"'),
  indexSource.indexOf('<div class="fps-counter"')
);

assert(
  indexSource.includes('id="fly-touch-controls"')
    && indexSource.includes('class="fly-touch-pad"')
    && indexSource.includes('id="fly-touch-look"')
    && indexSource.includes('class="fly-touch-joystick-knob"')
    && indexSource.includes('class="fly-touch-altitude"')
    && touchControls.includes('data-fly-key="w"')
    && touchControls.includes('data-fly-key="s"')
    && !touchControls.includes('data-fly-key="a"')
    && !touchControls.includes('data-fly-key="d"')
    && !touchControls.includes('data-fly-key="e"')
    && !touchControls.includes('data-fly-key="q"'),
  'Mobile fly mode should expose a left look joystick and right forward/back movement controls.'
);

assert(
  uiSource.includes('const flyTouchControls = document.getElementById("fly-touch-controls");')
    && uiSource.includes('const flyTouchJoystick = document.getElementById("fly-touch-look");')
    && uiSource.includes('const flyTouchButtons = [...flyTouchControls.querySelectorAll("[data-fly-key]")];')
    && uiSource.includes('function setFlyTouchKey(key, down)')
    && uiSource.includes('_flyFP.keys[key] = down;')
    && uiSource.includes('document.body.classList.toggle("fly-mode", on);')
    && uiSource.includes('syncFlyTouchControls();'),
  'Touch controls should sync with the same fly-mode state and key map as keyboard controls.'
);

assert(
  uiSource.includes('lookX: 0,')
    && uiSource.includes('lookY: 0,')
    && uiSource.includes('function setFlyTouchJoystick(x, y)')
    && uiSource.includes('fp.yaw -= fp.lookX * lookSpeed * dt;')
    && uiSource.includes('fp.pitch -= fp.lookY * lookSpeed * dt;')
    && uiSource.includes('updateFlyTouchJoystick(e);'),
  'Mobile fly joystick should drive continuous first-person look and reset when released.'
);

assert(
  uiSource.includes('canvas.addEventListener("pointerdown", (e) => {')
    && uiSource.includes('if (e.pointerType !== "touch" && e.pointerType !== "pen") return;')
    && uiSource.includes('flyTouchLookPointer = e.pointerId;')
    && uiSource.includes('_flyFP.yaw -= (e.clientX - flyTouchLookX) * sens;')
    && uiSource.includes('clampFirstPersonPitch(_flyFP);'),
  'Mobile fly mode should let touch/pen drags on the open view look around without pointer lock.'
);

assert(
  cssSource.includes('.fly-touch-controls')
    && cssSource.includes('body.mobile.fly-mode .fly-touch-controls')
    && cssSource.includes('.fly-touch-pad')
    && cssSource.includes('.fly-touch-altitude')
    && cssSource.includes('border-radius: 999px;')
    && cssSource.includes('bottom: calc(max(16px, env(safe-area-inset-bottom)) + 204px);')
    && cssSource.includes('right: max(16px, env(safe-area-inset-right));'),
  'Mobile fly touch controls should be circular and pinned above the bottom HUD.'
);
