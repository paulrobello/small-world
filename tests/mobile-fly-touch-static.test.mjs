import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

assert(
  indexSource.includes('id="fly-touch-controls"')
    && indexSource.includes('class="fly-touch-pad"')
    && indexSource.includes('class="fly-touch-altitude"')
    && indexSource.includes('data-fly-key="w"')
    && indexSource.includes('data-fly-key="a"')
    && indexSource.includes('data-fly-key="s"')
    && indexSource.includes('data-fly-key="d"')
    && indexSource.includes('data-fly-key="e"')
    && indexSource.includes('data-fly-key="q"'),
  'Mobile fly mode should expose compact edge controls for movement and altitude.'
);

assert(
  uiSource.includes('const flyTouchControls = document.getElementById("fly-touch-controls");')
    && uiSource.includes('const flyTouchButtons = [...flyTouchControls.querySelectorAll("[data-fly-key]")];')
    && uiSource.includes('function setFlyTouchKey(key, down)')
    && uiSource.includes('_flyFP.keys[key] = down;')
    && uiSource.includes('document.body.classList.toggle("fly-mode", on);')
    && uiSource.includes('syncFlyTouchControls();'),
  'Touch controls should sync with the same fly-mode state and key map as keyboard controls.'
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
    && cssSource.includes('width: 96px;')
    && cssSource.includes('right: max(16px, env(safe-area-inset-right));'),
  'Mobile fly touch controls should stay compact and pinned to screen edges.'
);
