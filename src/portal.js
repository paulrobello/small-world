import * as THREE from "three";
import { DENSITY_BASE, disposeGroup, state } from "./state.js";
import { makeHeightFn, pickGroundPoint, pickLayout } from "./terrain.js";
import { FLORA_BUILDERS } from "./flora.js";
import { makeCreature } from "./fauna.js";
import { makeGrassField } from "./grass.js";
import { makeSkyDome, makeMountainBackdrop, makeCloudLayer } from "./sky.js";
import { LOWFX } from "./lowfx.js";
import { mulberry32 } from "./seed.js";
import {
  terrainNoiseFromSeed,
  FLORA_FOOTPRINT,
  FLORA_FOOTPRINT_DEFAULT,
} from "./world-constants.js";

const PORTAL_RT_SIZE = LOWFX ? 256 : 768;
const PORTAL_RENDER_INTERVAL_MS = LOWFX ? 180 : 90;
const PORTAL_ACTIVE_DISTANCE = LOWFX ? 52 : 90;
const PORTAL_RING_RADIUS = 1.48;
const PORTAL_VIEW_RADIUS = PORTAL_RING_RADIUS - 0.04;
const PORTAL_GROUND_SINK = 0.18 + PORTAL_RING_RADIUS * 0.1;
const PORTAL_TRAVEL_PLANE_EPSILON = 0.38;
const PORTAL_TRAVEL_RADIUS = PORTAL_VIEW_RADIUS * 0.8;
export const PORTAL_ARRIVAL_OFFSET = PORTAL_RING_RADIUS + 0.9;
const PORTAL_PREVIEW_LOOK_DISTANCE = 8;
const PORTAL_FLORA_BLOCK_RADIUS = PORTAL_RING_RADIUS + 1.0;
const PORTAL_GRASS_CLEAR_HALF_LENGTH = 2.08;
const PORTAL_GRASS_CLEAR_RADIUS = PORTAL_RING_RADIUS * 0.86;
const PORTAL_GRASS_SHORTEN_RADIUS = PORTAL_RING_RADIUS * 1.45;
const PORTAL_GRASS_SHORTEN_TO = 0.14;
const PORTAL_PREVIEW_FLATTEN_RADIUS = 4.2;
const PORTAL_PREVIEW_FLATTEN_SIDE_RADIUS = 2.8;
const PORTAL_PREVIEW_GROUND_SINK = 0.15;
const PREVIEW_WATER_Y = -0.12;
const PREVIEW_FLORA_BURY = 0.08;
// PREVIEW_FLORA_FOOTPRINT / PREVIEW_FLORA_FOOTPRINT_DEFAULT alias the shared
// FLORA_FOOTPRINT table in ./world-constants.js (ARC-002) so the portal
// preview's slope-planting matches the real destination world exactly. The
// previous hand-copied table had silently diverged (e.g. a missing underscore
// in `beach_succulent`) — the dedup is the fix.
const PREVIEW_FLORA_FOOTPRINT = FLORA_FOOTPRINT;
const PREVIEW_FLORA_FOOTPRINT_DEFAULT = FLORA_FOOTPRINT_DEFAULT;

function normalizePortalPreviewSettings(settings = {}) {
  return {
    portalPreviewGrass: settings.portalPreviewGrass === true,
    portalPreviewFlora: settings.portalPreviewFlora !== false,
    portalPreviewCreatures: settings.portalPreviewCreatures === true,
    portalPreviewFx: settings.portalPreviewFx !== false,
  };
}

function portalNormal(portal) {
  const yaw = portal?.group?.rotation?.y ?? 0;
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

export function isCameraPassingThroughPortal(portal, camera, worldScale = 1) {
  if (!portal || !camera) return false;
  const invWorldScale = 1 / Math.max(0.001, worldScale);
  const center = portal.group.position;
  const normal = portalNormal(portal);
  const tangent = { x: Math.cos(portal.group.rotation.y), z: -Math.sin(portal.group.rotation.y) };
  const dx = camera.position.x * invWorldScale - center.x;
  const dy = camera.position.y * invWorldScale - center.y;
  const dz = camera.position.z * invWorldScale - center.z;
  const planeDist = Math.abs(dx * normal.x + dz * normal.z);
  const sideDist = dx * tangent.x + dz * tangent.z;
  const discDistSq = sideDist * sideDist + dy * dy;
  return planeDist < PORTAL_TRAVEL_PLANE_EPSILON && discDistSq < PORTAL_TRAVEL_RADIUS * PORTAL_TRAVEL_RADIUS;
}

export function getPortalArrivalPose(portal) {
  const normal = portalNormal(portal);
  const center = portal.group.position;
  return {
    x: center.x + normal.x * PORTAL_ARRIVAL_OFFSET,
    z: center.z + normal.z * PORTAL_ARRIVAL_OFFSET,
    yaw: Math.atan2(normal.x, normal.z) + Math.PI,
  };
}

export function getPortalSideArrivalPose(portal, side = 1) {
  const normal = portalNormal(portal);
  const center = portal.group.position;
  const sideSign = side >= 0 ? 1 : -1;
  return {
    x: center.x + normal.x * PORTAL_ARRIVAL_OFFSET * sideSign,
    z: center.z + normal.z * PORTAL_ARRIVAL_OFFSET * sideSign,
    yaw: Math.atan2(normal.x * sideSign, normal.z * sideSign) + Math.PI,
  };
}

export function getPortalSideEntryPose(portal, side = 1) {
  const normal = portalNormal(portal);
  const center = portal.group.position;
  const sideSign = side >= 0 ? 1 : -1;
  return {
    x: center.x + normal.x * PORTAL_ARRIVAL_OFFSET * sideSign,
    z: center.z + normal.z * PORTAL_ARRIVAL_OFFSET * sideSign,
    yaw: Math.atan2(normal.x * sideSign, normal.z * sideSign),
  };
}

export function getPortalCameraSide(portal, camera, worldScale = 1) {
  if (!portal || !camera) return 1;
  const invWorldScale = 1 / Math.max(0.001, worldScale);
  const center = portal.group.position;
  const normal = portalNormal(portal);
  const dx = camera.position.x * invWorldScale - center.x;
  const dz = camera.position.z * invWorldScale - center.z;
  return (dx * normal.x + dz * normal.z) >= 0 ? 1 : -1;
}

function makePortalRenderTarget(name) {
  const rt = new THREE.WebGLRenderTarget(PORTAL_RT_SIZE, PORTAL_RT_SIZE, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  rt.texture.name = name;
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  return rt;
}

function withSeededRandom(seed, fn) {
  const originalRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function samplePreviewTerrainFootprint(heightFn, x, z, r) {
  const diagonal = r * Math.SQRT1_2;
  const samples = [
    [0, 0],
    [r, 0], [-r, 0], [0, r], [0, -r],
    [diagonal, diagonal], [-diagonal, diagonal],
    [diagonal, -diagonal], [-diagonal, -diagonal],
  ];
  return samples.map(([dx, dz]) => heightFn(x + dx, z + dz));
}

function applyPreviewFlatZones(heightFn, flatZones) {
  if (!flatZones.length) return heightFn;
  return (x, z) => {
    let out = heightFn(x, z);
    for (const { cx, cz, r, flatY } of flatZones) {
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      const r2 = r * r;
      if (d2 >= r2) continue;
      const t = 1 - d2 / r2;
      const blend = t * t * (3 - 2 * t);
      out += (flatY - out) * blend;
    }
    return out;
  };
}

export function makeSeededPortalPlacement({
  seed,
  index = 0,
  layout,
  heightFn,
  isBlocked = () => false,
  maxRadiusFrac = 0.54,
  minRadiusFrac = 0,
  preferredAngle = null,
} = {}) {
  const minRadius = (layout?.boundRadius ?? 0) * minRadiusFrac;
  const minRadiusSq = minRadius * minRadius;
  const isInsideMinRadius = (x, z) => minRadiusSq > 0 && x * x + z * z < minRadiusSq;
  const buildPlacement = (p, y) => {
    const heading = Math.atan2(-p.x, -p.z);
    const nx = Math.sin(heading);
    const nz = Math.cos(heading);
    const frontX = p.x + nx * PORTAL_ARRIVAL_OFFSET;
    const frontZ = p.z + nz * PORTAL_ARRIVAL_OFFSET;
    const backX = p.x - nx * PORTAL_ARRIVAL_OFFSET;
    const backZ = p.z - nz * PORTAL_ARRIVAL_OFFSET;
    const groundY = Math.max(
      y,
      ...samplePreviewTerrainFootprint(heightFn, p.x, p.z, PORTAL_PREVIEW_FLATTEN_RADIUS * 0.65),
      ...samplePreviewTerrainFootprint(heightFn, frontX, frontZ, PORTAL_PREVIEW_FLATTEN_SIDE_RADIUS * 0.55),
      ...samplePreviewTerrainFootprint(heightFn, backX, backZ, PORTAL_PREVIEW_FLATTEN_SIDE_RADIUS * 0.55)
    ) - PORTAL_PREVIEW_GROUND_SINK;
    return {
      x: p.x,
      z: p.z,
      y: groundY,
      heading,
      nx,
      nz,
      flatZones: [
        { cx: p.x, cz: p.z, r: PORTAL_PREVIEW_FLATTEN_RADIUS, flatY: groundY },
        { cx: frontX, cz: frontZ, r: PORTAL_PREVIEW_FLATTEN_SIDE_RADIUS, flatY: groundY },
        { cx: backX, cz: backZ, r: PORTAL_PREVIEW_FLATTEN_SIDE_RADIUS, flatY: groundY },
      ],
    };
  };
  const rngSeed = ((seed >>> 0) ^ Math.imul(index + 1, 0x9e3779b9) ^ 0x7050a17d) >>> 0;
  for (let tries = 0; tries < 96; tries++) {
    const p = withSeededRandom(rngSeed + tries, () => pickGroundPoint(maxRadiusFrac, { layout }));
    const y = heightFn(p.x, p.z);
    if (y < -0.18 || isInsideMinRadius(p.x, p.z) || isBlocked(p.x, p.z)) continue;
    return buildPlacement(p, y);
  }
  const radius = (layout?.boundRadius ?? 0) * Math.max(minRadiusFrac, maxRadiusFrac * 0.92);
  const baseAngle = preferredAngle ?? (mulberry32(rngSeed)() * Math.PI * 2);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let tries = 0; tries < 32; tries++) {
    const a = baseAngle + tries * golden;
    const p = { x: Math.cos(a) * radius, z: Math.sin(a) * radius };
    const y = heightFn(p.x, p.z);
    if (y < -0.18 || isBlocked(p.x, p.z)) continue;
    return buildPlacement(p, y);
  }
  return { x: 0, z: 0, y: heightFn(0, 0), heading: 0, nx: 0, nz: 1, flatZones: [] };
}

function makePreviewWorldContext(targetBiome, seed) {
  return withSeededRandom(seed, () => {
    Math.random(); // consume the biome roll exactly like generateWorld
    const layout = pickLayout();
    const noise2D = terrainNoiseFromSeed(seed);
    const terrainAmp = targetBiome.cloudlike ? 2.15 : 3.2;
    const baseHeightFn = makeHeightFn(noise2D, layout, terrainAmp);
    const rawHeightFn = targetBiome.water
      ? (x, z) => {
        const h = baseHeightFn(x, z);
        const depth = PREVIEW_WATER_Y - h;
        if (depth <= 0) return h;
        const wet = Math.min(1, depth / 1.6);
        const smoothWet = wet * wet * (3 - 2 * wet);
        return h - smoothWet * (0.45 + depth * 0.28);
      }
      : baseHeightFn;
    const portalAnchor = makeSeededPortalPlacement({ seed, index: 0, layout, heightFn: rawHeightFn });
    const heightFn = applyPreviewFlatZones(rawHeightFn, portalAnchor.flatZones);
    return { layout, heightFn, portalAnchor };
  });
}

function pickPreviewGroundPoint(layout, rng, maxRadiusFrac = 0.88) {
  const originalRandom = Math.random;
  Math.random = rng;
  try {
    return pickGroundPoint(maxRadiusFrac, { layout });
  } finally {
    Math.random = originalRandom;
  }
}

function isInPortalPreviewSightline(x, z, portalAnchor) {
  const dx = x - portalAnchor.x;
  const dz = z - portalAnchor.z;
  const alongAxis = dx * portalAnchor.nx + dz * portalAnchor.nz;
  const sideAxis = dx * portalAnchor.nz - dz * portalAnchor.nx;
  const inDirection = (dir) => {
    const along = dir * alongAxis - PORTAL_ARRIVAL_OFFSET;
    if (along < -0.4 || along > PORTAL_PREVIEW_LOOK_DISTANCE * 0.9) return false;
    const radius = PORTAL_VIEW_RADIUS * 0.62 + along * 0.045;
    return Math.abs(sideAxis) < radius;
  };
  return inDirection(1) || inDirection(-1);
}

function isNearPortalPreviewClearance(x, z, r, portalAnchor) {
  const minD = PORTAL_FLORA_BLOCK_RADIUS + r;
  const dx = x - portalAnchor.x;
  const dz = z - portalAnchor.z;
  return dx * dx + dz * dz < minD * minD;
}

function clonePreviewObjectUnique(source) {
  const clone = source.clone(true);
  clone.traverse((child) => {
    if (child.geometry) child.geometry = child.geometry.clone();
    if (child.material) {
      child.material = Array.isArray(child.material)
        ? child.material.map((mat) => mat.clone())
        : child.material.clone();
    }
  });
  return clone;
}

// QA-009: dispose the GPU resources of a builder-produced original that we
// cloned-and-discard. The clone (from clonePreviewObjectUnique) already owns
// its own geometry/material copies, so the original is fully redundant.
//
// We CANNOT blindly disposeGroup the original: flora/creature builders pull
// some geometries/materials from the shared per-regen pool (`_floraPool` /
// `_creaturePool` in src/flora/_shared.js and src/fauna/creature.js), and
// those same pooled handles are currently referenced by the LIVE real world
// (state.world) — disposing them would corrupt real-world flora/creatures.
//
// Safe policy: collect every geometry/material reachable from state.world into
// a retained set, then dispose only the original's resources NOT in that set.
// Per-instance (non-pooled) allocations unique to the discarded original get
// freed; pooled/shared handles are left untouched for the pool/real world.
function disposePreviewOriginal(original) {
  if (!original) return;
  const retained = new Set();
  const collect = () => {
    const world = state.world;
    if (world) {
      world.traverse((o) => {
        if (o.geometry) retained.add(o.geometry);
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((m) => retained.add(m));
          else retained.add(o.material);
        }
      });
    }
  };
  collect();
  const disposedMaterials = new Set();
  const disposedTextures = new Set();
  original.traverse((o) => {
    if (o.geometry && !retained.has(o.geometry)) {
      o.geometry.dispose();
    }
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (retained.has(m) || disposedMaterials.has(m)) continue;
        disposedMaterials.add(m);
        // Dispose only textures this material owns uniquely.
        for (const key of Object.keys(m)) {
          const v = m[key];
          if (v && v.isTexture && !disposedTextures.has(v)) {
            disposedTextures.add(v);
            v.dispose();
          }
        }
        m.dispose();
      }
    }
  });
}

function withPreviewWorldState(targetBiome, layout, heightFn, fn) {
  const previous = {
    ISLAND_SIZE: state.ISLAND_SIZE,
    ISLAND_RADIUS: state.ISLAND_RADIUS,
    currentLayout: state.currentLayout,
    heightFn: state.heightFn,
    currentBiome: state.currentBiome,
    obstacles: state.obstacles,
    grass: state.grass,
    userSettings: state.userSettings,
  };
  state.ISLAND_SIZE = layout.planeSize;
  state.ISLAND_RADIUS = layout.boundRadius;
  state.currentLayout = layout;
  state.heightFn = heightFn;
  state.currentBiome = targetBiome;
  state.obstacles = [];
  state.grass = null;
  state.userSettings = previous.userSettings;
  try {
    return fn();
  } finally {
    state.ISLAND_SIZE = previous.ISLAND_SIZE;
    state.ISLAND_RADIUS = previous.ISLAND_RADIUS;
    state.currentLayout = previous.currentLayout;
    state.heightFn = previous.heightFn;
    state.currentBiome = previous.currentBiome;
    state.obstacles = previous.obstacles;
    state.grass = previous.grass;
    state.userSettings = previous.userSettings;
  }
}

function makePortalMaterial(frontTexture, backTexture, settings) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tPortalFront: { value: frontTexture },
      tPortalBack: { value: backTexture },
      uEdgeColor: { value: new THREE.Color("#f6e7ff") },
      uTime: { value: 0 },
      uDistortStrength: { value: LOWFX ? 0.00675 : 0.01125 },
      uFxStrength: { value: settings.portalPreviewFx ? 1 : 0 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tPortalFront;
      uniform sampler2D tPortalBack;
      uniform vec3 uEdgeColor;
      uniform float uTime;
      uniform float uDistortStrength;
      uniform float uFxStrength;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float d = length(p);
        if (d > 1.0) discard;
        float angle = atan(p.y, p.x);
        float radialWave = sin(d * 22.0 - uTime * 2.8);
        float swirlWave = sin(angle * 7.0 + d * 8.0 + uTime * 1.7);
        float rippleMask = smoothstep(0.06, 0.42, d) * (1.0 - smoothstep(0.94, 1.0, d));
        vec2 radialDir = p / max(d, 0.001);
        vec2 tangentDir = vec2(-radialDir.y, radialDir.x);
        vec2 warpedUv = vUv
          + radialDir * radialWave * uDistortStrength * rippleMask * uFxStrength
          + tangentDir * swirlWave * uDistortStrength * 0.42 * rippleMask * uFxStrength;
        warpedUv = clamp(warpedUv, vec2(0.001), vec2(0.999));
        vec2 backUv = vec2(1.0 - warpedUv.x, warpedUv.y);
        vec3 frontCol = texture2D(tPortalFront, warpedUv).rgb;
        vec3 backCol = texture2D(tPortalBack, backUv).rgb;
        vec3 col = gl_FrontFacing ? frontCol : backCol;
        col += (radialWave * 0.5 + 0.5) * 0.035 * rippleMask * uFxStrength;
        float rim = smoothstep(0.86, 1.0, d);
        float alpha = 1.0 - smoothstep(0.985, 1.0, d);
        col = mix(col, uEdgeColor, rim * 0.18 * uFxStrength);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

function makePreviewTerrain(biome, heightFn, size) {
  const segs = LOWFX ? 64 : 128;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color(biome.ground[0]);
  const mid = new THREE.Color(biome.ground[1]);
  const high = new THREE.Color(biome.ground[2]);
  const cliff = new THREE.Color(biome.cliff);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightFn(x, z);
    pos.setY(i, y);
    const t = THREE.MathUtils.clamp((y + 1.0) / 4.2, 0, 1);
    tmp.copy(low).lerp(t < 0.52 ? mid : high, t < 0.52 ? t / 0.52 : (t - 0.52) / 0.48);
    tmp.lerp(cliff, Math.max(0, Math.min(0.32, Math.abs(y) * 0.045)));
    colors[i * 3 + 0] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  return mesh;
}

function makePreviewWater(biome, layout) {
  if (!biome.water) return null;
  const geo = new THREE.PlaneGeometry(layout.planeSize * 1.05, layout.planeSize * 1.05, 36, 36);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(biome.water),
    transparent: true,
    opacity: 0.5,
    roughness: 0.26,
    metalness: 0,
    clearcoat: 0.25,
    clearcoatRoughness: 0.2,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = PREVIEW_WATER_Y;
  return mesh;
}

function makePreviewFloraGroundY(kind, scale, x, z, heightFn) {
  const fp = (PREVIEW_FLORA_FOOTPRINT[kind] ?? PREVIEW_FLORA_FOOTPRINT_DEFAULT) * scale;
  return Math.min(
    heightFn(x, z),
    heightFn(x + fp, z),
    heightFn(x - fp, z),
    heightFn(x, z + fp),
    heightFn(x, z - fp)
  ) - PREVIEW_FLORA_BURY;
}

function makePreviewFlora(targetBiome, rng, heightFn, layout, portalAnchor) {
  const group = new THREE.Group();
  const targetCount = Math.min(
    LOWFX ? 18 : 42,
    Math.max(10, Math.round((targetBiome.floraCount ?? 60) * (layout.planeSize / DENSITY_BASE) * 0.24))
  );
  let placed = 0;
  let attempts = 0;
  while (placed < targetCount && attempts < targetCount * 10) {
    attempts++;
    const kind = targetBiome.flora[Math.floor(rng() * targetBiome.flora.length)];
    const p = pickPreviewGroundPoint(layout, rng, 0.88);
    if (isInPortalPreviewSightline(p.x, p.z, portalAnchor)) continue;
    const y = heightFn(p.x, p.z);
    if (y < (targetBiome.water ? PREVIEW_WATER_Y + 0.03 : -0.28)) continue;
    const scaleMul = (0.75 + rng() * 0.65) *
      (kind === "tree" || kind === "leafballtree" || kind === "pine" || kind === "snowpine" || kind === "deadtree" || kind === "balloontree" ? 1.65 : 1);
    const fp = (PREVIEW_FLORA_FOOTPRINT[kind] ?? PREVIEW_FLORA_FOOTPRINT_DEFAULT) * scaleMul;
    if (isNearPortalPreviewClearance(p.x, p.z, fp, portalAnchor)) continue;
    const builder = FLORA_BUILDERS[kind] ?? FLORA_BUILDERS.rock;
    const original = builder(targetBiome);
    const obj = clonePreviewObjectUnique(original);
    disposePreviewOriginal(original);
    obj.position.set(p.x, makePreviewFloraGroundY(kind, scaleMul, p.x, p.z, heightFn), p.z);
    obj.rotation.y = rng() * Math.PI * 2;
    obj.scale.setScalar(scaleMul);
    group.add(obj);
    placed++;
  }
  return group;
}

function makePreviewGrass(targetBiome, heightFn, layout, portalAnchor) {
  const portalShortGrass = [{
    x: portalAnchor.x,
    z: portalAnchor.z,
    r: PORTAL_GRASS_SHORTEN_RADIUS,
    shortenTo: PORTAL_GRASS_SHORTEN_TO,
  }];
  const portalClearCapsules = [{
    x: portalAnchor.x,
    z: portalAnchor.z,
    nx: portalAnchor.nx,
    nz: portalAnchor.nz,
    halfLength: PORTAL_GRASS_CLEAR_HALF_LENGTH,
    r: PORTAL_GRASS_CLEAR_RADIUS,
  }];
  return withPreviewWorldState(targetBiome, layout, heightFn, () => {
    const grass = makeGrassField(targetBiome, heightFn, [], portalShortGrass, portalClearCapsules);
    if (grass) grass.name = "PortalPreviewGrass";
    return grass;
  });
}

function makePreviewCreatures(targetBiome, rng, heightFn, layout, portalAnchor) {
  const group = new THREE.Group();
  group.name = "PortalPreviewCreatures";
  const count = LOWFX ? 3 : 6;
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 10) {
    attempts++;
    const p = pickPreviewGroundPoint(layout, rng, 0.72);
    if (isInPortalPreviewSightline(p.x, p.z, portalAnchor)) continue;
    const y = heightFn(p.x, p.z);
    if (y < -0.2) continue;
    const creatureOriginal = makeCreature(targetBiome).group;
    const creature = clonePreviewObjectUnique(creatureOriginal);
    disposePreviewOriginal(creatureOriginal);
    creature.position.set(p.x, y + 0.18, p.z);
    creature.rotation.y = rng() * Math.PI * 2;
    creature.scale.setScalar(0.9 + rng() * 0.22);
    group.add(creature);
    placed++;
  }
  return group;
}

function previewPortalEyeY(heightFn, x, z) {
  return heightFn(x, z) + 1.9;
}

function positionPreviewCamera(camera, portalAnchor, heightFn, side) {
  const x = portalAnchor.x + portalAnchor.nx * PORTAL_ARRIVAL_OFFSET * side;
  const z = portalAnchor.z + portalAnchor.nz * PORTAL_ARRIVAL_OFFSET * side;
  const lookX = x + portalAnchor.nx * PORTAL_PREVIEW_LOOK_DISTANCE * side;
  const lookZ = z + portalAnchor.nz * PORTAL_PREVIEW_LOOK_DISTANCE * side;
  const y = previewPortalEyeY(heightFn, x, z);
  camera.position.set(x, y, z);
  camera.lookAt(lookX, y, lookZ);
}

function syncPreviewProjectionToCamera(previewCamera, camera) {
  if (!previewCamera || !camera) return;
  const aspect = Math.max(0.001, camera.aspect || 1);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * aspect);
  previewCamera.fov = THREE.MathUtils.radToDeg(Math.max(vFov, hFov));
  previewCamera.aspect = 1;
  previewCamera.zoom = camera.zoom;
  previewCamera.near = camera.near;
  previewCamera.far = camera.far;
  previewCamera.updateProjectionMatrix();
}

function buildPortalPreviewScene(targetBiome, seed, previewSettings = {}) {
  const settings = normalizePortalPreviewSettings(previewSettings);
  const previewScene = new THREE.Scene();
  previewScene.name = "PortalPreview";
  previewScene.background = new THREE.Color(targetBiome.sky);
  previewScene.fog = new THREE.FogExp2(new THREE.Color(targetBiome.fog), targetBiome.fogDensity * 0.65);

  const rng = mulberry32((seed ^ 0x9e37) >>> 0);
  const { layout, heightFn, portalAnchor } = makePreviewWorldContext(targetBiome, seed);

  previewScene.add(makeSkyDome(targetBiome));
  const mountains = makeMountainBackdrop(targetBiome);
  mountains.position.y -= 2.2;
  previewScene.add(mountains);
  const clouds = makeCloudLayer(targetBiome);
  if (clouds) previewScene.add(clouds);
  previewScene.add(new THREE.HemisphereLight(new THREE.Color(targetBiome.sky), new THREE.Color(targetBiome.ground[0]), 1.5));
  const sun = new THREE.DirectionalLight(new THREE.Color(targetBiome.sun), 1.4);
  sun.position.set(10, 16, 8);
  previewScene.add(sun);
  previewScene.add(makePreviewTerrain(targetBiome, heightFn, layout.planeSize));
  const water = makePreviewWater(targetBiome, layout);
  if (water) previewScene.add(water);
  if (settings.portalPreviewFlora) previewScene.add(makePreviewFlora(targetBiome, rng, heightFn, layout, portalAnchor));
  if (settings.portalPreviewGrass) previewScene.add(makePreviewGrass(targetBiome, heightFn, layout, portalAnchor));
  if (settings.portalPreviewCreatures) previewScene.add(makePreviewCreatures(targetBiome, rng, heightFn, layout, portalAnchor));

  const previewFrontCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 140);
  positionPreviewCamera(previewFrontCamera, portalAnchor, heightFn, 1);

  const previewBackCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 140);
  positionPreviewCamera(previewBackCamera, portalAnchor, heightFn, -1);

  return { scene: previewScene, frontCamera: previewFrontCamera, backCamera: previewBackCamera };
}

export function createBiomePortal({
  sourceBiome,
  targetBiome,
  x,
  y,
  z,
  heading = 0,
  seed = 0,
  targetSeed = seed,
  previewSettings = {},
}) {
  const settings = normalizePortalPreviewSettings(previewSettings);
  const frontRt = makePortalRenderTarget("PortalPreviewFrontTexture");
  const backRt = makePortalRenderTarget("PortalPreviewBackTexture");

  const preview = buildPortalPreviewScene(targetBiome, seed, settings);

  const group = new THREE.Group();
  group.name = "PortalRing";
  group.position.set(x, y + PORTAL_RING_RADIUS - PORTAL_GROUND_SINK, z);
  group.rotation.y = heading;
  group.userData.portal = { sourceBiome: sourceBiome.id, targetBiome: targetBiome.id };

  const ringMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(targetBiome.cliff).lerp(new THREE.Color(targetBiome.accent), 0.35),
    emissive: new THREE.Color(targetBiome.accent).multiplyScalar(0.18),
    roughness: 0.62,
    metalness: 0.08,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(PORTAL_RING_RADIUS, 0.13, 12, 72), ringMat);
  ring.name = "PortalRing";
  ring.castShadow = true;
  ring.receiveShadow = true;
  group.add(ring);

  const view = new THREE.Mesh(
    new THREE.CircleGeometry(PORTAL_VIEW_RADIUS, 72),
    makePortalMaterial(frontRt.texture, backRt.texture, settings)
  );
  view.name = "PortalView";
  view.position.z = 0.018;
  group.add(view);

  return {
    group,
    ring,
    view,
    frontRt,
    backRt,
    previewScene: preview.scene,
    previewFrontCamera: preview.frontCamera,
    previewBackCamera: preview.backCamera,
    sourceBiome,
    targetBiome,
    seed,
    targetSeed,
    previewSettings: settings,
    lastRenderAt: -Infinity,
    blocker: {
      kind: "portal",
      x,
      z,
      r: PORTAL_FLORA_BLOCK_RADIUS,
      grassRadius: PORTAL_RING_RADIUS * 1.45,
      grassClearance: {
        x,
        z,
        nx: Math.sin(heading),
        nz: Math.cos(heading),
        halfLength: PORTAL_GRASS_CLEAR_HALF_LENGTH,
        r: PORTAL_GRASS_CLEAR_RADIUS,
      },
    },
    obstacle: { kind: "portal", x, z, r: PORTAL_RING_RADIUS * 1.12, top: y + PORTAL_RING_RADIUS * 2.0 },
  };
}

export function updatePortalPreview(portal, renderer, camera, nowSeconds = 0) {
  if (!portal || !renderer || !camera) return;
  portal.view.material.uniforms.uTime.value = nowSeconds;
  if (camera.position.distanceTo(portal.group.position) > PORTAL_ACTIVE_DISTANCE) return;
  const nowMs = nowSeconds * 1000;
  if (nowMs - portal.lastRenderAt < PORTAL_RENDER_INTERVAL_MS) return;
  portal.lastRenderAt = nowMs;
  syncPreviewProjectionToCamera(portal.previewFrontCamera, camera);
  syncPreviewProjectionToCamera(portal.previewBackCamera, camera);

  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(portal.frontRt);
  renderer.clear();
  renderer.render(portal.previewScene, portal.previewFrontCamera);
  renderer.setRenderTarget(portal.backRt);
  renderer.clear();
  renderer.render(portal.previewScene, portal.previewBackCamera);
  renderer.setRenderTarget(prevTarget);
}

export function updatePortalPreviewSettings(portal, previewSettings = {}) {
  if (!portal) return;
  const settings = normalizePortalPreviewSettings(previewSettings);
  portal.previewSettings = settings;
  if (portal.view?.material?.uniforms?.uFxStrength) {
    portal.view.material.uniforms.uFxStrength.value = settings.portalPreviewFx ? 1 : 0;
  }
  disposeGroup(portal.previewScene);
  const preview = buildPortalPreviewScene(portal.targetBiome, portal.seed, settings);
  portal.previewScene = preview.scene;
  portal.previewFrontCamera = preview.frontCamera;
  portal.previewBackCamera = preview.backCamera;
  portal.lastRenderAt = -Infinity;
}

export function disposePortal(portal) {
  if (!portal) return;
  disposeGroup(portal.group);
  disposeGroup(portal.previewScene);
  portal.frontRt?.dispose();
  portal.backRt?.dispose();
}
