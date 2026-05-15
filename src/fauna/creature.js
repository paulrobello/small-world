import * as THREE from "three";
import { state } from "../state.js";
import { jitterGeo } from "../util.js";
import { nearestCenter } from "../terrain.js";
import { makeDirtPuff, makeDustKick, emitGroundMark } from "../environment.js";
import { applyShellFur } from "../fur.js";
import { BLOOM_LAYER } from "../postfx.js";
import { WATER_AVOID_Y, avoidObstacles, colorsClose } from "./shared.js";

// Personality presets — picked once per creature at spawn, tweak how it walks,
// thinks, hops, herds, and sleeps. Subtle multipliers; the cute baseline is
// still recognisable.
const PERSONALITIES = {
  shy:    { speedMul: 0.75, bobSpeedMul: 0.9, bobAmpMul: 0.85, pauseChance: 0.4,  hopProb: 0.12, herdStrength: 0.2,  nightThresh: 0.55 },
  bold:   { speedMul: 1.25, bobSpeedMul: 1.0, bobAmpMul: 1.1,  pauseChance: 0.05, hopProb: 0.45, herdStrength: 0.45, nightThresh: 0.85 },
  sleepy: { speedMul: 0.75, bobSpeedMul: 0.7, bobAmpMul: 0.9,  pauseChance: 0.45, hopProb: 0.1,  herdStrength: 0.3,  nightThresh: 0.40 },
  bouncy: { speedMul: 1.05, bobSpeedMul: 1.4, bobAmpMul: 1.5,  pauseChance: 0.1,  hopProb: 0.55, herdStrength: 0.35, nightThresh: 0.75 },
};
const PERSONALITY_NAMES = Object.keys(PERSONALITIES);

const FISH_MIN_GROUND_Y = -4.2;

function fishMaxGroundY(scale) {
  // Water plane is around y=-0.12 and can wave downward; keep the fish body's
  // top below the lowest visible surface and require terrain clearance below.
  return WATER_AVOID_Y - 0.24 - 0.66 * scale;
}

function currentPerchPoint(perch) {
  if (!perch?.perchWind) return perch;
  const wind = perch.perchWind;
  const t = state.windUniforms.uTime.value;
  const foliageWind = state.windUniforms.uFoliageWind.value;
  const windY = Math.max(wind.localY ?? 0, 0);
  const windAmp = windY * windY * (wind.strength ?? 1) * foliageWind;
  const baseX = wind.baseX ?? perch.x;
  const baseZ = wind.baseZ ?? perch.z;
  // Mirror applyWindSway's non-instanced shader path: it samples
  // modelMatrix * vec4(transformed, 1.0), offsets local X/Z, then lets the
  // flora group's rotation/scale carry that offset into world space.
  const localX = Math.sin(t * 1.4 + baseX * 0.30 + baseZ * 0.40) * windAmp * 0.06;
  const localZ = Math.sin(t * 0.9 + baseX * 0.15 - baseZ * 0.25) * windAmp * 0.05;
  const rot = wind.rotationY ?? 0;
  const scale = wind.scale ?? 1;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return {
    x: perch.x + (c * localX + s * localZ) * scale,
    y: perch.y,
    z: perch.z + (-s * localX + c * localZ) * scale,
  };
}

// Per-regen creature resource pool — shared eye/pupil materials and the
// constant geometries used by every creature. `resetCreaturePool()` is
// called at the top of each generateWorld, so disposeGroup correctly tears
// down the previous regen's pooled objects (each lives in state.world via
// the first creature that consumed it). Without pooling, every creature
// would allocate its own copies of identical resources.
let _creaturePool = new Map();
export function resetCreaturePool() {
  _creaturePool = new Map();
}
function pooled(key, factory) {
  let v = _creaturePool.get(key);
  if (v === undefined) {
    v = factory();
    _creaturePool.set(key, v);
  }
  return v;
}

// Shared single-"z" texture for the night-sleep particles. Built lazily on
// first drowsy creature, then reused across every spawned z for the session.
let _zTexture = null;
function getZTexture() {
  if (_zTexture) return _zTexture;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = "#fafaf2";
  ctx.font = "italic bold 44px 'Quicksand', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillText("z", 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _zTexture = tex;
  return tex;
}

// One rising z particle. Stream is managed per-creature: spawn cadence,
// per-particle life, sideways drift, fade in then fade out as it climbs.
const Z_LIFE = 2.4;
const Z_SPAWN_INTERVAL = 0.9;
const Z_RISE = 0.9;
function spawnZ(c) {
  const mat = new THREE.SpriteMaterial({
    map: getZTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  const scale = 0.26 + Math.random() * 0.16;
  s.scale.set(scale, scale, 1);
  const startX = 0.15 + (Math.random() - 0.5) * 0.12;
  s.position.set(startX, 0.85, 0);
  s.userData.life = 0;
  s.userData.startX = startX;
  s.userData.driftX = (Math.random() - 0.5) * 0.25;
  s.userData.wobblePhase = Math.random() * Math.PI * 2;
  c.group.add(s);
  c.zSprites.push(s);
}

// opts:
//   role         — "parent" | "kid"   (for family groups)
//   parent       — reference to the parent creature (for kids)
//   sizeMul      — overall size multiplier (default 1)
//   sleeper      — spawn in sleeping state (walkers only)
//   burrower     — spawn as burrower variant (walkers only)
export function makeCreature(biome, opts = {}) {
  const isAngler = !!opts.angler;
  const isBumblebee = opts.variant === "bumblebee";
  const isFish = biome.creatureKind === "fish" || isAngler;
  // sleepers and burrowers must be walkers — sleeping fliers in mid-air look broken
  const forceWalk = !!(opts.sleeper || opts.burrower);
  const flies = isFish ? true : isBumblebee ? true : forceWalk ? false : Math.random() < 0.3;

  const group = new THREE.Group();
  // YXZ order so heading yaw applies first, then pitch/roll resolve in the
  // creature's body frame (heading-local). stepCreature uses pitch + roll
  // to lay walkers flat against sloped terrain.
  group.rotation.order = "YXZ";
  group.userData.inspect = {
    category: "creature",
    variant: opts.sleeper
      ? "sleeper"
      : opts.burrower
        ? "burrower"
        : isAngler
          ? "angler"
          : isFish
            ? "fish"
            : isBumblebee
              ? "bumblebee"
              : flies
                ? "flier"
                : "walker",
  };
  const palette = biome.creatureColors;
  const bodyCol = opts.color instanceof THREE.Color
    ? opts.color.clone()
    : new THREE.Color(palette[Math.floor(Math.random() * palette.length)]);
  // Roll fur before geometry jitter consumes a variable number of random
  // values. That keeps a seed's fuzzy/smooth outcome stable when body detail
  // changes, and restores inspect seeds that were fuzzy before smoothing.
  const furProb = biome.furProbability ?? 0;
  const furRoll = furProb > 0 ? Math.random() : 1;
  const wantsFur = isBumblebee || (!isFish && (opts.furry ?? (furProb > 0 && furRoll < furProb)));

  // body — rounder for fliers, more elongated for walkers
  const bodyGeo = jitterGeo(new THREE.IcosahedronGeometry(0.42, 1), 0.06);
  const body = new THREE.Mesh(
    bodyGeo,
    new THREE.MeshStandardMaterial({
      name: flies ? "flier.body.mat.smooth" : "walker.body.mat.smooth",
      color: bodyCol,
      roughness: 0.55,
      metalness: 0.02,
    })
  );
  let bodyBaseY = isFish ? 0.72 : flies ? 0.92 : 0.82;
  let bodyBaseX = isFish ? 0.9 : flies ? 1.05 : 1;
  let bodyBaseZ = isFish ? 1.45 : flies ? 1.05 : 1.25;
  body.scale.set(bodyBaseX, bodyBaseY, bodyBaseZ);
  body.castShadow = true;
  group.add(body);

  if (isBumblebee) {
    const stripes = opts.stripeColors || ["#111111", "#ffd13b"];
    bodyCol.set(stripes[0]);
    body.material.color.set(stripes[0]);
    body.material.name = "bumblebee.body.mat";
    bodyBaseZ *= 1.25; // 25% elongation
    body.scale.set(bodyBaseX, bodyBaseY, bodyBaseZ);
    // Paint stripes directly onto the body surface via vertex colors.
    // Bumblebees are mostly dark with a few wide yellow bands.
    const darkCol = new THREE.Color(stripes[0]);
    const lightCol = new THREE.Color(stripes[1]);
    const pos = body.geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    // Default all vertices to dark first
    for (let i = 0; i < pos.count; i++) {
      colors[i * 3] = darkCol.r;
      colors[i * 3 + 1] = darkCol.g;
      colors[i * 3 + 2] = darkCol.b;
    }
    // Two yellow bands — rear abdomen and mid-body. Keep them narrow
    // so most of the body stays dark (head + tail tip = black).
    const bands = [
      { center: -0.28, half: 0.06 },  // rear abdomen
      { center:  0.10, half: 0.06 },  // mid body
    ];
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      for (const b of bands) {
        if (Math.abs(z - b.center) < b.half) {
          colors[i * 3] = lightCol.r;
          colors[i * 3 + 1] = lightCol.g;
          colors[i * 3 + 2] = lightCol.b;
          break;
        }
      }
    }
    body.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    body.material.vertexColors = true;
    body.material.needsUpdate = true;
  }

  let furShells = null;
  // Per-creature fur roll. furProbability ∈ [0,1]; biomes without an
  // override fall back to 0 (no fur). Fish never get fur; fliers use the same
  // short body fur as walkers.
  // The roll happens inside generateWorld's seeded Math.random window, so the
  // same seed reproduces the same fuzzy/smooth split.
  if (wantsFur) {
    furShells = applyShellFur(body, biome, {
      baseColor: bodyCol.clone(),
      tipColor: bodyCol.clone(),
    });
  }
  group.userData.inspect.fur = furShells ? "1" : "0";
  group.userData.inspect.color = bodyCol.getHexString();

  // belly highlight
  const belly = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 10, 8),
    new THREE.MeshStandardMaterial({
      name: flies ? "flier.belly.mat.smooth" : "walker.belly.mat.smooth",
      color: bodyCol.clone().offsetHSL(0, -0.2, 0.18),
    })
  );
  belly.position.set(0, -0.12, 0.05);
  belly.scale.set(0.85, 0.55, 1);
  belly.userData.baseScale = belly.scale.clone();
  group.add(belly);

  // eyes — material and geometry are uniform across every creature of a
  // single regen, so they're pulled from the per-regen pool.
  const eyeMat = pooled("eye.mat", () => new THREE.MeshStandardMaterial({
    color: 0xfafaf2,
    roughness: 0.15,
  }));
  const pupilMat = biome.glowEyes
    ? pooled("pupil.mat.glow", () => new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.accent),
        emissive: new THREE.Color(biome.accent),
        emissiveIntensity: 1.4,
        roughness: 0.3,
      }))
    : pooled("pupil.mat", () => new THREE.MeshStandardMaterial({
        color: 0x0a0a0a,
        roughness: 0.05,
      }));
  const eyeGeo = pooled("eye.geo", () => new THREE.SphereGeometry(0.11, 10, 8));
  const pupilGeo = pooled("pupil.geo", () => new THREE.SphereGeometry(0.05, 8, 8));
  const eyeParts = [];
  for (const sign of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(
      sign * (isFish ? 0.25 : 0.16),
      isFish ? 0.12 : 0.17,
      isFish ? 0.24 : 0.4
    );
    if (isFish) eye.scale.setScalar(0.92);
    group.add(eye);
    eyeParts.push(eye);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(
      sign * (isFish ? 0.32 : 0.16),
      isFish ? 0.12 : 0.17,
      isFish ? 0.27 : 0.48
    );
    if (isFish) pupil.scale.setScalar(0.86);
    if (biome.glowEyes) pupil.layers.enable(BLOOM_LAYER);
    group.add(pupil);
    eyeParts.push(pupil);
  }

  // antennae for some
  const antennae = [];
  if (!isFish && (isBumblebee || Math.random() > 0.55)) {
    const antMat = new THREE.MeshStandardMaterial({
      color: bodyCol.clone().offsetHSL(0, 0, -0.2),
    });
    for (const sign of [-1, 1]) {
      const stalk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.32, 4),
        antMat
      );
      // Stalk center sits deeper inside the body so the base never floats
      // free when a jitter-perturbed body vertex pulls in. Tip ends up at the
      // same visible height (0.52) as before.
      stalk.position.set(sign * 0.1, 0.36, 0.1);
      stalk.rotation.z = sign * -0.25;
      group.add(stalk);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 6, 6),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.accent),
          emissive: new THREE.Color(biome.accent).multiplyScalar(0.35),
        })
      );
      tip.layers.enable(BLOOM_LAYER);
      // Parented to the stalk so the tip rigidly tracks the stalk top
      // through any rotation. Local +Y on the cylinder is the stalk's top.
      tip.position.set(0, 0.16, 0);
      stalk.add(tip);
      antennae.push(stalk);
    }
  }

  const feet = [];
  const legs = [];
  const wings = [];
  let tailFin = null;
  let lureStalk = null;
  let lureOrb = null;

  if (flies) {
    if (isFish) {
      const finMat = new THREE.MeshStandardMaterial({
        color: bodyCol.clone().offsetHSL(0, -0.05, 0.14),
        flatShading: true,
        roughness: 0.5,
        side: THREE.DoubleSide,
      });
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.24, -0.02, 0.02);
        pivot.rotation.z = side * -0.45;
        pivot.rotation.x = -0.18;
        group.add(pivot);
        const finGeo = jitterGeo(
          new THREE.IcosahedronGeometry(0.16, 0),
          0.035
        );
        finGeo.scale(1.75, 0.12, 0.85);
        const fin = new THREE.Mesh(finGeo, finMat);
        fin.position.set(side * 0.2, -0.02, -0.02);
        fin.castShadow = true;
        pivot.add(fin);
        wings.push(pivot);
      }
      const tailGeo = jitterGeo(new THREE.IcosahedronGeometry(0.18, 0), 0.04);
      tailGeo.scale(0.38, 1.35, 1.6);
      tailFin = new THREE.Mesh(tailGeo, finMat);
      tailFin.position.set(0, 0.02, -0.58);
      tailFin.castShadow = true;
      group.add(tailFin);

      if (isAngler) {
        const lureMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.accent),
          emissive: new THREE.Color(biome.accent),
          emissiveIntensity: 1.55,
          roughness: 0.25,
        });
        const stalkMat = new THREE.MeshStandardMaterial({
          color: bodyCol.clone().offsetHSL(0, -0.08, -0.08),
          roughness: 0.65,
          flatShading: true,
        });
        lureStalk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.018, 0.52, 6),
          stalkMat
        );
        lureStalk.position.set(0, 0.38, 0.2);
        lureStalk.rotation.x = -0.72;
        group.add(lureStalk);

        lureOrb = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 10, 8),
          lureMat
        );
        lureOrb.position.set(0, 0.27, 0);
        lureOrb.layers.enable(BLOOM_LAYER);
        lureStalk.add(lureOrb);
      }
    } else {
      // wings — flattened ellipsoid icospheres on hinge groups
      const wingMat = new THREE.MeshStandardMaterial({
        color: isBumblebee ? 0xccccdd : bodyCol.clone().offsetHSL(0, -0.15, 0.12),
        flatShading: true,
        roughness: isBumblebee ? 0.3 : 0.45,
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

      if (isBumblebee) {
        // Six legs — three pairs along the underside. Larger than the
        // original tiny proportions so they're readable at half scale.
        const legMat = new THREE.MeshStandardMaterial({
          color: 0x111111,
          roughness: 0.6,
        });
        const legGeo = new THREE.CylinderGeometry(0.028, 0.022, 0.38, 4);
        legGeo.translate(0, -0.19, 0);
        const legPositions = [
          [-0.16, 0.10],
          [ 0.16, 0.10],
          [-0.16, 0.00],
          [ 0.16, 0.00],
          [-0.16,-0.10],
          [ 0.16,-0.10],
        ];
        for (const [fx, fz] of legPositions) {
          const leg = new THREE.Mesh(legGeo, legMat);
          leg.position.set(fx, -0.14, fz);
          leg.castShadow = true;
          group.add(leg);
          legs.push(leg);
          const foot = new THREE.Mesh(
            new THREE.SphereGeometry(0.03, 4, 4),
            legMat
          );
          foot.position.set(fx, -0.52, fz);
          group.add(foot);
          feet.push(foot);
        }
      } else {
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
      }
      // Stinger — thin black cone at the rear
      if (isBumblebee) {
        const stingerGeo = new THREE.ConeGeometry(0.03, 0.30, 5);
        stingerGeo.rotateX(Math.PI / 2);
        stingerGeo.translate(0, 0, -0.55);
        const stinger = new THREE.Mesh(stingerGeo, new THREE.MeshStandardMaterial({
          color: 0x0a0a0a,
          roughness: 0.4,
        }));
        group.add(stinger);
      }
    }
  } else {
    // walkers: visible legs + feet
    const legMat = new THREE.MeshStandardMaterial({
      name: "walker.leg.mat.smooth",
      color: bodyCol.clone().offsetHSL(0, 0, -0.18),
      roughness: 0.75,
    });
    const footMat = new THREE.MeshStandardMaterial({
      name: "walker.foot.mat.smooth",
      color: bodyCol.clone().offsetHSL(0, 0, -0.3),
    });
    // cylinder of length 1 with its origin at the top so scale.y = length.
    // Geometry data is identical for every leg of every creature — pool a
    // single shared instance instead of allocating + disposing per creature.
    const legGeo = pooled("leg.geo", () => {
      const g = new THREE.CylinderGeometry(0.045, 0.06, 1, 6);
      g.translate(0, -0.5, 0);
      return g;
    });
    const footGeo = pooled("foot.geo", () => new THREE.SphereGeometry(0.085, 6, 6));

    const footPositions = [
      [-0.18, 0.18],
      [0.18, 0.18],
      [-0.18, -0.18],
      [0.18, -0.18],
    ];
    for (const [fx, fz] of footPositions) {
      const leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(fx, -0.1, fz);
      leg.scale.y = 0.22; // resting length, updated each frame
      leg.castShadow = true;
      group.add(leg);
      legs.push(leg);

      const foot = new THREE.Mesh(footGeo, footMat);
      foot.position.set(fx, -0.32, fz);
      foot.scale.set(1.15, 0.55, 1.3);
      foot.userData.groundMarkOffset = { x: fx, z: fz };
      foot.castShadow = true;
      group.add(foot);
      feet.push(foot);
    }
  }

  const sizeMul = opts.sizeMul ?? 1;
  const baseScale = 0.65 + Math.random() * 0.6;
  // burrowers are notably smaller; kids inherit sizeMul on top
  const burrowScale = opts.burrower ? 0.55 : 1;
  const scale = baseScale * sizeMul * burrowScale * (isFish ? 0.5625 : 1) * (isBumblebee ? 0.5 : 1);
  group.scale.setScalar(scale);

  const hoverHeight = 1.4 + Math.random() * 1.8;

  const isSleeper = !!opts.sleeper && !flies;
  const isBurrower = !!opts.burrower && !flies;

  // Sleepers spawn already curled (eyes scaled to 0, body squashed, legs
  // tucked under the body, belly collapsed, antennae retracted).
  // stepCreature animates the wake-up in reverse.
  let wakeProgress = isSleeper ? 0 : 1;
  if (isSleeper) {
    for (const e of eyeParts) e.scale.setScalar(0);
    body.scale.set(bodyBaseX * 1.18, bodyBaseY * 0.55, bodyBaseZ * 1.05);
    for (let i = 0; i < legs.length; i++) {
      legs[i].scale.y = 0.02;
      feet[i].position.y = -0.15;
    }
    belly.scale.set(0, 0, 0);
    // Uniform scale so the tip (child of stalk at local +Y) collapses with it.
    for (const a of antennae) a.scale.setScalar(0);
  }

  // Personality stamp — pulled from the deterministic RNG during world-gen,
  // applies subtle multipliers to speed/think/bob and biases the sleep,
  // herd, and hop responses below.
  const personalityName =
    PERSONALITY_NAMES[Math.floor(Math.random() * PERSONALITY_NAMES.length)];
  const personality = PERSONALITIES[personalityName];

  const baseSpeed = flies ? 1.1 + Math.random() * 0.9 : 0.6 + Math.random() * 0.7;
  const baseBobSpeed = flies ? 4 + Math.random() * 2 : 6 + Math.random() * 3;

  return {
    group,
    body,
    belly,
    antennae,
    feet,
    legs,
    wings,
    tailFin,
    lureStalk,
    lureOrb,
    isAngler,
    eyeParts,
    flies,
    isFish,
    scale,
    role: opts.role || null,         // "parent" | "kid" | null
    parent: opts.parent || null,     // reference to parent creature (kids only)
    heading: Math.random() * Math.PI * 2,
    speed: baseSpeed * personality.speedMul,
    bob: Math.random() * Math.PI * 2,
    bobSpeed: baseBobSpeed * personality.bobSpeedMul,
    flapSpeed: 16 + Math.random() * 10,
    flapPhase: Math.random() * Math.PI * 2,
    hoverHeight,
    // landing state — only used when flies===true
    landState: "flying", // "flying" | "descending" | "landed" | "ascending"
    landTimer: 6 + Math.random() * 14, // seconds until first landing attempt
    currentHover: hoverHeight, // animated; lerps between hoverHeight and rest
    // Mushroom cap to land on (or null for an ordinary ground landing).
    // Picked on flying→descending; cleared on ascending→flying.
    perchTarget: null,
    perchOffsetX: 0,
    perchOffsetZ: 0,
    // Smoothed blend factor from terrain ground → perch top. Lerps toward
    // a closeness target each frame so the floor change can never snap,
    // even if the perch was picked at close range or the flier crosses
    // the closeness curve quickly.
    perchFloorWeight: 0,
    bodyBaseY,
    bodyBaseX,
    bodyBaseZ,
    bodyColor: bodyCol.clone(),
    furShells,
    nextThink: Math.random() * 2.5,
    pauseUntil: 0,
    age: Math.random() * 100,
    // sleeper state — when isSleeper, the creature won't think/move until woken.
    isSleeper,
    wakeProgress,             // 0 = fully asleep, 1 = fully awake
    // burrower state — alternating cycles of above-ground/burrowed life
    isBurrower,
    burrowState: isBurrower ? "surface" : null, // "surface" | "descending" | "burrowed" | "emerging"
    burrowTimer: isBurrower ? 2 + Math.random() * 4 : 0,
    burrowDepth: 0,           // 0 = on ground, 1 = fully submerged
    dirtColor: new THREE.Color(biome.cliff),
    // Personality + behavior knobs read by stepCreature
    personality: personalityName,
    pauseChance: personality.pauseChance,
    bobAmpMul: personality.bobAmpMul,
    hopProb: personality.hopProb,
    herdStrength: personality.herdStrength,
    nightThresh: personality.nightThresh,
    // Look-at-camera — set by the UI hover handler to N seconds; stepCreature
    // decrements and overrides the heading-based rotation while > 0.
    lookTimer: 0,
    // Curiosity hop — a vertical pos.y bump added on top of the regular
    // ground+bob math. hopVy is the integrated vertical velocity, hopOffset
    // the current height above resting, hopCooldown the gate.
    hopVy: 0,
    hopOffset: 0,
    hopCooldown: 1.5 + Math.random() * 3,
    // Night-sleep — 0..1 sleepiness target driven by state.nightFactor and
    // personality.nightThresh. zSprites is a per-creature pool of rising "z"
    // particles spawned while sleeping; they finish their fade on wake.
    sleepiness: 0,
    zSprites: [],
    zSpawnTimer: 0,
    // Footstep dust — per-foot last sin sample for rising-edge detection,
    // and a global per-creature cooldown so multiple feet don't all kick
    // at once. Allocated for fliers/fish too (cheap) since the walker
    // animation block is never entered for them.
    lastFootSin: [0, 0, 0, 0],
    lastDustAt: 0,
  };
}

// Trigger a brief look-at-camera response. Called from the UI hover/tap
// handler — the stepCreature override decays via c.lookTimer.
export function lookAtCreature(c) {
  if (c.isSleeper) return;
  // 1.5s of camera-facing — long enough to read, short enough to not feel sticky
  c.lookTimer = 1.5;
}

// Find distance to nearest butterfly or bee for the curiosity-hop trigger.
// Returns Infinity if no buzzers are loaded. Cheap — we early-exit on the
// first close-enough hit so most checks bail in a handful of cells.
function nearestBuzzer(pos) {
  let best = Infinity;
  const list1 = state.butterflies;
  for (let i = 0; i < list1.length; i++) {
    const bp = list1[i].group.position;
    const dx = bp.x - pos.x;
    const dz = bp.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
    if (best < 1.0) return Math.sqrt(best);
  }
  const list2 = state.bees;
  for (let i = 0; i < list2.length; i++) {
    const bp = list2[i].group.position;
    const dx = bp.x - pos.x;
    const dz = bp.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
    if (best < 1.0) return Math.sqrt(best);
  }
  return Math.sqrt(best);
}

function _localFootToWorld(c, localX, localZ) {
  const rot = -c.heading + Math.PI / 2;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const lx = localX * c.scale;
  const lz = localZ * c.scale;
  return {
    x: c.group.position.x + cr * lx + sr * lz,
    z: c.group.position.z - sr * lx + cr * lz,
  };
}

function emitWalkerFootprint(c, footIndex, heightFn) {
  const marks = state.groundMarks;
  const cfg = state.currentBiome?.groundMarks;
  if (!marks || !cfg || c.flies || c.isFish) return;
  const foot = c.feet[footIndex];
  const off = foot?.userData?.groundMarkOffset;
  if (!off) return;
  const p = _localFootToWorld(c, off.x, off.z);
  const y = heightFn(p.x, p.z);
  if (y <= 0.04) return;
  const side = off.x < 0 ? -1 : 1;
  emitGroundMark(marks, {
    x: p.x,
    y,
    z: p.z,
    heading: c.heading + side * 0.16,
    width: Math.max(0.08, 0.14 * c.scale),
    length: Math.max(0.14, 0.26 * c.scale),
    opacity: cfg.opacity,
    life: cfg.life,
  });
}

function emitFlierLandingMarks(c, heightFn) {
  const marks = state.groundMarks;
  const cfg = state.currentBiome?.groundMarks;
  if (!marks || !cfg || !c.flies || c.isFish || c.perchTarget) return;
  const y = heightFn(c.group.position.x, c.group.position.z);
  if (y <= 0.04) return;
  const offsets = [
    [-0.16, 0.10],
    [0.16, 0.10],
    [-0.12, -0.12],
    [0.12, -0.12],
  ];
  for (const [lx, lz] of offsets) {
    const p = _localFootToWorld(c, lx, lz);
    emitGroundMark(marks, {
      x: p.x,
      y: heightFn(p.x, p.z),
      z: p.z,
      heading: c.heading + (lx < 0 ? -0.12 : 0.12),
      width: Math.max(0.07, 0.12 * c.scale),
      length: Math.max(0.13, 0.24 * c.scale),
      opacity: cfg.opacity * 0.9,
      life: cfg.life,
    });
  }
  if (cfg.poof === "sand") {
    const kick = makeDustKick(c.group.position.x, y, c.group.position.z, cfg.color, {
      count: 3,
      size: 0.045,
      opacity: 0.35,
      velocityScale: 0.45,
      life: 0.32,
      poof: true,
    });
    state.world.add(kick);
    state.dustKicks.push(kick);
  }
}

// Nudge `c.heading` toward the nearest same-color creature so kin pair up
// into loose pairs/trios. Capped by `c.herdStrength` and a max distance so
// it never overpowers the existing random wander.
function herdInfluence(c, dt) {
  const me = c.group.position;
  let best = null;
  let bestD = Infinity;
  const list = state.creatures;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o === c) continue;
    if (o.isSleeper || o.isBurrower) continue;
    if (!o.bodyColor || !colorsClose(o.bodyColor, c.bodyColor)) continue;
    const op = o.group.position;
    const dx = op.x - me.x;
    const dz = op.z - me.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 64) continue;        // ignore peers more than 8 units away
    if (d2 < bestD) {
      bestD = d2;
      best = o;
    }
  }
  if (!best) return;
  const op = best.group.position;
  const d = Math.sqrt(bestD);
  // Too close → drift apart slightly. Sweet spot 1.4–4 units → pull toward.
  const sign = d < 1.2 ? -1 : 1;
  const targetH = Math.atan2(op.z - me.z, op.x - me.x);
  let diff = targetH - c.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  c.heading += sign * diff * c.herdStrength * 0.4;
}

// Wake a sleeping creature. Called from the UI hover handler and from the
// first-person stroll proximity check. Handles two distinct sleep states:
//   - isSleeper: spawned-asleep flag set at world-gen time
//   - sleepiness > 0.05: natural night-sleep, eased in by the night cycle
// Either path triggers the same unfurl animation, and we set alertUntil so
// the per-frame sleepiness target is forced to 0 for a few seconds (otherwise
// they'd re-curl immediately because state.nightFactor is still high).
export function wakeCreature(c) {
  const naturallyAsleep = !c.flies && c.sleepiness > 0.05;
  const drowsyFlier = c.flies && !c.isFish && c.sleepiness > 0.05;
  if (!c.isSleeper && !naturallyAsleep && !drowsyFlier) return;
  c.isSleeper = false;
  c.sleepiness = 0;
  c.alertUntil = (c.age ?? 0) + 8;
  c.heading = Math.random() * Math.PI * 2;
  c.nextThink = 0.3 + Math.random() * 0.6;
  if (drowsyFlier) {
    if (drowsyFlier && (c.landState === "landed" || c.landState === "descending")) {
      c.landState = "ascending";
      c.landTimer = 8 + Math.random() * 6;
    }
    return;
  }
  c._waking = true;
  // Reset wakeProgress so the unfurl actually animates from curled → upright.
  // For natural sleepers wakeProgress was 1 (set at spawn), so without this
  // the eyes/body would snap open instantly on wake.
  c.wakeProgress = 0;
}

// Pick a mushroom cap within reach as the next landing target. Called
// when a flier transitions flying→descending. Probability gate is per-call
// so most descents still land normally on the ground; the rest steer to a
// mushroom. Search radius is small so fliers don't fly across the island
// just to perch — feels more natural for a perch they spot mid-cruise.
function pickPerchForFlier(c) {
  const perches = state.perchSpots;
  if (!perches || perches.length === 0) return;
  if (Math.random() >= 0.55) return;
  const pos = c.group.position;
  let nearest = null;
  let nearestD2 = 36; // within 6 units
  for (let i = 0; i < perches.length; i++) {
    const p = perches[i];
    const perchPoint = currentPerchPoint(p);
    const dx = perchPoint.x - pos.x;
    const dz = perchPoint.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < nearestD2) {
      nearestD2 = d2;
      nearest = p;
    }
  }
  if (nearest) c.perchTarget = nearest;
}

export function stepCreature(c, dt, t, heightFn) {
  c.age += dt;
  c.nextThink -= dt;
  if (c.lookTimer > 0) c.lookTimer -= dt;
  if (c.hopCooldown > 0) c.hopCooldown -= dt;

  // Sleepiness target — driven by the global night factor and the personality
  // threshold. Sleepy creatures yawn earlier; bold ones tough it out until
  // it's properly dark. Smoothstep gives a soft on/off so the body curl
  // animates rather than snapping.
  if (!c.isSleeper && !c.flies) {
    const nf = state.nightFactor ?? 0;
    const a = c.nightThresh - 0.08;
    const b = c.nightThresh + 0.08;
    let target = (nf - a) / Math.max(0.001, b - a);
    if (target < 0) target = 0;
    else if (target > 1) target = 1;
    else target = target * target * (3 - 2 * target);
    // Alert window after being woken — keep them out of sleep even at night.
    if (c.alertUntil && c.age < c.alertUntil) target = 0;
    // ease toward target at ~0.6/s so dawn/dusk transitions are smooth
    c.sleepiness += (target - c.sleepiness) * Math.min(1, dt * 0.6);
  } else if (c.flies && !c.isFish) {
    // fliers don't fully sleep, but they get drowsy + descend toward rest
    const nf = state.nightFactor ?? 0;
    const a = c.nightThresh - 0.08;
    const b = c.nightThresh + 0.08;
    let target = (nf - a) / Math.max(0.001, b - a);
    if (target < 0) target = 0;
    else if (target > 1) target = 1;
    if (c.alertUntil && c.age < c.alertUntil) target = 0;
    c.sleepiness += (target - c.sleepiness) * Math.min(1, dt * 0.6);
  }

  // Rising-z particle stream. Spawn while actively sleeping (either a
  // spawned-asleep isSleeper or a walker that's curled up at night); the
  // existing particles always tick so they finish their fade after wake.
  const sleepStrength = c.isSleeper ? 1 : c.sleepiness;
  if (!c.flies && sleepStrength > 0.6) {
    c.zSpawnTimer -= dt;
    if (c.zSpawnTimer <= 0) {
      spawnZ(c);
      c.zSpawnTimer = Z_SPAWN_INTERVAL * (0.7 + Math.random() * 0.6);
    }
  }
  if (c.zSprites.length > 0) {
    for (let i = c.zSprites.length - 1; i >= 0; i--) {
      const s = c.zSprites[i];
      s.userData.life += dt;
      const u = s.userData.life / Z_LIFE;
      if (u >= 1) {
        c.group.remove(s);
        s.material.dispose();
        c.zSprites.splice(i, 1);
        continue;
      }
      const fadeIn = Math.min(1, u / 0.18);
      const fadeOut = u > 0.55 ? 1 - (u - 0.55) / 0.45 : 1;
      s.material.opacity = 0.7125 * fadeIn * fadeOut;
      s.position.y = 0.85 + u * Z_RISE;
      s.position.x =
        s.userData.startX +
        s.userData.driftX * s.userData.life +
        Math.sin(s.userData.wobblePhase + u * Math.PI * 2) * 0.06;
    }
  }

  // Integrate the hop physics every frame so a hop in flight smoothly settles
  // even if the cooldown is later overwritten.
  if (c.hopVy !== 0 || c.hopOffset !== 0) {
    c.hopOffset += c.hopVy * dt;
    c.hopVy -= 14 * dt;
    if (c.hopOffset <= 0) {
      c.hopOffset = 0;
      c.hopVy = 0;
    }
  }

  // ── sleeping (curled, eyes closed, no motion) ─────────────────────────
  if (c.isSleeper) {
    // slow "breathing" — body bob on y axis, very small amplitude
    const breath = Math.sin(t * 1.1 + c.flapPhase) * 0.03;
    c.body.scale.y = c.bodyBaseY * 0.55 + breath;
    c.body.scale.x = c.bodyBaseX * (1.18 - breath * 0.3);
    // legs/feet tucked under the body (set in makeCreature) — keep them
    // there in case anything else perturbed them
    for (let i = 0; i < c.legs.length; i++) {
      c.legs[i].scale.y = 0.02;
      c.feet[i].position.y = -0.15;
    }
    // belly hidden — sphere would poke out below the squashed body
    if (c.belly) c.belly.scale.set(0, 0, 0);
    // antennae retracted so they don't float disconnected above the body
    if (c.antennae) for (const a of c.antennae) a.scale.setScalar(0);
    // Fur shells are children of the body and inherit its squash — they stay
    // visible while sleeping (a curled fuzzy creature should still read as
    // fuzzy, just compressed).
    // keep planted at ground height
    const ground = heightFn(c.group.position.x, c.group.position.z);
    c.group.position.y = ground + 0.28 * c.scale;
    return;
  }

  // ── waking-up animation (unfurl eyes + body + legs) ───────────────────
  if (c._waking) {
    c.wakeProgress = Math.min(1, c.wakeProgress + dt * 1.8);
    const w = c.wakeProgress;
    for (const e of c.eyeParts) e.scale.setScalar(w);
    // body lerps from curled → resting baseline (the squash anim below
    // takes over once we're fully awake)
    c.body.scale.x = c.bodyBaseX * (1.18 + (1 - 1.18) * w);
    c.body.scale.y = c.bodyBaseY * (0.55 + (1 - 0.55) * w);
    // legs extend back to resting length, feet drop to their normal place
    for (let i = 0; i < c.legs.length; i++) {
      c.legs[i].scale.y = 0.02 + (0.22 - 0.02) * w;
      c.feet[i].position.y = -0.15 + (-0.32 - -0.15) * w;
    }
    // belly inflates back to its base scale
    if (c.belly) {
      const bs = c.belly.userData.baseScale;
      c.belly.scale.set(bs.x * w, bs.y * w, bs.z * w);
    }
    // antennae grow back to full length
    if (c.antennae) for (const a of c.antennae) a.scale.setScalar(w);
    if (w >= 1) c._waking = false;
  }

  // ── night sleep (walkers only) ────────────────────────────────────────
  // High sleepiness curls a walker down on the spot. Smooth transitions in
  // and out — eyes scale, body squashes, head-bob falls to a slow breath.
  if (!c.flies && c.sleepiness > 0.05 && !c._waking) {
    const s = c.sleepiness;
    // Curl reaches full posture at s=0.6 (the same threshold the zZz sprite
    // fades in on) so motion stops the moment the creature reads as sleeping.
    const curl = Math.min(1, s / 0.6);
    const eyeOpen = Math.max(0, 1 - curl * 1.2);
    for (const e of c.eyeParts) e.scale.setScalar(eyeOpen);
    c.body.scale.y = c.bodyBaseY * (1 + (0.55 - 1) * curl);
    c.body.scale.x = c.bodyBaseX * (1 + (1.18 - 1) * curl);
    // Legs and feet retract as the creature curls
    for (let i = 0; i < c.legs.length; i++) {
      c.legs[i].scale.y = 0.22 + (0.02 - 0.22) * curl;
      c.feet[i].position.y = -0.32 + (-0.15 - -0.32) * curl;
    }
    // Belly shrinks toward zero as the body squashes flat over it
    if (c.belly) {
      const bs = c.belly.userData.baseScale;
      const open = 1 - curl;
      c.belly.scale.set(bs.x * open, bs.y * open, bs.z * open);
    }
    // Antennae fold down toward the body
    if (c.antennae) for (const a of c.antennae) a.scale.setScalar(1 - curl);
    if (s > 0.6) {
      // fully curled — slow breath, no motion, planted on the ground
      const breath = Math.sin(t * 1.1 + c.flapPhase) * 0.03;
      c.body.scale.y = c.bodyBaseY * 0.55 + breath;
      c.body.scale.x = c.bodyBaseX * (1.18 - breath * 0.3);
      const ground = heightFn(c.group.position.x, c.group.position.z);
      c.group.position.y = ground + 0.28 * c.scale + c.hopOffset;
      return;
    }
  }

  // ── burrower state machine ────────────────────────────────────────────
  if (c.isBurrower) {
    c.burrowTimer -= dt;
    if (c.burrowState === "surface" && c.burrowTimer <= 0) {
      c.burrowState = "descending";
      c.burrowTimer = 0.6;
    } else if (c.burrowState === "descending") {
      c.burrowDepth = Math.min(1, c.burrowDepth + dt * 1.6);
      if (c.burrowDepth >= 1) {
        c.burrowState = "burrowed";
        c.group.visible = false;
        c.burrowTimer = 3 + Math.random() * 4;
      }
    } else if (c.burrowState === "burrowed" && c.burrowTimer <= 0) {
      // teleport to a fresh nearby ground point and emerge there
      const pos = c.group.position;
      const ang = Math.random() * Math.PI * 2;
      const dist = 2.5 + Math.random() * 4;
      let nx = pos.x + Math.cos(ang) * dist;
      let nz = pos.z + Math.sin(ang) * dist;
      if (heightFn(nx, nz) < 0) {
        // fall back to a nudge toward origin if we'd surface in the void
        nx = pos.x * 0.5;
        nz = pos.z * 0.5;
      }
      pos.x = nx;
      pos.z = nz;
      c.group.visible = true;
      c.burrowState = "emerging";
      // emit a small dirt puff at the surface point
      const puff = makeDirtPuff(nx, heightFn(nx, nz), nz, c.dirtColor);
      state.world.add(puff);
      state.dirtPuffs.push(puff);
    } else if (c.burrowState === "emerging") {
      c.burrowDepth = Math.max(0, c.burrowDepth - dt * 1.8);
      if (c.burrowDepth <= 0) {
        c.burrowState = "surface";
        c.burrowTimer = 5 + Math.random() * 6;
      }
    }
    // while burrowed, skip all motion/animation
    if (c.burrowState === "burrowed") return;
  }

  // ── flier landing state machine ────────────────────────────────────────
  // Fish never land — they always float.
  if (c.flies && !c.isFish) {
    c.landTimer -= dt;
    const restH = 0.35 * c.scale;

    // No landing on water — if the ground beneath us is below the waterline
    // (or we'd already committed to landing there), bail to "flying" so the
    // perch lookup retries somewhere on dry land next cycle. Also snap
    // currentHover up to the cruise ceiling so we don't visibly hover at
    // restH-altitude over the lake while the per-frame lerp slowly climbs.
    const overWater =
      state.waterMesh && heightFn(c.group.position.x, c.group.position.z) < WATER_AVOID_Y;
    if (overWater && c.landState !== "flying") {
      c.landState = "flying";
      c.landTimer = 4 + Math.random() * 8;
      c.perchTarget = null;
      c.perchOffsetX = 0;
      c.perchOffsetZ = 0;
      const ceil = c.hoverHeight * (1 - 0.7 * c.sleepiness);
      if (c.currentHover < ceil) c.currentHover = ceil;
    }

    // Drowsy fliers want down — force a descent if they're still flying,
    // and refuse to lift off until they've slept it off. Skip the forced
    // descent while over water so a sleepy flier doesn't try to ditch
    // mid-lake; it'll keep cruising until it finds land.
    if (!overWater && c.sleepiness > 0.6 && c.landState === "flying") {
      c.landState = "descending";
      c.landTimer = 8 + Math.random() * 6;
      pickPerchForFlier(c);
    }
    if (!overWater && c.sleepiness > 0.6 && c.landState === "ascending") {
      c.landState = "descending";
    }

    if (!overWater && c.landState === "flying" && c.landTimer <= 0) {
      c.landState = "descending";
      pickPerchForFlier(c);
    } else if (c.landState === "landed" && c.landTimer <= 0 && c.sleepiness < 0.5) {
      c.landState = "ascending";
    }

    // pull the hover ceiling down with sleepiness so a flier slowly sinks
    // toward the ground at night even before reaching the landed state.
    const hoverCeil = c.hoverHeight * (1 - 0.7 * c.sleepiness);
    let targetH =
      c.landState === "flying" || c.landState === "ascending"
        ? hoverCeil
        : restH;
    // While descending toward a distant perch, hold an approach altitude
    // so the flier has time to fly over to the mushroom before it bottoms
    // out. Once roughly over the cap, the normal restH target kicks in
    // and the actual touchdown onto the cap happens.
    if (c.perchTarget && c.landState === "descending") {
      const perchPoint = currentPerchPoint(c.perchTarget);
      const dxp = perchPoint.x - c.group.position.x;
      const dzp = perchPoint.z - c.group.position.z;
      if (dxp * dxp + dzp * dzp > 1.0) {
        targetH = Math.max(restH, Math.min(hoverCeil, 0.6 * c.hoverHeight));
      }
    }
    // smooth lerp for the descent/ascent
    c.currentHover += (targetH - c.currentHover) * Math.min(1, dt * 1.4);

    if (c.landState === "descending" && c.currentHover - restH < 0.08) {
      // Only commit to "landed" once we're at the perch (or there's no
      // perch). Otherwise the flier would freeze in mid-air partway across.
      let canLand = true;
      if (c.perchTarget) {
        const perchPoint = currentPerchPoint(c.perchTarget);
        const dxp = perchPoint.x - c.group.position.x;
        const dzp = perchPoint.z - c.group.position.z;
        canLand = dxp * dxp + dzp * dzp < 0.16;
        if (canLand) {
          c.perchOffsetX = c.group.position.x - perchPoint.x;
          c.perchOffsetZ = c.group.position.z - perchPoint.z;
        }
      }
      if (canLand) {
        c.landState = "landed";
        c.landTimer = 4 + Math.random() * 10;
        emitFlierLandingMarks(c, heightFn);
      }
    } else if (
      c.landState === "ascending" &&
      c.hoverHeight - c.currentHover < 0.15
    ) {
      c.landState = "flying";
      c.landTimer = 8 + Math.random() * 16;
      // Keep perchTarget after takeoff — the floor blend uses it to ease
      // back toward ground as the flier drifts away in XZ. Cleared lazily
      // below once the blend has fully unwound, so the pos.y handoff from
      // perch-relative to ground-relative is seamless.
    }

    // Lazy cleanup — once the floor blend has decayed essentially to zero
    // (the flier is well clear of the perch), drop the reference so the
    // next descent is free to pick a fresh perch.
    if (
      c.perchTarget &&
      c.landState === "flying" &&
      c.perchFloorWeight < 0.02
    ) {
      c.perchTarget = null;
      c.perchFloorWeight = 0;
      c.perchOffsetX = 0;
      c.perchOffsetZ = 0;
    }
  }

  const grounded = c.flies && c.landState === "landed";

  // think — fliers never pause while airborne; walkers + landed fliers can
  if (c.nextThink <= 0) {
    const homingToPerch =
      c.flies && c.perchTarget && c.landState === "descending";
    if ((!c.flies || grounded) && Math.random() < c.pauseChance) {
      c.pauseUntil = t + 0.6 + Math.random() * 1.4;
    } else if (!homingToPerch) {
      c.heading += (Math.random() - 0.5) * (c.flies && !grounded ? 1.2 : 1.6);
      // Herding — pull toward the nearest same-color creature (capped). Only
      // applied during the think event so it's cheap (O(creatures) per
      // creature ~once a second) and doesn't fight the natural wander.
      if (!c.flies || grounded) {
        herdInfluence(c, dt);
      }
    }
    // While homing to a perch, intentionally skip the random heading
    // jitter — the dedicated perch-homing steering below takes the wheel,
    // so the flier flies straight at the cap instead of curving around it.
    // Trigger a curiosity hop if a butterfly or bee is buzzing nearby. Walkers
    // and landed fliers only — airborne fliers don't need to hop.
    if (
      (!c.flies || grounded) &&
      c.hopCooldown <= 0 &&
      c.hopOffset === 0 &&
      c.sleepiness < 0.4
    ) {
      const near = nearestBuzzer(c.group.position);
      if (near < 2.4 && Math.random() < c.hopProb) {
        c.hopVy = 2.0 + Math.random() * 0.6;
        c.hopCooldown = 3 + Math.random() * 3;
      }
    }
    c.nextThink = (c.flies ? 0.7 : 1.2) + Math.random() * (c.flies ? 1.8 : 3.0);
  }

  // Perch homing — while descending toward a mushroom cap, override the
  // random heading jitter so we actually fly to it. Steering rate is
  // bumped (and stronger when close) so the flier resolves heading
  // errors quickly instead of orbiting the cap on its way in.
  if (c.flies && c.perchTarget && c.landState === "descending") {
    const perchPoint = currentPerchPoint(c.perchTarget);
    const dx = perchPoint.x - c.group.position.x;
    const dz = perchPoint.z - c.group.position.z;
    const target = Math.atan2(dz, dx);
    let diff = target - c.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const xz2 = dx * dx + dz * dz;
    const turnRate = xz2 < 4 ? 9 : 5;
    c.heading += diff * Math.min(1, dt * turnRate);
  }

  // family kids — if we've drifted too far from the parent, bias heading
  // toward them. Only nudges the heading; the normal think loop still adds jitter.
  if (c.role === "kid" && c.parent && c.parent.group.parent) {
    const pp = c.parent.group.position;
    const me = c.group.position;
    const dx = pp.x - me.x;
    const dz = pp.z - me.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 2.2) {
      const target = Math.atan2(dz, dx);
      // shortest-arc lerp toward parent heading
      let diff = target - c.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      c.heading += diff * Math.min(1, dt * 1.2);
    }
  }

  let moving = t > c.pauseUntil;
  // landed fliers stay put — they perched
  if (grounded) moving = false;
  const pos = c.group.position;

  if (moving) {
    let speedFactor = 1 - c.sleepiness * 0.85;
    // Slow the approach when close to a perch so the flier can settle on
    // the cap rather than zooming past it and lapping around for another
    // pass. Falls from full speed at xzDist 2.5 down to 30% at xzDist 0.
    if (c.flies && c.perchTarget && c.landState === "descending") {
      const perchPoint = currentPerchPoint(c.perchTarget);
      const dxp = perchPoint.x - pos.x;
      const dzp = perchPoint.z - pos.z;
      const xzDist = Math.sqrt(dxp * dxp + dzp * dzp);
      const k = Math.max(0, Math.min(1, xzDist / 2.5));
      speedFactor *= 0.3 + 0.7 * k;
    }
    const step = c.speed * dt * speedFactor;
    const oldPosX = pos.x;
    const oldPosZ = pos.z;
    const nx = pos.x + Math.cos(c.heading) * step;
    const nz = pos.z + Math.sin(c.heading) * step;
    // Edge avoidance:
    //  - walkers stay on the island plateau (turn back near the radius edge,
    //    so they don't wander down the slope onto the flat base plane)
    //  - fliers may range out over the slope but turn back inside the base
    //    plane so they never disappear off-world
    //  - in water biomes, walkers also turn back if their next step would
    //    submerge them below the waterline
    let wouldStray;
    let target;
    if (c.isFish && state.waterMesh) {
      const planeBound = state.ISLAND_SIZE * 0.46;
      const nextGround = heightFn(nx, nz);
      wouldStray =
        Math.sqrt(nx * nx + nz * nz) > planeBound ||
        nextGround > fishMaxGroundY(c.scale) ||
        nextGround < FISH_MIN_GROUND_Y;
      target = nearestCenter(pos.x, pos.z);
    } else if (c.flies && c.landState === "flying") {
      const planeBound = state.ISLAND_SIZE * 0.46;
      wouldStray = Math.sqrt(nx * nx + nz * nz) > planeBound;
      // Fliers may cruise across water. The Y-position block below raises
      // their floor to water-surface + body clearance; this branch only blocks
      // them from straying off the island plate altogether.
      target = nearestCenter(pos.x, pos.z);
    } else {
      const near = nearestCenter(nx, nz);
      const dx = nx - near.cx;
      const dz = nz - near.cz;
      wouldStray = Math.sqrt(dx * dx + dz * dz) > near.radius * 0.94;
      if (!wouldStray && state.waterMesh && heightFn(nx, nz) < WATER_AVOID_Y) {
        wouldStray = true;
      }
      target = near;
    }

    if (wouldStray) {
      if (c.isFish) {
        c.heading += Math.PI + (Math.random() - 0.5) * 0.7;
      } else {
        c.heading =
          Math.atan2(target.cz - pos.z, target.cx - pos.x) +
          (Math.random() - 0.5) * 0.5;
      }
    } else {
      // Obstacle slide — walkers always route around trunks; fliers route
      // around them too, but only while below the canopy (height filter in
      // avoidObstacles short-circuits if the flier is comfortably above).
      // A flier targeting a mushroom passes its perch coords as skipX/skipZ
      // so it doesn't get pushed away from the very cap it's trying to land
      // on.
      const skipPerch = c.perchTarget ? currentPerchPoint(c.perchTarget) : null;
      const slide = avoidObstacles(
        pos.x,
        pos.z,
        nx,
        nz,
        c.heading,
        step,
        0.25 * c.scale,
        c.flies ? pos.y : undefined,
        skipPerch?.x,
        skipPerch?.z,
        c
      );
      if (slide) {
        pos.x = slide.nx;
        pos.z = slide.nz;
        c.heading = slide.heading;
      } else {
        pos.x = nx;
        pos.z = nz;
      }
    }
    // Post-commit water guards. The pre-step water check above only sees the
    // straight-step nx/nz — obstacle slide (slide.nx/.nz) and a herd-influence
    // heading rotation can deflect the committed position across a waterline.
    // Ground movers revert if they enter water; fish revert if they leave a
    // deep-enough swim band.
    if (c.isFish && state.waterMesh) {
      const fishGround = heightFn(pos.x, pos.z);
      if (fishGround > fishMaxGroundY(c.scale) || fishGround < FISH_MIN_GROUND_Y) {
        pos.x = oldPosX;
        pos.z = oldPosZ;
        c.heading += Math.PI + (Math.random() - 0.5) * 0.5;
      }
    }
    if (
      !c.flies &&
      state.waterMesh &&
      heightFn(pos.x, pos.z) < WATER_AVOID_Y
    ) {
      pos.x = oldPosX;
      pos.z = oldPosZ;
      c.heading += Math.PI + (Math.random() - 0.5) * 0.4;
    }
    c.bob += dt * c.bobSpeed;
  } else {
    c.bob += dt * 2;
  }

  if (grounded && c.perchTarget) {
    const perchPoint = currentPerchPoint(c.perchTarget);
    pos.x = perchPoint.x + c.perchOffsetX;
    pos.z = perchPoint.z + c.perchOffsetZ;
  }

  const ground = heightFn(pos.x, pos.z);
  if (c.isFish && state.waterMesh) {
    const halfBodyY = 0.42 * c.bodyBaseY * c.scale;
    const topY = WATER_AVOID_Y - 0.2 - halfBodyY;
    const bottomY = ground + halfBodyY + 0.04;
    if (bottomY > topY) {
      c.heading += Math.PI + (Math.random() - 0.5) * 0.5;
      pos.y += (topY - pos.y) * Math.min(1, dt * 4.0);
    } else {
      const band = topY - bottomY;
      const swimT = THREE.MathUtils.clamp(
        0.5 +
          Math.sin(t * 0.7 + c.flapPhase) * 0.34 +
          Math.sin(t * 0.23 + c.age) * 0.12,
        0.08,
        0.92
      );
      const cruise = bottomY + band * swimT;
      const swimBob = Math.sin(c.bob) * Math.min(0.08, band * 0.08) * c.bobAmpMul;
      const targetY = Math.max(bottomY, Math.min(topY, cruise + swimBob));
      pos.y += (targetY - pos.y) * Math.min(1, dt * 3.5);
      pos.y = Math.max(bottomY, Math.min(topY, pos.y));
    }
  } else if (c.flies) {
    // Floor blends from terrain ground up to (perch top + a tiny lift) as
    // the flier closes in on its perch in XZ. The blend uses smoothstep
    // over a wide ~4-unit window so the rise reads as a gentle glide arc
    // rather than a snap-up at a hard threshold. perchFloorWeight is
    // additionally low-pass filtered so the *rate* of change is capped
    // — guarantees smoothness even if the perch was picked close-by or
    // the flier crosses the curve quickly. Perch lift accounts for the
    // flier body's half-Y (≈0.39·scale) being slightly larger than restH
    // (0.35·scale): without it the body visibly sinks into the cap.
    //
    // Non-fish fliers over water: raise the floor to the water surface plus
    // body clearance so hover-above-terrain can never put their belly below
    // the waterline. This matters more now that water basins are deeper.
    let floorY = ground;
    let waterClearanceY = null;
    if (!c.isFish && state.waterMesh && ground < WATER_AVOID_Y) {
      waterClearanceY = WATER_AVOID_Y + 0.42 * c.bodyBaseY * c.scale + 0.08;
      floorY = waterClearanceY;
    }
    const restH = 0.35 * c.scale;
    if (c.perchTarget) {
      const perchPoint = currentPerchPoint(c.perchTarget);
      const dxp = perchPoint.x - pos.x;
      const dzp = perchPoint.z - pos.z;
      const xzDist = Math.sqrt(dxp * dxp + dzp * dzp);
      const NEAR = 0.5;
      const FAR = 4.0;
      const xRaw = (FAR - xzDist) / (FAR - NEAR);
      const xc = Math.max(0, Math.min(1, xRaw));
      const closeness = xc * xc * (3 - 2 * xc);
      // Always target the raw closeness — the weight lerp below handles
      // takeoff just as naturally as approach, because as the flier rises
      // and drifts away the closeness drops and the floor unwinds back to
      // ground smoothly.
      c.perchFloorWeight +=
        (closeness - c.perchFloorWeight) * Math.min(1, dt * 1.6);
      const weight = c.perchFloorWeight;
      // Sit slightly into the cap so the body really touches it (negative
      // because the flier body's half-Y is just a hair larger than restH,
      // so a small bias is needed to keep the contact convincing).
      const perchLift = -0.04 * c.scale;
      floorY = ground * (1 - weight) + (perchPoint.y + perchLift) * weight;
    }
    // bob amplitude scales with current hover — perched creatures only quiver
    const bobAmp = grounded
      ? 0.02
      : 0.28 * Math.min(1, c.currentHover / Math.max(0.1, c.hoverHeight));
    pos.y = floorY + c.currentHover + Math.sin(c.bob) * bobAmp * c.bobAmpMul + c.hopOffset;
    if (waterClearanceY !== null && pos.y < waterClearanceY) pos.y = waterClearanceY;
  } else {
    const bobAmp = (moving ? 0.08 : 0.02) * c.bobAmpMul;
    pos.y = ground + 0.35 * c.scale + Math.sin(c.bob) * bobAmp + c.hopOffset;
    // burrowers sink/rise — burrowDepth=0 sits at surface, 1 fully under
    if (c.isBurrower && c.burrowDepth > 0) {
      pos.y -= c.burrowDepth * (0.8 + 0.4 * c.scale);
    }
  }

  // face heading (smoothed)
  const targetRot = -c.heading + Math.PI / 2;
  let cur = c.group.rotation.y;
  let diff = targetRot - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  c.group.rotation.y = cur + diff * Math.min(1, dt * 6);

  // Look-at-camera override — when the user hovers/taps a creature, pull its
  // facing toward the camera for ~1.5s. Stronger lerp than the regular
  // heading-follow so the response reads as deliberate.
  if (c.lookTimer > 0 && state.camera) {
    const camDx = state.camera.position.x - c.group.position.x;
    const camDz = state.camera.position.z - c.group.position.z;
    const camHeading = Math.atan2(camDz, camDx);
    const lookRot = -camHeading + Math.PI / 2;
    let lcur = c.group.rotation.y;
    let ldiff = lookRot - lcur;
    while (ldiff > Math.PI) ldiff -= Math.PI * 2;
    while (ldiff < -Math.PI) ldiff += Math.PI * 2;
    c.group.rotation.y = lcur + ldiff * Math.min(1, dt * 9);
  }

  // Terrain-normal alignment for walkers — sample the slope along heading
  // and perpendicular to it, then ease group pitch (rotation.x) and roll
  // (rotation.z) toward the matching angles. With YXZ Euler order these
  // resolve in the body frame after yaw, so the creature lies flat on the
  // hillside instead of staying world-axis-aligned and clipping into the
  // slope. Fliers, fish, and burrowed creatures stay level.
  if (!c.flies && !(c.isBurrower && c.burrowState === "burrowed")) {
    const ds = 0.25 * c.scale;
    const ch = Math.cos(c.heading);
    const sh = Math.sin(c.heading);
    const yF = heightFn(pos.x + ch * ds, pos.z + sh * ds);
    const yB = heightFn(pos.x - ch * ds, pos.z - sh * ds);
    const yR = heightFn(pos.x + sh * ds, pos.z - ch * ds);
    const yL = heightFn(pos.x - sh * ds, pos.z + ch * ds);
    const slopeFwd = (yF - yB) / (2 * ds);
    const slopeRight = (yR - yL) / (2 * ds);
    // Clamp before atan so noise spikes near cliff edges don't whip the body.
    const cl = (v) => Math.max(-2, Math.min(2, v));
    const pitchTarget = -Math.atan(cl(slopeFwd));
    const rollTarget = Math.atan(cl(slopeRight));
    const k = Math.min(1, dt * 5);
    c.group.rotation.x += (pitchTarget - c.group.rotation.x) * k;
    c.group.rotation.z += (rollTarget - c.group.rotation.z) * k;
  } else if (c.flies) {
    // Fliers stay level — ease any residual pitch/roll back to zero in case
    // the creature was just woken from a curled walker state.
    const k = Math.min(1, dt * 4);
    c.group.rotation.x += (0 - c.group.rotation.x) * k;
    c.group.rotation.z += (0 - c.group.rotation.z) * k;
  }

  // squash & stretch body (the wake-up unfurl owns body scale until it finishes;
  // night-sleep also owns body scale while drowsy)
  if (!c._waking && !(!c.flies && c.sleepiness > 0.05)) {
    const squash = 1 + Math.sin(c.bob) * 0.05 * (moving ? 1 : 0.4);
    c.body.scale.y = c.bodyBaseY * squash;
    c.body.scale.x = c.bodyBaseX / Math.sqrt(squash);
  }

  if (c.flies) {
    if (c.isFish) {
      const phase = t * 6.0 + c.flapPhase;
      const wave = Math.sin(phase);
      for (let i = 0; i < c.wings.length; i++) {
        const sign = i === 0 ? -1 : 1;
        c.wings[i].rotation.z = sign * (-0.45 + wave * 0.28);
        c.wings[i].rotation.x = -0.18 + Math.cos(phase * 0.8) * 0.12;
        c.wings[i].rotation.y = Math.cos(phase * 0.7) * 0.18;
      }
      if (c.tailFin) c.tailFin.rotation.y = Math.sin(phase * 1.15) * 0.55;
      c.body.rotation.z = wave * 0.04;
      if (c.isAngler && c.lureStalk && c.lureOrb) {
        c.lureStalk.rotation.z = Math.sin(t * 1.9 + c.flapPhase) * 0.12;
        c.lureOrb.scale.setScalar(1 + Math.sin(t * 3.1 + c.flapPhase) * 0.12);
      }
    } else if (grounded) {
      // Wings mostly tucked, but with a small idle twitch so the bird never
      // looks completely lifeless. Period ~2s, amplitude small.
      const k = Math.min(1, dt * 5);
      const twitch = Math.sin(t * 3.0 + c.flapPhase) * 0.06;
      for (let i = 0; i < c.wings.length; i++) {
        const sign = i === 0 ? -1 : 1;
        const restRot = sign * (0.55 + twitch);
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
      const flapStrength = 0.55 + 0.45 * altRatio; // weaker flap near the ground
      const phase = t * c.flapSpeed + c.flapPhase;
      const flap = Math.sin(phase);
      for (let i = 0; i < c.wings.length; i++) {
        const sign = i === 0 ? -1 : 1;
        c.wings[i].rotation.z = sign * (0.15 + flap * 1.2 * flapStrength);
        c.wings[i].rotation.x = Math.cos(phase) * 0.18 * flapStrength;
      }
      c.body.rotation.z = -flap * 0.06 * flapStrength;
    }
  } else if (moving) {
    // diagonal trot pattern: FL+BR phase, FR+BL counter-phase
    const phases = [0, Math.PI, Math.PI, 0];
    for (let i = 0; i < c.feet.length; i++) {
      const sVal = Math.sin(c.bob + phases[i]);
      const footY = -0.32 + sVal * 0.09;
      c.feet[i].position.y = footY;
      c.legs[i].scale.y = -0.1 - footY;
      // Rising-edge footstep detection — fires once when sVal crosses 0.85
      // upward. Every rising foot leaves its own soft-ground footprint.
      // Shared cooldown only throttles the optional tiny sand poof.
      const prev = c.lastFootSin[i] ?? 0;
      if (sVal > 0.85 && prev <= 0.85) {
        emitWalkerFootprint(c, i, heightFn);
        if (t - c.lastDustAt > 0.18) {
          const fx = c.group.position.x;
          const fz = c.group.position.z;
          const fy = heightFn(fx, fz);
          if (fy > 0.1 && state.currentBiome?.groundMarks?.poof === "sand") {
            const kick = makeDustKick(fx, fy, fz, c.dirtColor, {
              count: 2,
              size: 0.045,
              opacity: 0.28,
              velocityScale: 0.35,
              life: 0.28,
            });
            state.world.add(kick);
            state.dustKicks.push(kick);
          }
          c.lastDustAt = t;
        }
      }
      c.lastFootSin[i] = sVal;
    }
  }
}
