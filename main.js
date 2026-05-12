import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { createNoise2D } from "simplex-noise";

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic PRNG + URL seed plumbing
// ─────────────────────────────────────────────────────────────────────────────
// mulberry32 — small, fast, decent quality, takes a 32-bit seed.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatSeed(seed) {
  return "0x" + (seed >>> 0).toString(16).padStart(4, "0");
}

function parseSeed(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s.slice(2), 16) >>> 0;
  if (/^[0-9a-f]{1,8}$/i.test(s) && /[a-f]/i.test(s))
    return parseInt(s, 16) >>> 0;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n >>> 0 : null;
}

function readSeedFromUrl() {
  return parseSeed(new URLSearchParams(window.location.search).get("seed"));
}

function writeSeedToUrl(seed) {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", formatSeed(seed));
  history.replaceState(null, "", url.toString());
}

function newRandomSeed(excludeBiomeId) {
  // Reroll a few times to avoid landing on the same biome on regenerate.
  for (let i = 0; i < 24; i++) {
    const s = Math.floor(Math.random() * 0x10000);
    if (!excludeBiomeId) return s;
    const peekBiome = BIOMES[Math.floor(mulberry32(s)() * BIOMES.length)];
    if (peekBiome.id !== excludeBiomeId) return s;
  }
  return Math.floor(Math.random() * 0x10000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Biome library
// ─────────────────────────────────────────────────────────────────────────────
const BIOMES = [
  {
    id: "verdant",
    name: "verdant grove",
    sub: "a soft place. mosses underfoot.",
    ground: ["#3a5a40", "#588157", "#a3b18a"],
    cliff: "#2c3e2e",
    underside: "#1a2820",
    sky: "#d8e2c6",
    fog: "#b6c9a3",
    fogDensity: 0.022,
    accent: "#f4a261",
    sun: "#fff8e0",
    flora: ["tree", "tree", "mushroom", "fern", "fern", "rock"],
    floraCount: 90,
    particle: "pollen",
    creatureColors: ["#e9c46a", "#f4a261", "#e76f51", "#fff8e0"],
    creatureCount: [10, 16],
  },
  {
    id: "desert",
    name: "crimson dunes",
    sub: "wind-carved silence.",
    ground: ["#9c3a3a", "#d97757", "#f1c890"],
    cliff: "#6b2424",
    underside: "#3a1414",
    sky: "#f6d4a8",
    fog: "#d8a779",
    fogDensity: 0.018,
    accent: "#3d405b",
    sun: "#ffe5b0",
    flora: ["cactus", "cactus", "rock", "rock", "skull"],
    floraCount: 50,
    particle: "dust",
    creatureColors: ["#fefae0", "#dda15e", "#bc6c25", "#3d405b"],
    creatureCount: [6, 11],
  },
  {
    id: "frozen",
    name: "frozen vale",
    sub: "even the rivers hold their breath.",
    ground: ["#e8ecef", "#aebcc1", "#6b7a85"],
    cliff: "#4a5560",
    underside: "#1f2530",
    sky: "#cad2c5",
    fog: "#b6c5d4",
    fogDensity: 0.030,
    accent: "#457b9d",
    sun: "#e0eaff",
    flora: ["pine", "pine", "pine", "rock", "rock"],
    floraCount: 70,
    particle: "snow",
    creatureColors: ["#1d3557", "#457b9d", "#a8dadc", "#f1faee"],
    creatureCount: [8, 13],
  },
  {
    id: "marsh",
    name: "lavender marsh",
    sub: "nocturne in violet.",
    ground: ["#3d2c5a", "#6a4c93", "#b288c0"],
    cliff: "#241638",
    underside: "#0e0820",
    sky: "#1a1033",
    fog: "#3a1f5a",
    fogDensity: 0.042,
    accent: "#ffba08",
    sun: "#d4b3ff",
    flora: ["reed", "reed", "reed", "mushroom", "mushroom", "rock"],
    floraCount: 100,
    particle: "firefly",
    creatureColors: ["#ffba08", "#faa307", "#f48c06", "#ffd166"],
    creatureCount: [12, 18],
  },
  {
    id: "ashen",
    name: "ashen wastes",
    sub: "embers remember.",
    ground: ["#2b2d42", "#4a4e69", "#6f6f7a"],
    cliff: "#1a1b2e",
    underside: "#0a0a14",
    sky: "#1c1a26",
    fog: "#2b2538",
    fogDensity: 0.048,
    accent: "#e63946",
    sun: "#ff8866",
    flora: ["deadtree", "deadtree", "rock", "rock", "skull"],
    floraCount: 42,
    particle: "ember",
    creatureColors: ["#e63946", "#f77f00", "#fcbf49", "#ffd166"],
    creatureCount: [6, 10],
  },
  {
    id: "golden",
    name: "golden steppe",
    sub: "endless honeyed afternoon.",
    ground: ["#8b5a2b", "#dda15e", "#fefae0"],
    cliff: "#5a3a18",
    underside: "#2a1c08",
    sky: "#fbe9c0",
    fog: "#e7c08a",
    fogDensity: 0.020,
    accent: "#606c38",
    sun: "#fff4d0",
    flora: ["grass", "grass", "grass", "rock", "tree", "tree"],
    floraCount: 115,
    particle: "pollen",
    creatureColors: ["#283618", "#606c38", "#bc6c25", "#fefae0"],
    creatureCount: [10, 15],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Renderer / scene / camera
// ─────────────────────────────────────────────────────────────────────────────
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  38,
  window.innerWidth / window.innerHeight,
  0.1,
  400
);
camera.position.set(26, 19, 26);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.22;
controls.minDistance = 14;
controls.maxDistance = 55;
controls.maxPolarAngle = Math.PI / 2.15;
controls.minPolarAngle = Math.PI / 6;
controls.target.set(0, 1.5, 0);

// ─────────────────────────────────────────────────────────────────────────────
// Terrain height function — circular floating island with smoothstep falloff
// ─────────────────────────────────────────────────────────────────────────────
const ISLAND_SIZE = 38;
const ISLAND_RADIUS = ISLAND_SIZE * 0.42;

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function makeHeightFn(noise2D, amp = 3.0) {
  return (x, z) => {
    const dist = Math.sqrt(x * x + z * z);
    const falloff = smoothstep(ISLAND_RADIUS, ISLAND_RADIUS * 0.45, dist);
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

// ─────────────────────────────────────────────────────────────────────────────
// Terrain mesh
// ─────────────────────────────────────────────────────────────────────────────
function makeTerrain(biome, heightFn) {
  const segs = 140;
  const geo = new THREE.PlaneGeometry(
    ISLAND_SIZE,
    ISLAND_SIZE,
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

function makeIslandUnderside(biome) {
  const geo = new THREE.ConeGeometry(ISLAND_RADIUS * 1.06, 9, 24, 1, true);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.underside),
    flatShading: true,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  // perturb cone vertices for craggy bottom
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 4.4) {
      pos.setX(i, pos.getX(i) + (Math.random() - 0.5) * 0.8);
      pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * 0.8);
    }
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -4;
  mesh.rotation.y = Math.random() * Math.PI;
  return mesh;
}

// ─────────────────────────────────────────────────────────────────────────────
// Flora builders
// ─────────────────────────────────────────────────────────────────────────────
const TRUNK = new THREE.Color("#3a2818");

function jitterGeo(geo, amount = 0.05) {
  // IcosahedronGeometry stores 3 different UVs and normals per face-corner
  // even when positions coincide. mergeVertices hashes all attributes, so
  // those per-face UVs prevent welding. Strip them so the merge is by
  // position alone, then recompute normals after we've perturbed.
  geo.deleteAttribute("uv");
  geo.deleteAttribute("normal");
  const welded = mergeVertices(geo, 1e-4);
  geo.dispose();
  const p = welded.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setX(i, p.getX(i) + (Math.random() - 0.5) * amount);
    p.setY(i, p.getY(i) + (Math.random() - 0.5) * amount);
    p.setZ(i, p.getZ(i) + (Math.random() - 0.5) * amount);
  }
  welded.computeVertexNormals();
  return welded;
}

const FLORA_BUILDERS = {
  tree(biome) {
    const g = new THREE.Group();
    const leafCol = new THREE.Color(biome.ground[0])
      .offsetHSL(0, 0.05, 0.08);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.18, 1.1, 6),
      new THREE.MeshStandardMaterial({
        color: TRUNK,
        flatShading: true,
        roughness: 1,
      })
    );
    trunk.position.y = 0.55;
    trunk.castShadow = true;
    g.add(trunk);
    const leaves = new THREE.Mesh(
      jitterGeo(new THREE.IcosahedronGeometry(0.75, 0), 0.12),
      new THREE.MeshStandardMaterial({
        color: leafCol,
        flatShading: true,
        roughness: 0.85,
      })
    );
    leaves.position.y = 1.45;
    leaves.scale.set(1, 1.15, 1);
    leaves.castShadow = true;
    g.add(leaves);
    return g;
  },

  pine(biome) {
    const g = new THREE.Group();
    const col = new THREE.Color(biome.accent).lerp(
      new THREE.Color("#0d2c1f"),
      0.35
    );
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 0.4, 6),
      new THREE.MeshStandardMaterial({ color: TRUNK, flatShading: true })
    );
    trunk.position.y = 0.2;
    trunk.castShadow = true;
    g.add(trunk);
    const tiers = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < tiers; i++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.65 - i * 0.13, 0.65, 6),
        new THREE.MeshStandardMaterial({ color: col, flatShading: true })
      );
      cone.position.y = 0.45 + i * 0.42;
      cone.castShadow = true;
      g.add(cone);
    }
    return g;
  },

  cactus() {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({
      color: "#3d5a2e",
      flatShading: true,
      roughness: 0.8,
    });
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.18, 0.7, 4, 8),
      m
    );
    body.position.y = 0.6;
    body.castShadow = true;
    g.add(body);
    if (Math.random() > 0.4) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.4, 4, 8), m);
      arm.position.set(0.22, 0.7, 0);
      arm.rotation.z = -Math.PI / 2.5;
      arm.castShadow = true;
      g.add(arm);
    }
    if (Math.random() > 0.5) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.35, 4, 8), m);
      arm.position.set(-0.22, 0.55, 0);
      arm.rotation.z = Math.PI / 2.5;
      arm.castShadow = true;
      g.add(arm);
    }
    return g;
  },

  mushroom(biome) {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.1, 0.35, 6),
      new THREE.MeshStandardMaterial({
        color: "#f1e8d8",
        flatShading: true,
      })
    );
    stem.position.y = 0.18;
    stem.castShadow = true;
    g.add(stem);
    const capCol = new THREE.Color(biome.accent);
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: capCol,
        flatShading: true,
        roughness: 0.6,
      })
    );
    cap.position.y = 0.36;
    cap.scale.set(1.4, 0.9, 1.4);
    cap.castShadow = true;
    g.add(cap);
    return g;
  },

  fern(biome) {
    const g = new THREE.Group();
    const col = new THREE.Color(biome.ground[0]).offsetHSL(0, 0, 0.15);
    const mat = new THREE.MeshStandardMaterial({
      color: col,
      flatShading: true,
    });
    const blades = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < blades; i++) {
      const blade = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.5, 4),
        mat
      );
      const a = (i / blades) * Math.PI * 2;
      blade.position.set(Math.cos(a) * 0.05, 0.22, Math.sin(a) * 0.05);
      blade.rotation.z = Math.cos(a) * 0.6;
      blade.rotation.x = Math.sin(a) * 0.6;
      g.add(blade);
    }
    return g;
  },

  rock(biome) {
    const r = 0.18 + Math.random() * 0.35;
    const geo = jitterGeo(new THREE.IcosahedronGeometry(r, 0), r * 0.3);
    const baseCol = new THREE.Color(biome.cliff).offsetHSL(
      0,
      0,
      0.05 + Math.random() * 0.1
    );
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: baseCol,
        flatShading: true,
        roughness: 1,
      })
    );
    mesh.scale.y = 0.55 + Math.random() * 0.4;
    mesh.castShadow = true;
    return mesh;
  },

  reed() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: "#6d4f8a",
      flatShading: true,
    });
    const count = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const h = 0.6 + Math.random() * 0.5;
      const blade = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.025, h, 4),
        mat
      );
      blade.position.set(
        (Math.random() - 0.5) * 0.18,
        h / 2,
        (Math.random() - 0.5) * 0.18
      );
      blade.rotation.z = (Math.random() - 0.5) * 0.3;
      g.add(blade);
    }
    return g;
  },

  grass(biome) {
    const g = new THREE.Group();
    const col = new THREE.Color(biome.ground[2]).offsetHSL(0, 0, -0.1);
    const mat = new THREE.MeshStandardMaterial({
      color: col,
      flatShading: true,
    });
    const count = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const blade = new THREE.Mesh(
        new THREE.ConeGeometry(0.04, 0.3 + Math.random() * 0.2, 3),
        mat
      );
      blade.position.set(
        (Math.random() - 0.5) * 0.2,
        0.15,
        (Math.random() - 0.5) * 0.2
      );
      blade.rotation.z = (Math.random() - 0.5) * 0.6;
      g.add(blade);
    }
    return g;
  },

  deadtree(biome) {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(biome.cliff).offsetHSL(0, -0.1, 0.05),
      flatShading: true,
      roughness: 1,
    });
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.13, 1.2, 5),
      mat
    );
    trunk.position.y = 0.6;
    trunk.rotation.z = (Math.random() - 0.5) * 0.15;
    trunk.castShadow = true;
    g.add(trunk);
    for (let i = 0; i < 4; i++) {
      const branch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.04, 0.45, 4),
        mat
      );
      branch.position.set(0, 0.9 + i * 0.08, 0);
      branch.rotation.z = (Math.random() - 0.5) * 1.6;
      branch.rotation.x = (Math.random() - 0.5) * 1.6;
      branch.castShadow = true;
      g.add(branch);
    }
    return g;
  },

  skull() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: "#f1ead8",
      flatShading: true,
      roughness: 0.8,
    });
    const skull = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 8),
      mat
    );
    skull.scale.set(1, 0.85, 1.1);
    skull.position.y = 0.18;
    skull.castShadow = true;
    g.add(skull);
    // eye sockets
    const eyeMat = new THREE.MeshStandardMaterial({
      color: "#1a1a1a",
    });
    [-0.06, 0.06].forEach((x) => {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 6, 6),
        eyeMat
      );
      eye.position.set(x, 0.2, 0.15);
      g.add(eye);
    });
    return g;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Creature — wandering blob with eyes
// ─────────────────────────────────────────────────────────────────────────────
function makeCreature(biome) {
  const flies = Math.random() < 0.3;

  const group = new THREE.Group();
  const palette = biome.creatureColors;
  const bodyCol = new THREE.Color(
    palette[Math.floor(Math.random() * palette.length)]
  );

  // body — rounder for fliers, more elongated for walkers
  const bodyGeo = jitterGeo(new THREE.IcosahedronGeometry(0.42, 0), 0.06);
  const body = new THREE.Mesh(
    bodyGeo,
    new THREE.MeshStandardMaterial({
      color: bodyCol,
      flatShading: true,
      roughness: 0.55,
      metalness: 0.02,
    })
  );
  const bodyBaseY = flies ? 0.92 : 0.82;
  const bodyBaseX = flies ? 1.05 : 1;
  const bodyBaseZ = flies ? 1.05 : 1.25;
  body.scale.set(bodyBaseX, bodyBaseY, bodyBaseZ);
  body.castShadow = true;
  group.add(body);

  // belly highlight
  const belly = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 10, 8),
    new THREE.MeshStandardMaterial({
      color: bodyCol.clone().offsetHSL(0, -0.2, 0.18),
      flatShading: true,
    })
  );
  belly.position.set(0, -0.12, 0.05);
  belly.scale.set(0.85, 0.55, 1);
  group.add(belly);

  // eyes
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xfafaf2,
    roughness: 0.15,
  });
  const pupilMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a,
    roughness: 0.05,
  });
  const eyeGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const pupilGeo = new THREE.SphereGeometry(0.05, 8, 8);
  for (const sign of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(sign * 0.16, 0.17, 0.4);
    group.add(eye);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(sign * 0.16, 0.17, 0.48);
    group.add(pupil);
  }

  // antennae for some
  if (Math.random() > 0.55) {
    const antMat = new THREE.MeshStandardMaterial({
      color: bodyCol.clone().offsetHSL(0, 0, -0.2),
    });
    for (const sign of [-1, 1]) {
      const stalk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.22, 4),
        antMat
      );
      stalk.position.set(sign * 0.1, 0.42, 0.1);
      stalk.rotation.z = sign * -0.25;
      group.add(stalk);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 6, 6),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.accent),
          emissive: new THREE.Color(biome.accent).multiplyScalar(0.35),
        })
      );
      tip.position.set(sign * 0.13, 0.52, 0.13);
      group.add(tip);
    }
  }

  const feet = [];
  const legs = [];
  const wings = [];

  if (flies) {
    // wings — flattened ellipsoid icospheres on hinge groups
    const wingMat = new THREE.MeshStandardMaterial({
      color: bodyCol.clone().offsetHSL(0, -0.15, 0.12),
      flatShading: true,
      roughness: 0.45,
      side: THREE.DoubleSide,
    });
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.12, 0.18, -0.02);
      group.add(pivot);

      const wingGeo = jitterGeo(
        new THREE.IcosahedronGeometry(0.18, 0),
        0.04
      );
      wingGeo.scale(2.4, 0.18, 1.1);
      const wing = new THREE.Mesh(wingGeo, wingMat);
      wing.position.set(side * 0.38, 0, 0);
      wing.castShadow = true;
      pivot.add(wing);
      wings.push(pivot);
    }

    // two dangling feet for charm (no legs, just little nubs hanging)
    const dangleMat = new THREE.MeshStandardMaterial({
      color: bodyCol.clone().offsetHSL(0, 0, -0.25),
      flatShading: true,
    });
    for (const sign of [-1, 1]) {
      const dangle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.04, 0.16, 5),
        dangleMat
      );
      dangle.position.set(sign * 0.11, -0.36, 0.02);
      dangle.castShadow = true;
      group.add(dangle);
    }
  } else {
    // walkers: visible legs + feet
    const legMat = new THREE.MeshStandardMaterial({
      color: bodyCol.clone().offsetHSL(0, 0, -0.18),
      flatShading: true,
      roughness: 0.75,
    });
    const footMat = new THREE.MeshStandardMaterial({
      color: bodyCol.clone().offsetHSL(0, 0, -0.3),
      flatShading: true,
    });
    // cylinder of length 1 with its origin at the top so scale.y = length
    const legGeoTemplate = new THREE.CylinderGeometry(0.045, 0.06, 1, 6);
    legGeoTemplate.translate(0, -0.5, 0);

    const footPositions = [
      [-0.18, 0.18],
      [0.18, 0.18],
      [-0.18, -0.18],
      [0.18, -0.18],
    ];
    for (const [fx, fz] of footPositions) {
      const leg = new THREE.Mesh(legGeoTemplate.clone(), legMat);
      leg.position.set(fx, -0.1, fz);
      leg.scale.y = 0.22; // resting length, updated each frame
      leg.castShadow = true;
      group.add(leg);
      legs.push(leg);

      const foot = new THREE.Mesh(
        new THREE.SphereGeometry(0.085, 6, 6),
        footMat
      );
      foot.position.set(fx, -0.32, fz);
      foot.scale.set(1.15, 0.55, 1.3);
      foot.castShadow = true;
      group.add(foot);
      feet.push(foot);
    }
    legGeoTemplate.dispose();
  }

  const scale = 0.65 + Math.random() * 0.6;
  group.scale.setScalar(scale);

  const hoverHeight = 1.4 + Math.random() * 1.8;

  return {
    group,
    body,
    feet,
    legs,
    wings,
    flies,
    scale,
    heading: Math.random() * Math.PI * 2,
    speed: flies ? 1.1 + Math.random() * 0.9 : 0.6 + Math.random() * 0.7,
    bob: Math.random() * Math.PI * 2,
    bobSpeed: flies ? 4 + Math.random() * 2 : 6 + Math.random() * 3,
    flapSpeed: 16 + Math.random() * 10,
    flapPhase: Math.random() * Math.PI * 2,
    hoverHeight,
    // landing state — only used when flies===true
    landState: "flying", // "flying" | "descending" | "landed" | "ascending"
    landTimer: 6 + Math.random() * 14, // seconds until first landing attempt
    currentHover: hoverHeight, // animated; lerps between hoverHeight and rest
    bodyBaseY,
    bodyBaseX,
    nextThink: Math.random() * 2.5,
    pauseUntil: 0,
    age: Math.random() * 100,
  };
}

function stepCreature(c, dt, t, heightFn) {
  c.age += dt;
  c.nextThink -= dt;

  // ── flier landing state machine ────────────────────────────────────────
  if (c.flies) {
    c.landTimer -= dt;
    const restH = 0.35 * c.scale;

    if (c.landState === "flying" && c.landTimer <= 0) {
      c.landState = "descending";
    } else if (c.landState === "landed" && c.landTimer <= 0) {
      c.landState = "ascending";
    }

    const targetH =
      c.landState === "flying" || c.landState === "ascending"
        ? c.hoverHeight
        : restH;
    // smooth lerp for the descent/ascent
    c.currentHover += (targetH - c.currentHover) * Math.min(1, dt * 1.4);

    if (
      c.landState === "descending" &&
      c.currentHover - restH < 0.08
    ) {
      c.landState = "landed";
      c.landTimer = 4 + Math.random() * 10;
    } else if (
      c.landState === "ascending" &&
      c.hoverHeight - c.currentHover < 0.15
    ) {
      c.landState = "flying";
      c.landTimer = 8 + Math.random() * 16;
    }
  }

  const grounded = c.flies && c.landState === "landed";

  // think — fliers never pause while airborne; walkers + landed fliers can
  if (c.nextThink <= 0) {
    if ((!c.flies || grounded) && Math.random() < 0.25) {
      c.pauseUntil = t + 0.6 + Math.random() * 1.4;
    } else {
      c.heading += (Math.random() - 0.5) * (c.flies && !grounded ? 1.2 : 1.6);
    }
    c.nextThink = (c.flies ? 0.7 : 1.2) + Math.random() * (c.flies ? 1.8 : 3.0);
  }

  let moving = t > c.pauseUntil;
  // landed fliers stay put — they perched
  if (grounded) moving = false;
  const pos = c.group.position;

  if (moving) {
    const step = c.speed * dt;
    const nx = pos.x + Math.cos(c.heading) * step;
    const nz = pos.z + Math.sin(c.heading) * step;
    const r = Math.sqrt(nx * nx + nz * nz);
    const bound =
      c.flies && c.landState === "flying"
        ? ISLAND_RADIUS * 1.08
        : ISLAND_RADIUS * 0.92;

    if (r > bound) {
      c.heading = Math.atan2(-nz, -nx) + (Math.random() - 0.5) * 0.5;
    } else {
      pos.x = nx;
      pos.z = nz;
    }
    c.bob += dt * c.bobSpeed;
  } else {
    c.bob += dt * 2;
  }

  const ground = heightFn(pos.x, pos.z);
  if (c.flies) {
    // bob amplitude scales with current hover — perched creatures only quiver
    const bobAmp = grounded
      ? 0.02
      : 0.28 * Math.min(1, c.currentHover / Math.max(0.1, c.hoverHeight));
    pos.y = ground + c.currentHover + Math.sin(c.bob) * bobAmp;
  } else {
    const bobAmp = moving ? 0.08 : 0.02;
    pos.y = ground + 0.35 * c.scale + Math.sin(c.bob) * bobAmp;
  }

  // face heading (smoothed)
  const targetRot = -c.heading + Math.PI / 2;
  let cur = c.group.rotation.y;
  let diff = targetRot - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  c.group.rotation.y = cur + diff * Math.min(1, dt * 6);

  // squash & stretch body
  const squash = 1 + Math.sin(c.bob) * 0.05 * (moving ? 1 : 0.4);
  c.body.scale.y = c.bodyBaseY * squash;
  c.body.scale.x = c.bodyBaseX / Math.sqrt(squash);

  if (c.flies) {
    if (grounded) {
      // wings folded — slowly settle into rest pose, no oscillation
      const k = Math.min(1, dt * 5);
      for (let i = 0; i < c.wings.length; i++) {
        const sign = i === 0 ? -1 : 1;
        const restRot = sign * 0.55; // wings tucked slightly up
        c.wings[i].rotation.z += (restRot - c.wings[i].rotation.z) * k;
        c.wings[i].rotation.x += (0 - c.wings[i].rotation.x) * k;
      }
      c.body.rotation.z += (0 - c.body.rotation.z) * k;
    } else {
      // amplitude fades as the creature transitions between hover and ground
      const altRatio = Math.min(
        1,
        (c.currentHover - 0.35 * c.scale) / Math.max(0.1, c.hoverHeight - 0.35 * c.scale)
      );
      const flapStrength = 0.4 + 0.6 * altRatio; // weaker flap near the ground
      const phase = t * c.flapSpeed + c.flapPhase;
      const flap = Math.sin(phase);
      for (let i = 0; i < c.wings.length; i++) {
        const sign = i === 0 ? -1 : 1;
        c.wings[i].rotation.z = sign * (0.25 + flap * 0.75 * flapStrength);
        c.wings[i].rotation.x = Math.cos(phase) * 0.12 * flapStrength;
      }
      c.body.rotation.z = -flap * 0.04 * flapStrength;
    }
  } else if (moving) {
    // diagonal trot pattern: FL+BR phase, FR+BL counter-phase
    const phases = [0, Math.PI, Math.PI, 0];
    for (let i = 0; i < c.feet.length; i++) {
      const footY = -0.32 + Math.sin(c.bob + phases[i]) * 0.09;
      c.feet[i].position.y = footY;
      // leg top is at -0.1 in body space; scale.y = distance to foot
      c.legs[i].scale.y = -0.1 - footY;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Caterpillar — head + 3-6 body spheres, body segments follow head's trail
// ─────────────────────────────────────────────────────────────────────────────
function findTrailPointAt(trail, distance) {
  if (trail.length === 0) return null;
  if (trail.length === 1) return trail[0];
  let acc = 0;
  let prev = trail[0];
  for (let i = 1; i < trail.length; i++) {
    const cur = trail[i];
    const dx = cur.x - prev.x;
    const dz = cur.z - prev.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (acc + d >= distance) {
      const u = d > 1e-4 ? (distance - acc) / d : 0;
      return {
        x: prev.x + dx * u,
        z: prev.z + dz * u,
      };
    }
    acc += d;
    prev = cur;
  }
  return prev;
}

function makeCaterpillar(biome) {
  const group = new THREE.Group();
  const palette = biome.creatureColors;
  const baseCol = new THREE.Color(
    palette[Math.floor(Math.random() * palette.length)]
  );
  const altCol = baseCol.clone().offsetHSL(0, 0.05, 0.12);

  const segments = [];
  const segCount = 3 + Math.floor(Math.random() * 4); // 3-6 body segments
  // uniform radius for head + every body segment — keeps them touching
  const segRadius = 0.28;

  // ── head ───────────────────────────────────────────────────────────────
  const headGeo = jitterGeo(
    new THREE.IcosahedronGeometry(segRadius, 0),
    0.05
  );
  const headMat = new THREE.MeshStandardMaterial({
    color: baseCol,
    flatShading: true,
    roughness: 0.55,
    metalness: 0.02,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.castShadow = true;
  group.add(head);
  segments.push(head);

  // eyes — same recipe as blob creatures
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xfafaf2,
    roughness: 0.15,
  });
  const pupilMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a,
    roughness: 0.05,
  });
  const eyeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const pupilGeo = new THREE.SphereGeometry(0.04, 8, 8);
  for (const sign of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(sign * 0.13, 0.12, 0.24);
    head.add(eye);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(sign * 0.13, 0.12, 0.31);
    head.add(pupil);
  }

  // antennae always for caterpillars — feels right
  const antMat = new THREE.MeshStandardMaterial({
    color: baseCol.clone().offsetHSL(0, 0, -0.25),
  });
  for (const sign of [-1, 1]) {
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.22, 4),
      antMat
    );
    stalk.position.set(sign * 0.09, 0.28, 0.05);
    stalk.rotation.z = sign * -0.3;
    head.add(stalk);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 6, 6),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.accent),
        emissive: new THREE.Color(biome.accent).multiplyScalar(0.4),
      })
    );
    tip.position.set(sign * 0.13, 0.38, 0.08);
    head.add(tip);
  }

  // ── body segments — all the same radius as the head ──────────────────
  for (let i = 0; i < segCount; i++) {
    const segGeo = jitterGeo(
      new THREE.IcosahedronGeometry(segRadius, 0),
      segRadius * 0.14
    );
    const mat = new THREE.MeshStandardMaterial({
      color: i % 2 === 0 ? altCol : baseCol,
      flatShading: true,
      roughness: 0.6,
    });
    const seg = new THREE.Mesh(segGeo, mat);
    seg.castShadow = true;
    group.add(seg);
    segments.push(seg);
  }

  const scale = 0.7 + Math.random() * 0.4;
  for (const s of segments) s.scale.setScalar(scale);

  // initial placement
  const a = Math.random() * Math.PI * 2;
  const spawnR = Math.random() * ISLAND_RADIUS * 0.55;
  const startX = Math.cos(a) * spawnR;
  const startZ = Math.sin(a) * spawnR;
  const startHeading = Math.random() * Math.PI * 2;
  // tighter than 2r — icospheres at exactly 2r touch only at corners, so
  // their flat faces leave a visible gap. Overlap a bit so segments visibly
  // read as touching even over sloped terrain.
  const segSpacing = 1.4 * segRadius * scale;

  // pre-seed the trail behind the head so segments aren't stacked at frame 0
  const trail = [];
  const seedStep = 0.04;
  for (let i = 0; i < 250; i++) {
    trail.push({
      x: startX - Math.cos(startHeading) * i * seedStep,
      z: startZ - Math.sin(startHeading) * i * seedStep,
    });
  }

  head.position.set(startX, 0, startZ);

  return {
    type: "caterpillar",
    group,
    segments,
    segRadius,
    trail,
    segSpacing,
    scale,
    heading: startHeading,
    speed: 0.5 + Math.random() * 0.3,
    nextThink: Math.random() * 2.5,
    age: Math.random() * 100,
  };
}

function stepCaterpillar(c, dt, t, heightFn) {
  c.age += dt;
  c.nextThink -= dt;
  if (c.nextThink <= 0) {
    c.heading += (Math.random() - 0.5) * 0.9;
    c.nextThink = 1.4 + Math.random() * 2.5;
  }

  const head = c.segments[0];
  const step = c.speed * dt;
  let nx = head.position.x + Math.cos(c.heading) * step;
  let nz = head.position.z + Math.sin(c.heading) * step;

  // edge avoidance — turn back toward centre when close to the rim
  const r2 = nx * nx + nz * nz;
  if (r2 > (ISLAND_RADIUS * 0.86) ** 2) {
    c.heading = Math.atan2(-nz, -nx) + (Math.random() - 0.5) * 0.4;
    nx = head.position.x + Math.cos(c.heading) * step;
    nz = head.position.z + Math.sin(c.heading) * step;
  }

  // all segments — including the head — sit at the same base offset so
  // adjacent spheres at segSpacing = 2*radius actually touch.
  const baseOffset = c.segRadius * 0.7 * c.scale;
  const headY = heightFn(nx, nz) + baseOffset;
  head.position.set(nx, headY, nz);
  head.rotation.y = -c.heading + Math.PI / 2;
  head.rotation.x = Math.sin(c.age * 4) * 0.06;

  // record path
  c.trail.unshift({ x: nx, z: nz });
  if (c.trail.length > 300) c.trail.length = 300;

  // body segments sample the trail at fixed arc-length offsets
  for (let i = 1; i < c.segments.length; i++) {
    const pt = findTrailPointAt(c.trail, i * c.segSpacing);
    if (!pt) continue;
    const groundY = heightFn(pt.x, pt.z);
    // subtle wave along the body — small enough that they stay touching
    const bob = Math.sin(c.age * 3.5 - i * 0.7) * 0.03 * c.scale;
    c.segments[i].position.set(pt.x, groundY + baseOffset + bob, pt.z);
    c.segments[i].rotation.z = Math.sin(c.age * 2 - i * 0.5) * 0.06;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Butterflies — small bright fliers that flutter between flowers
// ─────────────────────────────────────────────────────────────────────────────
function makeButterfly(palette, biome) {
  const group = new THREE.Group();

  const c1 = palette[Math.floor(Math.random() * palette.length)];
  let c2 = palette[Math.floor(Math.random() * palette.length)];
  if (palette.length > 1 && c2 === c1)
    c2 = palette[(palette.indexOf(c1) + 1) % palette.length];

  // tiny dark body
  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.04, 0),
    new THREE.MeshStandardMaterial({
      color: 0x1a1a22,
      flatShading: true,
      roughness: 0.5,
    })
  );
  body.scale.set(0.7, 0.7, 1.8);
  body.castShadow = true;
  group.add(body);

  // wing materials — two-tone (front + back wing pairs)
  const wingMat1 = new THREE.MeshStandardMaterial({
    color: new THREE.Color(c1),
    flatShading: true,
    roughness: 0.45,
    side: THREE.DoubleSide,
  });
  const wingMat2 = new THREE.MeshStandardMaterial({
    color: new THREE.Color(c2),
    flatShading: true,
    roughness: 0.45,
    side: THREE.DoubleSide,
  });

  const frontGeo = new THREE.IcosahedronGeometry(0.13, 1);
  frontGeo.scale(1.0, 0.05, 1.25);
  const backGeo = new THREE.IcosahedronGeometry(0.09, 1);
  backGeo.scale(1.0, 0.05, 1.0);

  const wings = [];
  // front (upper) pair — slightly forward
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.01, -0.04);
    group.add(pivot);
    const w = new THREE.Mesh(frontGeo, wingMat1);
    w.position.set(side * 0.15, 0, -0.04);
    w.castShadow = true;
    pivot.add(w);
    wings.push({ pivot, side, isBack: false });
  }
  // back (lower) pair — slightly aft, smaller
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.005, 0.04);
    group.add(pivot);
    const w = new THREE.Mesh(backGeo, wingMat2);
    w.position.set(side * 0.10, 0, 0.05);
    w.castShadow = true;
    pivot.add(w);
    wings.push({ pivot, side, isBack: true });
  }

  // 25% smaller overall
  group.scale.setScalar(0.75);

  return {
    group,
    wings,
    target: null,
    state: "cruising", // "cruising" → flying to flower, "hovering" → near it
    holdUntil: 0,
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 0.5,
      (Math.random() - 0.5) * 2
    ),
    flapPhase: Math.random() * Math.PI * 2,
    flapSpeed: 28 + Math.random() * 18,
    wobblePhase: Math.random() * Math.PI * 2,
    wobbleSpeed: 4.5 + Math.random() * 3,
  };
}

function pickFlower(flowerSpots) {
  if (!flowerSpots.length) return null;
  const f = flowerSpots[Math.floor(Math.random() * flowerSpots.length)];
  return new THREE.Vector3(f.x, f.y + 0.22, f.z);
}

const _bflyTarget = new THREE.Vector3();
function stepButterfly(b, dt, t, flowerSpots, heightFn) {
  const pos = b.group.position;

  // state machine — pick flower → fly → hover → pick another
  if (b.state === "hovering" && t > b.holdUntil) {
    b.state = "cruising";
    b.target = pickFlower(flowerSpots);
  }
  if (b.state === "cruising" && !b.target) {
    b.target = pickFlower(flowerSpots);
  }
  if (b.state === "cruising" && b.target) {
    const dx = pos.x - b.target.x;
    const dy = pos.y - b.target.y;
    const dz = pos.z - b.target.z;
    if (dx * dx + dy * dy + dz * dz < 0.05) {
      b.state = "hovering";
      b.holdUntil = t + 1.2 + Math.random() * 2.5;
    }
  }

  // steer toward target
  if (b.target) {
    const dx = b.target.x - pos.x;
    const dy = b.target.y - pos.y;
    const dz = b.target.z - pos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 0.001) {
      const accel = b.state === "hovering" ? 1.0 : 4.0;
      b.velocity.x += (dx / d) * accel * dt;
      b.velocity.y += (dy / d) * accel * dt;
      b.velocity.z += (dz / d) * accel * dt;
    }
  }

  // erratic wobble — what makes butterflies look like butterflies
  const wt = b.wobblePhase + t * b.wobbleSpeed;
  b.velocity.x += Math.sin(wt * 1.7) * 1.4 * dt;
  b.velocity.y += Math.cos(wt * 2.3) * 1.8 * dt;
  b.velocity.z += Math.cos(wt * 1.3) * 1.4 * dt;

  // damping
  const damp = Math.pow(0.78, dt * 60);
  b.velocity.x *= damp;
  b.velocity.y *= damp;
  b.velocity.z *= damp;

  // cap speed (slower when hovering)
  const sp = b.velocity.length();
  const maxSp = b.state === "hovering" ? 1.4 : 3.0;
  if (sp > maxSp) b.velocity.multiplyScalar(maxSp / sp);

  pos.x += b.velocity.x * dt;
  pos.y += b.velocity.y * dt;
  pos.z += b.velocity.z * dt;

  // don't dip below terrain
  const ground = heightFn(pos.x, pos.z);
  const minY = ground + 0.12;
  if (pos.y < minY) {
    pos.y = minY;
    if (b.velocity.y < 0) b.velocity.y = 0.2;
  }

  // orient toward velocity
  if (b.velocity.lengthSq() > 0.08) {
    _bflyTarget.copy(pos).add(b.velocity);
    b.group.lookAt(_bflyTarget);
  }

  // fast wing flap; back pair lags slightly behind the front
  for (const w of b.wings) {
    const phaseOff = w.isBack ? 0.35 : 0;
    const f = Math.sin(t * b.flapSpeed + b.flapPhase + phaseOff);
    w.pivot.rotation.z = w.side * (0.35 + f * 0.95);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Particles (biome-specific atmosphere)
// ─────────────────────────────────────────────────────────────────────────────
function makeParticles(biome) {
  const kind = biome.particle;
  const count = {
    pollen: 240,
    dust: 320,
    snow: 500,
    firefly: 90,
    ember: 180,
  }[kind] || 200;

  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const seeds = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(Math.random()) * ISLAND_RADIUS * 1.1;
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
  };

  const mat = new THREE.PointsMaterial({
    color: new THREE.Color(colorMap[kind]),
    size: kind === "firefly" ? 0.16 : kind === "snow" ? 0.1 : 0.07,
    transparent: true,
    opacity: kind === "dust" ? 0.35 : 0.85,
    depthWrite: false,
    blending: kind === "firefly" || kind === "ember"
      ? THREE.AdditiveBlending
      : THREE.NormalBlending,
    sizeAttenuation: true,
  });

  const points = new THREE.Points(geo, mat);
  points.userData = { kind, velocities, seeds, count };
  return points;
}

function stepParticles(points, dt, t) {
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
        const r = Math.random() * ISLAND_RADIUS * 0.8;
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
      if (r > ISLAND_RADIUS) {
        x *= 0.95;
        z *= 0.95;
      }
      if (y < 0.5) y = 0.5 + Math.random();
      if (y > 6) y = 6;
    } else if (kind === "dust") {
      x += Math.sin(t * 0.3 + s) * 0.4 * dt + 0.3 * dt;
      y += Math.sin(t * 0.4 + s * 2) * 0.1 * dt;
      z += Math.cos(t * 0.35 + s) * 0.3 * dt;
      const r = Math.sqrt(x * x + z * z);
      if (r > ISLAND_RADIUS * 1.2) {
        const a = Math.random() * Math.PI * 2;
        const nr = Math.random() * ISLAND_RADIUS * 0.4;
        x = Math.cos(a) * nr;
        z = Math.sin(a) * nr;
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
  }

  points.geometry.attributes.position.needsUpdate = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ground decoration — instanced grass, wildflowers, pebbles
// ─────────────────────────────────────────────────────────────────────────────
const WILDFLOWER_PALETTES = {
  verdant: ["#f4a261", "#e76f51", "#fefae0", "#fff2b3"],
  desert:  ["#e63946", "#f4a261", "#fefae0"],
  frozen:  ["#cad2ff", "#f1faee", "#e0c3fc"],
  marsh:   ["#ffba08", "#ff6d6d", "#c9a8e8", "#ffd166"],
  ashen:   ["#e63946", "#f77f00", "#fcbf49"],
  golden:  ["#fefae0", "#dda15e", "#f1c890", "#a3b18a"],
};

const GRASS_DENSITY = {
  verdant: 600, desert: 140, frozen: 240,
  marsh:   500, ashen:  110, golden: 750,
};
const FLOWER_DENSITY = {
  verdant: 180, desert: 60, frozen: 90,
  marsh:   220, ashen:  50, golden: 200,
};
const PEBBLE_DENSITY = {
  verdant: 80, desert: 130, frozen: 100,
  marsh:   70, ashen:  140, golden: 90,
};

function placeInstanced(geo, mat, count, heightFn, opts = {}) {
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
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * ISLAND_RADIUS * maxRadiusFrac;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
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

function makeGrassField(biome, heightFn) {
  const count = GRASS_DENSITY[biome.id] ?? 300;
  const g = new THREE.ConeGeometry(0.03, 0.32, 3, 1);
  g.translate(0, 0.16, 0);
  const base = new THREE.Color(biome.ground[1]).offsetHSL(
    (Math.random() - 0.5) * 0.04, 0.1, -0.08
  );
  const m = new THREE.MeshStandardMaterial({
    color: base,
    flatShading: true,
    roughness: 0.95,
  });
  return placeInstanced(g, m, count, heightFn, {
    minScale: 0.5,
    maxScale: 1.3,
    tilt: 0.3,
  });
}

function makeWildflowerField(biome, heightFn) {
  const palette = WILDFLOWER_PALETTES[biome.id] ?? ["#ffffff"];
  const total = FLOWER_DENSITY[biome.id] ?? 100;
  const perColor = Math.max(8, Math.floor(total / palette.length));
  const meshes = [];

  for (const color of palette) {
    const g = new THREE.IcosahedronGeometry(0.05, 0);
    g.scale(1, 0.7, 1);
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      flatShading: true,
      roughness: 0.4,
    });
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

function makePebbleField(biome, heightFn) {
  const count = PEBBLE_DENSITY[biome.id] ?? 80;
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
// Birds — small bodies + flapping wings, flocking with boid behaviour
// ─────────────────────────────────────────────────────────────────────────────
function makeBird(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });

  // body — elongated along Z; lookAt() makes -Z the forward direction
  const bodyGeo = jitterGeo(new THREE.IcosahedronGeometry(0.1, 0), 0.015);
  bodyGeo.scale(0.85, 0.78, 2.0);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.castShadow = true;
  group.add(body);

  // shared wing geometry — flat ellipsoid centred at origin
  const wingGeo = new THREE.IcosahedronGeometry(0.12, 0);
  wingGeo.scale(2.2, 0.06, 1.2);

  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.025, 0);
    group.add(pivot);

    const w = new THREE.Mesh(wingGeo, mat);
    w.position.x = side * 0.16;
    w.castShadow = true;
    pivot.add(w);
    wings.push(pivot);
  }

  return {
    group,
    body,
    wings,
    velocity: new THREE.Vector3(),
    flapPhase: Math.random() * Math.PI * 2,
    flapSpeed: 22 + Math.random() * 10,
  };
}

function pickBirdColor(biome) {
  const r = Math.random();
  if (r < 0.5) return new THREE.Color(0x1a1a22);
  if (r < 0.8) return new THREE.Color(biome.accent);
  return new THREE.Color(biome.sun).offsetHSL(0, 0, -0.25);
}

function makeFlock(biome) {
  const size = 5 + Math.floor(Math.random() * 5); // 5–9
  const color = pickBirdColor(biome);
  const birds = [];

  const cx = (Math.random() - 0.5) * ISLAND_SIZE * 0.5;
  const cz = (Math.random() - 0.5) * ISLAND_SIZE * 0.5;
  const altitude = 7 + Math.random() * 5;

  const dir = Math.random() * Math.PI * 2;
  const initVel = new THREE.Vector3(Math.cos(dir), 0, Math.sin(dir))
    .multiplyScalar(2.5);

  for (let i = 0; i < size; i++) {
    const b = makeBird(color);
    b.group.position.set(
      cx + (Math.random() - 0.5) * 3,
      altitude + (Math.random() - 0.5) * 1.5,
      cz + (Math.random() - 0.5) * 3
    );
    b.velocity.copy(initVel).add(
      new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).multiplyScalar(0.4)
    );
    birds.push(b);
  }

  return {
    birds,
    waypoint: new THREE.Vector3(cx, altitude, cz),
    waypointTimer: 0,
    altitude,
  };
}

const _flockTarget = new THREE.Vector3();
function stepFlock(flock, dt, t) {
  flock.waypointTimer -= dt;
  if (flock.waypointTimer <= 0) {
    flock.waypoint.set(
      (Math.random() - 0.5) * ISLAND_SIZE * 0.7,
      flock.altitude + (Math.random() - 0.5) * 2.5,
      (Math.random() - 0.5) * ISLAND_SIZE * 0.7
    );
    flock.waypointTimer = 4 + Math.random() * 4;
  }

  const birds = flock.birds;
  const N = birds.length;

  // boid weights — tuned for tight but loose-looking flocks
  const PERCEPTION = 4.5;
  const SEP_RADIUS = 1.4;
  const MAX_SPEED  = 4.5;
  const MIN_SPEED  = 2.0;
  const W_ALIGN = 1.4;
  const W_COH   = 0.9;
  const W_SEP   = 2.6;
  const W_WAY   = 0.5;

  for (let i = 0; i < N; i++) {
    const b = birds[i];
    const pos = b.group.position;
    let ax = 0, ay = 0, az = 0;
    let cx = 0, cy = 0, cz = 0;
    let sx = 0, sy = 0, sz = 0;
    let nN = 0, nS = 0;

    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const o = birds[j];
      const dx = o.group.position.x - pos.x;
      const dy = o.group.position.y - pos.y;
      const dz = o.group.position.z - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;

      if (d2 < PERCEPTION * PERCEPTION) {
        ax += o.velocity.x; ay += o.velocity.y; az += o.velocity.z;
        cx += o.group.position.x;
        cy += o.group.position.y;
        cz += o.group.position.z;
        nN++;
      }
      if (d2 < SEP_RADIUS * SEP_RADIUS && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        sx -= dx / d; sy -= dy / d; sz -= dz / d;
        nS++;
      }
    }

    let fx = 0, fy = 0, fz = 0;
    if (nN > 0) {
      fx += (ax / nN) * W_ALIGN;
      fy += (ay / nN) * W_ALIGN;
      fz += (az / nN) * W_ALIGN;
      fx += (cx / nN - pos.x) * W_COH;
      fy += (cy / nN - pos.y) * W_COH;
      fz += (cz / nN - pos.z) * W_COH;
    }
    if (nS > 0) {
      fx += sx * W_SEP; fy += sy * W_SEP; fz += sz * W_SEP;
    }
    fx += (flock.waypoint.x - pos.x) * 0.06 * W_WAY;
    fy += (flock.waypoint.y - pos.y) * 0.15 * W_WAY;
    fz += (flock.waypoint.z - pos.z) * 0.06 * W_WAY;

    // soft boundary — gently pull back toward the island when too far
    const r2 = pos.x * pos.x + pos.z * pos.z;
    if (r2 > ISLAND_RADIUS * ISLAND_RADIUS * 1.4) {
      fx -= pos.x * 0.4;
      fz -= pos.z * 0.4;
    }

    b.velocity.x += fx * dt;
    b.velocity.y += fy * dt;
    b.velocity.z += fz * dt;

    const sp = b.velocity.length();
    if (sp > MAX_SPEED) b.velocity.multiplyScalar(MAX_SPEED / sp);
    else if (sp < MIN_SPEED && sp > 1e-4)
      b.velocity.multiplyScalar(MIN_SPEED / sp);

    pos.x += b.velocity.x * dt;
    pos.y += b.velocity.y * dt;
    pos.z += b.velocity.z * dt;

    _flockTarget.copy(pos).add(b.velocity);
    b.group.lookAt(_flockTarget);

    // flap — left/right wings mirrored
    const flapRate = b.flapSpeed + sp * 1.5;
    const flap = Math.sin(t * flapRate + b.flapPhase);
    b.wings[0].rotation.z = -flap * 0.85 + 0.15;
    b.wings[1].rotation.z =  flap * 0.85 - 0.15;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// World state
// ─────────────────────────────────────────────────────────────────────────────
let world = new THREE.Group();
scene.add(world);
let creatures = [];
let caterpillars = [];
let butterflies = [];
let flowerSpots = [];
let flocks = [];
let particles = null;
let heightFn = () => 0;
let currentBiome = null;
let currentSeed = 0;
let maxElev = 0;

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}

function randInt(lo, hi) {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function generateWorld(seed) {
  // Swap Math.random for the seeded PRNG so every Math.random() call
  // during world construction is deterministic. Per-frame animation
  // (stepCreature/stepFlock/stepParticles) runs after we restore, so it
  // keeps its natural variation.
  const originalRandom = Math.random;
  Math.random = mulberry32(seed);

  // Pick biome from the seed itself, so one number reproduces everything.
  const biome = BIOMES[Math.floor(Math.random() * BIOMES.length)];

  // clear
  disposeGroup(world);
  scene.remove(world);
  world = new THREE.Group();
  scene.add(world);
  creatures = [];
  flocks = [];
  caterpillars = [];
  butterflies = [];
  flowerSpots = [];
  particles = null;

  currentBiome = biome;
  currentSeed = seed;

  // atmosphere
  scene.background = new THREE.Color(biome.sky);
  scene.fog = new THREE.FogExp2(new THREE.Color(biome.fog), biome.fogDensity);

  // lights
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(biome.sky),
    new THREE.Color(biome.ground[0]),
    0.65
  );
  world.add(hemi);

  const sun = new THREE.DirectionalLight(new THREE.Color(biome.sun), 1.25);
  sun.position.set(18, 28, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -ISLAND_SIZE / 2;
  sun.shadow.camera.right = ISLAND_SIZE / 2;
  sun.shadow.camera.top = ISLAND_SIZE / 2;
  sun.shadow.camera.bottom = -ISLAND_SIZE / 2;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0008;
  world.add(sun);

  const accent = new THREE.PointLight(
    new THREE.Color(biome.accent),
    0.6,
    35,
    1.6
  );
  accent.position.set(0, 8, 0);
  world.add(accent);

  // terrain
  const noise2D = createNoise2D();
  heightFn = makeHeightFn(noise2D, 3.2);
  const terrain = makeTerrain(biome, heightFn);
  world.add(terrain);
  world.add(makeIslandUnderside(biome));

  // measure max elevation for HUD
  maxElev = 0;
  for (let i = 0; i < 200; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * ISLAND_RADIUS * 0.8;
    const h = heightFn(Math.cos(a) * r, Math.sin(a) * r);
    if (h > maxElev) maxElev = h;
  }

  // flora
  let placed = 0;
  let attempts = 0;
  while (placed < biome.floraCount && attempts < biome.floraCount * 6) {
    attempts++;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * ISLAND_RADIUS * 0.88;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = heightFn(x, z);
    if (y < -0.3) continue; // skip steep cliffs / void
    const kind =
      biome.flora[Math.floor(Math.random() * biome.flora.length)];
    const f = FLORA_BUILDERS[kind](biome);
    f.position.set(x, y, z);
    f.rotation.y = Math.random() * Math.PI * 2;
    const s = 0.7 + Math.random() * 0.7;
    f.scale.setScalar(s);
    world.add(f);
    placed++;
  }

  // ground cover — instanced grass / wildflowers / pebbles
  world.add(makeGrassField(biome, heightFn));
  for (const m of makeWildflowerField(biome, heightFn)) {
    world.add(m);
    if (m.userData.positions) flowerSpots.push(...m.userData.positions);
  }
  world.add(makePebbleField(biome, heightFn));

  // creatures
  const ncreatures = randInt(...biome.creatureCount);
  for (let i = 0; i < ncreatures; i++) {
    const c = makeCreature(biome);
    let x = 0,
      z = 0,
      y = -10;
    for (let tries = 0; tries < 20 && y < 0; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * ISLAND_RADIUS * 0.65;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      y = heightFn(x, z);
    }
    c.group.position.set(x, y + 0.4, z);
    world.add(c.group);
    creatures.push(c);
  }

  // caterpillars — multi-segment crawlers
  const ncats = 1 + Math.floor(Math.random() * 3); // 1–3
  for (let i = 0; i < ncats; i++) {
    const cat = makeCaterpillar(biome);
    world.add(cat.group);
    caterpillars.push(cat);
  }

  // butterflies — drift between flower positions
  const flowerDensity = FLOWER_DENSITY[biome.id] ?? 100;
  const bMin = Math.max(2, Math.floor(flowerDensity / 30));
  const bMax = Math.max(bMin + 1, Math.floor(flowerDensity / 14));
  const nbutterflies = bMin + Math.floor(Math.random() * (bMax - bMin + 1));
  const palette = WILDFLOWER_PALETTES[biome.id] ?? ["#ffffff"];
  for (let i = 0; i < nbutterflies; i++) {
    const bf = makeButterfly(palette, biome);
    // start near a flower if we have any
    if (flowerSpots.length) {
      const f = flowerSpots[Math.floor(Math.random() * flowerSpots.length)];
      bf.group.position.set(
        f.x + (Math.random() - 0.5) * 1.5,
        f.y + 0.6 + Math.random() * 0.8,
        f.z + (Math.random() - 0.5) * 1.5
      );
    } else {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * ISLAND_RADIUS * 0.6;
      bf.group.position.set(Math.cos(a) * r, 2, Math.sin(a) * r);
    }
    world.add(bf.group);
    butterflies.push(bf);
  }

  // bird flocks
  const numFlocks = 1 + Math.floor(Math.random() * 3); // 1–3
  let totalBirds = 0;
  for (let f = 0; f < numFlocks; f++) {
    const flock = makeFlock(biome);
    for (const bird of flock.birds) world.add(bird.group);
    totalBirds += flock.birds.length;
    flocks.push(flock);
  }

  // particles
  particles = makeParticles(biome);
  world.add(particles);

  // HUD
  document.getElementById("biome-name").textContent = biome.name;
  document.getElementById("biome-sub").textContent = biome.sub;
  document.getElementById("creature-count").textContent = String(
    ncreatures + ncats
  ).padStart(2, "0");
  document.getElementById("flora-count").textContent = String(placed).padStart(
    2,
    "0"
  );
  document.getElementById("bird-count").textContent = String(
    totalBirds
  ).padStart(2, "0");
  document.getElementById("seed").textContent = formatSeed(seed);
  document.getElementById("elevation").textContent =
    Math.round(maxElev * 120) + "m";

  // brief intro flourish: zoom-in
  controls.autoRotate = true;

  // restore native Math.random so per-frame animation isn't deterministic
  Math.random = originalRandom;
  writeSeedToUrl(seed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Animation loop
// ─────────────────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  for (const c of creatures) stepCreature(c, dt, t, heightFn);
  for (const c of caterpillars) stepCaterpillar(c, dt, t, heightFn);
  for (const b of butterflies) stepButterfly(b, dt, t, flowerSpots, heightFn);
  for (const f of flocks) stepFlock(f, dt, t);
  stepParticles(particles, dt, t);

  controls.update();
  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────────────────────
// Wiring
// ─────────────────────────────────────────────────────────────────────────────
document.getElementById("regen").addEventListener("click", () => {
  const overlay = document.createElement("div");
  overlay.style.cssText = `
    position:fixed; inset:0; background:#000; z-index:50; pointer-events:none;
    opacity:0; transition:opacity .35s ease;`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => (overlay.style.opacity = "0.7"));
  setTimeout(() => {
    generateWorld(newRandomSeed(currentBiome?.id));
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 400);
  }, 360);
});

// Also regenerate when seed changes via back/forward navigation.
window.addEventListener("popstate", () => {
  const s = readSeedFromUrl();
  if (s !== null && s !== currentSeed) generateWorld(s);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// kickoff — honour ?seed=XXXX in the URL if present
const initialSeed = readSeedFromUrl() ?? newRandomSeed();
generateWorld(initialSeed);
animate();
