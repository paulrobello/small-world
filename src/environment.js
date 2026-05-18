import * as THREE from "three";
import { state, DENSITY_BASE } from "./state.js";
import { jitterGeo, applyWindSway } from "./util.js";
import { applyTerrainClip, pickGroundPoint, clipCenter } from "./terrain.js";
import {
  WILDFLOWER_PALETTES,
  FLOWER_DENSITY,
  PEBBLE_DENSITY,
  BEACHCOMB_DENSITY,
} from "./biomes.js";
import { LOWFX, LOWFX_DENSITY } from "./lowfx.js";
import { BLOOM_LAYER } from "./postfx.js";
import { WATER_AVOID_Y } from "./fauna/shared.js";

const _lowfxScale = (n) => (LOWFX ? Math.max(1, Math.round(n * LOWFX_DENSITY)) : n);

// Ground-cover counts were tuned against DENSITY_BASE; scale linearly with the
// current ISLAND_SIZE so larger worlds keep the same per-area density. The
// optional `gain` lets a specific layer be visually denser than the historical
// baseline (grass and wildflowers were tuned too sparse for the new size).
const _coverScale = (n, gain = 1) =>
  _lowfxScale(Math.round(n * (state.ISLAND_SIZE / DENSITY_BASE) * gain));

// ─── particles ───
const PARTICLE_KIND_ID = {
  pollen: 0, dust: 1, snow: 2, firefly: 3, ember: 4,
  lichenmote: 5, feather: 6, bubble: 7, leaf: 8, spark: 9, rain: 10,
  sand: 11, cinder: 12,
};

function cinderFissureLiftAt(x, z) {
  let lift = 0;
  for (const obstacle of state.obstacles) {
    if (obstacle.kind !== "lavafissure") continue;
    const dx = x - obstacle.x;
    const dz = z - obstacle.z;
    const radius = Math.max(0.35, (obstacle.r ?? 0.24) * 3.8);
    const influence = Math.max(0, 1 - Math.sqrt(dx * dx + dz * dz) / radius);
    lift = Math.max(lift, influence * influence * (3 - 2 * influence));
  }
  return lift;
}

const _particleVS = `
attribute float aSeed;
attribute float aLife;
varying float vLife;
varying float vSeed;
varying float vViewZ;
uniform float uTime;
uniform float uPixelRatio;
uniform float uBaseSize;
void main() {
  vLife = aLife;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewZ = -mv.z; // positive distance in front of camera, matches readViewDist in postfx.js
  float size = uBaseSize;
  #if PARTICLE_KIND == 11
    size *= (0.80 + 1.80 * fract(aSeed * 11.317)) * (0.82 + 0.18 * sin(aLife * 6.2831));
  #elif PARTICLE_KIND == 12
    size *= (0.45 + 1.35 * fract(aSeed * 17.173)) * (1.0 - aLife * 0.7);
  #elif PARTICLE_KIND == 4 || PARTICLE_KIND == 9
    size *= 1.0 - aLife * 0.7;
  #elif PARTICLE_KIND == 2
    size *= 0.7 + 0.3 * fract(aSeed);
  #endif
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uPixelRatio * (300.0 / max(0.001, -mv.z));
}
`;

// Soft-particles: sample the depth pre-pass texture and fade alpha when a
// particle is within a small view-Z window of the scene surface behind it,
// so embers/dust/rain don't slice through cliffs and creatures with a hard
// edge. uSoftParticles is a runtime 0/1 toggle (no shader recompile).
const _particleFS = `
precision highp float;
uniform vec3 uColor;
uniform vec3 uColor2;
uniform float uOpacity;
uniform float uTime;
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform float uCameraNear;
uniform float uCameraFar;
uniform float uSoftParticles;
varying float vLife;
varying float vSeed;
varying float vViewZ;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  #if PARTICLE_KIND == 10
    float a = smoothstep(0.5, 0.0, abs(c.x) * 2.0) * smoothstep(0.5, 0.0, abs(c.y));
  #elif PARTICLE_KIND == 11
    // broader low dune streaks: wide along wind, narrow vertically
    float a = smoothstep(0.5, 0.0, abs(c.x)) * smoothstep(0.5, 0.0, abs(c.y) * 2.0);
    a *= 0.72 + 0.28 * sin(vLife * 6.2831 + vSeed);
  #elif PARTICLE_KIND == 12
    // horizontal streak — stretched in x, tight in y
    float a = smoothstep(0.5, 0.0, abs(c.x)) * smoothstep(0.5, 0.0, abs(c.y) * 2.6);
    // gust pulse: vary alpha by life so individual grains breathe
    a *= 0.55 + 0.45 * sin(vLife * 6.2831);
  #else
    float a = smoothstep(0.5, 0.0, d);
  #endif
  vec3 col = uColor;
  #if PARTICLE_KIND == 11
    col = mix(uColor, uColor2, vLife * 0.45);
  #elif PARTICLE_KIND == 4 || PARTICLE_KIND == 9 || PARTICLE_KIND == 12
    col = mix(uColor, uColor2, vLife);
    a *= 1.0 - vLife;
  #elif PARTICLE_KIND == 3
    float pulse = 0.5 + 0.5 * sin(uTime * 2.0 + vSeed * 18.0);
    col *= 0.6 + 0.4 * pulse;
    a *= pulse;
  #elif PARTICLE_KIND == 5
    a *= 0.6 + 0.3 * sin(uTime * 1.4 + vSeed * 9.0);
  #endif
  if (uSoftParticles > 0.5) {
    float rawD = texture2D(tDepth, gl_FragCoord.xy / uResolution).x;
    float viewZ = (uCameraNear * uCameraFar) / ((uCameraFar - uCameraNear) * rawD - uCameraFar);
    float sceneDist = -viewZ;
    // Fade over a 1.2 world-unit window — gentle on dust/embers but firm
    // enough to hide intersections with cliffs and tree trunks.
    float soft = clamp((sceneDist - vViewZ) / 1.2, 0.0, 1.0);
    a *= soft;
  }
  gl_FragColor = vec4(col, a * uOpacity);
}
`;

const _sandParticleVS = `
attribute float aSeed;
attribute float aLife;
varying float vLife;
varying float vSeed;
uniform float uPixelRatio;
uniform float uBaseSize;
void main() {
  vLife = aLife;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uBaseSize * uPixelRatio * (300.0 / max(0.001, -mv.z));
}
`;

const _sandParticleFS = `
precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
varying float vLife;
varying float vSeed;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  if (length(c) > 0.34) discard;
  float a = 0.62 + 0.28 * fract(vSeed * 0.173 + vLife);
  gl_FragColor = vec4(uColor, a * uOpacity);
}
`;

export function makeParticles(biome) {
  const kind = biome.particle;
  const baseCount = {
    pollen: 240, dust: 320, snow: 500, firefly: 90, ember: 180,
    lichenmote: 140, feather: 120, bubble: 140, leaf: 120, spark: 240, rain: 520,
    sand: 3120, cinder: 260,
  }[kind] || 200;
  const count = _lowfxScale(baseCount);

  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const lifes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(Math.random()) * state.ISLAND_RADIUS * 1.1;
    const a = Math.random() * Math.PI * 2;
    positions[i * 3 + 0] = Math.cos(a) * r;
    // Sand/cinders hug the ground — sample low so grains read as wind-swept, not airborne.
    if (kind === "sand") {
      const groundY = state.heightFn ? state.heightFn(positions[i * 3 + 0], positions[i * 3 + 2]) : 0;
      positions[i * 3 + 1] = Math.max(0.05, groundY + 0.08) + Math.random() * 0.38;
    } else {
      positions[i * 3 + 1] = kind === "cinder" ? 0.1 + Math.random() * 5.6 : Math.random() * 14;
    }
    positions[i * 3 + 2] = Math.sin(a) * r;
    velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.4;
    velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    seeds[i] = Math.random() * 100;
    lifes[i] = Math.random();
  }

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const lifeAttr = new THREE.BufferAttribute(lifes, 1);
  // position + aLife are rewritten every frame in stepParticles — declare
  // streaming usage so the driver picks the right upload path immediately.
  posAttr.setUsage(THREE.DynamicDrawUsage);
  lifeAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute("aLife", lifeAttr);

  const colorMap = {
    pollen: biome.sun, dust: biome.fog, snow: "#ffffff",
    firefly: biome.accent, ember: biome.accent, lichenmote: biome.accent,
    feather: "#ffffff", bubble: biome.water || biome.sky,
    leaf: biome.accent, spark: biome.sun, rain: biome.sun,
    sand: "#d89a4f",
    cinder: biome.sun,
  };
  // Ember/spark/cinder fade toward a smokier secondary colour over life.
  const color2Map = {
    sand: "#edbd72", ember: "#3a2018", spark: "#fff2b3", cinder: "#4a2018",
  };
  const sizeMap = {
    firefly: 0.16,
    snow: 0.1,
    lichenmote: 0.12,
    feather: 0.18,
    bubble: 0.13,
    leaf: 0.16,
    spark: 0.08,
    rain: 0.06,
    pollen: 0.08,
    dust: 0.09,
    ember: 0.12,
    sand: 0.28,
    cinder: 0.95,
  };
  const opacityMap = {
    dust: 0.35, feather: 0.7, bubble: 0.55, leaf: 0.85, spark: 0.95, rain: 0.55,
    pollen: 0.85, snow: 0.85, firefly: 0.85, ember: 0.85, lichenmote: 0.85,
    sand: 0.58, cinder: 0.95,
  };
  const additive = new Set(["firefly", "ember", "lichenmote", "spark", "cinder"]);

  const renderer = state.renderer; // set by main.js after init
  const pixelRatio = renderer ? renderer.getPixelRatio() : 1;
  const camera = state.camera;
  // Soft particles require the depth pre-pass — null under LOWFX, in which
  // case uSoftParticles stays 0 and the shader skips the depth-fade branch.
  const softOn = kind !== "sand" && !!(state.depthTexture && state.userSettings.softParticles);
  const cinderBloomBoost = kind === "cinder" ? 3.2 : 1.0;

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uBaseSize: { value: sizeMap[kind] ?? 0.07 },
      uColor: { value: new THREE.Color(colorMap[kind]).multiplyScalar(cinderBloomBoost) },
      uColor2: { value: new THREE.Color(color2Map[kind] ?? colorMap[kind]).multiplyScalar(cinderBloomBoost) },
      uOpacity: { value: opacityMap[kind] ?? 0.85 },
      tDepth: { value: state.depthTexture },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uCameraNear: { value: camera ? camera.near : 0.1 },
      uCameraFar: { value: camera ? camera.far : 400.0 },
      uSoftParticles: { value: softOn ? 1.0 : 0.0 },
    },
    defines: { PARTICLE_KIND: PARTICLE_KIND_ID[kind] ?? 0 },
    vertexShader: kind === "sand" ? _sandParticleVS : _particleVS,
    fragmentShader: kind === "sand" ? _sandParticleFS : _particleFS,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: additive.has(kind) ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.userData = { kind, velocities, seeds, lifes, count };
  if (kind === "cinder") points.layers.enable(BLOOM_LAYER);
  return points;
}

export function stepParticles(points, dt, t) {
  if (!points) return;
  const { kind, seeds, lifes, count } = points.userData;
  const pos = points.geometry.attributes.position.array;

  for (let i = 0; i < count; i++) {
    const ix = i * 3;
    let x = pos[ix], y = pos[ix + 1], z = pos[ix + 2];
    const s = seeds[i];

    if (kind === "snow") {
      y -= (0.6 + (s % 1) * 0.6) * dt;
      x += Math.sin(t * 0.6 + s) * 0.1 * dt;
      z += Math.cos(t * 0.5 + s) * 0.1 * dt;
      if (y < -2) y = 14;
    } else if (kind === "ember") {
      y += (0.5 + (s % 1) * 0.5) * dt;
      x += Math.sin(t * 1.4 + s) * 0.2 * dt;
      z += Math.cos(t * 1.1 + s) * 0.2 * dt;
      if (y > 12) {
        y = 0;
        const r = Math.random() * state.ISLAND_RADIUS * 0.8;
        const a = Math.random() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
    } else if (kind === "firefly") {
      x += Math.sin(t * 0.7 + s * 1.7) * 0.5 * dt;
      y += Math.sin(t * 1.1 + s) * 0.25 * dt;
      z += Math.cos(t * 0.6 + s * 1.3) * 0.5 * dt;
      // keep in bounds
      const r = Math.sqrt(x * x + z * z);
      if (r > state.ISLAND_RADIUS) {
        x *= 0.95;
        z *= 0.95;
      }
      if (y < 0.5) y = 0.5 + Math.random();
      if (y > 6) y = 6;
    } else if (kind === "lichenmote") {
      // ground-hugging motes — drift slowly, occasionally rise then sink
      x += Math.sin(t * 0.5 + s * 1.3) * 0.25 * dt;
      y += Math.sin(t * 0.8 + s) * 0.15 * dt;
      z += Math.cos(t * 0.45 + s * 1.1) * 0.25 * dt;
      // keep them low — between 0.2 and 1.6
      if (y < 0.2) y = 0.2 + Math.random() * 0.2;
      if (y > 1.6) y = 1.6;
      const rr = Math.sqrt(x * x + z * z);
      if (rr > state.ISLAND_RADIUS) { x *= 0.95; z *= 0.95; }
    } else if (kind === "feather") {
      // slow downward drift with horizontal wobble — like a stray puff
      y -= (0.18 + (s % 1) * 0.12) * dt;
      x += Math.sin(t * 0.45 + s * 1.7) * 0.45 * dt;
      z += Math.cos(t * 0.35 + s * 1.3) * 0.45 * dt;
      if (y < -1) {
        y = 14;
        const r = Math.sqrt(Math.random()) * state.ISLAND_RADIUS * 1.1;
        const a = Math.random() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
    } else if (kind === "dust") {
      x += Math.sin(t * 0.3 + s) * 0.4 * dt + 0.3 * dt;
      y += Math.sin(t * 0.4 + s * 2) * 0.1 * dt;
      z += Math.cos(t * 0.35 + s) * 0.3 * dt;
      const r = Math.sqrt(x * x + z * z);
      if (r > state.ISLAND_RADIUS * 1.2) {
        const a = Math.random() * Math.PI * 2;
        const nr = Math.random() * state.ISLAND_RADIUS * 0.4;
        x = Math.cos(a) * nr;
        z = Math.sin(a) * nr;
      }
    } else if (kind === "sand") {
      // Dominant horizontal wind sweeping across the dunes, with gusts and
      // small per-grain wobble. Grains stay near the surface; when blown past
      // the downwind edge they wrap back to the upwind side so the stream is
      // continuous.
      const gust = 0.95 + 0.70 * Math.sin(t * 0.35 + s * 0.07);
      const windBand = 0.65 + 0.35 * Math.sin(z * 0.23 + t * 0.8 + s * 0.05);
      // Slight cross-wind on Z so the grit doesn't move in ruler-straight rows.
      const cross = 0.18 * Math.sin(t * 0.5 + s * 0.13);
      x += (7.8 * gust * windBand + Math.sin(t * 1.6 + s) * 0.45) * dt;
      z += (cross + Math.cos(t * 0.9 + s * 1.3) * 0.24) * dt;
      // Tiny vertical wobble — sand grains don't really climb, they skip.
      y += Math.sin(t * 2.0 + s * 1.7) * 0.08 * dt - 0.01 * dt;
      // Sample terrain to clamp grains close to the ground so they hug dunes.
      const groundY = state.heightFn ? state.heightFn(x, z) : 0;
      const floor = Math.max(0.05, groundY + 0.08);
      const ceil = floor + 0.42 + windBand * 0.18;
      if (y < floor) y = floor;
      else if (y > ceil) y = ceil;
      // Wrap from downwind edge back to upwind edge.
      if (x > state.ISLAND_RADIUS * 1.1) {
        x = -state.ISLAND_RADIUS * 1.05 + Math.random() * 1.0;
        z = (Math.random() - 0.5) * state.ISLAND_RADIUS * 2.0;
        const gy = state.heightFn ? state.heightFn(x, z) : 0;
        y = Math.max(0.05, gy + 0.08) + Math.random() * 0.38;
      } else if (Math.abs(z) > state.ISLAND_RADIUS * 1.15) {
        z = -Math.sign(z) * state.ISLAND_RADIUS * 1.05;
      }
    } else if (kind === "cinder") {
      // Glowing ash: loose horizontal drift, rising over hot fissures and
      // settling elsewhere.
      const fissureLift = cinderFissureLiftAt(x, z);
      const wander = 0.26 + fissureLift * 0.16;
      x += (Math.sin(t * 0.55 + s * 1.7) + Math.sin(t * 0.21 + s * 0.31) * 0.5) * wander * dt;
      z += (Math.cos(t * 0.48 + s * 1.3) + Math.sin(t * 0.27 + s * 0.47) * 0.45) * wander * dt;
      const verticalDrift = -0.18 + fissureLift * 0.74;
      y += (verticalDrift + Math.sin(t * 1.1 + s * 1.6) * 0.12) * dt;
      const groundY = state.heightFn ? state.heightFn(x, z) : 0;
      const ceil = groundY + 5.8;
      if (y > ceil) y = ceil;
      const rr = Math.sqrt(x * x + z * z);
      if (rr > state.ISLAND_RADIUS * 1.12) {
        x *= 0.92;
        z *= 0.92;
      }
    } else if (kind === "bubble") {
      // slow upward drift with a soft wobble — pops at the top
      y += (0.35 + (s % 1) * 0.25) * dt;
      x += Math.sin(t * 1.1 + s * 1.4) * 0.18 * dt;
      z += Math.cos(t * 0.95 + s * 1.2) * 0.18 * dt;
      if (y > 8) {
        y = -0.2;
        const r = Math.sqrt(Math.random()) * state.ISLAND_RADIUS * 1.05;
        const a = Math.random() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
    } else if (kind === "leaf") {
      // drifting fall, slower than dust, with horizontal flutter that emulates tumbling
      y -= (0.32 + (s % 1) * 0.18) * dt;
      x += Math.sin(t * 1.6 + s * 2.1) * 0.55 * dt;
      z += Math.cos(t * 1.3 + s * 1.7) * 0.55 * dt;
      if (y < -1) {
        y = 12 + Math.random() * 3;
        const r = Math.sqrt(Math.random()) * state.ISLAND_RADIUS * 1.05;
        const a = Math.random() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
    } else if (kind === "spark") {
      // hotter, faster-rising, smaller than ember
      y += (1.1 + (s % 1) * 0.8) * dt;
      x += Math.sin(t * 2.2 + s) * 0.3 * dt;
      z += Math.cos(t * 1.9 + s) * 0.3 * dt;
      if (y > 11) {
        y = 0;
        const r = Math.random() * state.ISLAND_RADIUS * 0.85;
        const a = Math.random() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
    } else if (kind === "rain") {
      // near-vertical streaks with a hint of horizontal drift
      y -= (8.5 + (s % 1) * 2.5) * dt;
      x += Math.sin(t * 0.4 + s) * 0.06 * dt;
      z += Math.cos(t * 0.35 + s) * 0.06 * dt;
      if (y < -1.5) {
        y = 12 + Math.random() * 4;
        const r = Math.sqrt(Math.random()) * state.ISLAND_RADIUS * 1.1;
        const a = Math.random() * Math.PI * 2;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
      }
    } else {
      // pollen — gentle float
      x += Math.sin(t * 0.5 + s) * 0.15 * dt;
      y += (0.15 + Math.sin(t + s) * 0.1) * dt;
      z += Math.cos(t * 0.45 + s) * 0.15 * dt;
      if (y > 9) {
        y = 0;
      }
    }

    pos[ix] = x;
    pos[ix + 1] = y;
    pos[ix + 2] = z;
  }

  points.geometry.attributes.position.needsUpdate = true;

  // aLife — drives shader-side size/opacity ramps. Infinite-loop kinds use a
  // (t * speed + seed) % 1 cycle; recycle kinds use real elapsed-life
  // progress. We treat all kinds identically here (cheap one-pass loop).
  for (let i = 0; i < count; i++) {
    const s = seeds[i];
    if (kind === "ember" || kind === "spark") {
      lifes[i] = Math.min(1, (lifes[i] ?? 0) + dt * 0.6);
      if (lifes[i] >= 1) lifes[i] = 0;
    } else if (kind === "cinder") {
      const cinderLifeRate = 0.16;
      lifes[i] = Math.min(1, (lifes[i] ?? 0) + dt * cinderLifeRate);
      if (lifes[i] >= 1) lifes[i] = 0;
    } else if (kind === "firefly" || kind === "lichenmote") {
      lifes[i] = (t * 0.3 + s * 0.01) % 1.0;
    } else if (kind === "rain" || kind === "snow" || kind === "leaf" || kind === "feather" || kind === "bubble") {
      // recycle handlers reset y; tie aLife to vertical position so it ramps
      // back to 0 naturally when wrapped.
      lifes[i] = Math.max(0, Math.min(1, 1 - (points.geometry.attributes.position.array[i * 3 + 1] / 14)));
    } else {
      lifes[i] = (t * 0.5 + s * 0.013) % 1.0;
    }
  }
  points.geometry.attributes.aLife.needsUpdate = true;

  // shader-side uTime
  if (points.material.uniforms && points.material.uniforms.uTime) {
    points.material.uniforms.uTime.value = t;
  }
}

// ─── dirt puffs (burrower emerge/sink bursts) ───
//
// Each puff is a small Points cloud of ~12 brown specks that fly outward,
// fall under "gravity," and fade out. Self-contained — the world manager
// adds them to the scene at spawn; stepDirtPuffs removes them at expiry.
const PUFF_PARTICLES = 24;
const PUFF_LIFE = 1.7; // seconds
export function makeDirtPuff(x, y, z, baseColor) {
  const positions = new Float32Array(PUFF_PARTICLES * 3);
  const velocities = new Float32Array(PUFF_PARTICLES * 3);
  for (let i = 0; i < PUFF_PARTICLES; i++) {
    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y + 0.05;
    positions[i * 3 + 2] = z;
    const ang = Math.random() * Math.PI * 2;
    const sp = 1.2 + Math.random() * 1.4;
    velocities[i * 3 + 0] = Math.cos(ang) * sp;
    velocities[i * 3 + 1] = 1.6 + Math.random() * 1.2;
    velocities[i * 3 + 2] = Math.sin(ang) * sp;
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(baseColor).offsetHSL(0.04, 0.15, 0.12),
    size: 0.18,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.userData = { velocities, age: 0 };
  return points;
}

export function stepDirtPuffs(puffs, dt) {
  if (!puffs || !puffs.length) return;
  for (let p = puffs.length - 1; p >= 0; p--) {
    const puff = puffs[p];
    const d = puff.userData;
    d.age += dt;
    const pos = puff.geometry.attributes.position.array;
    const v = d.velocities;
    for (let i = 0; i < PUFF_PARTICLES; i++) {
      const ix = i * 3;
      pos[ix + 0] += v[ix + 0] * dt;
      pos[ix + 1] += v[ix + 1] * dt;
      pos[ix + 2] += v[ix + 2] * dt;
      v[ix + 1] -= 6.5 * dt; // gravity
      v[ix + 0] *= 0.94;
      v[ix + 2] *= 0.94;
    }
    puff.geometry.attributes.position.needsUpdate = true;
    puff.material.opacity = Math.max(0, 0.9 * (1 - d.age / PUFF_LIFE));
    if (d.age >= PUFF_LIFE) {
      if (puff.parent) puff.parent.remove(puff);
      puff.geometry.dispose();
      puff.material.dispose();
      puffs.splice(p, 1);
    }
  }
}

// ─── footstep dust kicks ───
const KICK_PARTICLES = 4;
const KICK_LIFE = 0.5;
export function makeDustKick(x, y, z, baseColor, opts = {}) {
  const count = opts.count ?? KICK_PARTICLES;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const velocityScale = opts.velocityScale ?? 1;
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = x;
    positions[i * 3 + 1] = y + 0.02;
    positions[i * 3 + 2] = z;
    const ang = Math.random() * Math.PI * 2;
    const sp = (0.4 + Math.random() * 0.5) * velocityScale;
    velocities[i * 3 + 0] = Math.cos(ang) * sp;
    velocities[i * 3 + 1] = (0.5 + Math.random() * 0.4) * velocityScale;
    velocities[i * 3 + 2] = Math.sin(ang) * sp;
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(baseColor).offsetHSL(0, -0.1, 0.12),
    size: opts.size ?? 0.08,
    transparent: true,
    opacity: opts.opacity ?? 0.7,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.userData = {
    velocities,
    age: 0,
    count,
    life: opts.life ?? KICK_LIFE,
    opacity: opts.opacity ?? 0.7,
    poof: opts.poof ?? false,
  };
  return points;
}

export function stepDustKicks(kicks, dt) {
  if (!kicks || !kicks.length) return;
  for (let p = kicks.length - 1; p >= 0; p--) {
    const kick = kicks[p];
    const d = kick.userData;
    d.age += dt;
    const pos = kick.geometry.attributes.position.array;
    const v = d.velocities;
    const count = d.count ?? KICK_PARTICLES;
    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      pos[ix + 0] += v[ix + 0] * dt;
      pos[ix + 1] += v[ix + 1] * dt;
      pos[ix + 2] += v[ix + 2] * dt;
      v[ix + 1] -= 3.5 * dt;
      v[ix + 0] *= 0.9;
      v[ix + 2] *= 0.9;
    }
    kick.geometry.attributes.position.needsUpdate = true;
    const life = d.life ?? KICK_LIFE;
    const opacity = d.opacity ?? 0.7;
    kick.material.opacity = Math.max(0, opacity * (1 - d.age / life));
    if (d.age >= life) {
      if (kick.parent) kick.parent.remove(kick);
      kick.geometry.dispose();
      kick.material.dispose();
      kicks.splice(p, 1);
    }
  }
}

// ─── soft-ground creature marks (terrain shader painted) ───
const GROUND_MARK_TEX_SIZE = LOWFX ? 256 : 512;
const GROUND_MARK_MAX_MARKS = LOWFX ? 192 : 512;

const _groundMarkPaint = `
vec2 groundMarkUv = vGroundMarkXZ * uGroundMarkInvSize + 0.5;
float groundMarkAlpha = texture2D(uGroundMarkTex, groundMarkUv).a;
diffuseColor.rgb = mix(diffuseColor.rgb, uGroundMarkColor, clamp(groundMarkAlpha, 0.0, 0.85));
`;

function _makeGroundMarkTexture(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return { canvas, ctx, texture };
}

function installGroundMarkShader(system) {
  const mat = state.terrainMesh?.material;
  if (!mat || mat.userData.groundMarkSystem === system) return;

  const d = system.userData;
  const uniforms = d.uniforms;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uGroundMarkColor = uniforms.uGroundMarkColor;
    shader.uniforms.uGroundMarkTex = uniforms.uGroundMarkTex;
    shader.uniforms.uGroundMarkInvSize = uniforms.uGroundMarkInvSize;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec2 vGroundMarkXZ;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vGroundMarkXZ = transformed.xz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform vec3 uGroundMarkColor;
         uniform sampler2D uGroundMarkTex;
         uniform float uGroundMarkInvSize;
         varying vec2 vGroundMarkXZ;`
      )
      .replace(
        "vec4 diffuseColor = vec4( diffuse, opacity );",
        `vec4 diffuseColor = vec4( diffuse, opacity );
         ${_groundMarkPaint}`
      );
  };
  mat.userData.groundMarkSystem = system;
  mat.userData.groundMarkUniforms = uniforms;
  mat.needsUpdate = true;
}

function _toGroundMarkPixel(d, x, z) {
  return {
    x: (x * d.invWorldSize + 0.5) * d.size,
    y: (z * d.invWorldSize + 0.5) * d.size,
  };
}

function _drawGroundMarkStamp(d, x, z, heading, width, length, opacity) {
  const p = _toGroundMarkPixel(d, x, z);
  const pad = Math.max(width, length) * d.pxPerWorld * 1.4;
  if (p.x < -pad || p.x > d.size + pad || p.y < -pad || p.y > d.size + pad) return;

  const ctx = d.ctx;
  const w = Math.max(1, width * d.pxPerWorld);
  const h = Math.max(1, length * d.pxPerWorld);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(heading);
  ctx.scale(w, h);
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  grad.addColorStop(0.00, `rgba(255,255,255,${Math.min(1, opacity)})`);
  grad.addColorStop(0.45, `rgba(255,255,255,${Math.min(1, opacity * 0.72)})`);
  grad.addColorStop(1.00, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function _paintGroundMark(system, mark, opacity) {
  const d = system.userData;
  const x = mark.x;
  const z = mark.z;
  if (Number.isFinite(mark.fromX) && Number.isFinite(mark.fromZ)) {
    const dx = x - mark.fromX;
    const dz = z - mark.fromZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const spacing = Math.max(0.04, Math.min(mark.width, mark.length) * 0.42);
    const steps = Math.max(1, Math.ceil(dist / spacing));
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      _drawGroundMarkStamp(
        d,
        mark.fromX + dx * u,
        mark.fromZ + dz * u,
        mark.heading,
        mark.width,
        mark.length,
        opacity
      );
    }
  } else {
    _drawGroundMarkStamp(d, x, z, mark.heading, mark.width, mark.length, opacity);
  }
}

function _groundMarkLife(mark) {
  const scale = state.userSettings.groundMarkLifeScale ?? 1;
  return mark.baseLife * Math.max(0.01, scale);
}

function _repaintGroundMarks(system) {
  const d = system.userData;
  d.ctx.clearRect(0, 0, d.size, d.size);
  for (const mark of d.marks) {
    const u = mark.age / Math.max(0.001, _groundMarkLife(mark));
    const fade = 1 - u * u * (3 - 2 * u);
    _paintGroundMark(system, mark, mark.opacity * fade);
  }
  d.texture.needsUpdate = true;
  d.active[0] = d.marks.length > 0 ? 1 : 0;
}

export function makeGroundMarks(biome) {
  const cfg = biome.groundMarks;
  if (!cfg) return null;

  const size = cfg.textureSize ?? GROUND_MARK_TEX_SIZE;
  const { canvas, ctx, texture } = _makeGroundMarkTexture(size);
  const system = new THREE.Object3D();
  system.name = "terrain-painted-ground-marks";
  system.visible = false;
  // disposeGroup() only knows about geometry/material, so provide a tiny
  // material-like disposer for the CanvasTexture owned by this Object3D.
  system.material = { dispose: () => texture.dispose() };
  system.userData = {
    canvas,
    ctx,
    texture,
    size,
    invWorldSize: 1 / state.ISLAND_SIZE,
    pxPerWorld: size / state.ISLAND_SIZE,
    marks: [],
    maxMarks: cfg.maxMarks ?? GROUND_MARK_MAX_MARKS,
    active: new Uint8Array(1),
    uniforms: {
      uGroundMarkColor: { value: new THREE.Color(cfg.color) },
      uGroundMarkTex: { value: texture },
      uGroundMarkInvSize: { value: 1 / state.ISLAND_SIZE },
    },
    cfg,
  };

  installGroundMarkShader(system);
  return system;
}

export function emitGroundMark(system, opts = {}) {
  if (!system || !system.userData) return;
  installGroundMarkShader(system);
  const d = system.userData;
  const x = opts.x;
  const z = opts.z;
  const y = opts.y ?? (state.heightFn ? state.heightFn(x, z) : 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
  if (state.waterMesh && y < WATER_AVOID_Y) return;

  const softness = d.cfg.softness ?? 1;
  const mark = {
    x,
    z,
    fromX: opts.fromX,
    fromZ: opts.fromZ,
    heading: opts.heading ?? 0,
    width: Math.max(0.01, (opts.width ?? 0.18) * softness),
    length: Math.max(0.01, (opts.length ?? 0.32) * softness),
    opacity: opts.opacity ?? d.cfg.opacity ?? 0.2,
    baseLife: opts.life ?? d.cfg.life ?? 6,
    age: 0,
  };
  if (d.marks.length >= d.maxMarks) d.marks.shift();
  d.marks.push(mark);
  _paintGroundMark(system, mark, mark.opacity);
  d.texture.needsUpdate = true;
  d.active[0] = 1;
}

export function stepGroundMarks(system, dt) {
  if (!system || !system.userData || dt <= 0) return;
  installGroundMarkShader(system);
  const d = system.userData;
  if (!d.marks.length) return;
  for (let i = d.marks.length - 1; i >= 0; i--) {
    const mark = d.marks[i];
    mark.age += dt;
    if (mark.age >= _groundMarkLife(mark)) d.marks.splice(i, 1);
  }
  _repaintGroundMarks(system);
}

// ─── fly swarms (dark specks hovering over a fixed prop) ───
//
// Tiny erratic cloud — each speck orbits a center with phase-offset sinusoids
// so the motion reads as jittery, insect-like buzzing rather than smooth flight.
// Used for the skull flies in the desert biome.
const FLY_COUNT = 9;
export function makeFlySwarm(centerX, centerY, centerZ) {
  const count = _lowfxScale(FLY_COUNT);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = centerX;
    positions[i * 3 + 1] = centerY;
    positions[i * 3 + 2] = centerZ;
    seeds[i] = Math.random() * 100;
  }
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", posAttr);
  const mat = new THREE.PointsMaterial({
    color: 0x141014,
    size: 0.07,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.userData = { centerX, centerY, centerZ, seeds, count };
  return points;
}

export function stepFlySwarms(swarms, t) {
  if (!swarms || !swarms.length) return;
  for (const sw of swarms) {
    const { centerX, centerY, centerZ, seeds, count } = sw.userData;
    const pos = sw.geometry.attributes.position.array;
    for (let i = 0; i < count; i++) {
      const s = seeds[i];
      // Tight, irregular orbit: a slow circular sweep plus a faster jitter
      // so individual flies dart and pause rather than glide.
      const r = 0.08 + 0.045 * Math.sin(t * 1.7 + s * 1.1);
      const ang = t * (1.5 + (s % 1) * 0.9) + s * 4.1;
      const dx = Math.cos(ang) * r + Math.sin(t * 6.0 + s * 3.3) * 0.018;
      const dy = Math.sin(t * 2.2 + s * 1.7) * 0.055 + Math.sin(t * 5.5 + s * 2.0) * 0.015;
      const dz = Math.sin(ang) * r + Math.cos(t * 5.6 + s * 3.0) * 0.018;
      pos[i * 3 + 0] = centerX + dx;
      pos[i * 3 + 1] = centerY + dy;
      pos[i * 3 + 2] = centerZ + dz;
    }
    sw.geometry.attributes.position.needsUpdate = true;
  }
}

// ─── ground cover + water ───
export function placeInstanced(geo, mat, count, heightFn, opts = {}) {
  const {
    yOffset = 0,
    maxRadiusFrac = 0.88,
    minScale = 0.6,
    maxScale = 1.3,
    minHeight = -0.15,
    maxHeight = Infinity,
    tilt = 0.25,
    fullRotation = true,
    avoidObstacleKinds = null,
    avoidRadius = 0,
    visualRadius = false,
    excludedCircles = [],
  } = opts;
  const avoidObstacleKindSet = avoidObstacleKinds
    ? (avoidObstacleKinds instanceof Set ? avoidObstacleKinds : new Set(avoidObstacleKinds))
    : null;

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;

  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const e = new THREE.Euler();

  const positions = [];

  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 5) {
    attempts++;
    const p = pickGroundPoint(maxRadiusFrac, { visualRadius });
    const x = p.x;
    const z = p.z;
    if (avoidObstacleKindSet) {
      let blocked = false;
      for (const obstacle of state.obstacles) {
        if (!avoidObstacleKindSet.has(obstacle.kind)) continue;
        const minD = obstacle.r + avoidRadius;
        const dx = x - obstacle.x;
        const dz = z - obstacle.z;
        if (dx * dx + dz * dz < minD * minD) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
    }
    let excluded = false;
    for (const c of excludedCircles) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) { excluded = true; break; }
    }
    if (excluded) continue;
    const y = heightFn(x, z);
    if (y < minHeight || y > maxHeight) continue;

    v.set(x, y + yOffset, z);
    s.setScalar(minScale + Math.random() * (maxScale - minScale));
    e.set(
      (Math.random() - 0.5) * tilt,
      fullRotation ? Math.random() * Math.PI * 2 : 0,
      (Math.random() - 0.5) * tilt
    );
    q.setFromEuler(e);
    m.compose(v, q, s);
    mesh.setMatrixAt(placed, m);
    positions.push({ x, y: y + yOffset, z });
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.positions = positions;
  return mesh;
}

export { makeGrassField } from "./grass.js";

// ─── wildflower geometries (pooled, shared across all calls) ───

// Thin tapered stem.
const _wfStemGeo = /* @__PURE__ */ (() => {
  const geo = new THREE.CylinderGeometry(0.006, 0.012, 0.44, 5, 3).translate(0, 0.22, 0);
  // slight organic curve
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = y / 0.44;
    pos.setX(i, pos.getX(i) + Math.sin(t * Math.PI * 0.8) * 0.008);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
})();

// Small pistil (flower center) — flattened yellow sphere.
const _wfPistilGeo = /* @__PURE__ */ (() => {
  const geo = new THREE.SphereGeometry(0.018, 6, 5);
  geo.scale(1, 0.55, 1);
  return geo;
})();
const _wfPistilMat = /* @__PURE__ */ new THREE.MeshStandardMaterial({
  color: "#ffe135",
  flatShading: true,
  roughness: 0.5,
});

// Small petal — a shorter, wider version of the leafball teardrop.
const _wfPetalGeo = /* @__PURE__ */ (() => {
  const lengthSegs = 4;
  const widthSegs = 3;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let iy = 0; iy <= lengthSegs; iy++) {
    const v = iy / lengthSegs;
    const halfWidth = Math.max(0.004, 0.045 * Math.sin(Math.PI * v) ** 0.6);
    for (let ix = 0; ix <= widthSegs; ix++) {
      const u = ix / widthSegs;
      const side = u * 2 - 1;
      const centerLift = (1 - Math.abs(side)) * 0.006 * (1 - v * 0.4);
      const tipCurl = 0.025 * v ** 1.3;
      positions.push(side * halfWidth, v * 0.08, tipCurl + centerLift);
      uvs.push(u, v);
    }
  }
  for (let iy = 0; iy < lengthSegs; iy++) {
    for (let ix = 0; ix < widthSegs; ix++) {
      const a = iy * (widthSegs + 1) + ix;
      const b = a + 1;
      const c = a + widthSegs + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
})();

// Small leaf — reused from leafballtree shape but miniaturised.
const _wfLeafGeo = /* @__PURE__ */ (() => {
  const lengthSegs = 5;
  const widthSegs = 3;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let iy = 0; iy <= lengthSegs; iy++) {
    const v = iy / lengthSegs;
    const halfWidth = Math.max(0.003, 0.045 * Math.sin(Math.PI * v) ** 0.72 * (1 - v * 0.16));
    for (let ix = 0; ix <= widthSegs; ix++) {
      const u = ix / widthSegs;
      const side = u * 2 - 1;
      const centerLift = (1 - Math.abs(side)) * 0.005 * (1 - v * 0.35);
      const tipCurl = 0.030 * v ** 1.45;
      const edgeCurl = -Math.abs(side) * 0.005 * Math.sin(Math.PI * v);
      positions.push(side * halfWidth, -v * 0.15, tipCurl + centerLift + edgeCurl);
      uvs.push(u, v);
    }
  }
  for (let iy = 0; iy < lengthSegs; iy++) {
    for (let ix = 0; ix < widthSegs; ix++) {
      const a = iy * (widthSegs + 1) + ix;
      const b = a + 1;
      const c = a + widthSegs + 1;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
})();

// Pooled materials (green stem/leaf, per-color petal).
const _wfStemMat = /* @__PURE__ */ applyWindSway(
  new THREE.MeshStandardMaterial({
    color: "#2d5a1e",
    flatShading: true,
    roughness: 0.85,
  }),
  1.0
);
const _wfLeafMat = /* @__PURE__ */ applyWindSway(
  new THREE.MeshStandardMaterial({
    color: "#3a7228",
    side: THREE.DoubleSide,
    flatShading: true,
    roughness: 0.80,
  }),
  1.0
);

function _wfPetalMat(color, glow) {
  const baseCol = new THREE.Color(color);
  return applyWindSway(
    new THREE.MeshStandardMaterial({
      color: baseCol,
      emissive: glow ? baseCol.clone() : 0x000000,
      emissiveIntensity: glow ? 1.1 : 0,
      side: THREE.DoubleSide,
      flatShading: true,
      roughness: 0.4,
    }),
    1.2
  );
}

// Helper: create an InstancedMesh from pre-computed matrices (same as flora.js).
function _makeInstancedBatch(geometry, material, matrices) {
  if (!matrices.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  for (let i = 0; i < matrices.length; i++) mesh.setMatrixAt(i, matrices[i]);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// Pick a ground position using the same rejection sampling as placeInstanced,
// but return just { x, y, z } instead of building an InstancedMesh.
function _pickWildflowerPos(heightFn, opts) {
  const {
    maxRadiusFrac = 0.88,
    minHeight = -0.15,
    maxHeight = Infinity,
    avoidObstacleKindSet = null,
    avoidRadius = 0,
    visualRadius = false,
    excludedCircles = [],
  } = opts;
  let attempts = 0;
  while (attempts < 20) {
    attempts++;
    const p = pickGroundPoint(maxRadiusFrac, { visualRadius });
    const x = p.x, z = p.z;
    if (avoidObstacleKindSet) {
      let blocked = false;
      for (const obstacle of state.obstacles) {
        if (!avoidObstacleKindSet.has(obstacle.kind)) continue;
        const minD = obstacle.r + avoidRadius;
        const dx = x - obstacle.x, dz = z - obstacle.z;
        if (dx * dx + dz * dz < minD * minD) { blocked = true; break; }
      }
      if (blocked) continue;
    }
    let excluded = false;
    for (const c of excludedCircles) {
      const dx = x - c.x, dz = z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) { excluded = true; break; }
    }
    if (excluded) continue;
    const y = heightFn(x, z);
    if (y < minHeight || y > maxHeight) continue;
    return { x, y, z };
  }
  return null;
}

export function makeWildflowerField(biome, heightFn, excludedCircles = []) {
  const palette = WILDFLOWER_PALETTES[biome.id] ?? ["#ffffff"];
  const total = _coverScale(FLOWER_DENSITY[biome.id] ?? 100, 1.6);
  if (total <= 0) return [];
  const perColor = Math.max(3, Math.floor(total / palette.length / 3));
  const glow = !!biome.glowFlowers;
  const meshes = [];

  const placeOpts = {
    maxRadiusFrac: 0.88,
    minHeight: -0.15,
    avoidObstacleKindSet: new Set(["lavafissure"]),
    avoidRadius: 0.12,
    visualRadius: true,
    excludedCircles,
  };

  // Pre-compute petal materials per palette colour.
  const petalMats = palette.map(c => _wfPetalMat(c, glow));

  // We build all matrices first, then batch into InstancedMeshes per type.
  // For each colour: stem matrices, leaf matrices, petal matrices.
  const stemMatrices = [];
  const leafMatrices = [];
  const pistilMatrices = [];
  const petalMatrices = palette.map(() => []);
  const allPositions = []; // flowerSpots

  const _m = new THREE.Matrix4();
  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _e = new THREE.Euler();
  const _q2 = new THREE.Quaternion();
  const _axis = new THREE.Vector3();
  const _q3 = new THREE.Quaternion();

  for (let ci = 0; ci < palette.length; ci++) {
    for (let fi = 0; fi < perColor; fi++) {
      const pos = _pickWildflowerPos(heightFn, placeOpts);
      if (!pos) continue;

      const { x, y, z } = pos;
      // Cluster of 2-4 flowers around this spot.
      const clusterSize = 2 + Math.floor(Math.random() * 3);
      for (let cf = 0; cf < clusterSize; cf++) {
        // Small offset within the cluster.
        const co = (cf / clusterSize) * Math.PI * 2 + Math.random() * 0.5;
        const cr = 0.02 + Math.random() * 0.03;
        const fx = x + Math.sin(co) * cr;
        const fz = z + Math.cos(co) * cr;
        const flowerScale = (0.9 + Math.random() * 1.0) * 1.25; // 25% larger
        const heightMul = 0.80 + Math.random() * 0.25 / 0.44; // 20% shorter min, up to +0.25 extra stem height
        const stemH = 0.44 * heightMul; // effective stem height
        const yRot = Math.random() * Math.PI * 2;
        const lean = Math.random() * 0.22;

        // stem — yaw to lean direction, then pitch in local space.
        _v.set(fx, y + 0.08, fz);
        _e.set(0, yRot, 0);
        _q.setFromEuler(_e);
        _q2.setFromAxisAngle(_axis.set(1, 0, 0), lean);
        _q.multiply(_q2);
        _s.set(flowerScale, flowerScale * heightMul, flowerScale);
        _m.compose(_v, _q, _s);
        stemMatrices.push(_m.clone());

        // 1-2 leaves attached partway up the leaned stem
        const leafCount = Math.random() < 0.6 ? 2 : 1;
        for (let li = 0; li < leafCount; li++) {
          const leafAngle = yRot + (li === 0 ? Math.PI * 0.5 : -Math.PI * 0.5) + (Math.random() - 0.5) * 0.5;
          const leafDroop = (Math.random() - 0.5) * 0.4;
          const stemFrac = 0.4 + Math.random() * 0.4;
          const stemLocal = new THREE.Vector3(0, stemH * stemFrac * flowerScale, 0);
          stemLocal.applyQuaternion(_q);
          _v.set(fx + stemLocal.x, y + 0.08 + stemLocal.y, fz + stemLocal.z);
          _e.set(0, leafAngle, 0);
          _q2.setFromEuler(_e);
          const leafQ = _q2.clone()
            .multiply(_q3.setFromAxisAngle(_axis.set(1, 0, 0), -Math.PI / 2 + leafDroop))
            .multiply(_q3.setFromAxisAngle(_axis.set(0, 0, 1), (Math.random() - 0.5) * 0.6))
            .multiply(_q3.setFromAxisAngle(_axis.set(0, 1, 0), (Math.random() - 0.5) * 0.4));
          _s.setScalar(flowerScale * (0.6 + Math.random() * 0.3));
          _m.compose(_v, leafQ, _s);
          leafMatrices.push(_m.clone());
        }

        // 4-6 petals at the stem tip, fanning outward.
        const petalCount = 4 + Math.floor(Math.random() * 3);
        const stemTipLocal = new THREE.Vector3(0, stemH * flowerScale, 0);
        stemTipLocal.applyQuaternion(_q);
        const stemTipX = fx + stemTipLocal.x;
        const stemTipY = y + 0.08 + stemTipLocal.y;
        const stemTipZ = fz + stemTipLocal.z;
        for (let pi = 0; pi < petalCount; pi++) {
          const pa = (pi / petalCount) * Math.PI * 2;
          _v.set(stemTipX, stemTipY + (Math.random() - 0.5) * 0.005, stemTipZ);
          _q2.setFromAxisAngle(_axis.set(0, 1, 0), pa);
          const petalQ = _q.clone().multiply(_q2);
          _q3.setFromAxisAngle(_axis.set(1, 0, 0), 1.15 + Math.random() * 0.35);
          petalQ.multiply(_q3);
          _s.setScalar(flowerScale * (0.8 + Math.random() * 0.4));
          _m.compose(_v, petalQ, _s);
          petalMatrices[ci].push(_m.clone());
        }

        // Pistil (yellow center) at stem tip, oriented with stem.
        _v.set(stemTipX, stemTipY, stemTipZ);
        _m.compose(_v, _q, _s.setScalar(flowerScale));
        pistilMatrices.push(_m.clone());
      } // end cluster

      allPositions.push({ x, y: y + 0.08, z });
    }
  }

  // Build InstancedMeshes.
  const stemMesh = _makeInstancedBatch(_wfStemGeo, _wfStemMat, stemMatrices);
  if (stemMesh) {
    stemMesh.userData.inspect = { category: "flora", variant: "wildflower" };
    meshes.push(stemMesh);
  }

  const leafMesh = _makeInstancedBatch(_wfLeafGeo, _wfLeafMat, leafMatrices);
  if (leafMesh) {
    leafMesh.userData.inspect = { category: "flora", variant: "wildflower" };
    meshes.push(leafMesh);
  }

  const pistilMesh = _makeInstancedBatch(_wfPistilGeo, _wfPistilMat, pistilMatrices);
  if (pistilMesh) {
    pistilMesh.userData.inspect = { category: "flora", variant: "wildflower" };
    meshes.push(pistilMesh);
  }

  let positionsAttached = false;
  for (let ci = 0; ci < palette.length; ci++) {
    const petalMesh = _makeInstancedBatch(_wfPetalGeo, petalMats[ci], petalMatrices[ci]);
    if (petalMesh) {
      if (glow) petalMesh.layers.enable(BLOOM_LAYER);
      // Only attach positions to the first petal mesh so world.js doesn't
      // duplicate flowerSpots when iterating all returned meshes.
      if (!positionsAttached) {
        petalMesh.userData.positions = allPositions;
        positionsAttached = true;
      }
      petalMesh.userData.inspect = { category: "flora", variant: "wildflower" };
      meshes.push(petalMesh);
    }
  }

  // Fallback: ensure flowerSpots are available on at least one mesh.
  if (!positionsAttached && meshes.length > 0) {
    meshes[0].userData.positions = allPositions;
  }

  return meshes;
}

export function makeVerdantGroveDetails(biome, heightFn, excludedCircles = []) {
  if (!biome.groveDetails?.groundCover) return null;

  const group = new THREE.Group();
  group.name = "verdant-grove-details";

  const dewGeo = new THREE.SphereGeometry(0.032, 6, 5);
  const dewMat = new THREE.MeshStandardMaterial({
    color: "#f2fff0",
    emissive: new THREE.Color("#d6ffd0").multiplyScalar(0.18),
    flatShading: false,
    roughness: 0.18,
    metalness: 0.08,
  });
  const dew = placeInstanced(dewGeo, dewMat, _coverScale(38), heightFn, {
    yOffset: 0.085,
    minScale: 0.45,
    maxScale: 0.95,
    tilt: 0,
    maxRadiusFrac: 0.78,
    minHeight: -0.12,
    avoidObstacleKinds: ["lavafissure"],
    avoidRadius: 0.12,
    visualRadius: true,
    excludedCircles,
  });
  dew.name = "dew-beads";
  dew.userData.inspect = { category: "flora", variant: "wildflower" };
  group.add(dew);

  group.userData.inspect = { category: "flora", variant: "grassblade" };
  return group;
}

export function makeCloudPuffField(biome, heightFn, excludedCircles = []) {
  if (!biome.cloudlike) return null;

  const geo = new THREE.IcosahedronGeometry(0.34, 1);
  geo.scale(1.15, 0.95, 1.05);
  const glow = new THREE.Color(0xffffff);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.fog).lerp(glow, 0.82),
    emissive: new THREE.Color(biome.sky).lerp(glow, 0.68),
    emissiveIntensity: 0.14,
    flatShading: false,
    roughness: 0.82,
    metalness: 0,
  });
  const group = new THREE.Group();
  group.name = "cloud-puff-field";
  const floatingCloudlets = placeInstanced(geo, mat, _coverScale(LOWFX ? 14 : 24), heightFn, {
    yOffset: 0.16,
    minScale: 0.22,
    maxScale: 0.56,
    tilt: 0.18,
    maxRadiusFrac: 0.72,
    minHeight: -0.25,
    excludedCircles,
  });
  floatingCloudlets.name = "floatingCloudlets";
  floatingCloudlets.castShadow = false;
  floatingCloudlets.receiveShadow = false;
  group.add(floatingCloudlets);
  return group;
}

export function makePebbleField(biome, heightFn, excludedCircles = []) {
  const count = _coverScale(PEBBLE_DENSITY[biome.id] ?? 80);
  if (count <= 0) return null;
  const g = jitterGeo(new THREE.IcosahedronGeometry(0.08, 0), 0.025);
  g.scale(1.3, 0.45, 1.3);
  const col = new THREE.Color(biome.cliff).offsetHSL(
    0, -0.05, 0.08 + Math.random() * 0.1
  );
  const m = new THREE.MeshStandardMaterial({
    color: col,
    flatShading: true,
    roughness: 1,
  });
  const mesh = placeInstanced(g, m, count, heightFn, {
    yOffset: 0.02,
    minScale: 0.4,
    maxScale: 1.1,
    tilt: 0.5,
    avoidObstacleKinds: ["lavafissure"],
    avoidRadius: 0.12,
    visualRadius: true,
    excludedCircles,
  });
  mesh.userData.inspect = { category: "flora", variant: "pebble" };
  return mesh;
}

function makeStarfishGeometry() {
  const shape = new THREE.Shape();
  const points = 10;
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 0.13 : 0.045;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export function makeBeachcombField(biome, heightFn, excludedCircles = []) {
  const total = BEACHCOMB_DENSITY[biome.id] ?? 0;
  if (total <= 0) return null;

  const group = new THREE.Group();
  const shellCount = _coverScale(Math.round(total * 0.78));
  const starCount = _coverScale(Math.round(total * 0.22));

  const shellGeo = new THREE.SphereGeometry(0.08, 8, 6);
  shellGeo.scale(1.25, 0.28, 0.72);
  const shellMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.ground[0]).lerp(new THREE.Color("#fff8e8"), 0.55),
    flatShading: true,
    roughness: 0.9,
  });
  const shells = placeInstanced(shellGeo, shellMat, shellCount, heightFn, {
    yOffset: 0.025,
    maxRadiusFrac: 0.96,
    minScale: 0.55,
    maxScale: 1.25,
    minHeight: -0.08,
    maxHeight: 0.32,
    tilt: 0.35,
    excludedCircles,
  });
  shells.userData.inspect = { category: "flora", variant: "shell" };
  group.add(shells);

  const starGeo = makeStarfishGeometry();
  const starMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.accent).lerp(new THREE.Color("#ffd89a"), 0.35),
    side: THREE.DoubleSide,
    flatShading: true,
    roughness: 0.82,
  });
  const stars = placeInstanced(starGeo, starMat, starCount, heightFn, {
    yOffset: 0.035,
    maxRadiusFrac: 0.96,
    minScale: 0.45,
    maxScale: 0.9,
    minHeight: -0.12,
    maxHeight: 0.22,
    tilt: 0.12,
    excludedCircles,
  });
  stars.userData.inspect = { category: "flora", variant: "starfish" };
  group.add(stars);

  group.userData.inspect = { category: "flora", variant: "shell" };
  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// Water plane — translucent disk for water-adjacent biomes (marsh, ...).
// Animated in `animate()` via a small per-vertex sin displacement.
// ─────────────────────────────────────────────────────────────────────────────
export function makeWaterPlane(biome) {
  const segs = 48;
  const size = state.ISLAND_SIZE * 1.05;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const base = new THREE.Color(biome.water || biome.fog);
  const mat = new THREE.MeshStandardMaterial({
    color: base,
    transparent: true,
    opacity: 0.55,
    roughness: 0.32,
    metalness: 0.18,
    // Transparent water should tint underwater glows, not depth-occlude them
    // out of the shared bloom/depth pre-pass.
    depthWrite: false,
  });

  // Reflection patch — only kicks in if state.waterReflection is set later
  // by world.js. Until then, uReflTex stays null and uReflMix is 0 so the
  // mix branch is skipped entirely.
  const reflUniforms = {
    uReflTex: { value: null },
    uInvViewport: {
      value: new THREE.Vector2(
        1 / window.innerWidth,
        1 / window.innerHeight
      ),
    },
    uReflMix: { value: 0.0 },
  };
  mat.userData.reflectionUniforms = reflUniforms;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uReflTex = reflUniforms.uReflTex;
    shader.uniforms.uInvViewport = reflUniforms.uInvViewport;
    shader.uniforms.uReflMix = reflUniforms.uReflMix;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform sampler2D uReflTex;
         uniform vec2 uInvViewport;
         uniform float uReflMix;`
      )
      .replace(
        "#include <opaque_fragment>",
        `#include <opaque_fragment>
         if (uReflMix > 0.001) {
           vec2 ruv = gl_FragCoord.xy * uInvViewport;
           vec3 refl = texture2D(uReflTex, ruv).rgb;
           // Fresnel-ish: stronger at glancing angles. We keep the math
           // fixed (don't sample vViewPosition) for cross-version stability.
           float f = pow(1.0 - clamp(dot(normalize(vNormal), vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 2.0);
           gl_FragColor.rgb = mix(gl_FragColor.rgb, refl, uReflMix * (0.4 + 0.6 * f));
         }`
      );
  };
  applyTerrainClip(mat, clipCenter());

  const mesh = new THREE.Mesh(geo, mat);
  // sit a touch below sea level so the underside cone meets the water
  mesh.position.y = -0.12;
  mesh.receiveShadow = true;
  // cache the base XZ so we can offset Y each frame from a clean reference
  const arr = geo.attributes.position.array;
  mesh.userData.basePositions = new Float32Array(arr);
  mesh.userData.inspect = { category: "flora", variant: "water" };
  return mesh;
}

export function stepWater(water, dt, t) {
  if (!water) return;
  const pos = water.geometry.attributes.position;
  const base = water.userData.basePositions;
  const a = pos.array;
  for (let i = 0; i < pos.count; i++) {
    const ix = i * 3;
    const x = base[ix];
    const z = base[ix + 2];
    a[ix + 1] =
      Math.sin(t * 0.9 + x * 0.5 + z * 0.4) * 0.05 +
      Math.sin(t * 1.4 + x * 0.3 - z * 0.6) * 0.03;
  }
  pos.needsUpdate = true;
}

// Backdrop primitives (sky dome, mountain rings, clouds, stars, aurora) live
// in src/sky.js — see makeSkyDome / makeMountainBackdrop / etc.
