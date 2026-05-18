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
    && pbrSource.includes('export function makeMushroomCapPBRMaterial')
    && pbrSource.includes('export function makeMushroomUndersideMaterial')
    && pbrSource.includes('export function resetPBRTextureCache'),
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
  pbrSource.includes('const _detailTextureCache = new Map()')
    && pbrSource.includes('function cachedDetailTextures')
    && pbrSource.includes('cachedDetailTextures("mushroom-cap", buildMushroomCapTextures)')
    && pbrSource.includes('cachedDetailTextures(\n    "mushroom-underside",')
    && pbrSource.includes('cachedDetailTextures("stone", buildStoneTextures)')
    && pbrSource.includes('cachedDetailTextures("plain-rock", buildPlainRockTextures)'),
  'Repeated PBR material calls in one world should reuse procedural texture sets instead of rebuilding canvases.'
);

assert(
  floraSource.includes('makeStonePBRMaterial')
    && floraSource.includes('makeMushroomCapPBRMaterial')
    && floraSource.includes('makeMushroomUndersideMaterial')
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
  pbrSource.includes('MUSHROOM_CAP_DETAIL_BOOST')
    && pbrSource.includes('material.normalScale.set(1.22, 1.22)')
    && pbrSource.includes('specularIntensity: 0.70')
    && pbrSource.includes('capColorCanvas')
    && pbrSource.includes('softCapMottle')
    && pbrSource.includes('material.map = colorTexture'),
  'Mushroom cap PBR should be strong enough for top texture to read under inspect lighting.'
);

assert(
  pbrSource.includes('emissiveIntensity: 0.24')
    && pbrSource.includes('side: THREE.FrontSide')
    && pbrSource.includes('buildMushroomUndersideTextures')
    && pbrSource.includes('undersideGills')
    && pbrSource.includes('UNDERSIDE_GILL_BANDS')
    && pbrSource.includes('UNDERSIDE_GILL_LINE_WIDTH')
    && pbrSource.includes('UNDERSIDE_GILL_CONTRAST')
    && pbrSource.includes('thinGillLines')
    && pbrSource.includes('gillLineDistance')
    && pbrSource.includes('gillInk')
    && pbrSource.includes('addProceduralMushroomGillTint')
    && pbrSource.includes('material.emissiveMap = colorTexture')
    && pbrSource.includes('undersideColorCanvas')
    && pbrSource.includes('material.normalScale.set(1.72, 1.72)')
    && floraSource.includes('grove.babyMushroom.underside.geo')
    && floraSource.includes('fairyring.underside.geo')
    && floraSource.includes('mushroom.underside.mat.lit')
    && floraSource.includes('bigmushroom.underside.mat.lit')
    && floraSource.includes('function makeMushroomUndersideGeometry')
    && floraSource.includes('rimOverlap = 1.004')
    && floraSource.includes('yOffset = -0.001')
    && floraSource.includes('innerRimInset = 0.965')
    && floraSource.includes('bevelDrop = 0.008')
    && floraSource.includes('const outerStart = positions.length / 3')
    && floraSource.includes('makeMushroomUndersideGeometry(0.8, 0.8, stemH, 12)')
    && floraSource.includes('normals.push(0, -1, 0)')
    && floraSource.includes('uvs.push(0.5 + x / (rimRadiusX * 2), 0.5 + z / (rimRadiusZ * 2))'),
  'Mushroom undersides should use a dedicated lit PBR material instead of rendering black.'
);

assert(
  floraSource.includes('function makeMushroomStemGeometry')
    && floraSource.includes('const sCurve')
    && floraSource.includes('const bulbBase')
    && floraSource.includes('const verticalRidge')
    && floraSource.includes('makeMushroomStemGeometry(0.35')
    && floraSource.includes('makeMushroomStemGeometry(stemH')
    && floraSource.includes('new THREE.SphereGeometry(spotRadius, 20, 12)'),
  'Small and large mushrooms should use an S-curved stem geometry with a wider bulb base.'
);

assert(
  pbrSource.includes('material.normalMap = normalTexture')
    && pbrSource.includes('material.roughnessMap = materialTexture')
    && !floraSource.includes('function makeMushroomGillGeometry')
    && !floraSource.includes('mushroom.gills.geo')
    && !floraSource.includes('bigmushroom.gills.geo'),
  'Mushroom underside fins should be represented as PBR gill grooves, not physical fin meshes.'
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
