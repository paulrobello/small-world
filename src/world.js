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
  resetCreaturePool,
} from "./fauna.js";
import { makeFlock } from "./birds.js";
import { makeShadowDisks } from "./shadows.js";
import {
  makeParticles,
  makeGrassField,
  makeWildflowerField,
  makePebbleField,
  makeBeachcombField,
  makeWaterPlane,
  makeFlySwarm,
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
import { makeWaterReflection, disposeWaterReflection } from "./reflection.js";
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
  //
  // WARNING — synchronous only. Anything scheduled via Promise.resolve(),
  // setTimeout, requestAnimationFrame, or a microtask queue inside this
  // function will run AFTER the restore at the bottom and silently observe
  // the real Math.random, breaking determinism. All builders must run
  // synchronously between the patch and the restore.
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
  // Dispose previous reflection's WebGL render target + clear its cloned
  // scene — disposeGroup only walks state.world, and the reflection lives on
  // state.waterReflection. Clearing the scene before nulling the ref ensures
  // a stray updateWaterReflection call between here and the new
  // makeWaterReflection below can't sample disposed materials.
  disposeWaterReflection(state.waterReflection);
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
  state.flySwarms = [];
  state.dirtPuffs = [];
  state.dustKicks = [];
  state.flowerSpots = [];
  state.obstacles = [];
  state.perchSpots = [];
  state.particles = null;
  state.waterMesh = null;
  state.grass = null;
  // release any followed creature — the entity it pointed to no longer exists
  _releaseFollow();

  // reset the flora + creature resource pools — previous-world
  // materials/geometries were just disposed via disposeGroup, so we can't
  // reuse them
  resetFloraPool();
  resetCreaturePool();

  state.currentBiome = biome;
  state.currentSeed = seed;

  // Bloom is purely additive in the custom composite (base + bloom*uStrength,
  // see _bloomCompositeShader). It can only brighten the frame, so darkBiomes
  // can keep bloom on — and the obsidian shard / glow eye / ember halos are
  // exactly the visual feature those moody biomes benefit from.
  if (state.postfx) state.postfx.setBloom(state.userSettings.bloom);
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
  state.terrainMesh = terrain;
  if (state.userSettings.terrainSmoothShading) {
    terrain.material.flatShading = false;
    terrain.material.needsUpdate = true;
  }

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
  let coralPlaced = 0;
  const CRYSTAL_CAP = 4;
  // Density compensation: biome counts were tuned against a 38-unit base; the
  // current ISLAND_SIZE may be larger. Scale linearly with width so a bigger
  // world still feels populated rather than empty.
  const densityScale = state.ISLAND_SIZE / DENSITY_BASE;
  const floraTarget = LOWFX
    ? Math.max(8, Math.round(biome.floraCount * densityScale * LOWFX_DENSITY))
    : Math.round(biome.floraCount * densityScale);
  // Per-kind footprint radius — how far around the trunk axis we sample
  // heightFn to find the lowest ground the base needs to reach. Bigger
  // trunks need a wider sample so the downhill side stays buried on slopes.
  // Anything not listed falls back to FLORA_FOOTPRINT_DEFAULT.
  const FLORA_FOOTPRINT = {
    tree: 0.28, pine: 0.28, deadtree: 0.22, mushroom: 0.18,
    bigmushroom: 0.45, lantern: 0.18, pillar: 0.30, archstone: 0.55,
    balloontree: 0.22, crystal: 0.30, obsidianshard: 0.28, skull: 0.22,
    berrybush: 0.30, coral: 0.25, braincoral: 0.26, cupcoral: 0.22,
    fern: 0.18, rock: 0.30, limestonerock: 0.30, reed: 0.10,
    seaweed: 0.12, beachsucculent: 0.20,
  };
  const FLORA_FOOTPRINT_DEFAULT = 0.20;
  const FLORA_BURY = 0.08; // extra sink so the seam is hidden in soft fog
  // Flora kinds tall/solid enough that walkers should route around them
  // instead of clipping through. Low-profile or soft kinds (rocks, ferns,
  // berrybushes, coral, reeds) are skipped — creatures can step over them
  // visually and adding collision there reads as fussy.
  const OBSTACLE_KINDS = new Set([
    "tree", "pine", "deadtree", "mushroom", "bigmushroom",
    "pillar", "archstone", "balloontree", "crystal",
    "lantern", "obsidianshard", "skull",
  ]);
  // Per-kind canopy top height (local Y of the highest visible mass at
  // scale=1). Fliers below ground + top * scale must route around the
  // trunk; fliers above that altitude can pass over freely.
  const OBSTACLE_TOP = {
    tree: 2.3, pine: 2.2, deadtree: 1.8, mushroom: 1.1,
    bigmushroom: 2.6, pillar: 2.8, archstone: 2.6, balloontree: 3.2,
    crystal: 1.6, lantern: 1.7, obsidianshard: 2.2, skull: 1.5,
  };
  const OBSTACLE_TOP_DEFAULT = 2.0;
  // Extra pad on top of the slope-plant footprint so creature bodies don't
  // visually nose-clip the trunk. fp itself is already ~1.5× the trunk radius.
  const OBSTACLE_PAD = 1.15;
  // Water-plane surface Y — matches makeWaterPlane in environment.js. Used to
  // separate underwater coral spawns from above-water flora in water biomes.
  const WATER_SURFACE_Y = -0.12;
  // Local-space top of a coral at scale=1 (base height + tilted branch + tip
  // ball). Used to compute the max scale that still fits beneath the water
  // surface so corals never poke through.
  const REEF_CORAL_TOP_LOCAL = {
    coral: 1.3,
    braincoral: 0.42,
    cupcoral: 0.62,
  };
  const CORAL_SUBMERGE_MARGIN = 0.08;
  const CORAL_MIN_SCALE = 0.55;
  // Reeds and seaweed want wet roots but visible stalks, so place them only
  // where terrain sits below the water plane rather than on dry sand.
  const SHALLOW_WATER_FLORA = new Set(["reed", "seaweed"]);
  const WATER_FLORA_MARGIN = 0.02;
  const WATER_FLORA_MAX_DEPTH = {
    reed: 0.45,
    seaweed: 0.75,
  };
  while (placed < floraTarget && attempts < floraTarget * 6) {
    attempts++;
    const kind = biome.flora[Math.floor(Math.random() * biome.flora.length)];
    // Reef corals grow on submerged shelves; reeds/seaweed prefer the shallow
    // waterline. Both sample the wider falloff band where heights dip below
    // sea level, while normal flora stays on dry/near-dry ground.
    const isReefCoral = biome.water && kind in REEF_CORAL_TOP_LOCAL;
    const isShallowWaterFlora = biome.water && SHALLOW_WATER_FLORA.has(kind);
    const p = pickGroundPoint(isReefCoral || isShallowWaterFlora ? 1.0 : 0.88);
    const y0 = state.heightFn(p.x, p.z);
    if (isReefCoral) {
      if (y0 > WATER_SURFACE_Y - 0.05) continue; // not submerged enough
      if (y0 < -1.8) continue; // void / extreme depth
    } else if (isShallowWaterFlora) {
      if (y0 > WATER_SURFACE_Y - WATER_FLORA_MARGIN) continue; // dry bank
      if (y0 < WATER_SURFACE_Y - WATER_FLORA_MAX_DEPTH[kind]) continue; // too deep
    } else if (biome.water && y0 < WATER_SURFACE_Y + 0.04) {
      continue; // keep beach flora and limestone above the waterline
    } else if (y0 < -0.3) {
      continue; // skip steep cliffs / void
    }
    // Hard cap on crystals — they each spawn a point light, and we want at
    // most 4 in any world to keep the shader cost (and the visual chaos) down.
    if (kind === "crystal" && crystalCount >= CRYSTAL_CAP) continue;
    const f = FLORA_BUILDERS[kind](biome);
    f.userData.inspect = { category: "flora", variant: kind };
    // Slope-plant: sample heightFn at four offsets around the trunk axis
    // and sink the base to the lowest sample minus FLORA_BURY. On a slope
    // this keeps the downhill side buried instead of floating out of the
    // terrain. Footprint scales with flora kind (and with the random scale
    // applied below so a 1.4× tree gets a wider sample than a 0.7× one).
    let s = 0.7 + Math.random() * 0.7;
    const fp = (FLORA_FOOTPRINT[kind] ?? FLORA_FOOTPRINT_DEFAULT) * s;
    const y = Math.min(
      y0,
      state.heightFn(p.x + fp, p.z),
      state.heightFn(p.x - fp, p.z),
      state.heightFn(p.x, p.z + fp),
      state.heightFn(p.x, p.z - fp)
    ) - FLORA_BURY;
    if (isReefCoral) {
      // Clamp scale so the tallest tip stays below the water surface.
      const maxScale = (WATER_SURFACE_Y - CORAL_SUBMERGE_MARGIN - y) / REEF_CORAL_TOP_LOCAL[kind];
      if (maxScale < CORAL_MIN_SCALE) continue;
      s = Math.min(s, maxScale);
    }
    f.position.set(p.x, y, p.z);
    f.rotation.y = Math.random() * Math.PI * 2;
    f.scale.setScalar(s);
    if (kind === "crystal") {
      const glow = new THREE.PointLight(new THREE.Color(biome.accent), 1.4, 6.5, 1.8);
      glow.position.set(0, 0.6, 0); // sits inside the cluster
      f.add(glow);
      crystalCount++;
    }
    state.world.add(f);
    if (OBSTACLE_KINDS.has(kind)) {
      const topLocal = (OBSTACLE_TOP[kind] ?? OBSTACLE_TOP_DEFAULT) * s;
      const topY = y0 + topLocal;
      state.obstacles.push({
        x: p.x,
        z: p.z,
        r: fp * OBSTACLE_PAD,
        top: topY,
      });
      // Mushrooms (and big-mushrooms) double as landing pads for fliers —
      // record the cap top so the perch-aware flier landing code can steer
      // toward it. Use the builder-supplied local cap-top (accurate to the
      // per-instance random stemH on bigmushroom) rather than the coarse
      // OBSTACLE_TOP estimate, so fliers actually touch the cap.
      if (kind === "mushroom" || kind === "bigmushroom") {
        const capLocal = f.userData.capTopY ?? OBSTACLE_TOP[kind] ?? OBSTACLE_TOP_DEFAULT;
        state.perchSpots.push({ x: p.x, z: p.z, y: y + capLocal * s });
      }
    }
    // Tight, ominous fly cloud over some skulls — not every skull gets one,
    // so the swarms read as a found detail rather than a uniform decoration.
    // OBSTACLE_TOP for skull (1.5) is a loose obstacle-avoidance estimate, not
    // the actual mesh top — the cranium only reaches ~0.33 locally. Place the
    // swarm at eye-socket level so flies look like they're crawling on the
    // skull rather than hovering somewhere above it.
    if (kind === "skull" && Math.random() < 0.55) {
      const swarm = makeFlySwarm(p.x, y + 0.5 * s, p.z);
      state.world.add(swarm);
      state.flySwarms.push(swarm);
    }
    if (isReefCoral) coralPlaced++;
    placed++;
  }

  // Coral top-up — the main loop's attempt budget gets eaten by underwater
  // rejection and scale-clamp skips, so it under-places reef pieces. Run a
  // reef-only pass with an absolute target tied to floraTarget.
  const reefKinds = biome.water
    ? [...new Set(biome.flora.filter((kind) => kind in REEF_CORAL_TOP_LOCAL))]
    : [];
  if (reefKinds.length > 0) {
    const coralTarget = Math.round(floraTarget * 0.5);
    let coralAttempts = 0;
    while (coralPlaced < coralTarget && coralAttempts < coralTarget * 12) {
      coralAttempts++;
      const kind = reefKinds[Math.floor(Math.random() * reefKinds.length)];
      const p = pickGroundPoint(1.0);
      const y0 = state.heightFn(p.x, p.z);
      if (y0 > WATER_SURFACE_Y - 0.05) continue;
      if (y0 < -3.0) continue; // void / past the underwater shelf
      let s = 0.7 + Math.random() * 0.7;
      const fp = (FLORA_FOOTPRINT[kind] ?? FLORA_FOOTPRINT_DEFAULT) * s;
      const y = Math.min(
        y0,
        state.heightFn(p.x + fp, p.z),
        state.heightFn(p.x - fp, p.z),
        state.heightFn(p.x, p.z + fp),
        state.heightFn(p.x, p.z - fp)
      ) - FLORA_BURY;
      const maxScale = (WATER_SURFACE_Y - CORAL_SUBMERGE_MARGIN - y) / REEF_CORAL_TOP_LOCAL[kind];
      if (maxScale < CORAL_MIN_SCALE) continue;
      s = Math.min(s, maxScale);
      const f = FLORA_BUILDERS[kind](biome);
      f.userData.inspect = { category: "flora", variant: kind };
      f.position.set(p.x, y, p.z);
      f.rotation.y = Math.random() * Math.PI * 2;
      f.scale.setScalar(s);
      state.world.add(f);
      coralPlaced++;
    }
  }

  // ground cover — instanced grass / wildflowers / pebbles
  const grass = makeGrassField(biome, state.heightFn);
  if (grass) state.world.add(grass);
  for (const m of makeWildflowerField(biome, state.heightFn)) {
    state.world.add(m);
    if (m.userData.positions) state.flowerSpots.push(...m.userData.positions);
  }
  const beachcomb = makeBeachcombField(biome, state.heightFn);
  if (beachcomb) state.world.add(beachcomb);
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

  // butterflies — drift between flower positions. Skipped in arid biomes
  // where butterflies read as out-of-place (the desert gets fly swarms over
  // skulls instead, set up during flora placement above).
  const flowerDensity = FLOWER_DENSITY[biome.id] ?? 100;
  const bMin = Math.max(2, Math.floor(flowerDensity / 30));
  const bMax = Math.max(bMin + 1, Math.floor(flowerDensity / 14));
  const nbutterflies = biome.noButterflies
    ? 0
    : bMin + Math.floor(Math.random() * (bMax - bMin + 1));
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
