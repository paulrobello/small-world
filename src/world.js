import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import {
  state,
  NIGHT_SKY,
  NIGHT_FOG,
  NIGHT_SUN,
  NIGHT_HEMI_GROUND,
  DAY_NIGHT_PERIOD_S,
  DENSITY_BASE,
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
} from "./terrain.js";
import { FLORA_BUILDERS, resetFloraPool } from "./flora.js";
import {
  makeCreature,
  makeCaterpillar,
  makeButterfly,
  makeBee,
  makeSwarm,
} from "./fauna.js";
import { makeFlock } from "./birds.js";
import { makeShadowDisks } from "./shadows.js";
import {
  makeParticles,
  makeGrassField,
  makeWildflowerField,
  makePebbleField,
  makeWaterPlane,
} from "./environment.js";
import {
  makeSkyDome,
  makeMountainBackdrop,
  makeCloudLayer,
  makeStarfield,
  makeAurora,
  makeCloudSwirl,
  stepClouds,
  updateSkyColors,
} from "./sky.js";
import { makeWaterReflection } from "./reflection.js";
import { LOWFX, LOWFX_DENSITY } from "./lowfx.js";

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
// day, dusk, and night palettes using a cosine curve. dusk is optional — when
// absent, the blend is a simple day→night two-stop.
const AMBIENT_LIFT = new THREE.Color("#a8b4c8");

// Three-stop color blend: f=1 day, f=0.5 dusk, f=0 night. If dusk is null,
// falls back to a two-stop day→night lerp (linear in f).
function blendPalette(out, day, dusk, night, f) {
  if (!dusk) return out.copy(day).lerp(night, 1 - f);
  if (f >= 0.5) {
    return out.copy(dusk).lerp(day, (f - 0.5) * 2);
  }
  return out.copy(night).lerp(dusk, f * 2);
}

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
  const ab = state.userSettings.ambientBoost ?? 0;
  // ambient boost reduces night-darkening so dark biomes don't swallow the lift
  const liftedDay = dayFactor + (1 - dayFactor) * ab * 0.7;
  const nightAmt = 1 - liftedDay;
  // expose to fauna step (sleep cycle reads this each frame)
  state.nightFactor = nightAmt;
  const dn = state.dayNight;

  blendPalette(_scene.background, dn.sky, dn.duskSky, dn.nightSky, liftedDay);
  if (ab > 0) _scene.background.lerp(AMBIENT_LIFT, ab * 0.55);
  blendPalette(_scene.fog.color, dn.fog, dn.duskFog, dn.nightFog, liftedDay);
  if (ab > 0) _scene.fog.color.lerp(AMBIENT_LIFT, ab * 0.6);
  // reveal animation — fog starts thick, eases back to biome default over ~1.5s
  let revealMul = 1;
  if (state.revealStart) {
    const k = (performance.now() - state.revealStart) / 1500;
    if (k < 1) {
      const e = (1 - Math.max(0, k)) ** 3; // ease-out cubic
      revealMul = 1 + 5 * e;
    }
  }
  _scene.fog.density =
    state.dayNight.fogDensity *
    (1 + nightAmt * 0.2) *
    state.userSettings.fogMultiplier *
    (1 - ab * 0.5) * // thinner fog at high ambient
    revealMul;

  blendPalette(state.sunLight.color, dn.sun, dn.duskSun, dn.nightSun, liftedDay);
  state.sunLight.intensity = 0.45 + dayFactor * 0.95 + ab * 1.6;
  const sunAngle = phase + Math.PI;
  const sunR = 26;
  state.sunLight.position.set(
    Math.cos(sunAngle) * sunR,
    Math.max(6, Math.sin(sunAngle) * 28 + 8),
    Math.sin(sunAngle * 0.5) * 12 + 4
  );

  blendPalette(state.hemiLight.color, dn.skyForHemi, dn.duskSky, dn.nightSky, liftedDay);
  if (ab > 0) state.hemiLight.color.lerp(AMBIENT_LIFT, ab * 0.7);
  blendPalette(
    state.hemiLight.groundColor,
    dn.ground,
    dn.duskGround,
    dn.nightGround,
    liftedDay
  );
  if (ab > 0) state.hemiLight.groundColor.lerp(AMBIENT_LIFT, ab * 0.5);
  // hemi fill scales hard with ambient so dark biomes actually brighten
  state.hemiLight.intensity = 0.32 + dayFactor * 0.45 + ab * 4.5;

  // Sky dome zenith/horizon + mountain layer tint follow the day/night curve
  updateSkyColors(state.skyDome, state.mountains, dn, liftedDay, nightAmt);

  // Stars + aurora fade in at night. Start visible around dusk and ramp to
  // full opacity at deep night so the transition feels like dimming up the
  // sky-noise rather than punching them in suddenly.
  if (state.starfield) {
    const u = state.starfield.material.uniforms;
    u.uTime.value = t;
    u.uAlpha.value = Math.max(0, nightAmt - 0.25) * 1.4;
  }
  if (state.aurora) {
    for (const m of state.aurora.userData.curtains) {
      const u = m.material.uniforms;
      u.uTime.value = t;
      u.uAlpha.value = Math.max(0, nightAmt - 0.2) * 1.3;
    }
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
  // Dispose previous reflection's WebGL render target — disposeGroup only walks
  // state.world, and the RT lives on state.waterReflection instead.
  if (state.waterReflection && state.waterReflection.rt) {
    state.waterReflection.rt.dispose();
  }
  state.waterReflection = null;
  _scene.remove(state.world);
  state.world = new THREE.Group();
  state.world.scale.setScalar(state.userSettings.worldScale ?? 1);
  _scene.add(state.world);
  state.creatures = [];
  state.flocks = [];
  state.caterpillars = [];
  state.butterflies = [];
  state.bees = [];
  state.dirtPuffs = [];
  state.dustKicks = [];
  state.flowerSpots = [];
  state.particles = null;
  state.waterMesh = null;
  state.grass = null;
  // release any followed creature — the entity it pointed to no longer exists
  _releaseFollow();

  // reset the flora resource pool — previous-world materials/geometries were
  // just disposed via disposeGroup, so we can't reuse them
  resetFloraPool();

  state.currentBiome = biome;
  state.currentSeed = seed;

  // Very dark biomes (obsidian, ashen) interact poorly with UnrealBloomPass:
  // the additive blend on a HalfFloat target loses precision against their
  // near-zero linear values and crushes the whole scene to pure black.
  // Force bloom off for them; the user's checkbox is unchanged so it comes
  // back automatically on the next biome.
  if (state.postfx) state.postfx.setBloom(state.userSettings.bloom && !biome.darkBiome);
  // depth-fog post pass tints distant pixels toward the same atmosphere color
  // as the in-scene FogExp2, just with a more painterly far-field falloff.
  if (state.postfx && state.postfx.setDepthFogColor) {
    state.postfx.setDepthFogColor(new THREE.Color(biome.fog));
  }

  // atmosphere — Color/Fog instances are mutated by updateDayNight()
  _scene.background = new THREE.Color(biome.sky);
  _scene.fog = new THREE.FogExp2(new THREE.Color(biome.fog), biome.fogDensity);

  // darkBiome biomes need extra lift: their sky/ground/cliff hexes are
  // near-black, so even strong lights still multiply against tiny material
  // colours. Boost hemi/sun/accent + nudge tone-mapping exposure to lift
  // the whole frame without changing the moody palette.
  const dark = !!biome.darkBiome;
  if (state.renderer) state.renderer.toneMappingExposure = dark ? 2.6 : 1.05;

  const hemi = new THREE.HemisphereLight(
    new THREE.Color(biome.sky),
    new THREE.Color(biome.ground[0]),
    dark ? 2.2 : 0.65
  );
  state.world.add(hemi);
  state.hemiLight = hemi;

  const sun = new THREE.DirectionalLight(new THREE.Color(biome.sun), dark ? 2.0 : 1.25);
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
    dark ? 1.8 : 0.6,
    dark ? 50 : 35,
    1.6
  );
  accent.position.set(0, 8, 0);
  state.world.add(accent);

  // Sky backdrop — dome (gradient) + two-layer mountain silhouette + drifting
  // cloud sprites. Day/night re-tints them via updateSkyColors each frame.
  const skyDome = makeSkyDome(biome);
  state.world.add(skyDome);
  state.skyDome = skyDome;

  const mountains = makeMountainBackdrop(biome);
  state.world.add(mountains);
  state.mountains = mountains;
  state.mountainBasePos = mountains.position.clone();

  state.clouds = makeCloudLayer(biome);
  if (state.clouds) state.world.add(state.clouds);

  // Starfield + aurora — drawn always, faded by night-amount in updateDayNight.
  state.starfield = makeStarfield();
  state.world.add(state.starfield);

  state.aurora = makeAurora(biome);
  if (state.aurora) state.world.add(state.aurora);

  state.cloudSwirl = makeCloudSwirl(biome);
  if (state.cloudSwirl) state.world.add(state.cloudSwirl);

  const nightP = biome.night ?? {};
  const duskP = biome.dusk ?? null;
  state.dayNight = {
    sky: new THREE.Color(biome.sky),
    skyForHemi: new THREE.Color(biome.sky),
    fog: new THREE.Color(biome.fog),
    sun: new THREE.Color(biome.sun),
    ground: new THREE.Color(biome.ground[0]),
    nightSky: new THREE.Color(nightP.sky ?? NIGHT_SKY),
    nightFog: new THREE.Color(nightP.fog ?? NIGHT_FOG),
    nightSun: new THREE.Color(nightP.sun ?? NIGHT_SUN),
    nightGround: new THREE.Color(nightP.ground ?? NIGHT_HEMI_GROUND),
    duskSky: duskP ? new THREE.Color(duskP.sky) : null,
    duskFog: duskP ? new THREE.Color(duskP.fog) : null,
    duskSun: duskP ? new THREE.Color(duskP.sun) : null,
    duskGround: duskP ? new THREE.Color(duskP.ground) : null,
    fogDensity: biome.fogDensity,
  };

  // terrain
  const noise2D = createNoise2D();
  state.heightFn = makeHeightFn(noise2D, layout, 3.2);
  const terrain = makeTerrain(biome, state.heightFn);
  state.world.add(terrain);

  // water plane (biomes that opt in)
  if (biome.water) {
    state.waterMesh = makeWaterPlane(biome);
    state.world.add(state.waterMesh);
    // Build the reflection only after the sky dome / starfield / aurora are
    // in place. Sky elements were added a few lines above this block, so they
    // exist already.
    state.waterReflection = makeWaterReflection(biome);
    // Hand the RT to the water material.
    const u = state.waterMesh.material.userData.reflectionUniforms;
    if (u) {
      u.uReflTex.value = state.waterReflection.rt.texture;
      u.uReflMix.value = 0.3; // 30% blend
    }
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
  let crystalCount = 0;
  const CRYSTAL_CAP = 4;
  // Density compensation: biome counts were tuned against a 38-unit base; the
  // current ISLAND_SIZE may be larger. Scale linearly with width so a bigger
  // world still feels populated rather than empty.
  const densityScale = state.ISLAND_SIZE / DENSITY_BASE;
  const floraTarget = LOWFX
    ? Math.max(8, Math.round(biome.floraCount * densityScale * LOWFX_DENSITY))
    : Math.round(biome.floraCount * densityScale);
  while (placed < floraTarget && attempts < floraTarget * 6) {
    attempts++;
    const p = pickGroundPoint(0.88);
    const y = state.heightFn(p.x, p.z);
    if (y < -0.3) continue; // skip steep cliffs / void
    const kind = biome.flora[Math.floor(Math.random() * biome.flora.length)];
    // Hard cap on crystals — they each spawn a point light, and we want at
    // most 4 in any world to keep the shader cost (and the visual chaos) down.
    if (kind === "crystal" && crystalCount >= CRYSTAL_CAP) continue;
    const f = FLORA_BUILDERS[kind](biome);
    f.position.set(p.x, y, p.z);
    f.rotation.y = Math.random() * Math.PI * 2;
    const s = 0.7 + Math.random() * 0.7;
    f.scale.setScalar(s);
    if (kind === "crystal") {
      const glow = new THREE.PointLight(new THREE.Color(biome.accent), 1.4, 6.5, 1.8);
      glow.position.set(0, 0.6, 0); // sits inside the cluster
      f.add(glow);
      crystalCount++;
    }
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
  const ncreatures = Math.max(1, Math.round(randInt(...biome.creatureCount) * densityScale));
  const allowGroundVariants = biome.creatureKind !== "fish";
  let spawned = 0;
  let budget = ncreatures;
  // In water biomes, raise the minimum-Y threshold so creatures don't spawn
  // submerged. Matches the WATER_AVOID_Y check in fauna.js (slight margin
  // above the waterline so waves never lap over them).
  const groundMinY = biome.water ? 0.05 : 0;
  function placeOnGround(c) {
    let p = { x: 0, z: 0 };
    let y = -10;
    for (let tries = 0; tries < 20 && y < groundMinY; tries++) {
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
      swarm.target.set(seed.x, seed.y + 0.35, seed.z);
      swarm.hasTarget = true;
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

  // Soft circular ground shadows under creatures + caterpillars.
  state.shadowDisks = makeShadowDisks(biome);
  state.world.add(state.shadowDisks);

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

  // kick off the reveal animation — updateDayNight reads this timestamp
  state.revealStart = performance.now();
}
