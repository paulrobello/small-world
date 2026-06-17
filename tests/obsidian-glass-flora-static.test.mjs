import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES } from '../src/biomes.js';

const obsidian = BIOMES.find((biome) => biome.id === 'obsidian');
// src/flora.js is now a registry. The lavafissure and obsidianglass builders
// both live in volcanic.js; the slice (lavafissure -> obsidianglass) resolves
// within that one file.
const floraSource = readFileSync(new URL('../src/flora/volcanic.js', import.meta.url), 'utf8');
const inspectSource = readFileSync(new URL('../src/inspect.js', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const fissureStart = floraSource.indexOf('lavafissure(biome)');
const fissureEnd = floraSource.indexOf('obsidianglass()', fissureStart);
const fissureBlock = floraSource.slice(fissureStart, fissureEnd);

assert(obsidian, 'volcanic glass biome should exist.');
assert(
  !obsidian.flora.includes('leafballtree'),
  'volcanic glass should not spawn tree flora.'
);
assert.equal(
  obsidian.leafballTreePalette,
  undefined,
  'volcanic glass should not keep a tree palette when tree flora is removed.'
);
assert(
  obsidian.flora.includes('obsidianglass'),
  'volcanic glass should include shiny obsidian glass flora.'
);
assert.equal(
  obsidian.noButterflies,
  true,
  'volcanic glass should not spawn butterflies.'
);
assert.equal(
  obsidian.sunIntensity,
  8.8,
  'volcanic glass should be 10% brighter than the previous 8.0 sun intensity.'
);
assert(
  obsidian.flora.indexOf('obsidianglass') > obsidian.flora.indexOf('skull'),
  'obsidian glass should be its own volcanic glass flora slot, not a tree replacement in the list.'
);
assert(
  floraSource.includes('obsidianglass()')
    && floraSource.includes('new THREE.ConeGeometry(0.22, 1, 5, 1)')
    && floraSource.includes('new THREE.MeshPhysicalMaterial')
    && floraSource.includes('color: new THREE.Color("#020204")')
    && floraSource.includes('emissive: new THREE.Color("#000000")')
    && floraSource.includes('roughness: 0.035')
    && floraSource.includes('metalness: 0.88')
    && floraSource.includes('clearcoat: 1.0')
    && floraSource.includes('specularIntensity: 1.0')
    && floraSource.includes('reflectivity: 1.0')
    && !floraSource.includes('obsidianglass.glint'),
  'obsidian glass flora should use black pointed shards and a high-shine physical material without floating glint strips.'
);
assert(
  worldSource.includes('obsidianglass: 0.34')
    && worldSource.includes('"obsidianglass"')
    && worldSource.includes('obsidianglass: 1.6'),
  'obsidian glass flora should participate in slope planting and obstacle routing.'
);
assert(
  inspectSource.includes('"lavafissure", "obsidianshard", "obsidianglass"')
    && uiSource.includes('obsidianglass: "Obsidian Glass"'),
  'shift-click and locator UI should treat obsidian glass as a dedicated inspectable flora variant.'
);

assert(fissureStart >= 0 && fissureEnd > fissureStart, 'Lava fissure builder should live before obsidian glass flora.');
assert(
  fissureBlock.includes('float redBand = smoothstep(0.0084375, 0.285, vAcross);'),
  'Lava fissure bright center should be 25% thinner than the previous 0.01125/0.38 band.'
);
