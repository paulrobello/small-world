import * as THREE from "three";
import { state } from "./state.js";
import { BIOMES } from "./biomes.js";
import { makeCreature, makeCaterpillar, stepCreature, stepCaterpillar } from "./fauna.js";
import { mulberry32 } from "./seed.js";

const _params = new URLSearchParams(window.location.search);
export const INSPECT = _params.get("inspect") === "1";

const VARIANTS = [
  { name: "walker",   kind: "creature",    build: (biome) => makeCreature(biome) },
  { name: "flier",    kind: "creature",    build: (biome) => {
      // re-roll until we get a flier (or, on fish biomes, a fish — they always fly)
      for (let i = 0; i < 30; i++) {
        const c = makeCreature(biome);
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
      return makeCreature(biome);
    } },
  { name: "sleeper",  kind: "creature",    build: (biome) => makeCreature(biome, { sleeper: true }) },
  { name: "burrower", kind: "creature",    build: (biome) => makeCreature(biome, { burrower: true }) },
  { name: "caterpillar", kind: "caterpillar", build: (biome) => makeCaterpillar(biome) },
  { name: "snail",       kind: "caterpillar", build: (biome) => makeCaterpillar(biome, { kind: "snail" }) },
];

let _biomeIdx = 0;
let _variantIdx = 0;
let _specimen = null;
let _specimenKind = "creature";
let _hudEl = null;
let _stage = null;

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
  const discGeo = new THREE.CylinderGeometry(1.6, 1.6, 0.06, 36);
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

function spawnSpecimen(scene) {
  if (_specimen && _specimen.group) {
    if (_specimen.group.parent) _specimen.group.parent.remove(_specimen.group);
    disposeObject(_specimen.group);
  }

  state.creatures = [];
  state.caterpillars = [];
  state.butterflies = [];
  state.bees = [];
  state.flowerSpots = [];
  state.dustKicks = [];
  state.dirtPuffs = [];

  const biome = BIOMES[_biomeIdx];
  const variant = VARIANTS[_variantIdx];

  // Seeded RNG so the same biome+variant always produces the same look —
  // makes A/B comparison across reloads possible.
  const original = Math.random;
  Math.random = mulberry32(0x1234 + _biomeIdx * 17 + _variantIdx * 31);
  let c;
  try {
    c = variant.build(biome);
  } finally {
    Math.random = original;
  }

  _specimen = c;
  _specimenKind = variant.kind;
  if (variant.kind === "caterpillar") {
    state.caterpillars.push(c);
    c.group.position.set(0, 0.05, 0);
  } else {
    state.creatures.push(c);
    c.group.position.set(0, c.flies ? 1.2 : 0.45, 0);
  }
  // Scale up for inspection
  c.group.scale.multiplyScalar(2.4);
  scene.add(c.group);
  updateHud();
}

function updateHud() {
  if (!_hudEl) return;
  const biome = BIOMES[_biomeIdx];
  const variant = VARIANTS[_variantIdx];
  _hudEl.innerHTML =
    `<span class="ihud-key">INSPECT</span>` +
    `<span class="ihud-val">${biome.name}</span>` +
    `<span class="ihud-sep">·</span>` +
    `<span class="ihud-val">${variant.name}</span>` +
    `<span class="ihud-keys">[/] biome &nbsp; ,/. variant &nbsp; r reroll</span>`;
}

const _flatHeight = () => 0;

export function setupInspect(scene, renderer, camera, controls) {
  camera.position.set(4.5, 2.8, 4.5);
  controls.target.set(0, 0.7, 0);
  controls.minDistance = 1.4;
  controls.maxDistance = 12;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
  controls.maxPolarAngle = Math.PI * 0.9;
  controls.update();

  state.heightFn = _flatHeight;

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
    if (e.key === "[") {
      _biomeIdx = (_biomeIdx - 1 + BIOMES.length) % BIOMES.length;
      spawnSpecimen(scene);
    } else if (e.key === "]") {
      _biomeIdx = (_biomeIdx + 1) % BIOMES.length;
      spawnSpecimen(scene);
    } else if (e.key === ",") {
      _variantIdx = (_variantIdx - 1 + VARIANTS.length) % VARIANTS.length;
      spawnSpecimen(scene);
    } else if (e.key === ".") {
      _variantIdx = (_variantIdx + 1) % VARIANTS.length;
      spawnSpecimen(scene);
    } else if (e.key === "r") {
      // Re-seed with a different offset so re-roll picks a different specimen
      const r = Math.random;
      Math.random = mulberry32(Date.now() & 0xffff);
      spawnSpecimen(scene);
      Math.random = r;
    }
  });

  spawnSpecimen(scene);
}

export function stepInspect(dt, t) {
  if (!_specimen) return;
  if (_specimenKind === "caterpillar") {
    stepCaterpillar(_specimen, dt, t, _flatHeight);
    // Caterpillars/snails move their segments in world coords (not via the
    // group transform), so they wander off the turntable. Clamp the head's
    // XZ to a small ring near origin — the body trail follows behind, which
    // produces a tidy "crawling in a small loop" pose for capture.
    const head = _specimen.segments?.[0];
    if (head) {
      const r = Math.sqrt(head.position.x ** 2 + head.position.z ** 2);
      const maxR = 0.7;
      if (r > maxR) {
        const s = maxR / r;
        head.position.x *= s;
        head.position.z *= s;
      }
    }
  } else {
    stepCreature(_specimen, dt, t, _flatHeight);
    // Keep the specimen pinned to the turntable center — internal animations
    // (idle bob, breathing, fin sway, walk cycle) still play, but the creature
    // doesn't wander off the disc.
    const g = _specimen.group;
    g.position.x = 0;
    g.position.z = 0;
  }
}
