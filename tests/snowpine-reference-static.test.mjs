import assert from 'node:assert/strict';
import { BIOMES } from '../src/biomes.js';

globalThis.__APP_VERSION__ = 'test';
globalThis.window = {
  location: { search: '' },
  matchMedia: () => ({ matches: false }),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { maxTouchPoints: 0 },
  configurable: true,
});

const { FLORA_BUILDERS } = await import('../src/flora.js');

const frozen = BIOMES.find((biome) => biome.id === 'frozen');
assert(frozen, 'frozen vale biome should exist.');

const tree = FLORA_BUILDERS.snowpine(frozen);
const boughs = tree.children.filter((child) => child.userData.snowpinePart === 'bough');
const snowRims = tree.children.filter((child) => child.userData.snowpinePart === 'snow-rim');

function faceNormalY(geometry, faceOffset) {
  const positions = geometry.attributes.position;
  const indices = geometry.index.array;
  const ia = indices[faceOffset];
  const ib = indices[faceOffset + 1];
  const ic = indices[faceOffset + 2];
  const ax = positions.getX(ia);
  const az = positions.getZ(ia);
  const bx = positions.getX(ib);
  const bz = positions.getZ(ib);
  const cx = positions.getX(ic);
  const cz = positions.getZ(ic);
  const abx = bx - ax;
  const abz = bz - az;
  const acx = cx - ax;
  const acz = cz - az;

  return abz * acx - abx * acz;
}

assert.equal(
  boughs.length,
  4,
  'reference-style snow pine should use exactly four stacked bough skirts.'
);
assert.equal(
  snowRims.length,
  0,
  'snow pine snow should be rendered by the bough shader, not separate snow-rim geometry.'
);

for (let i = 1; i < boughs.length; i++) {
  assert(
    boughs[i].userData.tierRadius < boughs[i - 1].userData.tierRadius,
    'snow pine bough skirts should taper toward the top.'
  );
  assert(
    boughs[i].userData.tierY > boughs[i - 1].userData.tierY,
    'snow pine bough skirts should stack upward.'
  );
}

assert(
  boughs.every((bough) => bough.geometry.attributes.aSnow && bough.geometry.attributes.color && bough.userData.zigZagPoints >= 24),
  'snow pine bough geometry should carry a dense snow mask for sharp scalloped shader edges.'
);
assert(
  boughs.every((bough) => bough.material.userData.snowpineSnowShader === true),
  'snow pine bough snow should be applied through a material shader hook.'
);
assert(
  boughs.every((bough) => bough.material.flatShading === false),
  'snow pine boughs should use smooth shading so the tree does not look faceted.'
);

for (const bough of boughs) {
  const faceCount = bough.geometry.index.count / 3;
  const upperFaceCount = bough.geometry.userData.snowpineUpperFaceCount;
  assert(
    upperFaceCount > 0 && upperFaceCount < faceCount,
    'snow pine bough geometry should mark which faces are lit upper canopy versus underside.'
  );
  for (let face = 0; face < upperFaceCount; face++) {
    assert(
      faceNormalY(bough.geometry, face * 3) > 0,
      'snow pine upper and snow-band bough faces should wind upward so lighting does not go black.'
    );
  }
  for (let face = upperFaceCount; face < faceCount; face++) {
    assert(
      faceNormalY(bough.geometry, face * 3) < 0,
      'snow pine underside bough faces should wind downward.'
    );
  }
}
