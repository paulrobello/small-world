import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const terrainSource = readFileSync(new URL('../src/terrain.js', import.meta.url), 'utf8');
const pbrSource = readFileSync(new URL('../src/pbr.js', import.meta.url), 'utf8');
const stateSource = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8');

assert(
  terrainSource.includes('makeTerrainPBRMaterial(biome, heightFn)'),
  'terrain should build its material through the terrain PBR helper so detail maps stay centralized.'
);

assert(
  pbrSource.includes('new THREE.MeshPhysicalMaterial'),
  'terrain PBR helper should use MeshPhysicalMaterial for non-metal reflectivity and specular intensity maps.'
);

assert(
  pbrSource.includes('new THREE.CanvasTexture(normalCanvas)')
    && pbrSource.includes('new THREE.CanvasTexture(materialCanvas)'),
  'terrain PBR helper should procedurally generate normal and packed material CanvasTextures.'
);

assert(
  pbrSource.includes('material.normalMapType = THREE.ObjectSpaceNormalMap'),
  'terrain normal detail should use object-space normals to avoid requiring terrain tangents.'
);

assert(
  pbrSource.includes('material.roughnessMap = materialTexture')
    && pbrSource.includes('material.specularIntensityMap = materialTexture'),
  'terrain should pack roughness and specular intensity into one material texture.'
);

assert(
  pbrSource.includes('LOWFX') && pbrSource.includes('state.userSettings.pbrDetails === false'),
  'terrain PBR details should be skipped for low-FX mode or when the user setting disables them.'
);

assert(
  pbrSource.includes('THREE.NoColorSpace'),
  'procedural PBR data textures should be sampled as data, not color-managed albedo.'
);

assert(
  stateSource.includes('normalMap')
    && stateSource.includes('roughnessMap')
    && stateSource.includes('specularIntensityMap')
    && stateSource.includes('texture.dispose()'),
  'disposeGroup should dispose material-owned PBR textures on world regen.'
);
