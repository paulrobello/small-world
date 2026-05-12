import * as THREE from "three";

export const ISLAND_SIZE_BASE = 38;
export const ISLAND_RADIUS_BASE = ISLAND_SIZE_BASE * 0.42;

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
  parallaxRingMesh: null,
  heightFn: () => 0,
  currentBiome: null,
  currentSeed: 0,
  maxElev: 0,
  sunLight: null,
  hemiLight: null,
  dayNight: null,
  windUniforms: { uTime: { value: 0 } },
  userSettings: {
    fogMultiplier: 1.0,
    autoCycle: false,
    manualDayFactor: 0.75,
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
