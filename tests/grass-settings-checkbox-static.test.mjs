import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const ui = readFileSync("src/ui.js", "utf8");
const world = readFileSync("src/world.js", "utf8");

assert.match(
  ui,
  /function syncGrassControls\(\) \{[\s\S]*?const grassAvailable = !!state\.grass;[\s\S]*?const enabled = grassAvailable && state\.userSettings\.grassEnabled !== false;[\s\S]*?grassEnabledEl\.checked = enabled;[\s\S]*?grassEnabledEl\.disabled = !grassAvailable;/,
  "Grass enabled checkbox should reflect the actual grass mesh availability, not only the persisted preference."
);

assert.match(
  ui,
  /state\._reapplyGrassSettings = \(\) => \{[\s\S]*?applyGrassSettings\(\);[\s\S]*?syncGrassControls\(\);[\s\S]*?\};/,
  "Grass control state should resync after the initial world build and every regeneration."
);

assert.match(
  world,
  /const grass = makeGrassField\(biome, state\.heightFn, coverExclusions, grassShorteners\);\s+if \(grass\) state\.world\.add\(grass\);\s+if \(state\._reapplyGrassSettings\) state\._reapplyGrassSettings\(\);/,
  "World generation should resync grass controls only after makeGrassField has established whether grass exists."
);
