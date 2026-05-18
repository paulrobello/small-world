import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const floraSource = readFileSync(new URL('../src/flora.js', import.meta.url), 'utf8');
const pbrSource = readFileSync(new URL('../src/pbr.js', import.meta.url), 'utf8');
const utilSource = readFileSync(new URL('../src/util.js', import.meta.url), 'utf8');
const groveFamilyBlock = floraSource.slice(
  floraSource.indexOf('function addGroveMushroomFamily'),
  floraSource.indexOf('function addPillarSurfaceMarks')
);
const fairyRingBlock = floraSource.slice(
  floraSource.indexOf('fairyring(biome)'),
  floraSource.indexOf('berrybush(biome)')
);

assert(
  pbrSource.includes('export function makeStonePBRMaterial')
    && pbrSource.includes('export function makePlainRockPBRMaterial')
    && pbrSource.includes('export function makeMushroomCapPBRMaterial'),
  'PBR helpers should expose stone, plain-rock, and mushroom-cap material builders.'
);

assert(
  pbrSource.includes('buildStoneTextures')
    && pbrSource.includes('buildPlainRockTextures')
    && pbrSource.includes('rockDetailHeight')
    && pbrSource.includes('smoothHashNoise')
    && pbrSource.includes('buildMushroomCapTextures')
    && pbrSource.includes('stoneCrack')
    && pbrSource.includes('verticalScratch')
    && pbrSource.includes('deepStoneCut')
    && pbrSource.includes('capRidges'),
  'Stone and mushroom cap PBR helpers should generate procedural crack, pore, and cap-ridge maps.'
);

assert(
  floraSource.includes('makeStonePBRMaterial')
    && floraSource.includes('makeMushroomCapPBRMaterial')
    && floraSource.includes('addPillarSurfaceMarks'),
  'Flora builders should wire stone and mushroom caps through the PBR helpers.'
);

assert(
  pbrSource.includes('mushroomCapHeight')
    && pbrSource.includes('rimLobes')
    && pbrSource.includes('capFreckles')
    && pbrSource.includes('gillPleats'),
  'Mushroom cap PBR should add height-derived ridges, rim lobes, freckles, and pleat detail.'
);

assert(
  groveFamilyBlock.includes('makeMushroomCapPBRMaterial')
    && fairyRingBlock.includes('makeMushroomCapPBRMaterial'),
  'Grove baby mushrooms and fairy-ring caps should use the mushroom PBR material helper.'
);

assert(
  floraSource.includes('function makePlainRockGeometry')
    && floraSource.includes('new THREE.IcosahedronGeometry(radius, detail)')
    && floraSource.includes('makePlainRockGeometry(chipRadius, { shoulder: true })')
    && floraSource.includes('makePlainRockPBRMaterial')
    && floraSource.includes('flatShading: true')
    && floraSource.includes('jitterGeo(new THREE.IcosahedronGeometry(r, 0), r * 0.25, { sphericalUvs: true })'),
  'Plain rock makeover and limestone geometry should restore spherical UVs so procedural PBR maps can render.'
);

assert(
  utilSource.includes('sphericalUvs = false')
    && utilSource.includes('welded.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))'),
  'jitterGeo should support opt-in spherical UV restoration for procedural detail maps.'
);
