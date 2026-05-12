import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { state } from "./src/state.js";
import { readSeedFromUrl, newRandomSeed } from "./src/seed.js";
import {
  generateWorld,
  updateDayNight,
  setSceneRef,
  setControlsRef,
} from "./src/world.js";
import { stepCreature, stepCaterpillar, stepButterfly, stepBee } from "./src/fauna.js";
import { stepFlock } from "./src/birds.js";
import { stepParticles, stepWater, stepDirtPuffs } from "./src/environment.js";
import {
  initUi,
  getFollowTarget,
  setFollowTarget,
  isStrolling,
  stepStroll,
  isPhotoMode,
} from "./src/ui.js";

// ─────────────────────────────────────────────────────────────────────────────
// Renderer / scene / camera
// ─────────────────────────────────────────────────────────────────────────────
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
  // Lets us grab the canvas pixels via toDataURL after a render — needed
  // for photo-mode capture. Negligible perf cost for this scene.
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.add(state.world);

const camera = new THREE.PerspectiveCamera(
  38,
  window.innerWidth / window.innerHeight,
  0.1,
  400
);
camera.position.set(26, 19, 26);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.22;
controls.minDistance = 14;
controls.maxDistance = 55;
controls.maxPolarAngle = Math.PI / 2.15;
controls.minPolarAngle = Math.PI / 6;
controls.target.set(0, 1.5, 0);
// touch gestures: one finger rotates, two-finger pinch dollies (no pan)
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_ROTATE,
};

setSceneRef(scene);
setControlsRef(controls);

// ─────────────────────────────────────────────────────────────────────────────
// Animation loop
// ─────────────────────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const rawDt = Math.min(clock.getDelta(), 0.05);
  const rawT = clock.elapsedTime;
  // Photo mode freezes the simulation so users can capture a still frame.
  // We hold dt at 0 AND freeze `t` (step funcs use sin(t*speed) for idle
  // bobbing, which would still drift if t kept advancing). Camera input
  // and rendering keep running on the frozen state.
  const paused = isPhotoMode();
  if (!paused) state.lastSimT = rawT;
  const dt = paused ? 0 : rawDt;
  const t = paused ? (state.lastSimT ?? rawT) : rawT;

  if (!paused) {
    // shared wind shader time
    state.windUniforms.uTime.value = t;
    updateDayNight(t);
  }

  for (const c of state.creatures) stepCreature(c, dt, t, state.heightFn);
  for (const c of state.caterpillars) stepCaterpillar(c, dt, t, state.heightFn);
  for (const b of state.butterflies)
    stepButterfly(b, dt, t, state.flowerSpots, state.heightFn);
  for (const b of state.bees)
    stepBee(b, dt, t, state.flowerSpots, state.heightFn);
  for (const f of state.flocks) stepFlock(f, dt, t);
  stepParticles(state.particles, dt, t);
  stepWater(state.waterMesh, dt, t);
  stepDirtPuffs(state.dirtPuffs, dt);

  if (isStrolling()) {
    stepStroll(dt);
  } else {
    // Smoothly track a followed creature, if any.
    const ft = getFollowTarget();
    if (ft && ft.group && ft.group.parent) {
      const p = ft.group.position;
      const k = Math.min(1, dt * 4);
      controls.target.x += (p.x - controls.target.x) * k;
      controls.target.y += (p.y + 0.6 - controls.target.y) * k;
      controls.target.z += (p.z - controls.target.z) * k;
    } else if (ft) {
      setFollowTarget(null);
    }
    controls.update();
  }
  renderer.render(scene, camera);
}

initUi({ camera, canvas, controls, renderer });

// kickoff — honour ?seed=XXXX in the URL if present
const initialSeed = readSeedFromUrl() ?? newRandomSeed();
generateWorld(initialSeed);
animate();
