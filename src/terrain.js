import * as THREE from "three";
import { state, ISLAND_SIZE_BASE, ISLAND_RADIUS_BASE } from "./state.js";
import { jitterGeo } from "./util.js";

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
  const r = center.radius;
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
    h *= falloff;
    // edges plunge into void
    if (falloff < 0.05) h -= (1 - falloff) * 6;
    return h;
  };
}

// Sample a random point on the layout, weighted by island area. Used for
// flora/creature/instance placement so multi-island worlds get coverage of
// every island and the void in between is skipped automatically.
export function pickGroundPoint(maxRadiusFrac = 0.88) {
  const centers = state.currentLayout.centers;
  let sum = 0;
  for (const c of centers) sum += c.radius * c.radius;
  let r = Math.random() * sum;
  let chosen = centers[0];
  for (const c of centers) {
    r -= c.radius * c.radius;
    if (r <= 0) { chosen = c; break; }
  }
  const ang = Math.random() * Math.PI * 2;
  const rad = Math.sqrt(Math.random()) * chosen.radius * maxRadiusFrac;
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
export function pickLayout() {
  // ~18% of worlds are tiny archipelagos of 2–3 small islands.
  if (Math.random() < 0.18) {
    const n = 2 + Math.floor(Math.random() * 2);
    const centers = [];
    const spread = n === 2 ? 8.5 : 10;
    const startAngle = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const ang = startAngle + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const dist = spread + (Math.random() - 0.5) * 1.6;
      const radius = 4.4 + Math.random() * 2.0;
      centers.push({
        cx: Math.cos(ang) * dist,
        cz: Math.sin(ang) * dist,
        radius,
        shape: { kind: "round" },
      });
    }
    const bound = centers.reduce((m, c) => {
      const d = Math.sqrt(c.cx * c.cx + c.cz * c.cz);
      return Math.max(m, d + c.radius);
    }, 0);
    return {
      centers,
      planeSize: Math.max(ISLAND_SIZE_BASE, bound * 2.4),
      boundRadius: bound,
      kind: "archipelago",
    };
  }

  // Single island — size + shape variations.
  const sizeRoll = Math.random();
  const sizeMult = sizeRoll < 0.27 ? 0.78 : sizeRoll < 0.78 ? 1.0 : 1.15;
  const radius = ISLAND_RADIUS_BASE * sizeMult;
  const shapeRoll = Math.random();
  let shape;
  if (shapeRoll < 0.5) {
    shape = { kind: "round" };
  } else if (shapeRoll < 0.82) {
    shape = {
      kind: "oblong",
      orient: Math.random() * Math.PI,
      stretch: 1.22 + Math.random() * 0.28,
    };
  } else {
    shape = {
      kind: "kidney",
      orient: Math.random() * Math.PI * 2,
      strength: 0.55 + Math.random() * 0.2,
    };
  }
  return {
    centers: [{ cx: 0, cz: 0, radius, shape }],
    planeSize: Math.max(ISLAND_SIZE_BASE, radius * 2.4),
    boundRadius: radius,
    kind: "single",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Terrain mesh
// ─────────────────────────────────────────────────────────────────────────────
export function makeTerrain(biome, heightFn) {
  // segment density scales with size so larger worlds keep similar fidelity
  const segs = Math.round(140 * (state.ISLAND_SIZE / ISLAND_SIZE_BASE));
  const geo = new THREE.PlaneGeometry(
    state.ISLAND_SIZE,
    state.ISLAND_SIZE,
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

  // first pass — set heights
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, heightFn(x, z));
  }

  geo.computeVertexNormals();

  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const nx = geo.attributes.normal.getX(i);
    const nz = geo.attributes.normal.getZ(i);
    const slope = 1 - Math.abs(geo.attributes.normal.getY(i));

    // height-banded colour
    const t = THREE.MathUtils.clamp((y + 1.0) / 4.5, 0, 1);
    if (t < 0.5) {
      tmp.copy(c0).lerp(c1, smoothstep(0, 0.5, t));
    } else {
      tmp.copy(c1).lerp(c2, smoothstep(0.5, 1, t));
    }
    // mix in cliff colour for steep slopes
    tmp.lerp(cliffCol, Math.min(slope * 1.6, 0.85));

    // subtle noise speckle
    const speckle = 0.92 + Math.random() * 0.16;
    colors[i * 3 + 0] = tmp.r * speckle;
    colors[i * 3 + 1] = tmp.g * speckle;
    colors[i * 3 + 2] = tmp.b * speckle;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.92,
    metalness: 0,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

export function makeIslandUnderside(biome, center) {
  const r = (center && center.radius) || state.ISLAND_RADIUS;
  // smaller islands get shorter, less craggy cones
  const sizeFrac = r / ISLAND_RADIUS_BASE;
  const coneH = 9 * Math.max(0.55, Math.min(1.2, sizeFrac));
  // cloud-island biomes get a puffier, more amplitude-rich underside so the
  // island reads like a hovering blob rather than a craggy chunk.
  const jitter = (biome.cloudlike ? 2.4 : 0.8) * Math.max(0.6, sizeFrac);
  const geo = new THREE.ConeGeometry(r * 1.06, coneH, 24, 1, true);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.underside),
    flatShading: true,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  // perturb cone vertices for craggy bottom
  const pos = geo.attributes.position;
  // cloud underside perturbs across more of the cone for a puffball look
  const yThreshold = biome.cloudlike ? coneH * 0.85 : coneH * 0.49;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < yThreshold) {
      pos.setX(i, pos.getX(i) + (Math.random() - 0.5) * jitter);
      pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * jitter);
      if (biome.cloudlike) {
        pos.setY(i, y + (Math.random() - 0.5) * jitter * 0.4);
      }
    }
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  // place at the centre and dip the cone so its rim aligns with sea level
  mesh.position.set(center ? center.cx : 0, -coneH * 0.44, center ? center.cz : 0);
  mesh.rotation.y = Math.random() * Math.PI;
  return mesh;
}
