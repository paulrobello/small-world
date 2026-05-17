import * as THREE from "three";
import { state } from "./state.js";
import { LOWFX } from "./lowfx.js";

const TERRAIN_PBR_TEX_SIZE = 384;
const LEAFBALL_BARK_TEX_SIZE = 256;
const LEAFBALL_LEAF_TEX_SIZE = 128;
const STONE_PBR_TEX_SIZE = 128;
const PLAIN_ROCK_PBR_TEX_SIZE = 128;
const MUSHROOM_CAP_TEX_SIZE = 128;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function hashNoise(x, z, seed) {
  const n = Math.sin(x * 12.9898 + z * 78.233 + seed * 0.071) * 43758.5453;
  return n - Math.floor(n);
}

function smoothHashNoise(x, z, seed) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hashNoise(ix, iz, seed);
  const b = hashNoise(ix + 1, iz, seed);
  const c = hashNoise(ix, iz + 1, seed);
  const d = hashNoise(ix + 1, iz + 1, seed);
  return (a + (b - a) * sx) + (c + (d - c) * sx - (a + (b - a) * sx)) * sz;
}

function detailNoise(x, z, seed) {
  return (
    Math.sin(x * 1.7 + seed * 0.013) * 0.38 +
    Math.sin(z * 2.1 - seed * 0.019) * 0.28 +
    Math.sin((x + z) * 3.6 + seed * 0.031) * 0.19 +
    (hashNoise(Math.floor(x * 2.4), Math.floor(z * 2.4), seed) - 0.5) * 0.30
  );
}

function sampleDetailHeight(heightFn, biome, x, z) {
  const detailStrength = biome.cloudlike ? 0.10 : 0.28;
  return heightFn(x, z) + detailNoise(x, z, state.currentSeed) * detailStrength;
}

function configurePBRTexture(texture) {
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function buildTerrainPBRTextures(biome, heightFn) {
  const size = TERRAIN_PBR_TEX_SIZE;
  const normalCanvas = makeCanvas(size);
  const materialCanvas = makeCanvas(size);
  const normalCtx = normalCanvas.getContext("2d");
  const materialCtx = materialCanvas.getContext("2d");
  const normalImage = normalCtx.createImageData(size, size);
  const materialImage = materialCtx.createImageData(size, size);
  const worldSize = state.ISLAND_SIZE;
  const texelWorld = worldSize / size;
  const normalStrength = biome.cloudlike ? 0.55 : 0.82;

  for (let py = 0; py < size; py++) {
    const z = (py / (size - 1) - 0.5) * worldSize;
    for (let px = 0; px < size; px++) {
      const x = (px / (size - 1) - 0.5) * worldSize;
      const hL = sampleDetailHeight(heightFn, biome, x - texelWorld, z);
      const hR = sampleDetailHeight(heightFn, biome, x + texelWorld, z);
      const hD = sampleDetailHeight(heightFn, biome, x, z - texelWorld);
      const hU = sampleDetailHeight(heightFn, biome, x, z + texelWorld);
      const dX = (hR - hL) / (texelWorld * 2);
      const dZ = (hU - hD) / (texelWorld * 2);
      const normal = new THREE.Vector3(-dX * normalStrength, 1, -dZ * normalStrength).normalize();
      const slope = clamp01((Math.abs(dX) + Math.abs(dZ)) * 0.45);
      const grain = clamp01(detailNoise(x * 1.8, z * 1.8, state.currentSeed + 97) * 0.5 + 0.5);
      const flatGlint = (1 - slope) * grain;
      const roughness = biome.cloudlike
        ? 0.82 + grain * 0.10
        : 0.70 + slope * 0.22 + (1 - grain) * 0.07;
      const specular = biome.cloudlike
        ? 0.04 + flatGlint * 0.07
        : 0.07 + flatGlint * 0.25;
      const index = (py * size + px) * 4;

      normalImage.data[index + 0] = Math.round((normal.x * 0.5 + 0.5) * 255);
      normalImage.data[index + 1] = Math.round((normal.y * 0.5 + 0.5) * 255);
      normalImage.data[index + 2] = Math.round((normal.z * 0.5 + 0.5) * 255);
      normalImage.data[index + 3] = 255;

      materialImage.data[index + 0] = Math.round(clamp01(roughness) * 255);
      materialImage.data[index + 1] = Math.round(clamp01(roughness) * 255);
      materialImage.data[index + 2] = 0;
      materialImage.data[index + 3] = Math.round(clamp01(specular) * 255);
    }
  }

  normalCtx.putImageData(normalImage, 0, 0);
  materialCtx.putImageData(materialImage, 0, 0);

  return {
    normalCanvas,
    materialCanvas,
    normalTexture: configurePBRTexture(new THREE.CanvasTexture(normalCanvas)),
    materialTexture: configurePBRTexture(new THREE.CanvasTexture(materialCanvas)),
  };
}

function buildLeafballBarkTextures() {
  const size = LEAFBALL_BARK_TEX_SIZE;
  const barkNormalCanvas = makeCanvas(size);
  const barkMaterialCanvas = makeCanvas(size);
  const normalCtx = barkNormalCanvas.getContext("2d");
  const materialCtx = barkMaterialCanvas.getContext("2d");
  const normalImage = normalCtx.createImageData(size, size);
  const materialImage = materialCtx.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    const v = py / (size - 1);
    for (let px = 0; px < size; px++) {
      const u = px / (size - 1);
      const fineBarkGrain =
        Math.sin(u * Math.PI * 92 + v * 17.0) * 0.18 +
        Math.sin(u * Math.PI * 137 - v * 23.0) * 0.10 +
        (hashNoise(px * 2, py * 3, state.currentSeed + 719) - 0.5) * 0.20;
      const barkRidge =
        Math.sin(u * Math.PI * 26 + Math.sin(v * Math.PI * 12) * 0.65) * 0.46 +
        Math.sin(u * Math.PI * 61 + v * 9.0) * 0.24 +
        fineBarkGrain;
      const ring = 0.5 + 0.5 * Math.sin(v * Math.PI * 14);
      const ridge = clamp01(barkRidge * 0.5 + 0.5);
      const nx = (ridge - 0.5) * 0.62;
      const ny = (ring - 0.5) * 0.12 + fineBarkGrain * 0.10;
      const nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
      const roughness = 0.74 + ridge * 0.17 + ring * 0.04;
      const specular = 0.08 + (1 - ridge) * 0.13;
      const index = (py * size + px) * 4;

      normalImage.data[index + 0] = Math.round((nx * 0.5 + 0.5) * 255);
      normalImage.data[index + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalImage.data[index + 2] = Math.round(nz * 255);
      normalImage.data[index + 3] = 255;

      materialImage.data[index + 0] = Math.round(clamp01(roughness) * 255);
      materialImage.data[index + 1] = Math.round(clamp01(roughness) * 255);
      materialImage.data[index + 2] = 0;
      materialImage.data[index + 3] = Math.round(clamp01(specular) * 255);
    }
  }
  normalCtx.putImageData(normalImage, 0, 0);
  materialCtx.putImageData(materialImage, 0, 0);
  return {
    normalTexture: configurePBRTexture(new THREE.CanvasTexture(barkNormalCanvas)),
    materialTexture: configurePBRTexture(new THREE.CanvasTexture(barkMaterialCanvas)),
  };
}

function buildLeafballLeafTextures() {
  const size = LEAFBALL_LEAF_TEX_SIZE;
  const leafNormalCanvas = makeCanvas(size);
  const leafMaterialCanvas = makeCanvas(size);
  const normalCtx = leafNormalCanvas.getContext("2d");
  const materialCtx = leafMaterialCanvas.getContext("2d");
  const normalImage = normalCtx.createImageData(size, size);
  const materialImage = materialCtx.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    const v = py / (size - 1);
    for (let px = 0; px < size; px++) {
      const u = px / (size - 1);
      const side = u * 2 - 1;
      const edgeFalloff = Math.sin(Math.PI * v) * (1 - Math.abs(side) * 0.58);
      const leafVein = Math.max(0, 1 - Math.abs(side) * 16) * edgeFalloff;
      const ribEmboss = Math.max(0, Math.sin(v * Math.PI * 11)) * 0.28 * edgeFalloff;
      const secondaryVeins =
        Math.max(0, Math.sin((v * 10.5 + Math.abs(side) * 2.7) * Math.PI)) *
        Math.max(0, 1 - Math.abs(side) * 1.25) *
        edgeFalloff *
        0.18;
      const noise = hashNoise(px, py, state.currentSeed + 503) - 0.5;
      const veinLift = leafVein + secondaryVeins;
      const nx = -side * (0.14 + ribEmboss * 0.32 + secondaryVeins * 0.20) + noise * 0.030;
      const ny = leafVein * 0.34 + secondaryVeins * 0.22 - ribEmboss * 0.18;
      const nz = Math.sqrt(Math.max(0.08, 1 - nx * nx - ny * ny));
      const wax = leafVein * 0.30 + secondaryVeins * 0.20 + edgeFalloff * 0.13;
      const roughness = 0.62 + (1 - edgeFalloff) * 0.16 - veinLift * 0.12;
      const leafSpecular = 0.12 + wax;
      const index = (py * size + px) * 4;

      normalImage.data[index + 0] = Math.round((nx * 0.5 + 0.5) * 255);
      normalImage.data[index + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalImage.data[index + 2] = Math.round(nz * 255);
      normalImage.data[index + 3] = 255;

      materialImage.data[index + 0] = Math.round(clamp01(roughness) * 255);
      materialImage.data[index + 1] = Math.round(clamp01(roughness) * 255);
      materialImage.data[index + 2] = 0;
      materialImage.data[index + 3] = Math.round(clamp01(leafSpecular) * 255);
    }
  }
  normalCtx.putImageData(normalImage, 0, 0);
  materialCtx.putImageData(materialImage, 0, 0);
  return {
    normalTexture: configurePBRTexture(new THREE.CanvasTexture(leafNormalCanvas)),
    materialTexture: configurePBRTexture(new THREE.CanvasTexture(leafMaterialCanvas)),
  };
}

function buildStoneTextures() {
  const size = STONE_PBR_TEX_SIZE;
  const stoneNormalCanvas = makeCanvas(size);
  const stoneMaterialCanvas = makeCanvas(size);
  const normalCtx = stoneNormalCanvas.getContext("2d");
  const materialCtx = stoneMaterialCanvas.getContext("2d");
  const normalImage = normalCtx.createImageData(size, size);
  const materialImage = materialCtx.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    const v = py / (size - 1);
    for (let px = 0; px < size; px++) {
      const u = px / (size - 1);
      const cellNoise = hashNoise(Math.floor(px / 8), Math.floor(py / 8), state.currentSeed + 947);
      const grain =
        Math.sin((u * 17.0 + v * 5.0) * Math.PI + cellNoise * 2.1) * 0.20 +
        Math.sin((u * 41.0 - v * 19.0) * Math.PI) * 0.10 +
        (hashNoise(px, py, state.currentSeed + 991) - 0.5) * 0.24;
      const stoneCrack =
        Math.max(0, 1 - Math.abs(Math.sin((u * 3.2 + v * 4.6 + cellNoise) * Math.PI)) * 11) *
        (0.45 + hashNoise(px * 2, py, state.currentSeed + 1009) * 0.55);
      const verticalScratch =
        Math.max(0, 1 - Math.abs(Math.sin((u * 34.0 + cellNoise * 0.35) * Math.PI)) * 15) *
        Math.max(0, 0.75 - hashNoise(px, Math.floor(py / 9), state.currentSeed + 1017)) *
        0.95;
      const hairlineScratch =
        Math.max(0, 1 - Math.abs(Math.sin((u * 71.0 - v * 9.0) * Math.PI)) * 24) *
        (0.28 + hashNoise(px * 5, py * 2, state.currentSeed + 1023) * 0.72);
      const pitted = Math.max(0, 0.62 - hashNoise(px * 3, py * 5, state.currentSeed + 1031)) * 0.34;
      const deepStoneCut = stoneCrack + verticalScratch * 0.72 + hairlineScratch * 0.36;
      const nx = grain * 0.36 - stoneCrack * 0.42 - verticalScratch * 0.34 + pitted * 0.12;
      const ny = grain * -0.24 + stoneCrack * 0.30 - hairlineScratch * 0.20 - pitted * 0.18;
      const nz = Math.sqrt(Math.max(0.08, 1 - nx * nx - ny * ny));
      const roughness = 0.82 + pitted * 0.30 + deepStoneCut * 0.12;
      const specular = 0.08 + Math.max(0, grain) * 0.08 - deepStoneCut * 0.04;
      const index = (py * size + px) * 4;

      normalImage.data[index + 0] = Math.round((nx * 0.5 + 0.5) * 255);
      normalImage.data[index + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalImage.data[index + 2] = Math.round(nz * 255);
      normalImage.data[index + 3] = 255;

      materialImage.data[index + 0] = Math.round(clamp01(roughness) * 255);
      materialImage.data[index + 1] = Math.round(clamp01(roughness) * 255);
      materialImage.data[index + 2] = 0;
      materialImage.data[index + 3] = Math.round(clamp01(specular) * 255);
    }
  }
  normalCtx.putImageData(normalImage, 0, 0);
  materialCtx.putImageData(materialImage, 0, 0);
  return {
    normalTexture: configurePBRTexture(new THREE.CanvasTexture(stoneNormalCanvas)),
    materialTexture: configurePBRTexture(new THREE.CanvasTexture(stoneMaterialCanvas)),
  };
}

function rockDetailHeight(u, v, seed) {
  const warpA = smoothHashNoise(u * 3.4, v * 3.1, seed + 1421) - 0.5;
  const warpB = smoothHashNoise(u * 4.7, v * 4.2, seed + 1453) - 0.5;
  const wu = u + warpA * 0.08;
  const wv = v + warpB * 0.08;
  const broadMottle = smoothHashNoise(wu * 5.8, wv * 5.1, seed + 1481);
  const fineMottle = smoothHashNoise(wu * 17.0, wv * 15.0, seed + 1499);
  const poreNoise = smoothHashNoise(wu * 36.0, wv * 34.0, seed + 1511);
  const crackField = smoothHashNoise(wu * 4.6 + fineMottle * 0.52, wv * 4.1 - broadMottle * 0.45, seed + 1531);
  const crackMask = smoothHashNoise(wu * 8.3, wv * 7.7, seed + 1543);
  const irregularCracks = Math.max(0, 1 - Math.abs(crackField - 0.52) * 25) * Math.max(0, crackMask - 0.47);
  const pits = Math.max(0, 0.56 - poreNoise) * 0.42;
  return (broadMottle - 0.5) * 0.30 + (fineMottle - 0.5) * 0.13 - pits - irregularCracks * 0.55;
}

function buildPlainRockTextures() {
  const size = PLAIN_ROCK_PBR_TEX_SIZE;
  const rockNormalCanvas = makeCanvas(size);
  const rockMaterialCanvas = makeCanvas(size);
  const normalCtx = rockNormalCanvas.getContext("2d");
  const materialCtx = rockMaterialCanvas.getContext("2d");
  const normalImage = normalCtx.createImageData(size, size);
  const materialImage = materialCtx.createImageData(size, size);
  const seed = state.currentSeed + 1409;

  for (let py = 0; py < size; py++) {
    const v = py / (size - 1);
    for (let px = 0; px < size; px++) {
      const u = px / (size - 1);
      const step = 1 / size;
      const hL = rockDetailHeight(Math.max(0, u - step), v, seed);
      const hR = rockDetailHeight(Math.min(1, u + step), v, seed);
      const hD = rockDetailHeight(u, Math.max(0, v - step), seed);
      const hU = rockDetailHeight(u, Math.min(1, v + step), seed);
      const h = rockDetailHeight(u, v, seed);
      const pore = Math.max(0, -h);
      const nx = (hL - hR) * 0.86;
      const ny = (hD - hU) * 0.86;
      const nz = Math.sqrt(Math.max(0.12, 1 - nx * nx - ny * ny));
      const roughness = 0.84 + pore * 0.16 + smoothHashNoise(u * 19.0, v * 17.0, seed + 61) * 0.05;
      const specular = 0.07 + Math.max(0, h) * 0.06;
      const index = (py * size + px) * 4;

      normalImage.data[index + 0] = Math.round((nx * 0.5 + 0.5) * 255);
      normalImage.data[index + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalImage.data[index + 2] = Math.round(nz * 255);
      normalImage.data[index + 3] = 255;

      materialImage.data[index + 0] = Math.round(clamp01(roughness) * 255);
      materialImage.data[index + 1] = Math.round(clamp01(roughness) * 255);
      materialImage.data[index + 2] = 0;
      materialImage.data[index + 3] = Math.round(clamp01(specular) * 255);
    }
  }
  normalCtx.putImageData(normalImage, 0, 0);
  materialCtx.putImageData(materialImage, 0, 0);
  return {
    normalTexture: configurePBRTexture(new THREE.CanvasTexture(rockNormalCanvas)),
    materialTexture: configurePBRTexture(new THREE.CanvasTexture(rockMaterialCanvas)),
  };
}

function buildMushroomCapTextures() {
  const size = MUSHROOM_CAP_TEX_SIZE;
  const capNormalCanvas = makeCanvas(size);
  const capMaterialCanvas = makeCanvas(size);
  const normalCtx = capNormalCanvas.getContext("2d");
  const materialCtx = capMaterialCanvas.getContext("2d");
  const normalImage = normalCtx.createImageData(size, size);
  const materialImage = materialCtx.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    const v = py / (size - 1);
    for (let px = 0; px < size; px++) {
      const u = px / (size - 1);
      const dx = u - 0.5;
      const dy = v - 0.5;
      const radius = Math.sqrt(dx * dx + dy * dy) * 2;
      const angle = Math.atan2(dy, dx);
      const capBody = clamp01(1 - radius);
      const capRidges = Math.max(0, Math.sin(angle * 18 + radius * 8.0)) * capBody;
      const pores = Math.max(0, 0.58 - hashNoise(px * 4, py * 4, state.currentSeed + 1171)) * capBody;
      const dampSpeckle = hashNoise(px, py, state.currentSeed + 1193) * capBody;
      const nx = Math.cos(angle) * (capRidges * 0.12 + pores * 0.10) + (dampSpeckle - 0.5) * 0.045;
      const ny = Math.sin(angle) * (capRidges * 0.12 + pores * 0.10) + (dampSpeckle - 0.5) * 0.045;
      const nz = Math.sqrt(Math.max(0.10, 1 - nx * nx - ny * ny));
      const roughness = 0.58 + pores * 0.18 + radius * 0.10 - dampSpeckle * 0.08;
      const specular = 0.14 + dampSpeckle * 0.20 + capRidges * 0.08;
      const index = (py * size + px) * 4;

      normalImage.data[index + 0] = Math.round((nx * 0.5 + 0.5) * 255);
      normalImage.data[index + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalImage.data[index + 2] = Math.round(nz * 255);
      normalImage.data[index + 3] = 255;

      materialImage.data[index + 0] = Math.round(clamp01(roughness) * 255);
      materialImage.data[index + 1] = Math.round(clamp01(roughness) * 255);
      materialImage.data[index + 2] = 0;
      materialImage.data[index + 3] = Math.round(clamp01(specular) * 255);
    }
  }
  normalCtx.putImageData(normalImage, 0, 0);
  materialCtx.putImageData(materialImage, 0, 0);
  return {
    normalTexture: configurePBRTexture(new THREE.CanvasTexture(capNormalCanvas)),
    materialTexture: configurePBRTexture(new THREE.CanvasTexture(capMaterialCanvas)),
  };
}

function applyDetailMaps(material, normalTexture, materialTexture) {
  material.normalMap = normalTexture;
  material.roughnessMap = materialTexture;
  material.specularIntensityMap = materialTexture;
  material.userData.pbrDetailTextures = [normalTexture, materialTexture];
  return material;
}

function baseTerrainMaterialParams(biome) {
  const cloudlike = !!biome.cloudlike;
  return {
    vertexColors: true,
    flatShading: !cloudlike,
    roughness: cloudlike ? 0.82 : 0.96,
    metalness: 0,
    emissive: cloudlike ? new THREE.Color(biome.fog).lerp(new THREE.Color(0xffffff), 0.35) : 0x000000,
    emissiveIntensity: cloudlike ? 0.08 : 0,
  };
}

export function makeTerrainPBRMaterial(biome, heightFn) {
  const baseParams = baseTerrainMaterialParams(biome);
  if (LOWFX || state.userSettings.pbrDetails === false) {
    return new THREE.MeshStandardMaterial(baseParams);
  }

  const material = new THREE.MeshPhysicalMaterial({
    ...baseParams,
    reflectivity: biome.cloudlike ? 0.14 : 0.28,
    specularIntensity: biome.cloudlike ? 0.18 : 0.42,
    specularColor: new THREE.Color(biome.sun).lerp(new THREE.Color(0xffffff), 0.55),
  });
  const { normalTexture, materialTexture } = buildTerrainPBRTextures(biome, heightFn);
  material.normalMapType = THREE.ObjectSpaceNormalMap;
  return applyDetailMaps(material, normalTexture, materialTexture);
}

export function makeLeafballTreeTrunkPBRMaterial(params) {
  if (LOWFX || state.userSettings.pbrDetails === false) {
    return new THREE.MeshStandardMaterial(params);
  }
  const material = new THREE.MeshPhysicalMaterial({
    ...params,
    reflectivity: 0.20,
    specularIntensity: 0.46,
    specularColor: new THREE.Color(params.color).lerp(new THREE.Color(0xffffff), 0.38),
  });
  const { normalTexture, materialTexture } = buildLeafballBarkTextures();
  material.normalScale.set(0.90, 0.90);
  return applyDetailMaps(material, normalTexture, materialTexture);
}

export function makeLeafballTreeLeafPBRMaterial(params) {
  if (LOWFX || state.userSettings.pbrDetails === false) {
    return new THREE.MeshStandardMaterial(params);
  }
  const material = new THREE.MeshPhysicalMaterial({
    ...params,
    reflectivity: 0.22,
    specularIntensity: 0.58,
    specularColor: new THREE.Color(params.color).lerp(new THREE.Color(0xffffff), 0.38),
  });
  const { normalTexture, materialTexture } = buildLeafballLeafTextures();
  material.normalScale.set(0.72, 0.72);
  return applyDetailMaps(material, normalTexture, materialTexture);
}

export function makeStonePBRMaterial(params) {
  if (LOWFX || state.userSettings.pbrDetails === false) {
    return new THREE.MeshStandardMaterial(params);
  }
  const material = new THREE.MeshPhysicalMaterial({
    ...params,
    reflectivity: 0.14,
    specularIntensity: 0.30,
    specularColor: new THREE.Color(params.color).lerp(new THREE.Color(0xffffff), 0.20),
  });
  const { normalTexture, materialTexture } = buildStoneTextures();
  material.normalScale.set(0.74, 0.74);
  return applyDetailMaps(material, normalTexture, materialTexture);
}

export function makePlainRockPBRMaterial(params) {
  if (LOWFX || state.userSettings.pbrDetails === false) {
    return new THREE.MeshStandardMaterial(params);
  }
  const material = new THREE.MeshPhysicalMaterial({
    ...params,
    reflectivity: 0.12,
    specularIntensity: 0.24,
    specularColor: new THREE.Color(params.color).lerp(new THREE.Color(0xffffff), 0.18),
  });
  const { normalTexture, materialTexture } = buildPlainRockTextures();
  material.normalScale.set(0.42, 0.42);
  return applyDetailMaps(material, normalTexture, materialTexture);
}

export function makeMushroomCapPBRMaterial(params) {
  if (LOWFX || state.userSettings.pbrDetails === false) {
    return new THREE.MeshStandardMaterial(params);
  }
  const material = new THREE.MeshPhysicalMaterial({
    ...params,
    reflectivity: 0.22,
    specularIntensity: 0.50,
    specularColor: new THREE.Color(params.color).lerp(new THREE.Color(0xffffff), 0.36),
  });
  const { normalTexture, materialTexture } = buildMushroomCapTextures();
  material.normalScale.set(0.52, 0.52);
  return applyDetailMaps(material, normalTexture, materialTexture);
}
