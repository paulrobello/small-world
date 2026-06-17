import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// src/flora.js is now a registry. addGroveMushroomFamily and addPillarSurfaceMarks
// both live in _shared.js — read that directly.
const floraSource = readFileSync(new URL('../src/flora/_shared.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');

const familyStart = floraSource.indexOf('function addGroveMushroomFamily');
const familyEnd = floraSource.indexOf('function addPillarSurfaceMarks', familyStart);
const familyBlock = floraSource.slice(familyStart, familyEnd);

assert(familyStart >= 0 && familyEnd > familyStart, 'Grove mushroom family helper should be present.');

assert.match(
  familyBlock,
  /stem\.userData\.surfaceLift = 0;/,
  'Baby mushroom stems should mark their root for terrain conforming on slopes.'
);

assert.match(
  familyBlock,
  /cap\.userData\.surfaceLift = 0;/,
  'Baby mushroom caps should follow the same conformed root height as their stems.'
);

assert.match(
  familyBlock,
  /underside\.userData\.surfaceLift = 0;/,
  'Baby mushroom undersides should follow the same conformed root height as their stems.'
);

assert.match(
  worldSource,
  /if \(kind === "lavafissure" \|\| kind === "mushroom" \|\| kind === "bigmushroom"\) conformSurfaceChildrenToTerrain\(f\);/,
  'World generation should terrain-conform offset mushroom family pieces after final placement and scale.'
);
