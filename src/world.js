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
import { BIOMES, WILDFLOWER_PALETTES, FLOWER_DENSITY, BLOOM_RADIUS_SCALE } from "./biomes.js";
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
  makeWillOWisp,
  resetCreaturePool,
  buildObstacleGrid,
} from "./fauna.js";
import { makeFlock } from "./birds.js";
import { makeShadowDisks } from "./shadows.js";
import {
  makeParticles,
  makeGrassField,
  makeWildflowerField,
  makePebbleField,
  makeGroundMarks,
  makeVerdantGroveDetails,
  makeCloudPuffField,
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
  makeIslandEdgeMist,
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
  state.willowisps = [];
  state.dirtPuffs = [];
  state.dustKicks = [];
  state.groundMarks = null;
  state.flowerSpots = [];
  state.obstacles = [];
  state._dynPool = null;
  state.perchSpots = [];
  state.creatureColorBuckets = null;
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

  const edgeMist = makeIslandEdgeMist(biome);
  if (edgeMist) state.world.add(edgeMist);

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
  // Cloud islands should read as soft puffs rather than rocky mountains.
  // Lowering the amplitude keeps the silhouette pillowy while preserving the
  // seeded terrain function for creature placement and HUD elevation.
  const terrainAmp = biome.cloudlike ? 2.15 : 3.2;
  const baseHeightFn = makeHeightFn(noise2D, layout, terrainAmp);
  state.heightFn = biome.water
    ? (x, z) => {
      const h = baseHeightFn(x, z);
      const waterY = -0.12;
      const depth = waterY - h;
      if (depth <= 0) return h;
      const wet = Math.min(1, depth / 1.6);
      const smoothWet = wet * wet * (3 - 2 * wet);
      return h - smoothWet * (0.45 + depth * 0.28);
    }
    : baseHeightFn;
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
  let fissureLightCount = 0;
  let coralPlaced = 0;
  const CRYSTAL_CAP = 4;
  const FISSURE_LIGHT_CAP = LOWFX ? 4 : 9;
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
    tree: 0.28, leafballtree: 0.90, pine: 0.28, deadtree: 0.22, mushroom: 0.18,
    bigmushroom: 0.45, fairyring: 1.15, lantern: 0.18, pillar: 0.30, archstone: 0.55,
    balloontree: 0.22, crystal: 0.30, obsidianshard: 0.28, skull: 0.22,
    berrybush: 0.30, coral: 0.25, braincoral: 0.26, cupcoral: 0.22,
    fern: 0.18, rock: 0.30, limestonerock: 0.30, reed: 0.10,
    seaweed: 0.12, beachsucculent: 0.20, lavafissure: 1.45,
  };
  const FLORA_FOOTPRINT_DEFAULT = 0.20;
  const FLORA_BURY = 0.08; // extra sink so the seam is hidden in soft fog
  // Flora kinds tall/solid enough that walkers should route around them
  // instead of clipping through. Low-profile or soft kinds (rocks, ferns,
  // coral, reeds) are skipped — creatures can step over them visually and
  // adding collision there reads as fussy.
  const OBSTACLE_KINDS = new Set([
    "tree", "leafballtree", "pine", "deadtree", "mushroom", "bigmushroom",
    "fairyring", "cactus", "pillar", "archstone", "balloontree", "crystal",
    "lantern", "obsidianshard", "skull", "lavafissure", "berrybush",
  ]);
  // Per-kind canopy top height (local Y of the highest visible mass at
  // scale=1). Fliers below ground + top * scale must route around the
  // trunk; fliers above that altitude can pass over freely.
  const OBSTACLE_TOP = {
    tree: 2.3, leafballtree: 2.25, pine: 2.2, deadtree: 1.8, mushroom: 1.1,
    bigmushroom: 2.6, fairyring: 0.9, cactus: 1.2, pillar: 2.8, archstone: 2.6, balloontree: 3.2,
    crystal: 1.6, lantern: 1.7, obsidianshard: 2.2, skull: 1.5,
    lavafissure: 0.16, berrybush: 0.58,
  };
  const OBSTACLE_TOP_DEFAULT = 2.0;
  // Extra pad on top of the slope-plant footprint so creature bodies don't
  // visually nose-clip the trunk. fp itself is already ~1.5× the trunk radius.
  const OBSTACLE_PAD = 1.15;
  // Visual canopy spacing is wider than root/footprint spacing. Trees and
  // big mushrooms can have small trunks but broad crowns/caps, so they need
  // a separate placement radius to prevent silhouettes from intersecting.
  const CANOPY_SPACING_KINDS = new Set(["tree", "leafballtree", "pine", "deadtree", "bigmushroom", "fairyring"]);
  const CANOPY_SPACING_PAD = 2.8;
  const PLACEMENT_BLOCK_KINDS = new Set(["lavafissure"]);
  const floraPlacementBlocks = [];
  // Track fairy-ring flatten zones so heightFn can be patched afterward.
  const fairyFlat = []; // { cx, cz, r, flatY }
  function flattenTerrainCircle(cx, cz, r, flatY) {
    const mesh = state.terrainMesh;
    if (!mesh) return;
    const pos = mesh.geometry.attributes.position;
    const r2 = r * r;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - cx;
      const dz = pos.getZ(i) - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r2) continue;
      // Smooth blend: full flatten at centre, taper to original at the edge.
      const t = 1 - d2 / r2; // 1 at centre, 0 at edge
      const blend = t * t * (3 - 2 * t); // smoothstep
      pos.setY(i, pos.getY(i) + (flatY - pos.getY(i)) * blend);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    fairyFlat.push({ cx, cz, r, flatY });
  }
  function blocksPlacement(x, z, r, kinds = PLACEMENT_BLOCK_KINDS) {
    const kindSet = kinds instanceof Set ? kinds : new Set(kinds);
    for (const obstacle of state.obstacles) {
      if (!kindSet.has(obstacle.kind)) continue;
      const minD = obstacle.r + r;
      const dx = x - obstacle.x;
      const dz = z - obstacle.z;
      if (dx * dx + dz * dz < minD * minD) return true;
    }
    return false;
  }
  function blocksFloraPlacement(x, z, r, kinds = null) {
    const kindSet = kinds == null ? null : (kinds instanceof Set ? kinds : new Set(kinds));
    for (const block of floraPlacementBlocks) {
      if (kindSet && !kindSet.has(block.kind)) continue;
      const minD = block.r + r;
      const dx = x - block.x;
      const dz = z - block.z;
      if (dx * dx + dz * dz < minD * minD) return true;
    }
    return false;
  }
  function conformSurfaceChildrenToTerrain(group) {
    const c = Math.cos(group.rotation.y);
    const s = Math.sin(group.rotation.y);
    const scale = group.scale.x || 1;
    for (const child of group.children) {
      const lift = child.userData.surfaceLift;
      if (lift === undefined) continue;
      if (child.userData.surfaceConformVertices && child.geometry?.attributes?.position) {
        const pos = child.geometry.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const lx = (child.position.x + pos.getX(i)) * scale;
          const lz = (child.position.z + pos.getZ(i)) * scale;
          const wx = group.position.x + c * lx + s * lz;
          const wz = group.position.z - s * lx + c * lz;
          pos.setY(i, (state.heightFn(wx, wz) - group.position.y) / scale + lift - child.position.y);
        }
        pos.needsUpdate = true;
        child.geometry.computeVertexNormals();
        continue;
      }
      const lx = child.position.x * scale;
      const lz = child.position.z * scale;
      const wx = group.position.x + c * lx + s * lz;
      const wz = group.position.z - s * lx + c * lz;
      child.position.y = (state.heightFn(wx, wz) - group.position.y) / scale + lift;
    }
  }
  function alignGroupUpToTerrainNormal(group, normal, yaw) {
    const align = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      normal
    );
    const spin = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      yaw
    );
    group.quaternion.copy(align.multiply(spin));
  }
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

  if (biome.groveDetails?.fairyRing) {
    let choice = null;
    for (let tries = 0; tries < 36; tries++) {
      const p = pickGroundPoint(0.42);
      const y0 = state.heightFn(p.x, p.z);
      const s = 1.05 + Math.random() * 0.22;
      const fp = FLORA_FOOTPRINT.fairyring * s;
      if (blocksFloraPlacement(p.x, p.z, fp * 1.1)) continue;
      if (!choice || y0 > choice.y0) choice = { p, y0, s, fp };
      if (y0 >= -0.2) break;
    }
    if (choice) {
      const { p, y0, s, fp } = choice;
      const landmark = FLORA_BUILDERS.fairyring(biome);
      landmark.userData.inspect = { category: "flora", variant: "fairyring" };
      const y = Math.min(
        y0,
        state.heightFn(p.x + fp, p.z),
        state.heightFn(p.x - fp, p.z),
        state.heightFn(p.x, p.z + fp),
        state.heightFn(p.x, p.z - fp)
      ) - FLORA_BURY;
      landmark.position.set(p.x, y, p.z);
      landmark.rotation.y = Math.random() * Math.PI * 2;
      landmark.scale.setScalar(s);
      // Flatten terrain vertices inside the ring so mushrooms sit level.
      flattenTerrainCircle(p.x, p.z, fp * 1.66, y);
      conformSurfaceChildrenToTerrain(landmark);
      state.world.add(landmark);
      floraPlacementBlocks.push({ kind: "fairyring", x: p.x, z: p.z, r: fp * 1.1 });
      state.obstacles.push({
        kind: "fairyring",
        x: p.x,
        z: p.z,
        r: fp * 1.1,
        top: y0 + (OBSTACLE_TOP.fairyring ?? OBSTACLE_TOP_DEFAULT) * s,
      });
      // Spawn will-o-wisps around the fairy ring
      const wispCount = landmark.userData.willowispCount ?? 0;
      for (let wi = 0; wi < wispCount; wi++) {
        const wisp = makeWillOWisp(p.x, y, p.z, fp * 2);
        state.world.add(wisp.group);
        state.willowisps.push(wisp);
      }
      placed++;
    }
  }

  // Patch heightFn to reflect fairy-ring flattening so all subsequent
  // flora placement and conformSurfaceChildren see the real mesh heights.
  if (fairyFlat.length) {
    const rawHeightFn = state.heightFn;
    state.heightFn = (x, z) => {
      const h = rawHeightFn(x, z);
      for (const { cx, cz, r, flatY } of fairyFlat) {
        const dx = x - cx, dz = z - cz;
        const d2 = dx * dx + dz * dz;
        const r2 = r * r;
        if (d2 >= r2) continue;
        const t = 1 - d2 / r2;
        const blend = t * t * (3 - 2 * t);
        return h + (flatY - h) * blend;
      }
      return h;
    };
  }

  let groveGiantPlaced = false;
  let verdantGiantPlaced = false;
  while (placed < floraTarget && attempts < floraTarget * 6) {
    attempts++;
    const kind = biome.flora[Math.floor(Math.random() * biome.flora.length)];
    // Reef corals grow on submerged shelves; reeds/seaweed prefer the shallow
    // waterline. Both sample the wider falloff band where heights dip below
    // sea level, while normal flora stays on dry/near-dry ground.
    const isReefCoral = biome.water && kind in REEF_CORAL_TOP_LOCAL;
    const isShallowWaterFlora = biome.water && SHALLOW_WATER_FLORA.has(kind);
    const normalFloraRadius = biome.id === "golden" && kind === "tree" ? 0.98 : 0.88;
    const p = pickGroundPoint(isReefCoral || isShallowWaterFlora ? 1.0 : normalFloraRadius);
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
    // Slope-plant: sample heightFn at four offsets around the trunk axis
    // and sink the base to the lowest sample minus FLORA_BURY. On a slope
    // this keeps the downhill side buried instead of floating out of the
    // terrain. Footprint scales with flora kind (and with the random scale
    // applied below so a 1.4× tree gets a wider sample than a 0.7× one).
    let s = 0.7 + Math.random() * 0.7;
    // Double the scale for tree types
    if (kind === "tree" || kind === "leafballtree" || kind === "pine" || kind === "deadtree" || kind === "balloontree") s *= 2;
    const fp = (FLORA_FOOTPRINT[kind] ?? FLORA_FOOTPRINT_DEFAULT) * s;
    const placementBlockKinds = kind === "lavafissure" ? null : PLACEMENT_BLOCK_KINDS;
    if (blocksFloraPlacement(p.x, p.z, fp * 1.2, placementBlockKinds)) continue;
    if (CANOPY_SPACING_KINDS.has(kind) && blocksFloraPlacement(p.x, p.z, fp * CANOPY_SPACING_PAD, CANOPY_SPACING_KINDS)) continue;
    const f = FLORA_BUILDERS[kind](biome);
    f.userData.inspect = { category: "flora", variant: kind };
    const hXp = state.heightFn(p.x + fp, p.z);
    const hXm = state.heightFn(p.x - fp, p.z);
    const hZp = state.heightFn(p.x, p.z + fp);
    const hZm = state.heightFn(p.x, p.z - fp);
    const y = Math.min(y0, hXp, hXm, hZp, hZm) - FLORA_BURY;
    if (isReefCoral) {
      // Clamp scale so the tallest tip stays below the water surface.
      const maxScale = (WATER_SURFACE_Y - CORAL_SUBMERGE_MARGIN - y) / REEF_CORAL_TOP_LOCAL[kind];
      if (maxScale < CORAL_MIN_SCALE) continue;
      s = Math.min(s, maxScale);
    }
    f.position.set(p.x, y, p.z);
    const yaw = Math.random() * Math.PI * 2;
    if (kind === "berrybush") {
      const normal = new THREE.Vector3(hXm - hXp, 2 * fp, hZm - hZp).normalize();
      alignGroupUpToTerrainNormal(f, normal, yaw);
    } else {
      f.rotation.y = yaw;
    }
    f.scale.setScalar(s);
    // Mushroom grove gets one giant bigmushroom (4× scale)
    if (kind === "bigmushroom" && biome.id === "grove" && !groveGiantPlaced) {
      // Only place in the inner 1/3 of the island so the giant cap
      // doesn't overhang the edge.
      const centers = state.currentLayout.centers;
      let bDx = p.x - centers[0].cx, bDz = p.z - centers[0].cz;
      for (let ci = 1; ci < centers.length; ci++) {
        const ddx = p.x - centers[ci].cx, ddz = p.z - centers[ci].cz;
        if (ddx * ddx + ddz * ddz < bDx * bDx + bDz * bDz) { bDx = ddx; bDz = ddz; }
      }
      if (Math.sqrt(bDx * bDx + bDz * bDz) > state.ISLAND_RADIUS / 3) continue;
      s *= 4;
      f.scale.setScalar(s);
      // Disable wind on the giant mushroom — at 4× scale the sway
      // amplitude looks exaggerated and comical. Clone materials first
      // so other bigmushroom instances (which share pooled materials)
      // are not affected.
      f.traverse((child) => {
        if (child.isMesh && child.material) {
          const prev = child.material.onBeforeCompile;
          child.material = child.material.clone();
          child.material.onBeforeCompile = (shader) => {
            prev(shader);
            if (shader.uniforms.uWindStrength) shader.uniforms.uWindStrength.value = 0;
          };
        }
      });
      // Zero perchWind so creatures perched on the cap don't bob.
      f.userData.perchWind = { strength: 0, localY: f.userData.perchWind?.localY ?? 0 };
      groveGiantPlaced = true;
    }
    // Verdant grove gets one giant leafballtree (3× scale) with a will-o-wisp
    if (kind === "leafballtree" && biome.id === "verdant" && !verdantGiantPlaced) {
      // Only place in the inner 2/3 of the island so the giant canopy doesn't
      // overhang the edge.
      const centers = state.currentLayout.centers;
      let bestDx = p.x - centers[0].cx, bestDz = p.z - centers[0].cz;
      for (let ci = 1; ci < centers.length; ci++) {
        const ddx = p.x - centers[ci].cx, ddz = p.z - centers[ci].cz;
        if (ddx * ddx + ddz * ddz < bestDx * bestDx + bestDz * bestDz) {
          bestDx = ddx; bestDz = ddz;
        }
      }
      const distFromCenter = Math.sqrt(bestDx * bestDx + bestDz * bestDz);
      const maxR = state.ISLAND_RADIUS * (2 / 3);
      if (distFromCenter > maxR) {
        // Skip this placement — keep verdantGiantPlaced false so we retry
        continue;
      }
      s *= 3;
      f.scale.setScalar(s);
      verdantGiantPlaced = true;
      // Will-o-wisp that orbits and flies above the giant tree
      // Avoidance sphere keeps it outside the canopy volume
      // Canopy center: y + 1.46 * s, canopy max radius: 0.88 * s ≈ 2.64 at 3×
      const canopyCenterY = y + 1.46 * s;
      const canopyR = 1.3 * s + 0.5; // full canopy extent + padding
      const wisp = makeWillOWisp(p.x, canopyCenterY, p.z, canopyR + 0.8);
      wisp.innerRadius = canopyR;
      wisp.avoidX = p.x;
      wisp.avoidY = canopyCenterY;
      wisp.avoidZ = p.z;
      wisp.avoidR = canopyR;
      // Start outside the canopy
      const startAngle = Math.random() * Math.PI * 2;
      wisp.group.position.set(
        p.x + Math.cos(startAngle) * (canopyR + 0.5),
        canopyCenterY + canopyR,
        p.z + Math.sin(startAngle) * (canopyR + 0.5)
      );
      state.world.add(wisp.group);
      state.willowisps.push(wisp);
    }
    if (kind === "lavafissure") conformSurfaceChildrenToTerrain(f);
    if (kind === "crystal") {
      const glow = new THREE.PointLight(new THREE.Color(biome.accent), 1.4, 6.5, 1.8);
      glow.position.set(0, 0.6, 0); // sits inside the cluster
      f.add(glow);
      crystalCount++;
    }
    if (kind === "lavafissure" && fissureLightCount < FISSURE_LIGHT_CAP) {
      const glow = new THREE.PointLight(new THREE.Color(biome.accent), 1.25, 5.5, 2.0);
      glow.position.set(0, 0.22, 0);
      f.add(glow);
      fissureLightCount++;
    }
    state.world.add(f);
    // Berry bushes are nectar targets for bees alongside flowers.
    if (kind === "berrybush") {
      state.flowerSpots.push({ x: p.x, y: y + 0.3 * s, z: p.z });
    }
    floraPlacementBlocks.push({
      kind,
      x: p.x,
      z: p.z,
      r: fp * (CANOPY_SPACING_KINDS.has(kind) ? CANOPY_SPACING_PAD : 1.2),
    });
    if (OBSTACLE_KINDS.has(kind)) {
      const topLocal = (f.userData.obstacleTopY ?? OBSTACLE_TOP[kind] ?? OBSTACLE_TOP_DEFAULT) * s;
      const fissurePts = kind === "lavafissure" ? f.userData.fissureObstaclePoints : null;
      if (Array.isArray(fissurePts) && fissurePts.length) {
        const c = Math.cos(f.rotation.y);
        const sy = Math.sin(f.rotation.y);
        for (const pt of fissurePts) {
          const lx = pt.x * s;
          const lz = pt.z * s;
          const wx = p.x + c * lx + sy * lz;
          const wz = p.z - sy * lx + c * lz;
          state.obstacles.push({
            kind,
            x: wx,
            z: wz,
            r: (pt.r ?? 0.24) * s * OBSTACLE_PAD,
            top: state.heightFn(wx, wz) + topLocal,
          });
        }
      } else {
        const topY = y0 + topLocal;
        state.obstacles.push({
          kind,
          x: p.x,
          z: p.z,
          r: fp * OBSTACLE_PAD,
          top: topY,
        });
      }
      // Mushrooms (and big-mushrooms) double as landing pads for fliers —
      // record the cap top so the perch-aware flier landing code can steer
      // toward it. Use the builder-supplied local cap-top (accurate to the
      // per-instance random stemH on bigmushroom) rather than the coarse
      // OBSTACLE_TOP estimate, so fliers actually touch the cap.
      if (kind === "mushroom" || kind === "bigmushroom" || kind === "leafballtree") {
        const capLocal = f.userData.capTopY ?? f.userData.obstacleTopY ?? OBSTACLE_TOP[kind] ?? OBSTACLE_TOP_DEFAULT;
        state.perchSpots.push({
          x: p.x,
          z: p.z,
          y: y + capLocal * s,
          perchWind: f.userData.perchWind
            ? { ...f.userData.perchWind, scale: s, rotationY: f.rotation.y, baseX: p.x, baseZ: p.z }
            : null,
        });
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
  // Exclude fairy-ring circles from all ground cover placement.
  const coverExclusions = floraPlacementBlocks
    .filter(b => b.kind === "fairyring")
    .map(b => ({ x: b.x, z: b.z, r: b.r }));
  const grass = makeGrassField(biome, state.heightFn, coverExclusions);
  if (grass) state.world.add(grass);
  for (const m of makeWildflowerField(biome, state.heightFn, coverExclusions)) {
    state.world.add(m);
    if (m.userData.positions) state.flowerSpots.push(...m.userData.positions);
  }
  const groveDetails = makeVerdantGroveDetails(biome, state.heightFn, coverExclusions);
  if (groveDetails) state.world.add(groveDetails);
  const cloudPuffs = makeCloudPuffField(biome, state.heightFn, coverExclusions);
  if (cloudPuffs) state.world.add(cloudPuffs);
  const beachcomb = makeBeachcombField(biome, state.heightFn, coverExclusions);
  if (beachcomb) state.world.add(beachcomb);
  const pebbles = makePebbleField(biome, state.heightFn, coverExclusions);
  if (pebbles) state.world.add(pebbles);
  state.groundMarks = makeGroundMarks(biome);
  if (state.groundMarks) state.world.add(state.groundMarks);

  // creatures — fish biomes don't get sleepers/burrowers (they float).
  // We treat ncreatures as a budget; family parents consume +1 per kid,
  // so the actual headcount can be slightly higher than the configured range.
  const ncreatures = Math.max(1, Math.round(randInt(...biome.creatureCount) * densityScale));
  const allowGroundVariants = biome.creatureKind !== "fish";
  let spawned = 0;
  let budget = ncreatures;
  // In water biomes, raise the minimum-Y threshold so ground creatures don't
  // spawn submerged. Fish are the exception: they spawn on underwater shelves
  // and their step logic keeps them swimming below the surface.
  const groundMinY = biome.water ? 0.05 : 0;
  const fishSurfaceY = -0.24;
  const fishMinGroundY = -4.2;
  function fishMaxGroundY(scale) {
    return fishSurfaceY - 0.66 * scale;
  }
  function placeFishUnderwater(c) {
    let p = { x: 0, z: 0 };
    let y = 0;
    let found = false;
    for (let tries = 0; tries < 120; tries++) {
      p = pickGroundPoint(1.0);
      y = state.heightFn(p.x, p.z);
      if (y <= fishMaxGroundY(c.scale) && y > fishMinGroundY) {
        found = true;
        break;
      }
    }
    if (!found) return false;
    const halfBodyY = 0.42 * c.bodyBaseY * c.scale;
    const topY = fishSurfaceY + 0.04 - halfBodyY;
    const bottomY = y + halfBodyY + 0.04;
    const swimY = bottomY + (topY - bottomY) * (0.4 + Math.random() * 0.25);
    c.group.position.set(p.x, swimY, p.z);
    state.world.add(c.group);
    state.creatures.push(c);
    spawned++;
    return true;
  }
  function placeOnGround(c) {
    if (c.isFish && biome.water) {
      const placedFish = placeFishUnderwater(c);
      if (!placedFish) disposeGroup(c.group);
      return placedFish;
    }
    let p = { x: 0, z: 0 };
    let y = -10;
    let found = false;
    for (let tries = 0; tries < 40; tries++) {
      p = pickGroundPoint(0.65);
      y = state.heightFn(p.x, p.z);
      if (y >= groundMinY && !blocksPlacement(p.x, p.z, 0.35)) {
        found = true;
        break;
      }
    }
    if (!found) {
      disposeGroup(c.group);
      return false;
    }
    c.group.position.set(p.x, y + 0.4, p.z);
    state.world.add(c.group);
    state.creatures.push(c);
    spawned++;
    return true;
  }
  let creatureAttempts = 0;
  while (budget > 0 && creatureAttempts < ncreatures * 10) {
    creatureAttempts++;
    const r = Math.random();
    // budget rolls: family (parent + kids), sleeper, burrower, plain
    if (allowGroundVariants && budget >= 2 && r < 0.18) {
      // family group — 1 parent + 1-2 kids
      const parent = makeCreature(biome, { role: "parent" });
      if (!placeOnGround(parent)) continue;
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
        let kidPlaced = false;
        for (let tries = 0; tries < 8; tries++) {
          const ang = Math.random() * Math.PI * 2;
          const off = 1.0 + Math.random() * 0.8;
          const nx = pp.x + Math.cos(ang) * off;
          const nz = pp.z + Math.sin(ang) * off;
          if (blocksPlacement(nx, nz, 0.3)) continue;
          kid.group.position.set(nx, state.heightFn(nx, nz) + 0.4, nz);
          state.world.add(kid.group);
          state.creatures.push(kid);
          spawned++;
          budget--;
          kidPlaced = true;
          break;
        }
        if (!kidPlaced) disposeGroup(kid.group);
      }
    } else if (allowGroundVariants && r < 0.30) {
      if (placeOnGround(makeCreature(biome, { sleeper: true }))) budget--;
    } else if (allowGroundVariants && r < 0.38) {
      if (placeOnGround(makeCreature(biome, { burrower: true }))) budget--;
    } else {
      const bumbleConfig = biome.flyerVariants?.[0];
      if (bumbleConfig && Math.random() < 0.35) {
        if (placeOnGround(makeCreature(biome, {
          variant: bumbleConfig.kind,
          stripeColors: bumbleConfig.stripeOverride,
        }))) budget--;
      } else {
        if (placeOnGround(makeCreature(biome))) budget--;
      }
    }
  }

  if (biome.anglerFish && biome.water) {
    const nAnglers = 2 + Math.floor(Math.random() * 3);
    let anglersPlaced = 0;
    let anglerAttempts = 0;
    while (anglersPlaced < nAnglers && anglerAttempts < nAnglers * 20) {
      anglerAttempts++;
      const angler = makeCreature(biome, { angler: true });
      if (placeFishUnderwater(angler)) {
        anglersPlaced++;
      } else {
        disposeGroup(angler.group);
      }
    }
  }

  // caterpillars — multi-segment crawlers, occasionally swapped for snails
  // Crawlers also avoid spawning inside fairy rings (large obstacle discs
  // that the "turn" avoidance response can't escape from).
  const CRAWLER_BLOCK_KINDS = new Set(["lavafissure", "fairyring"]);
  function placeCrawler(make) {
    for (let tries = 0; tries < 12; tries++) {
      const crawler = make();
      const head = crawler.segments?.[0];
      if (head && !blocksPlacement(head.position.x, head.position.z, 0.28 * crawler.scale, CRAWLER_BLOCK_KINDS)) {
        state.world.add(crawler.group);
        state.caterpillars.push(crawler);
        return true;
      }
      disposeGroup(crawler.group);
    }
    return false;
  }

  const ncats = 1 + Math.floor(Math.random() * 3); // 1–3
  for (let i = 0; i < ncats; i++) {
    placeCrawler(() => makeCaterpillar(biome));
  }
  // snails — 0-2 per world (cute, slow). They live in the caterpillars array
  // so they get stepped and ray-picked alongside their cousins.
  const nsnails = Math.random() < 0.7 ? (Math.random() < 0.4 ? 2 : 1) : 0;
  for (let i = 0; i < nsnails; i++) {
    placeCrawler(() => makeCaterpillar(biome, { kind: "snail" }));
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
  const numFlocks = 1;
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

  // Mobile help panel — mirror the same stats
  const hBiome = document.getElementById("help-biome");
  if (hBiome) hBiome.textContent = biome.name;
  const hSeed = document.getElementById("help-seed");
  if (hSeed) hSeed.textContent = formatSeed(seed);
  const hCr = document.getElementById("help-creatures");
  if (hCr) hCr.textContent = String(state.creatures.length + state.caterpillars.length).padStart(2, "0");
  const hFl = document.getElementById("help-flora");
  if (hFl) hFl.textContent = String(placed).padStart(2, "0");
  const hBi = document.getElementById("help-birds");
  if (hBi) hBi.textContent = String(totalBirds).padStart(2, "0");
  const hEl = document.getElementById("help-elevation");
  if (hEl) hEl.textContent = Math.round(state.maxElev * 120) + "m";

  // Notify mobile UI that world is ready (triggers header auto-hide)
  window.dispatchEvent(new CustomEvent("world-ready"));

  // restore the user's auto-rotate preference (regen shouldn't override it)
  if (_controls) _controls.autoRotate = state.userSettings.autoRotate;

  // restore native Math.random so per-frame animation isn't deterministic
  Math.random = originalRandom;
  writeSeedToUrl(seed);

  // Build the spatial grid for static obstacle queries so avoidObstacles()
  // can use O(nearby) lookups instead of scanning the full list.
  buildObstacleGrid(state.obstacles);

  // Build color buckets for O(1) herding lookups — group creatures by
  // their bodyColor hex string so herdInfluence only scans same-colored
  // peers instead of the full creature list.
  const buckets = {};
  for (const c of state.creatures) {
    const key = c.colorBucket;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(c);
  }
  state.creatureColorBuckets = buckets;

  // kick off the reveal animation — updateDayNight reads this timestamp
  state.revealStart = performance.now();
}
