import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES, GRASS_DENSITY } from '../src/biomes.js';

const cloud = BIOMES.find((biome) => biome.id === 'cloud');
const floraSource = readFileSync(new URL('../src/flora.js', import.meta.url), 'utf8');
const environmentSource = readFileSync(new URL('../src/environment.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

assert(cloud, 'cloud island biome should exist.');
assert.equal(
  cloud.flora.filter((kind) => kind === 'balloontree').length,
  3,
  'cloud island should use the cloud-specific balloontree in its tree slots.'
);
assert.equal(
  cloud.flora.includes('leafballtree'),
  false,
  'cloud island should not use leafballtree canopies, which read as flattened regular trees in this biome.'
);
assert.equal(
  Object.hasOwn(cloud, 'leafballTreePalette'),
  false,
  'cloud island should not keep a leafballTreePalette once it uses only balloontree for tree slots.'
);
assert.equal(cloud.flora.includes('rock'), false, 'cloud island should not spawn rock flora.');
assert.equal(cloud.flora.includes('dandylion'), true, 'cloud island should include dandy lions.');
assert.equal(GRASS_DENSITY.cloud, 0, 'cloud island should disable the instanced grass field.');
assert.equal(cloud.bloom, false, 'cloud island should opt out of bloom post-processing.');
assert.deepEqual(
  cloud.creatureColors,
  ['#fff4b8', '#ffe08a', '#f6c36a', '#ffd0a3'],
  'cloud island creatures should use warm yellow and peach colors with no blue palette entries.'
);
assert(
  cloud.creatureColors.every((hex) => {
    const red = Number.parseInt(hex.slice(1, 3), 16);
    const green = Number.parseInt(hex.slice(3, 5), 16);
    const blue = Number.parseInt(hex.slice(5, 7), 16);
    return red >= green && green >= blue;
  }),
  'cloud island creature colors should stay warm-channel dominant, not blue-dominant.'
);
assert.equal(
  environmentSource.includes('cloud-puff-pads'),
  false,
  'cloud island should not place flattened ground cloud pads that read as crushed trees.'
);
assert.equal(
  environmentSource.includes('variant: "cloudpuff"'),
  false,
  'cloud puff ambiance should not shift-click into unsupported cloudpuff inspect URLs that normalize to tree.'
);
assert(
  floraSource.includes('const detailPuffs = biome.cloudlike ? 8 + Math.floor(Math.random() * 5) : 0'),
  'cloud balloon trees should add extra small puff detail around the crown.'
);
assert(
  floraSource.includes('balloontree.tether.cloud.mat') && floraSource.includes('new THREE.CylinderGeometry(0.006, 0.004, tetherLength, 5)'),
  'cloud balloon trees should add fine tether strands from trunk to crown puffs.'
);
assert(
  floraSource.includes('function applyBalloonPuffWisps(material') && floraSource.includes('uBalloonWispStrength'),
  'balloon tree puff material should use a custom shader patch for wispy swirling bands.'
);
assert(
  floraSource.includes('float balloonWispSoftNoise(vec3 p)') && floraSource.includes('atan(vBalloonLocalPos.z, vBalloonLocalPos.x)'),
  'balloon tree wisps should be procedural and softly warped around each puff instead of relying on a flat texture.'
);
assert(
  floraSource.includes('applyBalloonPuffWisps(') && floraSource.includes('uTime'),
  'balloon tree wisps should animate through the shared wind time uniform.'
);
assert(
  floraSource.includes('uBalloonWispContrast') && floraSource.includes('uBalloonWispShadow'),
  'balloon tree wisps should include both bright and shadow bands so the animation reads on pale cloud puffs.'
);
assert(
  floraSource.includes('uBalloonWispTime * 0.46'),
  'balloon tree wisps should drift fast enough to be visible during normal viewing.'
);
assert(
  floraSource.includes('spiralPhase') && floraSource.includes('spiralRibbon'),
  'balloon tree wisps should use an explicit spiral phase/ribbon mask rather than mottled noise bands.'
);
assert(
  floraSource.includes('atan(vBalloonLocalPos.z, vBalloonLocalPos.x) * 2.8') && floraSource.includes('vBalloonLocalPos.y * 9.5'),
  'balloon tree spiral bands should wrap around the puff and climb vertically enough to read as swirl.'
);
assert(
  environmentSource.includes('yOffset: 0.16'),
  'cloud puff ambiance should sit partially sunk into the cloud terrain.'
);
assert(
  worldSource.includes('state.userSettings.bloom && biome.bloom !== false'),
  'world generation should keep bloom disabled for biomes that opt out.'
);
assert(
  uiSource.includes('bloomEl.checked && state.currentBiome?.bloom !== false'),
  'the FX toggle should not re-enable bloom while the current biome opts out.'
);
