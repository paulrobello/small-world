import * as THREE from "three";
import { state } from "./state.js";
import { BIOMES } from "./biomes.js";
import { WILDFLOWER_PALETTES } from "./biomes.js";
import { makeCreature, makeCaterpillar, stepCreature, makeRingTrail } from "./fauna.js";
import { FLORA_BUILDERS, resetFloraPool } from "./flora.js";
import { mulberry32 } from "./seed.js";
import { jitterGeo, applyWindSway } from "./util.js";
import { BLOOM_LAYER } from "./postfx.js";
import { makeGrassMaterial } from "./grass.js";
import { createNoise2D } from "simplex-noise";

const _params = new URLSearchParams(window.location.search);
export const INSPECT = _params.get("inspect") === "1";

const INSPECT_VIEW_DIRECTIONS = {
  default: new THREE.Vector3(1.7, 1.0, 1.7),
  top: new THREE.Vector3(0.001, 1, 0.001),
  left: new THREE.Vector3(-1, 0.35, 0),
  right: new THREE.Vector3(1, 0.35, 0),
  front: new THREE.Vector3(0, 0.35, 1),
  back: new THREE.Vector3(0, 0.35, -1),
  up: new THREE.Vector3(0, -0.32, 1),
};

function _parseViewName(raw) {
  return raw && raw in INSPECT_VIEW_DIRECTIONS ? raw : "default";
}

function _parseVectorParam(raw) {
  if (!raw) return null;
  const parts = raw.split(",").map((v) => Number(v.trim()));
  if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) return null;
  return new THREE.Vector3(parts[0], parts[1], parts[2]);
}

function _formatVectorParam(v) {
  return [v.x, v.y, v.z].map((n) => Number(n.toFixed(4))).join(",");
}

const CREATURE_VARIANTS = [
  { name: "walker",   kind: "creature",    build: (biome, opts = {}) => makeCreature(biome, opts) },
  { name: "flier",    kind: "creature",    build: (biome, opts = {}) => {
      // re-roll until we get a flier (or, on fish biomes, a fish — they always fly)
      for (let i = 0; i < 30; i++) {
        const c = makeCreature(biome, opts);
        if (c.flies) return c;
        // dispose the rejected creature's geometry to avoid leaks
        c.group.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
            else o.material.dispose();
          }
        });
      }
      return makeCreature(biome, opts);
    } },
  { name: "bumblebee", kind: "creature", build: (biome, opts = {}) => {
      const stripeOverride = biome.flyerVariants?.find(v => v.kind === "bumblebee")?.stripeOverride;
      return makeCreature(biome, { ...opts, variant: "bumblebee", stripeColors: stripeOverride });
    }},
  { name: "fish",     kind: "creature",    build: (biome, opts = {}) => makeCreature({ ...biome, creatureKind: "fish" }, opts) },
  { name: "angler",   kind: "creature",    build: (biome, opts = {}) => makeCreature({ ...biome, creatureKind: "fish", anglerFish: true }, { ...opts, angler: true }) },
  { name: "sleeper",  kind: "creature",    build: (biome, opts = {}) => makeCreature(biome, { ...opts, sleeper: true }) },
  { name: "burrower", kind: "creature",    build: (biome, opts = {}) => makeCreature(biome, { ...opts, burrower: true }) },
  { name: "caterpillar", kind: "caterpillar", build: (biome, opts = {}) => makeCaterpillar(biome, opts) },
  { name: "snail",       kind: "caterpillar", build: (biome, opts = {}) => makeCaterpillar(biome, { ...opts, kind: "snail" }) },
];

// Single-instance stand-ins for things that exist only as InstancedMesh fields
// or world-spanning planes in normal worlds. Sized up so they read at the
// turntable distance (~1.5 units to camera) — actual field instances are
// 0.05–0.34 units tall, which would be invisible specks on the disc.
const INSPECT_SCENERY_BUILDERS = {
  wildflower(biome) {
    const palette = WILDFLOWER_PALETTES[biome.id] ?? ["#ffffff"];
    const g = new THREE.Group();
    const glow = !!biome.glowFlowers;

    // Show 3 detailed flowers in a cluster, one per palette color.
    // Stem geometry (6× scale for inspect distance).
    const stemGeo = new THREE.CylinderGeometry(0.006, 0.012, 0.44, 5, 3).translate(0, 0.22, 0);
    const stemMat = applyWindSway(
      new THREE.MeshStandardMaterial({ color: "#2d5a1e", flatShading: true, roughness: 0.85 }),
      1.0
    );

    // Petal geometry (small curved teardrop).
    const petalGeo = (() => {
      const segs = 4, wSegs = 3;
      const pos = [], uvs = [], idx = [];
      for (let iy = 0; iy <= segs; iy++) {
        const v = iy / segs;
        const hw = Math.max(0.004, 0.045 * Math.sin(Math.PI * v) ** 0.6);
        for (let ix = 0; ix <= wSegs; ix++) {
          const u = ix / wSegs;
          const s = u * 2 - 1;
          const cl = (1 - Math.abs(s)) * 0.006 * (1 - v * 0.4);
          const tc = 0.025 * v ** 1.3;
          pos.push(s * hw, v * 0.08, tc + cl);
          uvs.push(u, v);
        }
      }
      for (let iy = 0; iy < segs; iy++)
        for (let ix = 0; ix < wSegs; ix++) {
          const a = iy * (wSegs + 1) + ix, b = a + 1, c = a + wSegs + 1, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    })();

    // Leaf geometry (mini leafball-style).
    const leafGeo = (() => {
      const segs = 5, wSegs = 3;
      const pos = [], uvs = [], idx = [];
      for (let iy = 0; iy <= segs; iy++) {
        const v = iy / segs;
        const hw = Math.max(0.004, 0.06 * Math.sin(Math.PI * v) ** 0.72 * (1 - v * 0.16));
        for (let ix = 0; ix <= wSegs; ix++) {
          const u = ix / wSegs;
          const s = u * 2 - 1;
          const cl = (1 - Math.abs(s)) * 0.005 * (1 - v * 0.35);
          const tc = 0.030 * v ** 1.45;
          const ec = -Math.abs(s) * 0.005 * Math.sin(Math.PI * v);
          pos.push(s * hw, -v * 0.15, tc + cl + ec);
          uvs.push(u, v);
        }
      }
      for (let iy = 0; iy < segs; iy++)
        for (let ix = 0; ix < wSegs; ix++) {
          const a = iy * (wSegs + 1) + ix, b = a + 1, c = a + wSegs + 1, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      return geo;
    })();
    const leafMat = applyWindSway(
      new THREE.MeshStandardMaterial({ color: "#3a7228", side: THREE.DoubleSide, flatShading: true, roughness: 0.80 }),
      1.0
    );

    const count = Math.min(3, palette.length);
    for (let fi = 0; fi < count; fi++) {
      const baseCol = new THREE.Color(palette[fi]);
      const petalMat = applyWindSway(
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

      const angle = (fi / count) * Math.PI * 2;
      // Position flowers so that Ry(angle) points local +Z outward from cluster center.
      // Ry(angle) maps +Z to (sin(angle), 0, cos(angle)), so position along that.
      const cx = Math.sin(angle) * 0.22;
      const cz = Math.cos(angle) * 0.22;
      const sc = 5; // inspect scale

      // Stem — lean outward from cluster center.
      const stemLean = 0.4;
      const stemH = 0.44;
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.scale.setScalar(sc);
      stem.position.set(cx, 0, cz);
      stem.rotation.set(0, angle, 0);
      stem.rotateX(stemLean);
      stem.castShadow = true;
      g.add(stem);

      // Leaves.
      for (let li = 0; li < 2; li++) {
        const la = angle + (li === 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
        // Position leaf along the leaned stem, ~30-50% up.
        const stemFrac = 0.4 + li * 0.2;
        const stemTip = new THREE.Vector3(0, stemH * stemFrac, 0);
        stemTip.applyQuaternion(stem.quaternion);
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.scale.setScalar(sc * 0.6);
        leaf.position.set(
          cx + stemTip.x * sc,
          stemTip.y * sc,
          cz + stemTip.z * sc
        );
        // Leaf geo hangs along -Y; yaw outward then pitch horizontal.
        leaf.rotation.set(0, la, 0);
        leaf.rotateX(-Math.PI / 2 + li * 0.15);
        leaf.rotateZ((Math.random() - 0.5) * 0.6);
        leaf.rotateY((Math.random() - 0.5) * 0.4);
        leaf.castShadow = true;
        g.add(leaf);
      }

      // Petals — at stem tip.
      const petalStemTip = new THREE.Vector3(0, stemH, 0);
      petalStemTip.applyQuaternion(stem.quaternion);
      const tipX = cx + petalStemTip.x * sc;
      const tipY = petalStemTip.y * sc;
      const tipZ = cz + petalStemTip.z * sc;
      const petalCount = 5;
      for (let pi = 0; pi < petalCount; pi++) {
        const pa = (pi / petalCount) * Math.PI * 2;
        const petal = new THREE.Mesh(petalGeo, petalMat);
        petal.scale.setScalar(sc * 1.2);
        petal.position.set(tipX, tipY, tipZ);
        // Inherit stem rotation, spin around stem axis, then splay outward.
        petal.quaternion.copy(stem.quaternion);
        petal.rotateY(pa);
        petal.rotateX(1.15 + Math.random() * 0.35);
        petal.castShadow = true;
        if (glow) petal.layers.enable(BLOOM_LAYER);
        g.add(petal);
      }

      // Pistil (yellow center) at stem tip.
      const pistilGeo = new THREE.SphereGeometry(0.018, 6, 5);
      pistilGeo.scale(1, 0.55, 1);
      const pistilMat = new THREE.MeshStandardMaterial({ color: "#ffe135", flatShading: true, roughness: 0.5 });
      const pistil = new THREE.Mesh(pistilGeo, pistilMat);
      pistil.scale.setScalar(sc);
      pistil.position.set(tipX, tipY, tipZ);
      pistil.quaternion.copy(stem.quaternion);
      pistil.castShadow = true;
      g.add(pistil);
    }
    return g;
  },

  grassblade(biome) {
    const g = new THREE.Group();
    const blade = new THREE.PlaneGeometry(0.06, 0.34, 1, 3);
    const bp = blade.attributes.position;
    const tipCount = bp.count;
    const tipFactors = new Float32Array(tipCount);
    for (let i = 0; i < tipCount; i++) {
      const y = bp.getY(i) + 0.17;
      bp.setY(i, y);
      const taper = 1 - Math.min(1, y / 0.34) * 0.6;
      bp.setX(i, bp.getX(i) * taper);
      tipFactors[i] = Math.min(1, y / 0.34);
    }
    blade.setAttribute("aTipFactor", new THREE.BufferAttribute(tipFactors, 1));
    blade.computeVertexNormals();

    const baseCol = new THREE.Color(biome.ground[1]).offsetHSL(0, 0.1, -0.08);
    const tipCol = baseCol.clone().offsetHSL(0.0, -0.15, 0.18);
    const mat = new THREE.MeshStandardMaterial({
      color: baseCol,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    const tipUniforms = { uTipColor: { value: tipCol } };
    const prevOnBeforeCompile = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader) => {
      if (prevOnBeforeCompile) prevOnBeforeCompile(shader);
      shader.uniforms.uTipColor = tipUniforms.uTipColor;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float aTipFactor;\nvarying float vTipFactor;"
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvTipFactor = aTipFactor;"
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform vec3 uTipColor;\nvarying float vTipFactor;"
        )
        .replace(
          "#include <color_fragment>",
          "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uTipColor, vTipFactor * 0.85);"
        );
    };
    applyWindSway(mat, 1.8);

    // Tuft of 5 blades fanning out from the center. Scale ~2× for inspect.
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(blade, mat);
      const a = (i / 5) * Math.PI * 2;
      m.position.set(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04);
      m.rotation.y = a;
      m.rotation.z = (Math.random() - 0.5) * 0.15;
      m.scale.setScalar(2);
      g.add(m);
    }
    return g;
  },

  grassfield(biome) {
    // Disc-filling InstancedMesh using the production grass shader (wind
    // noise, clump-height variation) with camera fade disabled so blades
    // stay full-height at inspect distance. Lets us visually verify the
    // shader and per-blade variation without orbiting the whole world.
    const { blade, material: mat, baseCol } = makeGrassMaterial(biome, {
      disableFade: true,
    });

    const DISC_R = 0.9;
    const COUNT = 1000;

    const mesh = new THREE.InstancedMesh(blade, mat, COUNT);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = false;

    const clumpNoise = createNoise2D();
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const e = new THREE.Euler();
    let placed = 0;
    let attempts = 0;
    while (placed < COUNT && attempts < COUNT * 4) {
      attempts++;
      // Rejection sample inside the disc.
      const x = (Math.random() * 2 - 1) * DISC_R;
      const z = (Math.random() * 2 - 1) * DISC_R;
      if (x * x + z * z > DISC_R * DISC_R) continue;

      // Inspect scale is ~6× tighter than the world — match the existing
      // tuft variant which scales blades by 2× from production size.
      const cN = clumpNoise(x * 6.0, z * 6.0) * 0.5 + 0.5;
      const baseScale = (0.7 + Math.random() * 0.7) * 2.0;
      const heightMul = 0.75 + 0.7 * cN;

      v.set(x, 0.001, z); // just above disc top to avoid z-fighting
      s.set(baseScale, baseScale * heightMul, baseScale);
      e.set(
        (Math.random() - 0.5) * 0.18,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.18
      );
      q.setFromEuler(e);
      m.compose(v, q, s);
      mesh.setMatrixAt(placed, m);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;

    const windSeeds = new Float32Array(mesh.count);
    for (let i = 0; i < mesh.count; i++) windSeeds[i] = Math.random();
    blade.setAttribute("aWindSeed", new THREE.InstancedBufferAttribute(windSeeds, 1));

    const colors = new Float32Array(mesh.count * 3);
    const tmp = new THREE.Color();
    for (let i = 0; i < mesh.count; i++) {
      tmp.copy(baseCol).offsetHSL(
        (Math.random() - 0.5) * 0.08,
        0,
        (Math.random() - 0.5) * 0.10
      );
      colors[i * 3 + 0] = tmp.r / baseCol.r || 1;
      colors[i * 3 + 1] = tmp.g / baseCol.g || 1;
      colors[i * 3 + 2] = tmp.b / baseCol.b || 1;
    }
    mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
    mesh.instanceColor.needsUpdate = true;

    const g = new THREE.Group();
    g.add(mesh);
    return g;
  },

  pebble(biome) {
    const g = new THREE.Group();
    const pebbleGeo = jitterGeo(new THREE.IcosahedronGeometry(0.08, 0), 0.025);
    pebbleGeo.scale(1.3, 0.45, 1.3);
    const col = new THREE.Color(biome.cliff).offsetHSL(0, -0.05, 0.12);
    const mat = new THREE.MeshStandardMaterial({
      color: col,
      flatShading: true,
      roughness: 1,
    });
    // Single pebble, ~3× field-instance scale so it reads on the disc.
    const m = new THREE.Mesh(pebbleGeo, mat);
    m.scale.setScalar(3);
    m.position.y = 0.02 * 3;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return g;
  },

  shell(biome) {
    const g = new THREE.Group();
    const geo = new THREE.SphereGeometry(0.1, 8, 6);
    geo.scale(1.35, 0.3, 0.75);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(biome.ground[0]).lerp(new THREE.Color("#fff8e8"), 0.55),
      flatShading: true,
      roughness: 0.9,
    });
    const m = new THREE.Mesh(geo, mat);
    m.scale.setScalar(2.4);
    m.position.y = 0.04;
    m.castShadow = true;
    g.add(m);
    return g;
  },

  starfish(biome) {
    const g = new THREE.Group();
    const shape = new THREE.Shape();
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? 0.18 : 0.065;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(biome.accent).lerp(new THREE.Color("#ffd89a"), 0.35),
      side: THREE.DoubleSide,
      flatShading: true,
      roughness: 0.82,
    });
    const m = new THREE.Mesh(geo, mat);
    m.scale.setScalar(2.2);
    m.position.y = 0.02;
    m.castShadow = true;
    g.add(m);
    return g;
  },

  water(biome) {
    const g = new THREE.Group();
    const geo = new THREE.PlaneGeometry(1.8, 1.8);
    geo.rotateX(-Math.PI / 2);
    const col = new THREE.Color(biome.water || biome.fog);
    const mat = new THREE.MeshStandardMaterial({
      color: col,
      transparent: true,
      opacity: 0.55,
      roughness: 0.32,
      metalness: 0.18,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 0.001; // sit just above disc surface to avoid z-fighting
    g.add(m);
    return g;
  },
};

const VARIANTS_BY_CATEGORY = {
  creature: CREATURE_VARIANTS,
  flora: [
    "tree", "leafballtree", "pine", "snowpine", "cactus", "mushroom", "fern", "rock", "limestonerock",
    "reed", "seaweed", "grass", "beachsucculent", "deadtree", "skull",
    "pillar", "archstone", "crystal", "bigmushroom", "fairyring", "berrybush",
    "lantern", "coral", "braincoral", "cupcoral", "balloontree",
    "lavafissure", "obsidianshard",
  ].map((name) => ({
    name,
    kind: "flora",
    build: (biome) => FLORA_BUILDERS[name](biome),
  })).concat([
    { name: "wildflower", kind: "flora", build: (biome) => INSPECT_SCENERY_BUILDERS.wildflower(biome) },
    { name: "grassblade", kind: "flora", build: (biome) => INSPECT_SCENERY_BUILDERS.grassblade(biome) },
    { name: "grassfield", kind: "flora", build: (biome) => INSPECT_SCENERY_BUILDERS.grassfield(biome) },
    { name: "pebble",     kind: "flora", build: (biome) => INSPECT_SCENERY_BUILDERS.pebble(biome) },
    { name: "shell",      kind: "flora", build: (biome) => INSPECT_SCENERY_BUILDERS.shell(biome) },
    { name: "starfish",   kind: "flora", build: (biome) => INSPECT_SCENERY_BUILDERS.starfish(biome) },
    { name: "water",      kind: "flora", build: (biome) => INSPECT_SCENERY_BUILDERS.water(biome) },
  ]),
};

function _currentVariants() {
  return VARIANTS_BY_CATEGORY[CATEGORIES[_categoryIdx]];
}

const CATEGORIES = ["creature", "flora"];

function _findCategoryIdx(id) {
  if (!id) return 0;
  const i = CATEGORIES.indexOf(id);
  return i >= 0 ? i : 0;
}

// Parse URL params for deterministic recreation.
//   ?inspect=1                    — enter inspect mode (required)
//   &category=<name>              — creature | flora (default: creature)
//   &biome=<id>                   — biome id from BIOMES (default: first entry)
//   &variant=<name>               — walker | flier | sleeper | burrower | caterpillar | snail
//   &seed=<hex|int>               — specimen seed (default: derived from biome+variant)
//   &view=<name>                  — default | top | left | right | front | back | up
//   &camera=<x,y,z>&target=<x,y,z> — exact initial camera pose; overrides view when both are valid
//   &screenshot=1                 — download a PNG after the first framed render
//   &wind=1                       — enable foliage wind in inspect (default: off)
//   &fur=0|1                      — force fur off/on for fur-capable creature variants
//   &color=<rrggbb>               — force creature body color to match a clicked live specimen
//   &paused=0                     — start rotating/animating (default: paused)
function _findBiomeIdx(id) {
  if (!id) return 0;
  const i = BIOMES.findIndex((b) => b.id === id);
  return i >= 0 ? i : 0;
}
function _findVariantIdx(name) {
  if (!name) return 0;
  const i = _currentVariants().findIndex((v) => v.name === name);
  return i >= 0 ? i : 0;
}
function _parseSeed(raw) {
  if (raw == null) return null;
  const n = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
  return Number.isFinite(n) ? (n >>> 0) : null;
}
function _parseBoolParam(raw) {
  if (raw == null) return null;
  if (["1", "true", "on", "yes"].includes(raw.toLowerCase())) return true;
  if (["0", "false", "off", "no"].includes(raw.toLowerCase())) return false;
  return null;
}
function _parseColorParam(raw) {
  if (!raw) return null;
  const hex = raw.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return new THREE.Color(`#${hex}`);
}

let _categoryIdx = _findCategoryIdx(_params.get("category"));
let _biomeIdx = _findBiomeIdx(_params.get("biome"));
let _variantIdx = _findVariantIdx(_params.get("variant"));
// Explicit override; null means use the derived seed in spawnSpecimen.
let _seedOverride = _parseSeed(_params.get("seed"));
let _specimen = null;
let _specimenKind = "creature";
let _hudEl = null;
let _stage = null;
let _inspectCamera = null;
let _inspectControls = null;
let _inspectRenderer = null;
let _viewName = _parseViewName(_params.get("view"));
let _cameraOverride = _parseVectorParam(_params.get("camera"));
let _targetOverride = _parseVectorParam(_params.get("target"));
if (!_cameraOverride || !_targetOverride) {
  _cameraOverride = null;
  _targetOverride = null;
}
let _autoScreenshot = _params.get("screenshot") === "1";
let _autoScreenshotDone = false;
let _inspectWindEnabled = _params.get("wind") === "1";
let _furOverride = _parseBoolParam(_params.get("fur"));
let _inspectFurEnabled = _furOverride ?? false;
let _specimenHasFur = false;
let _colorOverride = _parseColorParam(_params.get("color"));
let _patternOverride = null;
{
  const pt = _params.get("patternType");
  if (pt != null) {
    let pc = _params.get("patternColor");
    if (pc && !pc.startsWith("#")) pc = "#" + pc;
    _patternOverride = {
      patternType: parseFloat(pt),
      patternColor: pc,
      stripeBandCount: _params.get("stripeBandCount") != null ? parseFloat(_params.get("stripeBandCount")) : undefined,
      stripeBandWidth: _params.get("stripeBandWidth") != null ? parseFloat(_params.get("stripeBandWidth")) : undefined,
      stripeOffset: _params.get("stripeOffset") != null ? parseFloat(_params.get("stripeOffset")) : undefined,
      patternScale: _params.get("patternScale") != null ? parseFloat(_params.get("patternScale")) : undefined,
    };
  }
}
let _paused = _params.get("paused") !== "0";
// Pending single-frame step. 0 = no step. Positive = forward, negative = back.
let _stepDt = 0;
let _frozenT = 0;

function _derivedSeed() {
  return (0x1234 + _biomeIdx * 17 + _variantIdx * 31) >>> 0;
}

// Reflect current state back to the URL so the user can copy the address bar
// to share an exact recreation.
function _syncUrl() {
  const sp = new URLSearchParams();
  sp.set("inspect", "1");
  sp.set("category", CATEGORIES[_categoryIdx]);
  sp.set("biome", BIOMES[_biomeIdx].id);
  sp.set("variant", _currentVariants()[_variantIdx].name);
  const seed = _seedOverride ?? _derivedSeed();
  sp.set("seed", "0x" + seed.toString(16).padStart(4, "0"));
  sp.set("view", _viewName);
  if (_cameraOverride && _targetOverride) {
    sp.set("camera", _formatVectorParam(_cameraOverride));
    sp.set("target", _formatVectorParam(_targetOverride));
  }
  if (_autoScreenshot) sp.set("screenshot", "1");
  if (_inspectWindEnabled) sp.set("wind", "1");
  sp.set("fur", _inspectFurEnabled ? "1" : "0");
  if (_colorOverride) sp.set("color", _colorOverride.getHexString());
  if (_patternOverride) {
    sp.set("patternType", _patternOverride.patternType);
    if (_patternOverride.patternColor) sp.set("patternColor", _patternOverride.patternColor.replace(/^#/, ""));
    if (_patternOverride.stripeBandCount != null) sp.set("stripeBandCount", _patternOverride.stripeBandCount);
    if (_patternOverride.stripeBandWidth != null) sp.set("stripeBandWidth", _patternOverride.stripeBandWidth);
    if (_patternOverride.stripeOffset != null) sp.set("stripeOffset", _patternOverride.stripeOffset);
    if (_patternOverride.patternScale != null) sp.set("patternScale", _patternOverride.patternScale);
  }
  sp.set("paused", _paused ? "1" : "0");
  const next = window.location.pathname + "?" + sp.toString();
  if (next !== window.location.pathname + window.location.search) {
    window.history.replaceState(null, "", next);
  }
}

function applyInspectWindSetting() {
  state.windUniforms.uFoliageWind.value = _inspectWindEnabled ? 1 : 0;
}

function downloadInspectScreenshot(renderer = _inspectRenderer) {
  if (!renderer?.domElement) return;
  const biomeTag = BIOMES[_biomeIdx].id.replace(/\s+/g, "-");
  const variantTag = _currentVariants()[_variantIdx].name.replace(/\s+/g, "-");
  const seed = _seedOverride ?? _derivedSeed();
  const seedTag = "0x" + seed.toString(16).padStart(4, "0");
  const url = renderer.domElement.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = `small-world-inspect-${biomeTag}-${variantTag}-${seedTag}-${_viewName}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function scheduleAutoScreenshot(renderer = _inspectRenderer) {
  if (!_autoScreenshot || _autoScreenshotDone) return;
  _autoScreenshotDone = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => downloadInspectScreenshot(renderer));
  });
}

function disposeObject(o) {
  o.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  });
}

function buildStage(scene) {
  if (_stage) {
    scene.remove(_stage);
    disposeObject(_stage);
  }
  _stage = new THREE.Group();

  // Gradient dome backdrop — mid-gray top to slightly darker bottom
  const domeGeo = new THREE.SphereGeometry(40, 24, 16);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      void main() {
        float t = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 top = vec3(0.42, 0.43, 0.46);
        vec3 bot = vec3(0.16, 0.17, 0.20);
        gl_FragColor = vec4(mix(bot, top, t), 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  _stage.add(dome);

  // Small turntable disc for the specimen to stand on
  const discGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.05, 36);
  const discMat = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.9 });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.y = -0.03;
  disc.receiveShadow = true;
  _stage.add(disc);

  // Lights — studio rig
  const hemi = new THREE.HemisphereLight(0xe8eaef, 0x303236, 0.85);
  _stage.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(3.5, 5, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 20;
  key.shadow.bias = -0.0005;
  _stage.add(key);

  const rim = new THREE.DirectionalLight(0xa0c0ff, 0.55);
  rim.position.set(-3, 2, -3);
  _stage.add(rim);

  // Expose to the rest of the codebase so e.g. fur shaders read a valid sun
  state.sunLight = key;
  state.hemiLight = hemi;

  scene.add(_stage);
}

// Compute a Y offset so a flora group rests on the turntable disc top.
// Disc top sits at y ≈ 0 (disc center is at y=-0.03 with height 0.05, so the
// top face is at y ≈ -0.005). Most flora builders author their geometry with
// the base at y=0, but some (crystal shards, obsidian shards) place their
// lowest geometry slightly below 0. Use the post-build bbox to lift up.
function _liftForFlora(group) {
  const bbox = new THREE.Box3().setFromObject(group);
  if (!isFinite(bbox.min.y)) return 0;
  return Math.max(0, -bbox.min.y);
}

function _specimenRoot() {
  return _specimen?.group ?? _specimen ?? null;
}

function _frameSpecimenInView() {
  const root = _specimenRoot();
  if (!root || !_inspectCamera || !_inspectControls) return;

  const bbox = new THREE.Box3().setFromObject(root);
  if (!isFinite(bbox.min.x) || bbox.isEmpty()) return;

  const sphere = new THREE.Sphere();
  bbox.getBoundingSphere(sphere);
  const center = sphere.center;
  const radius = Math.max(0.45, sphere.radius);

  const camera = _inspectCamera;
  const controls = _inspectControls;
  if (_cameraOverride && _targetOverride) {
    camera.position.copy(_cameraOverride);
    controls.target.copy(_targetOverride);
    const dist = Math.max(0.35, camera.position.distanceTo(controls.target));
    controls.minDistance = Math.max(0.35, dist * 0.12);
    controls.maxDistance = Math.max(6, dist * 3.2);
    controls.update();
    return;
  }

  const dir = INSPECT_VIEW_DIRECTIONS[_viewName].clone();
  if (dir.lengthSq() < 0.0001) dir.copy(INSPECT_VIEW_DIRECTIONS.default);
  dir.normalize();

  const verticalFov = THREE.MathUtils.degToRad(camera.getEffectiveFOV());
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const fitFov = Math.max(0.1, Math.min(verticalFov, horizontalFov));
  const fitDistance = (radius / Math.sin(fitFov / 2)) * 1.22;

  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(dir, fitDistance);
  controls.minDistance = Math.max(0.35, fitDistance * 0.28);
  controls.maxDistance = Math.max(6, fitDistance * 3.2);
  controls.update();
}

function spawnSpecimen(scene) {
  if (_specimen) {
    const grp = _specimen.group ?? _specimen;
    if (grp.parent) grp.parent.remove(grp);
    disposeObject(grp);
  }

  state.creatures = [];
  state.caterpillars = [];
  state.butterflies = [];
  state.bees = [];
  state.flowerSpots = [];
  state.dustKicks = [];
  state.dirtPuffs = [];

  const biome = BIOMES[_biomeIdx];
  const variant = _currentVariants()[_variantIdx];

  // Seeded RNG so the same biome+variant always produces the same look —
  // makes A/B comparison across reloads possible. An explicit seed param
  // (via reroll or URL) overrides the derived value.
  const seed = _seedOverride ?? _derivedSeed();
  const original = Math.random;
  Math.random = mulberry32(seed);
  let c;
  try {
    c = variant.build(biome, {
      ...(_furOverride == null ? {} : { furry: _furOverride }),
      color: _colorOverride ?? undefined,
      patternOverride: _patternOverride ?? undefined,
    });
  } finally {
    Math.random = original;
  }

  _specimenHasFur = !!(c?.furShells && c.furShells.length);
  if (_furOverride == null) _inspectFurEnabled = _specimenHasFur;

  _specimen = c;
  _specimenKind = variant.kind;
  if (variant.kind === "flora") {
    // Flora returns just a THREE.Group with no per-frame state. Lift so the
    // group sits on the disc; the wind-sway shader animates via the global
    // windUniforms.uTime advance in main.js.
    resetFloraPool();
    const lift = _liftForFlora(c);
    c.position.set(0, lift, 0);
    scene.add(c);
  } else if (variant.kind === "caterpillar") {
    state.caterpillars.push(c);
    // Lift so the head's bottom sphere clears the disc.
    // head bottom (body-local) = baseOffset - radius*scale = -radius*scale*0.3
    const lift = c.segRadius * c.scale * 0.3 + 0.02;
    c.group.position.set(0, lift, 0);
    // Pose still — no crawling — so body segments rest in a known place.
    c.speed = 0;
    // Face toward the camera (default at +x+z corner) so eyes are visible.
    c.heading = Math.PI / 4;
    // Pin head to origin in body-local; stepCaterpillar sets y each frame.
    const head = c.segments[0];
    head.position.x = 0;
    head.position.z = 0;
    head.rotation.y = -c.heading + Math.PI / 2;
    // Re-seed the trail to a clean line behind the head (away from camera).
    const seedPoints = [];
    const seedStep = 0.04;
    for (let i = 0; i < 250; i++) {
      seedPoints.push({
        x: -Math.cos(c.heading) * i * seedStep,
        y: 0,
        z: -Math.sin(c.heading) * i * seedStep,
      });
    }
    c.trail = makeRingTrail(seedPoints);
    scene.add(c.group);
  } else {
    state.creatures.push(c);
    // Fliers normally hover at 1.4-3.2 units which leaves them above the
    // inspect camera's frame. Cap to a height that sits comfortably in view.
    if (c.flies) {
      c.hoverHeight = 0.7;
      c.currentHover = 0.7;
    }
    c.group.position.set(0, c.flies ? 0.7 : 0.45, 0);
    // Burrowers cycle through a hide-underground state machine, which makes
    // them disappear for 3-7s at a time. Pin them to the surface for inspect
    // so the small-and-cute burrower silhouette stays visible.
    if (c.isBurrower) {
      c.isBurrower = false;
      c.burrowState = "surface";
      c.burrowDepth = 0;
    }
    scene.add(c.group);
  }
  _frameSpecimenInView();
  updateHud();
  _syncUrl();
}

function updateHud() {
  if (!_hudEl) return;
  const biome = BIOMES[_biomeIdx];
  const variants = _currentVariants();
  const variant = variants[_variantIdx];
  const category = CATEGORIES[_categoryIdx];
  const pauseTag = _paused ? `<span class="ihud-paused">PAUSED</span>` : "";
  const windTag = _inspectWindEnabled ? `<span class="ihud-paused">WIND</span>` : "";
  const furTag = _specimenHasFur ? `<span class="ihud-paused">FUR</span>` : "";
  // Reroll has no visible effect for most flora; hide the hint there to
  // avoid implying we'll change something.
  const rerollHint = category === "flora" ? "" : " &nbsp; r reroll";
  const furHint = category === "flora" ? "" : "f fur &nbsp; ";
  _hudEl.innerHTML =
    `<span class="ihud-key">INSPECT</span>` +
    `<span class="ihud-val">${biome.name}</span>` +
    `<span class="ihud-sep">·</span>` +
    `<span class="ihud-val">${category}</span>` +
    `<span class="ihud-sep">·</span>` +
    `<span class="ihud-val">${variant.name}</span>` +
    pauseTag +
    windTag +
    furTag +
    `<span class="ihud-keys">${furHint}[/] biome &nbsp; k category &nbsp; ,/. variant${rerollHint} &nbsp; w wind &nbsp; s screenshot &nbsp; space pause &nbsp; ←/→ step</span>`;
}

const _flatHeight = () => 0;

// Minimal inspect-only caterpillar/snail animation. Bypasses stepCaterpillar
// because that function unshifts a duplicate head-position entry onto the
// trail every frame; with c.speed=0 the trail fills with duplicates and body
// segments collapse onto the head within a second. Here we place segments
// statically behind the head along c.heading and apply the breathing/wave
// bob from c.age.
function stepInspectCaterpillar(c, dt) {
  c.age = Math.max(0, c.age + dt);
  const head = c.segments[0];
  const baseOffset = c.segRadius * 0.7 * c.scale;
  head.position.set(0, baseOffset, 0);
  head.rotation.y = -c.heading + Math.PI / 2;
  head.rotation.x = Math.sin(c.age * 4) * 0.06;
  const dx = -Math.cos(c.heading);
  const dz = -Math.sin(c.heading);
  for (let i = 1; i < c.segments.length; i++) {
    const off = i * c.segSpacing;
    const bob = Math.sin(c.age * 3.5 - i * 0.7) * 0.03 * c.scale;
    c.segments[i].position.set(dx * off, baseOffset + bob, dz * off);
    c.segments[i].rotation.z = Math.sin(c.age * 2 - i * 0.5) * 0.06;
  }
}

export function setupInspect(scene, renderer, camera, controls) {
  _inspectCamera = camera;
  _inspectControls = controls;
  _inspectRenderer = renderer;
  if (_cameraOverride && _targetOverride) {
    controls.target.copy(_targetOverride);
    camera.position.copy(_cameraOverride);
  } else {
    controls.target.set(0, 0.35, 0);
    camera.position.copy(controls.target).add(INSPECT_VIEW_DIRECTIONS[_viewName]);
  }
  controls.minDistance = 0.8;
  controls.maxDistance = 6;
  controls.autoRotate = !_paused;
  controls.autoRotateSpeed = 0.6;
  controls.minPolarAngle = 0.001;
  controls.maxPolarAngle = Math.PI * 0.9;
  controls.update();

  state.heightFn = _flatHeight;
  applyInspectWindSetting();

  buildStage(scene);

  // Hide normal HUD
  document.querySelector(".hud.hud-top")?.classList.add("inspect-hidden");
  document.querySelector(".hud.hud-bottom")?.classList.add("inspect-hidden");
  document.getElementById("settings-panel")?.classList.add("inspect-hidden");
  document.getElementById("help-panel")?.classList.add("inspect-hidden");
  // Also corner crosshairs + grain/vignette (keep grain for film grain feel,
  // but hide corners which were originally aligned to the world view)
  document.querySelectorAll(".corner").forEach((el) => el.classList.add("inspect-hidden"));

  _hudEl = document.createElement("div");
  _hudEl.className = "inspect-hud";
  document.body.appendChild(_hudEl);

  window.addEventListener("keydown", (e) => {
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const handledKeys = ["[", "]", ",", ".", "r", "s", "S", "w", "W", "f", "F", " ", "ArrowRight", "ArrowLeft", "k"];
    if (!handledKeys.includes(e.key)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === "[") {
      _biomeIdx = (_biomeIdx - 1 + BIOMES.length) % BIOMES.length;
      _seedOverride = null; // new context — derive a fresh seed
      spawnSpecimen(scene);
    } else if (e.key === "]") {
      _biomeIdx = (_biomeIdx + 1) % BIOMES.length;
      _seedOverride = null;
      spawnSpecimen(scene);
    } else if (e.key === ",") {
      _variantIdx = (_variantIdx - 1 + _currentVariants().length) % _currentVariants().length;
      _seedOverride = null;
      spawnSpecimen(scene);
    } else if (e.key === ".") {
      _variantIdx = (_variantIdx + 1) % _currentVariants().length;
      _seedOverride = null;
      spawnSpecimen(scene);
    } else if (e.key === "r") {
      // Pick a fresh random seed and keep it so the URL stays reproducible
      _seedOverride = (Math.random() * 0x10000) | 0;
      spawnSpecimen(scene);
    } else if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      downloadInspectScreenshot(renderer);
    } else if (e.key === "w" || e.key === "W") {
      e.preventDefault();
      _inspectWindEnabled = !_inspectWindEnabled;
      applyInspectWindSetting();
      updateHud();
      _syncUrl();
    } else if (e.key === "f" || e.key === "F") {
      if (CATEGORIES[_categoryIdx] !== "flora") {
        e.preventDefault();
        _inspectFurEnabled = !_inspectFurEnabled;
        _furOverride = _inspectFurEnabled;
        spawnSpecimen(scene);
      }
    } else if (e.key === " ") {
      _paused = !_paused;
      _stepDt = 0;
      // Freeze camera auto-rotate too so screenshots compose cleanly
      controls.autoRotate = !_paused;
      updateHud();
      _syncUrl();
      e.preventDefault();
    } else if (e.key === "ArrowRight" && _paused) {
      _stepDt = 1 / 60;
    } else if (e.key === "ArrowLeft" && _paused) {
      // Negative dt steps integrated state (c.bob, c.age, hopOffset) back.
      // Step-based randomness (think pauses, herding) isn't re-rolled, but
      // for short back/forth nudges the visible result is symmetric.
      _stepDt = -1 / 60;
    } else if (e.key === "k") {
      _categoryIdx = (_categoryIdx + 1) % CATEGORIES.length;
      _variantIdx = 0;
      _seedOverride = null;
      spawnSpecimen(scene);
    }
  }, { capture: true });

  spawnSpecimen(scene);
  scheduleAutoScreenshot(renderer);
}

export function stepInspect(dt, t) {
  if (!_specimen) return;
  if (_specimenKind === "flora") return; // wind sway runs via global uTime; no per-frame work
  // Pause/step: when paused, zero dt and freeze t so all sin-time-driven
  // animations (bob, flap, breath) stop. ArrowRight while paused advances
  // exactly one ~16 ms frame.
  let useDt = dt;
  let useT = t;
  if (_paused) {
    if (_stepDt !== 0) {
      useDt = _stepDt;
      _frozenT += _stepDt;
      useT = _frozenT;
      _stepDt = 0;
    } else {
      useDt = 0;
      useT = _frozenT;
    }
  } else {
    _frozenT = t;
  }
  if (_specimenKind === "caterpillar") {
    stepInspectCaterpillar(_specimen, useDt);
  } else {
    stepCreature(_specimen, useDt, useT, _flatHeight);
    // Keep the specimen pinned to the turntable center — internal animations
    // (idle bob, breathing, fin sway, walk cycle) still play, but the creature
    // doesn't wander off the disc.
    const g = _specimen.group;
    g.position.x = 0;
    g.position.z = 0;
  }
}
