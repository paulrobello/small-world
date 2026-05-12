import * as THREE from "three";

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
  shadowDisks: null,
  waterReflection: null,
  mountainBasePos: null,
  dustKicks: [],
  postfx: null,
  heightFn: () => 0,
  currentBiome: null,
  currentSeed: 0,
  maxElev: 0,
  sunLight: null,
  hemiLight: null,
  dayNight: null,
  windUniforms: { uTime: { value: 0 } },
  revealStart: 0,
  lastSimT: 0,
  // Camera ref, set in main.js on boot. Read by stepCreature for the
  // look-at-camera response when the user hovers a creature.
  camera: null,
  // 0 = full day, 1 = full night. Updated each frame in updateDayNight so
  // fauna can react (sleep cycle at night). Personality may shift each
  // creature's effective threshold.
  nightFactor: 0,
  userSettings: {
    fogMultiplier: 0.2,
    autoCycle: false,
    manualDayFactor: 0.75,
    autoRotate: true,
    ambientBoost: 0,
    worldScale: 1,
    autoRegen: false,
    autoRegenMinutes: 2,
    bloom: true,
    tiltShift: false,
  },
};

export const NIGHT_SKY = new THREE.Color("#0a0d24");
export const NIGHT_FOG = new THREE.Color("#070a1f");
export const NIGHT_SUN = new THREE.Color("#7a89b8");
export const NIGHT_HEMI_GROUND = new THREE.Color("#06070d");
export const DAY_NIGHT_PERIOD_S = 120;

export function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
}
