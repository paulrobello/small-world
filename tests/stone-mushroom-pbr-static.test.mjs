import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const floraSource = readFileSync(new URL('../src/flora.js', import.meta.url), 'utf8');
const pbrSource = readFileSync(new URL('../src/pbr.js', import.meta.url), 'utf8');
const utilSource = readFileSync(new URL('../src/util.js', import.meta.url), 'utf8');

assert(
  pbrSource.includes('export function makeStonePBRMaterial')
    && pbrSource.includes('export function makeMushroomCapPBRMaterial'),
  'PBR helpers should expose stone and mushroom-cap material builders.'
);

assert(
  pbrSource.includes('buildStoneTextures')
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
  floraSource.includes('jitterGeo(new THREE.IcosahedronGeometry(r, 0), r * 0.3, { sphericalUvs: true })')
    && floraSource.includes('jitterGeo(new THREE.IcosahedronGeometry(r, 0), r * 0.25, { sphericalUvs: true })'),
  'Jittered rock geometry should restore spherical UVs so procedural PBR maps can render.'
);

assert(
  utilSource.includes('sphericalUvs = false')
    && utilSource.includes('welded.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2))'),
  'jitterGeo should support opt-in spherical UV restoration for procedural detail maps.'
);
