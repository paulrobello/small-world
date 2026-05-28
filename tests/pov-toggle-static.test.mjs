import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

assert(
  indexSource.includes('id="stroll-toggle"')
    && indexSource.includes('aria-label="enter first-person stroll"')
    && indexSource.includes('<span class="pov-glyph">POV</span>'),
  'The footer controls should expose first-person stroll without requiring the help panel.'
);

assert(
  uiSource.includes('const strollToggle = document.getElementById("stroll-toggle");')
    && uiSource.includes('strollToggle.classList.toggle("active", on);')
    && uiSource.includes('strollToggle.setAttribute("aria-pressed", on ? "true" : "false");')
    && uiSource.includes('strollToggle.addEventListener("click", () => {')
    && uiSource.includes('syncStrollButton();'),
  'The visible POV control should share the same stroll state and sync path as the settings button and F key.'
);

assert(
  cssSource.includes('.pov-toggle')
    && cssSource.includes('.pov-toggle.active')
    && cssSource.includes('.pov-glyph')
    && cssSource.includes('.pov-label { display: none; }'),
  'The visible POV control should fit the existing footer controls and collapse its label on very narrow screens.'
);
