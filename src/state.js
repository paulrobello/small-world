import * as THREE from "three";

// App version — injected by Vite at build time from package.json.
// In dev mode, reads from the env var; in production, inlined by define.
export const APP_VERSION = __APP_VERSION__;

export const ISLAND_SIZE_BASE = 50;
export const ISLAND_RADIUS_BASE = ISLAND_SIZE_BASE * 0.462;
// Density anchor for biome flora/creature counts. The biome tables in
// biomes.js were tuned against a 38-unit base; when the base grows we scale
// counts by ISLAND_SIZE / DENSITY_BASE so larger worlds stay cutely populated
// instead of going sparse. Don't touch this without also rebalancing biomes.
export const DENSITY_BASE = 38;

export const state = {
  ISLAND_SIZE: ISLAND_SIZE_BASE,
  ISLAND_RADIUS: ISLAND_RADIUS_BASE,
  currentLayout: {
    centers: [{ cx: 0, cz: 0, radius: ISLAND_RADIUS_BASE, shape: { kind: "round" } }],
    planeSize: ISLAND_SIZE_BASE,
    boundRadius: ISLAND_RADIUS_BASE,
    kind: "single",
  },
  world: new THREE.Group(),
  creatures: [],
  caterpillars: [],
  butterflies: [],
  bees: [],
  willowisps: [],
  // Tiny dark fly clouds hovering above props (currently desert skulls).
  // Each entry is a THREE.Points parented to state.world, with userData
  // { centerX, centerY, centerZ, seeds, count }. Stepped each frame by
  // stepFlySwarms in environment.js.
  flySwarms: [],
  dirtPuffs: [],
  flowerSpots: [],
  flocks: [],
  particles: null,
  waterMesh: null,
  skyDome: null,
  mountains: null,
  clouds: null,
  starfield: null,
  aurora: null,
  // Cloud-biome only — torus-shaped swirling cloud halo built by makeCloudSwirl.
  // Null on every other biome. Parented to state.world; disposeGroup handles
  // teardown.
  cloudSwirl: null,
  shadowDisks: null,
  waterReflection: null,
  portal: null,
  mountainBasePos: null,
  dustKicks: [],
  groundMarks: null,
  // Collision discs for tall/solid flora. Populated in generateWorld during the
  // flora placement loop; consumed by stepCreature / stepCaterpillar for
  // tangent-slide obstacle avoidance. Entries: { x, z, r, top }. Empty array
  // when no obstacle-class flora exists. `top` is the world-Y of the canopy
  // and lets fliers above that altitude pass through freely.
  obstacles: [],
  // Per-frame mover-vs-mover collision discs. Rebuilt at the top of each
  // animate() tick from walker creatures and every caterpillar segment.
  // Entries: { x, z, r, top, owner } where `owner` is the creature/caterpillar
  // struct (so a mover skips its own entries via selfOwner in avoidObstacles)
  // and `top` is the body's top world-Y (lets fliers above pass over). Not
  // persistent state — purely a per-frame scratch buffer to keep alloc churn
  // out of the inner loop.
  dynamicObstacles: [],
  // Pre-allocated pool for dynamicObstacles entries (avoids per-frame GC).
  // Grows on demand, reset on world regen by main.js.
  _dynPool: null,
  // Mushroom-cap landing pads for fliers. Populated alongside obstacles
  // during flora placement. Entries: { x, z, y } where y is the world-Y of
  // the cap top. Cleared at the start of generateWorld.
  perchSpots: [],
  // Color-bucketed creature index for O(1) herding. Built in world.js
  // after creature spawning. Keyed by bodyColor hex string.
  creatureColorBuckets: null,
  // Set by makeGrassField in src/grass.js. Holds { mesh, uniforms } so
  // stepGrass can update uCameraXZ each frame and disposeGroup-style
  // teardown can null it out on regen. Mesh itself is parented to
  // state.world so disposeGroup handles its GPU resources.
  grass: null,
  postfx: null,
  heightFn: () => 0,
  currentBiome: null,
  currentSeed: 0,
  isGeneratingWorld: false,
  maxElev: 0,
  sunLight: null,
  hemiLight: null,
  dayNight: null,
  // Shared uniforms for foliage wind sway. uTime is advanced every frame in
  // main.js (frozen when wind is globally off). uFoliageWind is a 0/1
  // multiplier applied to applyWindSway materials so trees/mushrooms can be
  // stilled independently of grass.
  windUniforms: { uTime: { value: 0 }, uFoliageWind: { value: 1 } },
  revealStart: 0,
  lastSimT: 0,
  // Camera ref, set in main.js on boot. Read by stepCreature for the
  // look-at-camera response when the user hovers a creature.
  camera: null,
  // Renderer ref, set in main.js on boot. Read by makeParticles to pull the
  // current pixel ratio into the particle ShaderMaterial.
  renderer: null,
  // 0 = full day, 1 = full night. Updated each frame in updateDayNight so
  // fauna can react (sleep cycle at night). Personality may shift each
  // creature's effective threshold.
  nightFactor: 0,
  userSettings: {
    fogMultiplier: 0.2,
    autoCycle: false,
    manualDayFactor: 0.75,
    autoRotate: false,
    ambientBoost: 0,
    worldScale: 1,
    autoRegen: false,
    autoRegenMinutes: 2,
    bloom: true,
    tiltShift: false,
    outline: true,
    ao: true,
    depthFog: true,
    fxPanelOpen: false,
    portalPreviewGrass: false,
    portalPreviewFlora: true,
    portalPreviewCreatures: false,
    portalPreviewFx: true,
    portalPanelOpen: false,
    showFps: false,
    windEnabled: true,
    windStrength: 1.0,
    windNoiseScale: 1.0,
    windPanelOpen: false,
    grassEnabled: true,
    grassDensity: 12.5,
    grassHeight: 0.96,
    groundMarkLifeScale: 2.0,
    grassPanelOpen: false,
    foliageWindEnabled: true,
    bloomRadius: 0.5,
    pbrDetails: true,
    musicEnabled: false,
    musicVolume: 0.5,
  },
  // Set by world.js after makeTerrain.
  terrainMesh: null,
  // Set by initPostFX. Null under LOWFX (no composer, no depth capture).
  depthTexture: null,
};

export const NIGHT_SKY = new THREE.Color("#0a0d24");
export const NIGHT_FOG = new THREE.Color("#070a1f");
export const NIGHT_SUN = new THREE.Color("#7a89b8");
export const NIGHT_HEMI_GROUND = new THREE.Color("#06070d");
export const DAY_NIGHT_PERIOD_S = 120;

const MATERIAL_TEXTURE_KEYS = [
  "map",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "specularIntensityMap",
  "specularColorMap",
  "aoMap",
  "emissiveMap",
  "alphaMap",
  "bumpMap",
  "displacementMap",
  "envMap",
  "clearcoatMap",
  "clearcoatNormalMap",
  "clearcoatRoughnessMap",
];

function disposeMaterial(material, disposedMaterials, disposedTextures) {
  if (!material || disposedMaterials.has(material)) return;
  disposedMaterials.add(material);
  for (const key of MATERIAL_TEXTURE_KEYS) {
    const texture = material[key];
    if (texture && texture.dispose && !disposedTextures.has(texture)) {
      disposedTextures.add(texture);
      texture.dispose();
    }
  }
  const extraTextures = material.userData?.pbrDetailTextures ?? [];
  for (const texture of extraTextures) {
    if (texture && texture.dispose && !disposedTextures.has(texture)) {
      disposedTextures.add(texture);
      texture.dispose();
    }
  }
  material.dispose();
}

export function disposeGroup(g) {
  const disposedMaterials = new Set();
  const disposedTextures = new Set();
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) {
        o.material.forEach((m) => disposeMaterial(m, disposedMaterials, disposedTextures));
      } else {
        disposeMaterial(o.material, disposedMaterials, disposedTextures);
      }
    }
  });
}
