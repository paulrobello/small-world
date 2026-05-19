import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const environmentSource = readFileSync(new URL('../src/environment.js', import.meta.url), 'utf8');

assert(
  environmentSource.includes('new THREE.MeshPhysicalMaterial')
    && environmentSource.includes('specularIntensity: 0.62')
    && environmentSource.includes('clearcoat: 0.32'),
  'Water should use a physical material with visible specular/clearcoat response for PBR highlights.'
);

assert(
  environmentSource.includes('uWaterTurbulenceTime')
    && environmentSource.includes('uWaterTurbulenceStrength')
    && environmentSource.includes('mat.userData.waterTurbulenceUniforms = waterTurbulenceUniforms'),
  'Water shader turbulence uniforms should be stored on material userData so stepWater can animate them.'
);

assert(
  environmentSource.includes('varying vec3 vWaterWorldPosition;')
    && environmentSource.includes('float waterTurbulence(vec2 p) {')
    && environmentSource.includes('vec2 waterTurbulenceSlope(vec2 p) {'),
  'Water shader should derive turbulence from world-space position for stable PBR detail.'
);

assert(
  environmentSource.includes('#include <normal_fragment_begin>')
    && environmentSource.includes('vec2 waterSlope = waterTurbulenceSlope(vWaterWorldPosition.xz);')
    && environmentSource.includes('normal = normalize(transformDirection(waterWorldNormal, viewMatrix));'),
  'Water turbulence should perturb the lit normal so reflections and highlights break up across ripples.'
);

assert(
  environmentSource.includes('#include <roughnessmap_fragment>')
    && environmentSource.includes('roughnessFactor = clamp(roughnessFactor + waterRoughnessNoise * 0.14 * uWaterTurbulenceStrength, 0.08, 0.62);'),
  'Water turbulence should vary roughness in the PBR shader, not only move vertices.'
);

assert(
  environmentSource.includes('const waterTurbulenceUniforms = water.material.userData.waterTurbulenceUniforms;')
    && environmentSource.includes('waterTurbulenceUniforms.uWaterTurbulenceTime.value = t;'),
  'stepWater should advance the PBR turbulence time uniform each frame.'
);
