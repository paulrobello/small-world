import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import {
  state,
  NIGHT_SKY,
  NIGHT_FOG,
  NIGHT_SUN,
  NIGHT_HEMI_GROUND,
  DAY_NIGHT_PERIOD_S,
  disposeGroup,
} from "./state.js";
import { BIOMES, WILDFLOWER_PALETTES, FLOWER_DENSITY } from "./biomes.js";
import { mulberry32, formatSeed, writeSeedToUrl } from "./seed.js";
import { randInt } from "./util.js";
import {
  makeHeightFn,
  pickGroundPoint,
  pickLayout,
  makeTerrain,
  makeIslandUnderside,
} from "./terrain.js";
import { FLORA_BUILDERS } from "./flora.js";
import {
  makeCreature,
  makeCaterpillar,
  makeButterfly,
  makeBee,
  makeSwarm,
} from "./fauna.js";
import { makeFlock } from "./birds.js";
import {
  makeParticles,
  makeGrassField,
  makeWildflowerField,
  makePebbleField,
  makeWaterPlane,
  makeParallaxRing,
} from "./environment.js";

let _scene = null;
let _controls = null;
let _releaseFollow = () => {};

export function setSceneRef(scene) {
  _scene = scene;
}
export function setControlsRef(controls) {
  _controls = controls;
}
export function setFollowReleaseCallback(fn) {
  _releaseFollow = fn;
}

// Slow day/night cycle. Lerps a handful of scene values between the biome's
// daytime palette and a generic deep-night palette using a cosine curve.
export function updateDayNight(t) {
  if (!state.dayNight || !state.sunLight || !state.hemiLight || !_scene) return;
  let dayFactor;
  let phase;
  if (state.userSettings.autoCycle) {
    phase = (t * 2 * Math.PI) / DAY_NIGHT_PERIOD_S;
    dayFactor = (Math.cos(phase) + 1) * 0.5;
  } else {
    dayFactor = state.userSettings.manualDayFactor;
    phase = Math.acos(2 * dayFactor - 1);
  }
  const nightAmt = 1 - dayFactor;

  _scene.background.copy(state.dayNight.sky).lerp(NIGHT_SKY, nightAmt);
  _scene.fog.color.copy(state.dayNight.fog).lerp(NIGHT_FOG, nightAmt);
  _scene.fog.density =
    state.dayNight.fogDensity * (1 + nightAmt * 0.2) * state.userSettings.fogMultiplier;

  state.sunLight.color.copy(state.dayNight.sun).lerp(NIGHT_SUN, nightAmt);
  state.sunLight.intensity = 0.45 + dayFactor * 0.95;
  const sunAngle = phase + Math.PI;
  const sunR = 26;
  state.sunLight.position.set(
    Math.cos(sunAngle) * sunR,
    Math.max(6, Math.sin(sunAngle) * 28 + 8),
    Math.sin(sunAngle * 0.5) * 12 + 4
  );

  state.hemiLight.color.copy(state.dayNight.skyForHemi).lerp(NIGHT_SKY, nightAmt);
  state.hemiLight.groundColor.copy(state.dayNight.ground).lerp(NIGHT_HEMI_GROUND, nightAmt);
  // ambientBoost is mostly there for dark biomes / night — it lifts the
  // hemi fill light and a touch of the sun so glowing motifs still pop.
  const ab = state.userSettings.ambientBoost ?? 0;
  state.hemiLight.intensity = 0.32 + dayFactor * 0.45 + ab * 1.6;
  state.sunLight.intensity += ab * 0.4;

  if (state.parallaxRingMesh) {
    state.parallaxRingMesh.material.color
      .copy(state.dayNight.ringTint)
      .lerp(NIGHT_FOG, nightAmt * 0.7);
  }
}

export function generateWorld(seed) {
  // Swap Math.random for the seeded PRNG so every Math.random() call
  // during world construction is deterministic. Per-frame animation
  // (stepCreature/stepFlock/stepParticles) runs after we restore, so it
  // keeps its natural variation.
  const originalRandom = Math.random;
  Math.random = mulberry32(seed);

  // Pick biome from the seed itself, so one number reproduces everything.
  const biome = BIOMES[Math.floor(Math.random() * BIOMES.length)];

  // Layout (size + shape + island count) — must be picked right after the
  // biome so it stays inside the deterministic Math.random window.
  const layout = pickLayout();
  state.currentLayout = layout;
  state.ISLAND_SIZE = layout.planeSize;
  state.ISLAND_RADIUS = layout.boundRadius;

  // clear
  disposeGroup(state.world);
  _scene.remove(state.world);
  state.world = new THREE.Group();
  _scene.add(state.world);
  state.creatures = [];
  state.flocks = [];
  state.caterpillars = [];
  state.butterflies = [];
  state.bees = [];
  state.dirtPuffs = [];
  state.flowerSpots = [];
  state.particles = null;
  state.waterMesh = null;
  // release any followed creature — the entity it pointed to no longer exists
  _releaseFollow();

  state.currentBiome = biome;
  state.currentSeed = seed;

  // atmosphere — Color/Fog instances are mutated by updateDayNight()
  _scene.background = new THREE.Color(biome.sky);
  _scene.fog = new THREE.FogExp2(new THREE.Color(biome.fog), biome.fogDensity);

  // lights
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(biome.sky),
    new THREE.Color(biome.ground[0]),
    0.65
  );
  state.world.add(hemi);
  state.hemiLight = hemi;

  const sun = new THREE.DirectionalLight(new THREE.Color(biome.sun), 1.25);
  sun.position.set(18, 28, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -state.ISLAND_SIZE / 2;
  sun.shadow.camera.right = state.ISLAND_SIZE / 2;
  sun.shadow.camera.top = state.ISLAND_SIZE / 2;
  sun.shadow.camera.bottom = -state.ISLAND_SIZE / 2;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 3.5;
  state.world.add(sun);
  state.sunLight = sun;

  const accent = new THREE.PointLight(
    new THREE.Color(biome.accent),
    0.6,
    35,
    1.6
  );
  accent.position.set(0, 8, 0);
  state.world.add(accent);

  // parallax distance ring + day/night palette snapshot
  const ring = makeParallaxRing(biome);
  state.world.add(ring);
  state.parallaxRingMesh = ring;

  state.dayNight = {
    sky: new THREE.Color(biome.sky),
    skyForHemi: new THREE.Color(biome.sky),
    fog: new THREE.Color(biome.fog),
    sun: new THREE.Color(biome.sun),
    ground: new THREE.Color(biome.ground[0]),
    ringTint: ring.material.color.clone(),
    fogDensity: biome.fogDensity,
  };

  // terrain
  const noise2D = createNoise2D();
  state.heightFn = makeHeightFn(noise2D, layout, 3.2);
  const terrain = makeTerrain(biome, state.heightFn);
  state.world.add(terrain);
  for (const c of layout.centers) {
    state.world.add(makeIslandUnderside(biome, c));
  }

  // water plane (biomes that opt in)
  if (biome.water) {
    state.waterMesh = makeWaterPlane(biome);
    state.world.add(state.waterMesh);
  }

  // measure max elevation for HUD — sample on actual ground
  state.maxElev = 0;
  for (let i = 0; i < 200; i++) {
    const p = pickGroundPoint(0.8);
    const h = state.heightFn(p.x, p.z);
    if (h > state.maxElev) state.maxElev = h;
  }

  // flora
  let placed = 0;
  let attempts = 0;
  while (placed < biome.floraCount && attempts < biome.floraCount * 6) {
    attempts++;
    const p = pickGroundPoint(0.88);
    const y = state.heightFn(p.x, p.z);
    if (y < -0.3) continue; // skip steep cliffs / void
    const kind = biome.flora[Math.floor(Math.random() * biome.flora.length)];
    const f = FLORA_BUILDERS[kind](biome);
    f.position.set(p.x, y, p.z);
    f.rotation.y = Math.random() * Math.PI * 2;
    const s = 0.7 + Math.random() * 0.7;
    f.scale.setScalar(s);
    state.world.add(f);
    placed++;
  }

  // ground cover — instanced grass / wildflowers / pebbles
  state.world.add(makeGrassField(biome, state.heightFn));
  for (const m of makeWildflowerField(biome, state.heightFn)) {
    state.world.add(m);
    if (m.userData.positions) state.flowerSpots.push(...m.userData.positions);
  }
  state.world.add(makePebbleField(biome, state.heightFn));

  // creatures — fish biomes don't get sleepers/burrowers (they float).
  // We treat ncreatures as a budget; family parents consume +1 per kid,
  // so the actual headcount can be slightly higher than the configured range.
  const ncreatures = randInt(...biome.creatureCount);
  const allowGroundVariants = biome.creatureKind !== "fish";
  let spawned = 0;
  let budget = ncreatures;
  function placeOnGround(c) {
    let p = { x: 0, z: 0 };
    let y = -10;
    for (let tries = 0; tries < 20 && y < 0; tries++) {
      p = pickGroundPoint(0.65);
      y = state.heightFn(p.x, p.z);
    }
    c.group.position.set(p.x, y + 0.4, p.z);
    state.world.add(c.group);
    state.creatures.push(c);
    spawned++;
  }
  while (budget > 0) {
    const r = Math.random();
    // budget rolls: family (parent + kids), sleeper, burrower, plain
    if (allowGroundVariants && budget >= 2 && r < 0.18) {
      // family group — 1 parent + 1-2 kids
      const parent = makeCreature(biome, { role: "parent" });
      placeOnGround(parent);
      budget--;
      const kidCount = Math.min(budget, 1 + (Math.random() < 0.5 ? 1 : 0));
      for (let k = 0; k < kidCount; k++) {
        const kid = makeCreature(biome, {
          role: "kid",
          parent,
          sizeMul: 0.6 + Math.random() * 0.1,
        });
        // spawn near the parent so they don't tow from the void
        const pp = parent.group.position;
        const ang = Math.random() * Math.PI * 2;
        const off = 1.0 + Math.random() * 0.8;
        const nx = pp.x + Math.cos(ang) * off;
        const nz = pp.z + Math.sin(ang) * off;
        kid.group.position.set(nx, state.heightFn(nx, nz) + 0.4, nz);
        state.world.add(kid.group);
        state.creatures.push(kid);
        spawned++;
        budget--;
      }
    } else if (allowGroundVariants && r < 0.30) {
      placeOnGround(makeCreature(biome, { sleeper: true }));
      budget--;
    } else if (allowGroundVariants && r < 0.38) {
      placeOnGround(makeCreature(biome, { burrower: true }));
      budget--;
    } else {
      placeOnGround(makeCreature(biome));
      budget--;
    }
  }

  // caterpillars — multi-segment crawlers, occasionally swapped for snails
  const ncats = 1 + Math.floor(Math.random() * 3); // 1–3
  for (let i = 0; i < ncats; i++) {
    const cat = makeCaterpillar(biome);
    state.world.add(cat.group);
    state.caterpillars.push(cat);
  }
  // snails — 0-2 per world (cute, slow). They live in the caterpillars array
  // so they get stepped and ray-picked alongside their cousins.
  const nsnails = Math.random() < 0.7 ? (Math.random() < 0.4 ? 2 : 1) : 0;
  for (let i = 0; i < nsnails; i++) {
    const snail = makeCaterpillar(biome, { kind: "snail" });
    state.world.add(snail.group);
    state.caterpillars.push(snail);
  }

  // butterflies — drift between flower positions
  const flowerDensity = FLOWER_DENSITY[biome.id] ?? 100;
  const bMin = Math.max(2, Math.floor(flowerDensity / 30));
  const bMax = Math.max(bMin + 1, Math.floor(flowerDensity / 14));
  const nbutterflies = bMin + Math.floor(Math.random() * (bMax - bMin + 1));
  const palette = WILDFLOWER_PALETTES[biome.id] ?? ["#ffffff"];
  for (let i = 0; i < nbutterflies; i++) {
    const bf = makeButterfly(palette, biome);
    if (state.flowerSpots.length) {
      const f = state.flowerSpots[Math.floor(Math.random() * state.flowerSpots.length)];
      bf.group.position.set(
        f.x + (Math.random() - 0.5) * 1.5,
        f.y + 0.6 + Math.random() * 0.8,
        f.z + (Math.random() - 0.5) * 1.5
      );
    } else {
      const p = pickGroundPoint(0.6);
      bf.group.position.set(p.x, 2, p.z);
    }
    state.world.add(bf.group);
    state.butterflies.push(bf);
  }

  // bee swarms — 1-2 swarms of 4-8 bees, only if there are flowers to dance
  // around. Each swarm shares a target flower; bees flock to it together.
  if (state.flowerSpots.length > 0) {
    const swarmCount = 1 + (Math.random() < 0.55 ? 1 : 0);
    for (let s = 0; s < swarmCount; s++) {
      const swarm = makeSwarm();
      const beesInSwarm = 4 + Math.floor(Math.random() * 5);
      // seed the first target so all bees converge from frame 1
      const seed = state.flowerSpots[
        Math.floor(Math.random() * state.flowerSpots.length)
      ];
      swarm.target = new THREE.Vector3(seed.x, seed.y + 0.35, seed.z);
      swarm.retargetIn = 4 + Math.random() * 5;
      for (let i = 0; i < beesInSwarm; i++) {
        const bee = makeBee(swarm, biome);
        // spawn around the swarm seed flower
        bee.group.position.set(
          seed.x + (Math.random() - 0.5) * 1.0,
          seed.y + 0.4 + Math.random() * 0.6,
          seed.z + (Math.random() - 0.5) * 1.0
        );
        state.world.add(bee.group);
        state.bees.push(bee);
      }
    }
  }

  // bird flocks
  const numFlocks = 1 + Math.floor(Math.random() * 3); // 1–3
  let totalBirds = 0;
  for (let f = 0; f < numFlocks; f++) {
    const flock = makeFlock(biome);
    for (const bird of flock.birds) state.world.add(bird.group);
    totalBirds += flock.birds.length;
    state.flocks.push(flock);
  }

  // particles
  state.particles = makeParticles(biome);
  state.world.add(state.particles);

  // HUD
  document.getElementById("biome-name").textContent = biome.name;
  document.getElementById("biome-sub").textContent = biome.sub;
  document.getElementById("creature-count").textContent = String(
    state.creatures.length + state.caterpillars.length
  ).padStart(2, "0");
  document.getElementById("flora-count").textContent = String(placed).padStart(2, "0");
  document.getElementById("bird-count").textContent = String(totalBirds).padStart(2, "0");
  document.getElementById("seed").textContent = formatSeed(seed);
  document.getElementById("elevation").textContent =
    Math.round(state.maxElev * 120) + "m";

  // restore the user's auto-rotate preference (regen shouldn't override it)
  if (_controls) _controls.autoRotate = state.userSettings.autoRotate;

  // restore native Math.random so per-frame animation isn't deterministic
  Math.random = originalRandom;
  writeSeedToUrl(seed);
}
