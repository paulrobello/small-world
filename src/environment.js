import * as THREE from "three";
import { state, DENSITY_BASE } from "./state.js";
import { jitterGeo, applyWindSway } from "./util.js";
import { applyRoundPlaneClip, pickGroundPoint, roundClipCenter } from "./terrain.js";
import {
  WILDFLOWER_PALETTES,
  FLOWER_DENSITY,
  PEBBLE_DENSITY,
  BEACHCOMB_DENSITY,
} from "./biomes.js";
import { LOWFX, LOWFX_DENSITY } from "./lowfx.js";
import { BLOOM_LAYER } from "./postfx.js";

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
  #if PARTICLE_KIND == 12
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
  #elif PARTICLE_KIND == 11 || PARTICLE_KIND == 12
    // horizontal streak — stretched in x, tight in y
    float a = smoothstep(0.5, 0.0, abs(c.x)) * smoothstep(0.5, 0.0, abs(c.y) * 2.6);
    // gust pulse: vary alpha by life so individual grains breathe
    a *= 0.55 + 0.45 * sin(vLife * 6.2831);
  #else
    float a = smoothstep(0.5, 0.0, d);
  #endif
  vec3 col = uColor;
  #if PARTICLE_KIND == 4 || PARTICLE_KIND == 9 || PARTICLE_KIND == 12
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

export function makeParticles(biome) {
  const kind = biome.particle;
  const baseCount = {
    pollen: 240, dust: 320, snow: 500, firefly: 90, ember: 180,
    lichenmote: 140, feather: 120, bubble: 140, leaf: 120, spark: 240, rain: 520,
    sand: 420, cinder: 520,
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
    positions[i * 3 + 1] = (kind === "sand" || kind === "cinder") ? 0.1 + Math.random() * 2.8 : Math.random() * 14;
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
    sand: (biome.ground && biome.ground[2]) || biome.fog,
    cinder: biome.sun,
  };
  // Ember/spark/cinder fade toward a smokier secondary colour over life.
  const color2Map = {
    ember: "#3a2018", spark: "#fff2b3", cinder: "#4a2018",
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
    sand: 0.16,
    cinder: 0.19,
  };
  const opacityMap = {
    dust: 0.35, feather: 0.7, bubble: 0.55, leaf: 0.85, spark: 0.95, rain: 0.55,
    pollen: 0.85, snow: 0.85, firefly: 0.85, ember: 0.85, lichenmote: 0.85,
    sand: 0.55, cinder: 0.95,
  };
  const additive = new Set(["firefly", "ember", "lichenmote", "spark", "cinder"]);

  const renderer = state.renderer; // set by main.js after init
  const pixelRatio = renderer ? renderer.getPixelRatio() : 1;
  const camera = state.camera;
  // Soft particles require the depth pre-pass — null under LOWFX, in which
  // case uSoftParticles stays 0 and the shader skips the depth-fade branch.
  const softOn = !!(state.depthTexture && state.userSettings.softParticles);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: pixelRatio },
      uBaseSize: { value: sizeMap[kind] ?? 0.07 },
      uColor: { value: new THREE.Color(colorMap[kind]) },
      uColor2: { value: new THREE.Color(color2Map[kind] ?? colorMap[kind]) },
      uOpacity: { value: opacityMap[kind] ?? 0.85 },
      tDepth: { value: state.depthTexture },
      uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
      uCameraNear: { value: camera ? camera.near : 0.1 },
      uCameraFar: { value: camera ? camera.far : 400.0 },
      uSoftParticles: { value: softOn ? 1.0 : 0.0 },
    },
    defines: { PARTICLE_KIND: PARTICLE_KIND_ID[kind] ?? 0 },
    vertexShader: _particleVS,
    fragmentShader: _particleFS,
    transparent: true,
    depthWrite: false,
    blending: additive.has(kind) ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.userData = { kind, velocities, seeds, lifes, count };
  return points;
}

export function stepParticles(points, dt, t) {
  if (!points) return;
  const { kind, velocities, seeds, lifes, count } = points.userData;
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
      const gust = 0.7 + 0.6 * Math.sin(t * 0.35 + s * 0.07);
      // Slight cross-wind on Z so streaks aren't pure straight lines.
      const cross = 0.25 * Math.sin(t * 0.5 + s * 0.13);
      x += (5.5 * gust + Math.sin(t * 1.6 + s) * 0.6) * dt;
      z += (cross + Math.cos(t * 0.9 + s * 1.3) * 0.4) * dt;
      // Tiny vertical wobble — sand grains don't really climb, they skip.
      y += Math.sin(t * 2.0 + s * 1.7) * 0.18 * dt - 0.05 * dt;
      // Sample terrain to clamp grains close to the ground so they hug dunes.
      const groundY = state.heightFn ? state.heightFn(x, z) : 0;
      const floor = Math.max(0.05, groundY + 0.08);
      const ceil = groundY + 2.4;
      if (y < floor) y = floor;
      else if (y > ceil) y = ceil;
      // Wrap from downwind edge back to upwind edge.
      if (x > state.ISLAND_RADIUS * 1.1) {
        x = -state.ISLAND_RADIUS * 1.05 + Math.random() * 1.0;
        z = (Math.random() - 0.5) * state.ISLAND_RADIUS * 2.0;
        const gy = state.heightFn ? state.heightFn(x, z) : 0;
        y = Math.max(0.1, gy + 0.1) + Math.random() * 2.0;
      } else if (Math.abs(z) > state.ISLAND_RADIUS * 1.15) {
        z = -Math.sign(z) * state.ISLAND_RADIUS * 1.05;
      }
    } else if (kind === "cinder") {
      // Glowing ash blown low across the wastes: sand-like wind, but slower,
      // floatier, and capped close to the terrain so it stays cute/subtle.
      const gust = 0.75 + 0.45 * Math.sin(t * 0.32 + s * 0.06);
      const cross = 0.22 * Math.sin(t * 0.48 + s * 0.11);
      x += (4.2 * gust + Math.sin(t * 1.25 + s) * 0.5) * dt;
      z += (cross + Math.cos(t * 0.82 + s * 1.2) * 0.34) * dt;
      y += (0.08 + Math.sin(t * 1.7 + s * 1.6) * 0.22) * dt;
      const groundY = state.heightFn ? state.heightFn(x, z) : 0;
      const floor = groundY + 0.12;
      const ceil = groundY + 3.0;
      if (y < floor) y = floor + Math.random() * 0.18;
      else if (y > ceil) y = ceil;
      if (x > state.ISLAND_RADIUS * 1.1) {
        x = -state.ISLAND_RADIUS * 1.05 + Math.random() * 1.0;
        z = (Math.random() - 0.5) * state.ISLAND_RADIUS * 2.0;
        const gy = state.heightFn ? state.heightFn(x, z) : 0;
        y = gy + 0.12 + Math.random() * 1.15;
      } else if (Math.abs(z) > state.ISLAND_RADIUS * 1.15) {
        z = -Math.sign(z) * state.ISLAND_RADIUS * 1.05;
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
    if (kind === "ember" || kind === "spark" || kind === "cinder") {
      lifes[i] = Math.min(1, (lifes[i] ?? 0) + dt * 0.6);
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
const PUFF_PARTICLES = 12;
const PUFF_LIFE = 0.85; // seconds
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

// ─── soft-ground creature marks ───
const GROUND_MARK_LIFT = 0.035;
const GROUND_MARK_MIN_Y = 0.04;
const GROUND_MARK_CAP = LOWFX ? 80 : 240;

const _groundMarkVS = `
attribute float aAlpha;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  vAlpha = aAlpha;
  vec4 worldPosition = modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const _groundMarkFS = `
precision highp float;
uniform vec3 uColor;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec2 p = vUv - 0.5;
  float d = length(vec2(p.x * 0.82, p.y * 1.18));
  float oval = 1.0 - smoothstep(0.18, 0.5, d);
  float center = 1.0 - smoothstep(0.04, 0.36, d);
  float alpha = oval * (0.72 + center * 0.28) * vAlpha;
  if (alpha <= 0.005) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`;

const _markM = new THREE.Matrix4();
const _markQ = new THREE.Quaternion();
const _markP = new THREE.Vector3();
const _markS = new THREE.Vector3();
const _markHiddenScale = new THREE.Vector3(0, 0, 0);
const _markUp = new THREE.Vector3(0, 1, 0);

function _hideGroundMark(system, i) {
  const d = system.userData;
  d.active[i] = 0;
  d.alphas[i] = 0;
  _markP.set(0, -999, 0);
  _markQ.identity();
  _markM.compose(_markP, _markQ, _markHiddenScale);
  system.setMatrixAt(i, _markM);
}

function _writeGroundMark(system, i, alphaScale) {
  const d = system.userData;
  const y = d.ys[i] + GROUND_MARK_LIFT;
  _markP.set(d.xs[i], y, d.zs[i]);
  _markQ.setFromAxisAngle(_markUp, d.headings[i]);
  _markS.set(d.widths[i], 1, d.lengths[i]);
  _markM.compose(_markP, _markQ, _markS);
  system.setMatrixAt(i, _markM);
  d.alphas[i] = d.opacities[i] * alphaScale;
}

export function makeGroundMarks(biome) {
  const cfg = biome.groundMarks;
  if (!cfg) return null;

  const capacity = Math.max(1, Math.round(cfg.capacity ?? GROUND_MARK_CAP));
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1).rotateX(-Math.PI / 2);
  const alphas = new Float32Array(capacity);
  geo.setAttribute("aAlpha", new THREE.InstancedBufferAttribute(alphas, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(cfg.color) },
    },
    vertexShader: _groundMarkVS,
    fragmentShader: _groundMarkFS,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.userData = {
    capacity,
    cursor: 0,
    active: new Uint8Array(capacity),
    xs: new Float32Array(capacity),
    ys: new Float32Array(capacity),
    zs: new Float32Array(capacity),
    headings: new Float32Array(capacity),
    widths: new Float32Array(capacity),
    lengths: new Float32Array(capacity),
    ages: new Float32Array(capacity),
    lifes: new Float32Array(capacity),
    opacities: new Float32Array(capacity),
    alphas,
    alphaAttr: geo.getAttribute("aAlpha"),
    cfg,
  };

  for (let i = 0; i < capacity; i++) _hideGroundMark(mesh, i);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.alphaAttr.needsUpdate = true;
  return mesh;
}

export function emitGroundMark(system, opts = {}) {
  if (!system || !system.userData) return;
  const d = system.userData;
  const x = opts.x;
  const z = opts.z;
  const y = opts.y ?? (state.heightFn ? state.heightFn(x, z) : 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
  if (state.waterMesh && y < GROUND_MARK_MIN_Y) return;

  const softness = d.cfg.softness ?? 1;
  const i = d.cursor;
  d.cursor = (d.cursor + 1) % d.capacity;
  d.active[i] = 1;
  d.xs[i] = x;
  d.ys[i] = y;
  d.zs[i] = z;
  d.headings[i] = opts.heading ?? 0;
  d.widths[i] = Math.max(0.01, (opts.width ?? 0.18) * softness);
  d.lengths[i] = Math.max(0.01, (opts.length ?? 0.32) * softness);
  d.ages[i] = 0;
  d.lifes[i] = opts.life ?? d.cfg.life ?? 6;
  d.opacities[i] = opts.opacity ?? d.cfg.opacity ?? 0.2;
  _writeGroundMark(system, i, 1);
  system.instanceMatrix.needsUpdate = true;
  d.alphaAttr.needsUpdate = true;
}

export function stepGroundMarks(system, dt, heightFn) {
  if (!system || !system.userData || dt <= 0) return;
  const d = system.userData;
  let matrixDirty = false;
  let alphaDirty = false;
  for (let i = 0; i < d.capacity; i++) {
    if (!d.active[i]) continue;
    d.ages[i] += dt;
    if (d.ages[i] >= d.lifes[i]) {
      _hideGroundMark(system, i);
      matrixDirty = true;
      alphaDirty = true;
      continue;
    }
    if (heightFn) d.ys[i] = heightFn(d.xs[i], d.zs[i]);
    const u = d.ages[i] / Math.max(0.001, d.lifes[i]);
    const fade = 1 - u * u * (3 - 2 * u);
    _writeGroundMark(system, i, fade);
    matrixDirty = true;
    alphaDirty = true;
  }
  if (matrixDirty) system.instanceMatrix.needsUpdate = true;
  if (alphaDirty) d.alphaAttr.needsUpdate = true;
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

export function makeWildflowerField(biome, heightFn, excludedCircles = []) {
  const palette = WILDFLOWER_PALETTES[biome.id] ?? ["#ffffff"];
  const total = _coverScale(FLOWER_DENSITY[biome.id] ?? 100, 1.6);
  const perColor = Math.max(8, Math.floor(total / palette.length));
  const meshes = [];

  for (const color of palette) {
    const g = new THREE.IcosahedronGeometry(0.05, 0);
    g.scale(1, 0.7, 1);
    const baseCol = new THREE.Color(color);
    const m = applyWindSway(
      new THREE.MeshStandardMaterial({
        color: baseCol,
        emissive: biome.glowFlowers ? baseCol.clone() : 0x000000,
        emissiveIntensity: biome.glowFlowers ? 1.1 : 0,
        flatShading: true,
        roughness: 0.4,
      }),
      1.2
    );
    const inst = placeInstanced(g, m, perColor, heightFn, {
      yOffset: 0.08,
      minScale: 0.6,
      maxScale: 1.5,
      tilt: 0,
      avoidObstacleKinds: ["lavafissure"],
      avoidRadius: 0.12,
      visualRadius: true,
      excludedCircles,
    });
    if (biome.glowFlowers) inst.layers.enable(BLOOM_LAYER);
    inst.userData.inspect = { category: "flora", variant: "wildflower" };
    meshes.push(inst);
  }
  return meshes;
}

export function makeVerdantGroveDetails(biome, heightFn, excludedCircles = []) {
  if (!biome.groveDetails?.groundCover) return null;

  const group = new THREE.Group();
  group.name = "verdant-grove-details";

  const mossGeo = new THREE.CircleGeometry(0.18, 10);
  mossGeo.scale(1.75, 0.85, 1);
  mossGeo.rotateX(-Math.PI / 2);
  const mossMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.ground[0]).lerp(new THREE.Color("#a9c985"), 0.28),
    flatShading: true,
    roughness: 1,
  });
  const mossPads = placeInstanced(mossGeo, mossMat, _coverScale(52), heightFn, {
    yOffset: 0.024,
    minScale: 0.65,
    maxScale: 1.75,
    tilt: 0.05,
    maxRadiusFrac: 0.84,
    minHeight: -0.2,
    avoidObstacleKinds: ["lavafissure"],
    avoidRadius: 0.12,
    visualRadius: true,
    excludedCircles,
  });
  mossPads.name = "moss-pads";
  mossPads.userData.inspect = { category: "flora", variant: "grassblade" };
  group.add(mossPads);

  const leafGeo = new THREE.CircleGeometry(0.06, 5);
  leafGeo.scale(1.9, 0.55, 1);
  leafGeo.rotateX(-Math.PI / 2);
  const leafMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.accent).lerp(new THREE.Color("#5a321d"), 0.36),
    flatShading: true,
    roughness: 0.9,
  });
  const leaves = placeInstanced(leafGeo, leafMat, _coverScale(80), heightFn, {
    yOffset: 0.035,
    minScale: 0.55,
    maxScale: 1.35,
    tilt: 0.16,
    maxRadiusFrac: 0.9,
    minHeight: -0.22,
    avoidObstacleKinds: ["lavafissure"],
    avoidRadius: 0.12,
    visualRadius: true,
    excludedCircles,
  });
  leaves.name = "leaf-litter";
  leaves.userData.inspect = { category: "flora", variant: "wildflower" };
  group.add(leaves);

  const cloverGeo = new THREE.ConeGeometry(0.055, 0.18, 4).translate(0, 0.09, 0);
  const cloverMat = applyWindSway(
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(biome.ground[2]).offsetHSL(0.02, 0.08, -0.1),
      flatShading: true,
      roughness: 0.85,
    }),
    1.2
  );
  const clover = placeInstanced(cloverGeo, cloverMat, _coverScale(70), heightFn, {
    yOffset: 0.028,
    minScale: 0.55,
    maxScale: 1.25,
    tilt: 0.4,
    maxRadiusFrac: 0.82,
    minHeight: -0.18,
    avoidObstacleKinds: ["lavafissure"],
    avoidRadius: 0.12,
    visualRadius: true,
    excludedCircles,
  });
  clover.name = "clover-tufts";
  clover.userData.inspect = { category: "flora", variant: "grassblade" };
  group.add(clover);

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

  const count = _coverScale(LOWFX ? 38 : 64);
  const geo = new THREE.IcosahedronGeometry(0.34, 1);
  geo.scale(1.7, 0.32, 1.25);
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
  const mesh = placeInstanced(geo, mat, count, heightFn, {
    yOffset: 0.05,
    minScale: 0.58,
    maxScale: 1.75,
    tilt: 0.08,
    maxRadiusFrac: 0.84,
    minHeight: -0.25,
    excludedCircles,
  });
  mesh.name = "cloud-puff-pads";
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  group.add(mesh);

  const floatingCloudlets = placeInstanced(geo, mat, _coverScale(LOWFX ? 14 : 24), heightFn, {
    yOffset: 0.34,
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
  group.userData.inspect = { category: "flora", variant: "cloudpuff" };
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
  applyRoundPlaneClip(mat, roundClipCenter());

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
