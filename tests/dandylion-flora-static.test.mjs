import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BIOMES, FLOWER_DENSITY } from '../src/biomes.js';

const floraSource = readFileSync(new URL('../src/flora.js', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/world.js', import.meta.url), 'utf8');
const inspectSource = readFileSync(new URL('../src/inspect.js', import.meta.url), 'utf8');

assert(
  floraSource.includes('dandylion(biome)'),
  'Dandy lion should be registered as a named flora builder.'
);

for (const biome of BIOMES) {
  const flowerDensity = FLOWER_DENSITY[biome.id] ?? 100;
  if ((flowerDensity > 0 && biome.id !== 'ashen') || biome.id === 'cloud') {
    assert(
      biome.flora.includes('dandylion'),
      `${biome.id} should spawn dandy lions anywhere wildflowers are enabled, plus cloud island's hand-placed puff flowers.`
    );
  } else {
    assert(
      !biome.flora.includes('dandylion'),
      `${biome.id} should not spawn dandy lions where wildflowers are disabled.`
    );
  }
}

const builderStart = floraSource.indexOf('dandylion(biome)');
const builderEnd = floraSource.indexOf('cactus()', builderStart);
const builderBlock = floraSource.slice(builderStart, builderEnd);

assert(builderStart >= 0 && builderEnd > builderStart, 'Dandy lion builder should live before cactus flora.');
assert(
  builderBlock.includes('DANDYLION_STEM_H = 0.92')
    && builderBlock.includes('buildLeafGeo')
    && builderBlock.includes('baseLeafCount')
    && builderBlock.includes('applyWindSway')
    && builderBlock.includes('flowerSpotY')
    && builderBlock.includes('sporeCount = 288'),
  'Dandy lion should have a long wind-swaying stem, broad leaves, and a dense procedural fuzz ball.'
);

assert(
  builderBlock.includes('dandylion.fuzz.line.mat')
    && builderBlock.includes('dandylion.spore.point.mat')
    && builderBlock.includes('new THREE.ShaderMaterial')
    && builderBlock.includes('new THREE.LineSegments(lineGeo, lineMat)')
    && builderBlock.includes('new THREE.Points(sporeGeo, sporeMat)')
    && builderBlock.includes('uFoliageWind: state.windUniforms.uFoliageWind')
    && builderBlock.includes('const fuzzInnerRadius = 0.050')
    && builderBlock.includes('sporeSizes[i] = 4.2 + Math.random() * 4.2')
    && builderBlock.includes('gl_PointSize = aSize;')
    && builderBlock.includes('uOpacity: { value: glow ? 0.46 : 0.34 }')
    && builderBlock.includes('uOpacity: { value: glow ? 0.58 : 0.44 }')
    && builderBlock.match(/transparent: true/g)?.length >= 2
    && !builderBlock.includes('new THREE.InstancedMesh(puffGeo, puffMat')
    && !builderBlock.includes('new THREE.IcosahedronGeometry(0.018'),
  'Dandy lion fuzz should use shader lines and point spores, not instanced mesh geometry.'
);

assert(
  builderBlock.includes('vec4 wp = modelMatrix * vec4(vec3(0.0, uDandylionHeadY, 0.0), 1.0)')
    && builderBlock.includes('float windY = uDandylionHeadY')
    && builderBlock.includes('float w1 = sin(uTime * 1.4 + wp.x * 0.30 + wp.z * 0.40)')
    && builderBlock.includes('float w2 = sin(uTime * 0.9 + wp.x * 0.15 - wp.z * 0.25)')
    && builderBlock.includes('vec2 windWorld = vec2(w1 * windAmp * 0.06, w2 * windAmp * 0.05)')
    && builderBlock.includes('p.xz += dandylionHeadWindOffset()')
    && !builderBlock.includes('float windY = max(p.y, 0.0)')
    && !builderBlock.includes('aSeed * 16.0 + p.z * 8.0'),
  'Dandy lion fuzz shader should use one rigid seed-head wind displacement so the spore sphere does not distort.'
);

assert(
  builderBlock.includes('function dandylionStemOffset(t)')
    && builderBlock.includes('const baseLeafCount = 5')
    && builderBlock.includes('const leafHeightStart = 0.20')
    && builderBlock.includes('const leafHeightGap = 0.18 / Math.max(1, baseLeafCount - 1)')
    && builderBlock.includes('const attachT = leafHeightStart + i * leafHeightGap + Math.random() * 0.012')
    && builderBlock.includes('const attachPos = dandylionStemOffset(attachT)')
    && builderBlock.includes('leaf.position.copy(attachPos)'),
  'Dandy lion should use exactly five leaves with visible vertical spacing, starting 20% of the stem length from the bottom.'
);

assert(
  builderBlock.includes('const leafPitchVariation = (Math.random() - 0.5) * 0.34')
    && builderBlock.includes('const leafYawVariation = (Math.random() - 0.5) * 0.18')
    && builderBlock.includes('const leafRollVariation = (Math.random() - 0.5) * 0.28')
    && builderBlock.includes('leaf.rotateX(leafPitchVariation)')
    && builderBlock.includes('leaf.rotateY(leafYawVariation)')
    && builderBlock.includes('leaf.rotateZ(leafRollVariation)'),
  'Dandy lion leaves should vary in pitch, yaw, and roll.'
);

assert(
  builderBlock.includes('const dandyPalette = getDandylionFloraPalette(biome)')
    && builderBlock.includes('color: dandyPalette.stem')
    && builderBlock.includes('color: dandyPalette.leaf')
    && !builderBlock.includes('new THREE.Color("#4f7d2b")')
    && !builderBlock.includes('new THREE.Color("#5b8f33")'),
  'Dandy lion stem and leaves should adopt the biome flora palette instead of fixed green colors.'
);

assert(
  builderBlock.includes('dandylion.stem.mat.smooth')
    && floraSource.includes('function applyDandylionHeadWind(material')
    && builderBlock.includes('applyDandylionHeadWind(')
    && builderBlock.includes('new THREE.MeshStandardMaterial({ color: dandyPalette.stem, flatShading: false')
    && builderBlock.includes('dandylion.core.mat.smooth')
    && builderBlock.includes('flatShading: false'),
  'Dandy lion stem and center ball should use smooth-shaded materials, with the center ball moving rigidly at the stem top.'
);

assert(
  worldSource.includes('kind === "berrybush" || kind === "dandylion"')
    && worldSource.includes('f.userData.flowerSpotY'),
  'Dandy lion heads should be available as flower spots for fliers.'
);

assert(
  inspectSource.includes('"dandylion"'),
  'Inspect flora catalog should expose the dandy lion specimen.'
);
