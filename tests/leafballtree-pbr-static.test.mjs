import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// src/flora.js is now a registry. The leafballtree builder (sliced up to pine,
// both in trees.js) and the getLeafballTreePalette helper (sliced up to
// addGroveMushroomFamily, both in _shared.js) live in separate modules now;
// concatenate both so the slices resolve.
const floraSource = [
  readFileSync(new URL('../src/flora/_shared.js', import.meta.url), 'utf8'),
  readFileSync(new URL('../src/flora/trees.js', import.meta.url), 'utf8'),
].join('\n');
const pbrSource = readFileSync(new URL('../src/pbr.js', import.meta.url), 'utf8');
const leafballBlock = floraSource.slice(
  floraSource.indexOf('leafballtree(biome)'),
  floraSource.indexOf('pine(biome)')
);
const paletteBlock = floraSource.slice(
  floraSource.indexOf('function getLeafballTreePalette'),
  floraSource.indexOf('function addGroveMushroomFamily')
);

assert(
  floraSource.includes('makeLeafballTreeTrunkPBRMaterial')
    && floraSource.includes('makeLeafballTreeLeafPBRMaterial'),
  'leafballtree should build trunk and leaf materials through dedicated PBR helpers.'
);

assert(
  pbrSource.includes('export function makeLeafballTreeTrunkPBRMaterial')
    && pbrSource.includes('export function makeLeafballTreeLeafPBRMaterial'),
  'PBR helpers should expose leafballtree-specific trunk and leaf material builders.'
);

assert(
  pbrSource.includes('buildLeafballBarkTextures')
    && pbrSource.includes('buildLeafballLeafTextures'),
  'leafballtree PBR helpers should generate separate bark and leaf detail textures.'
);

assert(
  pbrSource.includes('new THREE.CanvasTexture(barkNormalCanvas)')
    && pbrSource.includes('new THREE.CanvasTexture(leafNormalCanvas)'),
  'leafballtree PBR textures should be generated procedurally from canvases.'
);

assert(
  pbrSource.includes('material.normalMap = normalTexture')
    && pbrSource.includes('material.roughnessMap = materialTexture')
    && pbrSource.includes('material.specularIntensityMap = materialTexture'),
  'leafballtree PBR materials should attach normal, roughness, and specular intensity maps.'
);

assert(
  pbrSource.includes('leafVein')
    && pbrSource.includes('barkRidge'),
  'leafballtree procedural maps should encode leaf veins and bark ridges for perceived detail.'
);

assert(
  pbrSource.includes('LOWFX') && pbrSource.includes('state.userSettings.pbrDetails === false'),
  'leafballtree PBR details should follow the same low-FX/user setting gate as terrain PBR.'
);

assert(
  leafballBlock.includes('flatShading: false'),
  'leafballtree trunk should be smooth-shaded so bark PBR detail is visible instead of faceted.'
);

assert(
  pbrSource.includes('specularIntensity: 0.46')
    && pbrSource.includes('material.normalScale.set(0.90, 0.90)'),
  'leafballtree bark PBR should be strong enough to read under inspect lighting.'
);

assert(
  paletteBlock.includes('getLeafballOutlineColor(leaves, trunk)')
    && !paletteBlock.includes('override.outline'),
  'leafballtree outlines should be derived from the active leaf/trunk palette instead of stale green overrides.'
);

assert(
  pbrSource.includes('const LEAFBALL_BARK_TEX_SIZE = 256')
    && pbrSource.includes('fineBarkGrain')
    && pbrSource.includes('Math.PI * 92'),
  'leafballtree bark PBR should use finer high-frequency bark grain.'
);

assert(
  pbrSource.includes('secondaryVeins')
    && pbrSource.includes('ribEmboss')
    && pbrSource.includes('leafSpecular'),
  'leafballtree leaves should add visible secondary veins, rib embossing, and waxy specular response.'
);

assert(
  pbrSource.includes('specularIntensity: 0.58')
    && pbrSource.includes('material.normalScale.set(0.72, 0.72)'),
  'leafballtree leaf PBR should be strong enough for veins and subtle highlights to read.'
);

assert(
  leafballBlock.includes('lengthSegs: 14')
    && leafballBlock.includes('widthSegs: 8')
    && leafballBlock.includes('centerRibLift')
    && leafballBlock.includes('secondaryRibLift'),
  'leafballtree leaves should have enough geometry and rib lift for veins to read beyond texture maps.'
);

assert(
  leafballBlock.includes('flatShading: false')
    && floraSource.includes('uLeafRibShade')
    && floraSource.includes('vLeafPlateUv'),
  'leafballtree leaves should use smooth shading plus shader-visible rib shading, not flat plates.'
);
