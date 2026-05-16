import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const floraSource = readFileSync(new URL('../src/flora.js', import.meta.url), 'utf8');

assert(
  floraSource.includes('function applyFernLeafletWind'),
  'Fern leaflets need a fern-specific wind shader so their instance height contributes to sway.'
);
assert(
  floraSource.includes('instanceMatrix[3].y'),
  'Fern leaflet wind should include the instance matrix y offset so leaves move with their frond stems.'
);
assert(
  /const leafletMat = applyFernLeafletWind\(/.test(floraSource),
  'Fern leaflet material should use applyFernLeafletWind rather than generic local-y applyWindSway.'
);
assert(
  floraSource.includes('vec3 ayW = vec3(instanceMatrix[1].x, instanceMatrix[1].y, instanceMatrix[1].z);'),
  'Fern leaflet wind should include the full instance Y basis; side-rotated leaves need Y-axis motion to follow stems.'
);
assert(
  floraSource.includes('transformed.y += dot(ayW, windWorld) * invYScaleSq;'),
  'Fern leaflet wind should apply world wind through local Y as well as X/Z so both leaf sides stay attached.'
);
