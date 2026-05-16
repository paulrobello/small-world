import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const floraSource = readFileSync(new URL('../src/flora.js', import.meta.url), 'utf8');

assert(
  floraSource.includes('function appendFernGeometry'),
  'Fern fronds should bake ribs and leaflets into one geometry so shared attachment points receive the same wind deformation.'
);
assert(
  floraSource.includes('new THREE.Mesh(frondGeo, frondMat)'),
  'Fern should render as one wind-swayed mesh instead of separate rib/leaflet meshes that can detach.'
);
assert(
  /const frondMat = applyWindSway\(/.test(floraSource),
  'The combined fern mesh should still use the shared applyWindSway path.'
);
assert(
  floraSource.includes('vertexColors: true'),
  'Smooth baked fern material should keep per-part color variation through vertex colors.'
);
assert(
  floraSource.includes('flatShading: false'),
  'Smooth baked fern material should explicitly avoid flat shading.'
);
assert(
  floraSource.includes('frondGeo.setAttribute("normal"'),
  'Smooth baked fern geometry should preserve transformed normals.'
);
assert(
  floraSource.includes('frondGeo.setAttribute("color"'),
  'Smooth baked fern geometry should preserve transformed vertex colors.'
);
assert(
  floraSource.includes('frondGeo.setIndex(indices)'),
  'Smooth baked fern geometry should preserve source indices instead of expanding every triangle.'
);
assert(
  !floraSource.includes('applyFernLeafletWind'),
  'Fern should not need a separate leaflet wind shader; detached leaflets are avoided by shared geometry.'
);
