import * as THREE from "three";
import { state, DENSITY_BASE } from "./state.js";
import { jitterGeo, applyWindSway } from "./util.js";
import { pickGroundPoint } from "./terrain.js";
import { WILDFLOWER_PALETTES, GRASS_DENSITY, FLOWER_DENSITY, PEBBLE_DENSITY } from "./biomes.js";
import { LOWFX, LOWFX_DENSITY } from "./lowfx.js";

const _lowfxScale = (n) => (LOWFX ? Math.max(1, Math.round(n * LOWFX_DENSITY)) : n);

// Ground-cover counts were tuned against DENSITY_BASE; scale linearly with the
// current ISLAND_SIZE so larger worlds keep the same per-area density. The
// optional `gain` lets a specific layer be visually denser than the historical
// baseline (grass and wildflowers were tuned too sparse for the new size).
const _coverScale = (n, gain = 1) =>
  _lowfxScale(Math.round(n * (state.ISLAND_SIZE / DENSITY_BASE) * gain));

// ─── particles ───
export function makeParticles(biome) {
  const kind = biome.particle;
  const baseCount = {
    pollen: 240,
    dust: 320,
    snow: 500,
    firefly: 90,
    ember: 180,
    lichenmote: 140,
    feather: 120,
    bubble: 140,
    leaf: 120,
    spark: 240,
    rain: 520,
  }[kind] || 200;
  const count = _lowfxScale(baseCount);

  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const seeds = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(Math.random()) * state.ISLAND_RADIUS * 1.1;
    const a = Math.random() * Math.PI * 2;
    positions[i * 3 + 0] = Math.cos(a) * r;
    positions[i * 3 + 1] = Math.random() * 14;
    positions[i * 3 + 2] = Math.sin(a) * r;
    velocities[i * 3 + 0] = (Math.random() - 0.5) * 0.4;
    velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
    velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
    seeds[i] = Math.random() * 100;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const colorMap = {
    pollen: biome.sun,
    dust: biome.fog,
    snow: "#ffffff",
    firefly: biome.accent,
    ember: biome.accent,
    lichenmote: biome.accent,
    feather: "#ffffff",
    bubble: biome.water || biome.sky,
    leaf: biome.accent,
    spark: biome.sun,
    rain: biome.sun,
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
  };
  const opacityMap = {
    dust: 0.35,
    feather: 0.7,
    bubble: 0.55,
    leaf: 0.85,
    spark: 0.95,
    rain: 0.55,
  };
  const additive = new Set(["firefly", "ember", "lichenmote", "spark"]);

  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(colorMap[kind]),
    size: sizeMap[kind] ?? 0.07,
    transparent: true,
    opacity: opacityMap[kind] ?? 0.85,
    depthWrite: false,
    blending: additive.has(kind)
      ? THREE.AdditiveBlending
      : THREE.NormalBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  points.userData = { kind, velocities, seeds, count };
  return points;
}

export function stepParticles(points, dt, t) {
  if (!points) return;
  const { kind, velocities, seeds, count } = points.userData;
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

  // firefly twinkle
  if (kind === "firefly") {
    points.material.opacity = 0.6 + Math.sin(t * 2) * 0.25;
  } else if (kind === "lichenmote") {
    points.material.opacity = 0.45 + Math.sin(t * 1.4) * 0.2;
  } else if (kind === "spark") {
    points.material.opacity = 0.75 + Math.sin(t * 4.5) * 0.2;
  }

  points.geometry.attributes.position.needsUpdate = true;
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
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(baseColor).offsetHSL(0, -0.05, 0.05),
    size: 0.14,
    transparent: true,
    opacity: 0.9,
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

// ─── ground cover + water ───
export function placeInstanced(geo, mat, count, heightFn, opts = {}) {
  const {
    yOffset = 0,
    maxRadiusFrac = 0.88,
    minScale = 0.6,
    maxScale = 1.3,
    minHeight = -0.15,
    tilt = 0.25,
    fullRotation = true,
  } = opts;

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
    const p = pickGroundPoint(maxRadiusFrac);
    const x = p.x;
    const z = p.z;
    const y = heightFn(x, z);
    if (y < minHeight) continue;

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

export function makeGrassField(biome, heightFn) {
  const count = _coverScale(GRASS_DENSITY[biome.id] ?? 300, 1.7);
  // Short ribbon — a tall thin plane with extra height segments so the wind
  // shader can curve the blade smoothly. Slightly tapered toward the tip
  // by hand-warping the top vertices.
  const blade = new THREE.PlaneGeometry(0.06, 0.34, 1, 3);
  // taper the top + push bottom flat to the ground
  const bp = blade.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const y = bp.getY(i) + 0.17; // shift so base sits at y=0, tip at y=0.34
    bp.setY(i, y);
    // taper width with height
    const taper = 1 - Math.min(1, y / 0.34) * 0.6;
    bp.setX(i, bp.getX(i) * taper);
  }
  blade.computeVertexNormals();

  const base = new THREE.Color(biome.ground[1]).offsetHSL(
    (Math.random() - 0.5) * 0.04, 0.1, -0.08
  );
  const m = applyWindSway(
    new THREE.MeshStandardMaterial({
      color: base,
      roughness: 0.95,
      side: THREE.DoubleSide,
    }),
    1.8
  );
  return placeInstanced(blade, m, count, heightFn, {
    minScale: 0.6,
    maxScale: 1.4,
    tilt: 0.18,
  });
}

export function makeWildflowerField(biome, heightFn) {
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
    meshes.push(
      placeInstanced(g, m, perColor, heightFn, {
        yOffset: 0.08,
        minScale: 0.6,
        maxScale: 1.5,
        tilt: 0,
      })
    );
  }
  return meshes;
}

export function makePebbleField(biome, heightFn) {
  const count = _coverScale(PEBBLE_DENSITY[biome.id] ?? 80);
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
  return placeInstanced(g, m, count, heightFn, {
    yOffset: 0.02,
    minScale: 0.4,
    maxScale: 1.1,
    tilt: 0.5,
  });
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
  });
  const mesh = new THREE.Mesh(geo, mat);
  // sit a touch below sea level so the underside cone meets the water
  mesh.position.y = -0.12;
  mesh.receiveShadow = true;
  // cache the base XZ so we can offset Y each frame from a clean reference
  const arr = geo.attributes.position.array;
  mesh.userData.basePositions = new Float32Array(arr);
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
