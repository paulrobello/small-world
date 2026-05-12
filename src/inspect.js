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

// Parse URL params for deterministic recreation.
//   ?inspect=1                    — enter inspect mode (required)
//   &biome=<id>                   — biome id from BIOMES (default: first entry)
//   &variant=<name>               — walker | flier | sleeper | burrower | caterpillar | snail
//   &seed=<hex|int>               — specimen seed (default: derived from biome+variant)
//   &paused=1                     — start paused
function _findBiomeIdx(id) {
  if (!id) return 0;
  const i = BIOMES.findIndex((b) => b.id === id);
  return i >= 0 ? i : 0;
}
function _findVariantIdx(name) {
  if (!name) return 0;
  const i = VARIANTS.findIndex((v) => v.name === name);
  return i >= 0 ? i : 0;
}
function _parseSeed(raw) {
  if (raw == null) return null;
  const n = raw.startsWith("0x") ? parseInt(raw, 16) : parseInt(raw, 10);
  return Number.isFinite(n) ? (n >>> 0) : null;
}

let _biomeIdx = _findBiomeIdx(_params.get("biome"));
let _variantIdx = _findVariantIdx(_params.get("variant"));
// Explicit override; null means use the derived seed in spawnSpecimen.
let _seedOverride = _parseSeed(_params.get("seed"));
let _specimen = null;
let _specimenKind = "creature";
let _hudEl = null;
let _stage = null;
let _paused = _params.get("paused") === "1";
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
  sp.set("biome", BIOMES[_biomeIdx].id);
  sp.set("variant", VARIANTS[_variantIdx].name);
  const seed = _seedOverride ?? _derivedSeed();
  sp.set("seed", "0x" + seed.toString(16).padStart(4, "0"));
  if (_paused) sp.set("paused", "1");
  const next = window.location.pathname + "?" + sp.toString();
  if (next !== window.location.pathname + window.location.search) {
    window.history.replaceState(null, "", next);
  }
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
  // makes A/B comparison across reloads possible. An explicit seed param
  // (via reroll or URL) overrides the derived value.
  const seed = _seedOverride ?? _derivedSeed();
  const original = Math.random;
  Math.random = mulberry32(seed);
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
    c.trail.length = 0;
    const seedStep = 0.04;
    for (let i = 0; i < 250; i++) {
      c.trail.push({
        x: -Math.cos(c.heading) * i * seedStep,
        y: 0,
        z: -Math.sin(c.heading) * i * seedStep,
      });
    }
  } else {
    state.creatures.push(c);
    c.group.position.set(0, c.flies ? 1.2 : 0.45, 0);
    // Burrowers cycle through a hide-underground state machine, which makes
    // them disappear for 3-7s at a time. Pin them to the surface for inspect
    // so the small-and-cute burrower silhouette stays visible.
    if (c.isBurrower) {
      c.isBurrower = false;
      c.burrowState = "surface";
      c.burrowDepth = 0;
    }
  }
  scene.add(c.group);
  updateHud();
  _syncUrl();
}

function updateHud() {
  if (!_hudEl) return;
  const biome = BIOMES[_biomeIdx];
  const variant = VARIANTS[_variantIdx];
  const pauseTag = _paused ? `<span class="ihud-paused">PAUSED</span>` : "";
  _hudEl.innerHTML =
    `<span class="ihud-key">INSPECT</span>` +
    `<span class="ihud-val">${biome.name}</span>` +
    `<span class="ihud-sep">·</span>` +
    `<span class="ihud-val">${variant.name}</span>` +
    pauseTag +
    `<span class="ihud-keys">[/] biome &nbsp; ,/. variant &nbsp; r reroll &nbsp; space pause &nbsp; ←/→ step</span>`;
}

const _flatHeight = () => 0;

export function setupInspect(scene, renderer, camera, controls) {
  camera.position.set(1.7, 1.0, 1.7);
  controls.target.set(0, 0.35, 0);
  controls.minDistance = 0.8;
  controls.maxDistance = 6;
  controls.autoRotate = !_paused;
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
      _seedOverride = null; // new context — derive a fresh seed
      spawnSpecimen(scene);
    } else if (e.key === "]") {
      _biomeIdx = (_biomeIdx + 1) % BIOMES.length;
      _seedOverride = null;
      spawnSpecimen(scene);
    } else if (e.key === ",") {
      _variantIdx = (_variantIdx - 1 + VARIANTS.length) % VARIANTS.length;
      _seedOverride = null;
      spawnSpecimen(scene);
    } else if (e.key === ".") {
      _variantIdx = (_variantIdx + 1) % VARIANTS.length;
      _seedOverride = null;
      spawnSpecimen(scene);
    } else if (e.key === "r") {
      // Pick a fresh random seed and keep it so the URL stays reproducible
      _seedOverride = (Math.random() * 0x10000) | 0;
      spawnSpecimen(scene);
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
    }
  });

  spawnSpecimen(scene);
}

export function stepInspect(dt, t) {
  if (!_specimen) return;
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
    stepCaterpillar(_specimen, useDt, useT, _flatHeight);
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
