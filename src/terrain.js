import * as THREE from "three";
import { state, ISLAND_SIZE_BASE, ISLAND_RADIUS_BASE } from "./state.js";
import { makeTerrainPBRMaterial } from "./pbr.js";

// Terrain height function — one or more shaped islands with smoothstep falloff

export function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Per-center falloff: 1 at the centre of an island, 0 in the void around it.
// `shape.kind` is "round", "oblong" (stretched along an axis), or "kidney"
// (a circular bite carved from one side).
export function islandFalloff(center, x, z) {
  const sh = center.shape || { kind: "round" };
  const dx = x - center.cx;
  const dz = z - center.cz;
  const r = center.visualRadius ?? center.radius;
  if (sh.kind === "oblong") {
    const co = Math.cos(sh.orient), si = Math.sin(sh.orient);
    const lx = co * dx + si * dz;
    const lz = -si * dx + co * dz;
    const d = Math.sqrt((lx / sh.stretch) ** 2 + lz * lz);
    return smoothstep(r, r * 0.45, d);
  }
  if (sh.kind === "kidney") {
    const co = Math.cos(sh.orient), si = Math.sin(sh.orient);
    const lx = co * dx + si * dz;
    const lz = -si * dx + co * dz;
    const d = Math.sqrt(lx * lx + lz * lz);
    const f = smoothstep(r, r * 0.45, d);
    const biteCx = r * 0.6;
    const biteR = r * 0.42;
    const biteD = Math.sqrt((lx - biteCx) ** 2 + lz * lz);
    const bite = smoothstep(biteR, biteR * 0.2, biteD);
    return f * (1 - bite * sh.strength);
  }
  const d = Math.sqrt(dx * dx + dz * dz);
  return smoothstep(r, r * 0.45, d);
}

// Edge rim height — the terrain perimeter converges to this Y so that the
// grass-ring aura (flat RingGeometry at a fixed Y) always sits flush.
const EDGE_RIM_Y = 0.0;
// Falloff threshold below which terrain starts blending toward EDGE_RIM_Y.
// Below this the noise amplitude fades and height converges to a flat rim.
const RIM_LEVEL_START = 0.35;

export function makeHeightFn(noise2D, layout, amp = 3.0) {
  return (x, z) => {
    let falloff = 0;
    for (const c of layout.centers) {
      const f = islandFalloff(c, x, z);
      if (f > falloff) falloff = f;
    }
    let h = 0;
    h += noise2D(x * 0.06, z * 0.06) * amp;
    h += noise2D(x * 0.14, z * 0.14) * (amp * 0.45);
    h += noise2D(x * 0.32, z * 0.32) * (amp * 0.18);
    // Smooth falloff at the edges — terrain tapers to base-plane level (~0)
    // along the island boundary rather than plunging into the void.
    h *= falloff;
    // Rim leveling: as falloff drops below the threshold, blend toward a
    // uniform edge height so the perimeter is flat and the grass ring
    // (fixed-Y RingGeometry) always sits flush with the terrain edge.
    if (falloff < RIM_LEVEL_START) {
      const t = smoothstep(0, RIM_LEVEL_START, falloff);
      h = EDGE_RIM_Y + (h - EDGE_RIM_Y) * t;
    }
    return h;
  };
}

// Sample a random point on the layout, weighted by island area. Used for
// flora/creature/instance placement so multi-island worlds get coverage of
// every island and the void in between is skipped automatically.
export function pickGroundPoint(maxRadiusFrac = 0.88, opts = {}) {
  const centers = (opts.layout ?? state.currentLayout).centers;
  const radiusFor = (c) => opts.visualRadius ? (c.visualRadius ?? c.radius) : c.radius;
  const areaWeight = (c) => {
    const shape = c.shape ?? { kind: "round" };
    const stretch = shape.kind === "oblong" ? (shape.stretch ?? 1) : 1;
    return radiusFor(c) * radiusFor(c) * stretch;
  };

  let sum = 0;
  for (const c of centers) sum += areaWeight(c);
  let r = Math.random() * sum;
  let chosen = centers[0];
  for (const c of centers) {
    r -= areaWeight(c);
    if (r <= 0) { chosen = c; break; }
  }

  const shape = chosen.shape ?? { kind: "round" };
  const ang = Math.random() * Math.PI * 2;
  const rad = Math.sqrt(Math.random()) * radiusFor(chosen) * maxRadiusFrac;

  if (shape.kind === "oblong") {
    // Sample in the same stretched local frame used by islandFalloff().
    // Without this, grass/flora placement stays circular while the visible
    // island edge is elliptical, leaving bare margins at the stretched ends.
    const stretch = shape.stretch ?? 1;
    const lx = Math.cos(ang) * rad * stretch;
    const lz = Math.sin(ang) * rad;
    const co = Math.cos(shape.orient), si = Math.sin(shape.orient);
    return {
      x: chosen.cx + co * lx - si * lz,
      z: chosen.cz + si * lx + co * lz,
    };
  }

  return {
    x: chosen.cx + Math.cos(ang) * rad,
    z: chosen.cz + Math.sin(ang) * rad,
  };
}

// Nearest island center to (x, z). Used by entity edge-avoidance so creatures
// in multi-island worlds steer back to their own island rather than the world
// origin (which usually sits in the void between islands).
export function nearestCenter(x, z) {
  const centers = state.currentLayout.centers;
  let best = centers[0];
  let bestD2 = Infinity;
  for (const c of centers) {
    const dx = x - c.cx;
    const dz = z - c.cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = c; }
  }
  return best;
}

// Pick a layout for a freshly seeded world. Called inside `generateWorld`
// while `Math.random` is the seeded PRNG so the choice is deterministic.
//
// Always a single island. (Archipelagos were tried but the creature roaming
// + visual silhouette didn't read well across multiple disconnected chunks.)
export function pickLayout() {
  const sizeRoll = Math.random();
  const sizeMult = sizeRoll < 0.27 ? 0.78 : sizeRoll < 0.78 ? 1.0 : 1.15;
  const radius = ISLAND_RADIUS_BASE * sizeMult;
  const shape = { kind: "round" };
  const visualRadius = radius + Math.max(3.0, radius * 0.18);
  return {
    centers: [{ cx: 0, cz: 0, radius, visualRadius, shape }],
    planeSize: Math.max(ISLAND_SIZE_BASE, visualRadius * 2.4),
    boundRadius: visualRadius,
    kind: "single",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Terrain mesh
// ─────────────────────────────────────────────────────────────────────────────
export function clipCenter(worldState = state) {
  const centers = worldState.currentLayout?.centers ?? [];
  return centers.find((c) => (c.shape?.kind ?? "round") === "round") ?? centers[0] ?? null;
}

function patchTerrainClipShader(shader, center) {
  const clipRadius = center.visualRadius ?? center.radius;
  const shape = center.shape ?? { kind: "round" };
  shader.uniforms.uClipCenter = { value: new THREE.Vector2(center.cx, center.cz) };
  shader.uniforms.uClipRadius = { value: clipRadius };
  shader.uniforms.uClipShapeKind = { value: shape.kind === "oblong" ? 1 : 0 };
  shader.uniforms.uClipOrient = { value: shape.orient ?? 0 };
  shader.uniforms.uClipStretch = { value: shape.stretch ?? 1 };
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      "#include <common>\nvarying vec2 vClipXZ;"
    )
    .replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\nvClipXZ = transformed.xz;"
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
      uniform vec2 uClipCenter;
      uniform float uClipRadius;
      uniform int uClipShapeKind;
      uniform float uClipOrient;
      uniform float uClipStretch;
      varying vec2 vClipXZ;
      float terrainClipDistance(vec2 p) {
        vec2 d = p - uClipCenter;
        if (uClipShapeKind == 1) {
          float co = cos(uClipOrient), si = sin(uClipOrient);
          vec2 l = vec2(co * d.x + si * d.y, -si * d.x + co * d.y);
          return sqrt((l.x / uClipStretch) * (l.x / uClipStretch) + l.y * l.y);
        }
        return length(d);
      }`
    )
    .replace(
      "#include <clipping_planes_fragment>",
      "#include <clipping_planes_fragment>\nif (terrainClipDistance(vClipXZ) > uClipRadius) discard;"
    );
}

export function applyTerrainClip(mat, center) {
  if (!center) return;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    patchTerrainClipShader(shader, center);
  };
}

function makeTerrainDepthMaterial(center) {
  if (!center) return null;
  const mat = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  mat.onBeforeCompile = (shader) => patchTerrainClipShader(shader, center);
  return mat;
}

export function makeTerrain(biome, heightFn, worldState = state) {
  // segment density scales with size so larger worlds keep similar fidelity
  const segs = Math.round(140 * (worldState.ISLAND_SIZE / ISLAND_SIZE_BASE));
  const geo = new THREE.PlaneGeometry(
    worldState.ISLAND_SIZE,
    worldState.ISLAND_SIZE,
    segs,
    segs
  );
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c0 = new THREE.Color(biome.ground[0]);
  const c1 = new THREE.Color(biome.ground[1]);
  const c2 = new THREE.Color(biome.ground[2]);
  const cliffCol = new THREE.Color(biome.cliff);
  const cloudlike = !!biome.cloudlike;
  const cloudGlow = new THREE.Color(0xffffff);

  // first pass — set heights
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightFn(x, z));
  }

  geo.computeVertexNormals();

  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const slope = 1 - Math.abs(geo.attributes.normal.getY(i));

    // height-banded colour
    const t = THREE.MathUtils.clamp((y + 1.0) / 4.5, 0, 1);
    if (t < 0.5) {
      tmp.copy(c0).lerp(c1, smoothstep(0, 0.5, t));
    } else {
      tmp.copy(c1).lerp(c2, smoothstep(0.5, 1, t));
    }
    if (cloudlike) {
      // Cloud terrain should stay soft on slopes. Instead of dark cliff bands,
      // add broad cottony highlights and a lavender-blue low tint.
      const puff =
        0.5 +
        0.5 * Math.sin(x * 0.34 + z * 0.19) *
        Math.sin(x * 0.12 - z * 0.31);
      tmp.lerp(cloudGlow, 0.28 + puff * 0.2);
      tmp.lerp(cliffCol, Math.min(slope * 0.28, 0.18));
    } else {
      // mix in cliff colour for steep slopes
      tmp.lerp(cliffCol, Math.min(slope * 1.6, 0.85));
    }

    // subtle noise speckle; cloud terrain gets less contrast so it reads as
    // airy cotton instead of rocky dirt.
    const speckle = cloudlike
      ? 0.98 + Math.random() * 0.05
      : 0.92 + Math.random() * 0.16;
    colors[i * 3 + 0] = tmp.r * speckle;
    colors[i * 3 + 1] = tmp.g * speckle;
    colors[i * 3 + 2] = tmp.b * speckle;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const mat = makeTerrainPBRMaterial(biome, heightFn);

  const terrainClipCenter = clipCenter(worldState);
  applyTerrainClip(mat, terrainClipCenter);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  const terrainDepthMat = makeTerrainDepthMaterial(terrainClipCenter);
  if (terrainDepthMat) mesh.customDepthMaterial = terrainDepthMat;
  return mesh;
}
