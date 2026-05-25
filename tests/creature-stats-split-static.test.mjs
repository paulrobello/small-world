import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

assert(
  indexSource.includes('<span class="label">ground</span>')
    && indexSource.includes('id="ground-creature-count"')
    && indexSource.includes('<span class="label">fly</span>')
    && indexSource.includes('id="fly-creature-count"')
    && indexSource.includes('<span class="label">swim</span>')
    && indexSource.includes('id="swim-creature-count"')
    && !indexSource.includes('id="creature-count"')
    && !indexSource.includes('id="elevation"'),
  'bottom HUD should split the old creature stat into ground, fly, and swim counters without the elevation stat.'
);

assert(
  indexSource.includes('<dt>ground</dt><dd id="help-ground-creatures">00</dd>')
    && indexSource.includes('<dt>fly</dt><dd id="help-fly-creatures">00</dd>')
    && indexSource.includes('<dt>swim</dt><dd id="help-swim-creatures">00</dd>')
    && !indexSource.includes('id="help-creatures"')
    && !indexSource.includes('id="help-elevation"'),
  'mobile help world stats should mirror the split creature counters without elevation.'
);

assert(
  worldSource.includes('const groundCreatureCount = worldState.creatures.filter((c) => !c.flies && !c.isFish).length + worldState.caterpillars.length')
    && worldSource.includes('const flyCreatureCount = worldState.creatures.filter((c) => c.flies && !c.isFish).length')
    && worldSource.includes('const swimCreatureCount = worldState.creatures.filter((c) => c.isFish).length')
    && worldSource.includes('document.getElementById("ground-creature-count").textContent = padStat(groundCreatureCount)')
    && worldSource.includes('document.getElementById("fly-creature-count").textContent = padStat(flyCreatureCount)')
    && worldSource.includes('document.getElementById("swim-creature-count").textContent = padStat(swimCreatureCount)')
    && worldSource.includes('if (hGround) hGround.textContent = padStat(groundCreatureCount)')
    && worldSource.includes('if (hFly) hFly.textContent = padStat(flyCreatureCount)')
    && worldSource.includes('if (hSwim) hSwim.textContent = padStat(swimCreatureCount)')
    && !worldSource.includes('getElementById("elevation")')
    && !worldSource.includes('getElementById("help-elevation")')
    && !worldSource.includes('measure max elevation for HUD'),
  'world generation should compute and write split ground/fly/swim creature stats without elevation writes.'
);

assert(
  cssSource.includes('.stats .label,')
    && cssSource.includes('.stats .value {')
    && cssSource.includes('color: var(--ink);')
    && cssSource.includes('opacity: 1;')
    && cssSource.includes('text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);'),
  'bottom HUD stats text should be fully opaque with a small black readability shadow.'
);

assert(
  cssSource.includes('.eyebrow,')
    && cssSource.includes('.eyebrow-button,')
    && cssSource.includes('.eyebrow-link {')
    && cssSource.includes('color: var(--ink);')
    && cssSource.includes('opacity: 1;'),
  'top field-notes/version text should be fully opaque.'
);

assert(
  indexSource.includes('<button class="eyebrow-button" id="locator-eyebrow" type="button">field notes</button>')
    && uiSource.includes('const locatorEyebrow = document.getElementById("locator-eyebrow")')
    && uiSource.includes('locatorEyebrow?.addEventListener("click", () => setLocatorOpen(!_locatorOpen))'),
  'field notes eyebrow text should open the creature/flora locator.'
);
