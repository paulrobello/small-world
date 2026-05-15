import * as THREE from "three";
import { state } from "../state.js";
import { BLOOM_LAYER } from "../postfx.js";

const WISP_GEO = new THREE.SphereGeometry(0.04, 8, 6);
const WISP_COLOR = new THREE.Color("#ffc36b");
const SPARKLE_GEO = new THREE.SphereGeometry(0.012, 4, 4);
const TRAIL_MAX = 14;
const TRAIL_LIFE = 0.9;
const LIGHT_RANGE = 3.0;
const LIGHT_INTENSITY = 1.2;

// ── sparkle pool ──
// Pre-allocated ring-buffer of meshes parented to state.world so they stay
// at the world-space trail position after the wisp moves on.  Each sparkle
// gets its own material clone for independent opacity fading.
function makeSparklePool() {
  const pool = [];
  for (let i = 0; i < TRAIL_MAX; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: WISP_COLOR,
      emissive: WISP_COLOR.clone().multiplyScalar(1.3),
      emissiveIntensity: 0.9,
      flatShading: true,
      roughness: 0.4,
      transparent: true,
      opacity: 0.8,
    });
    const sp = new THREE.Mesh(SPARKLE_GEO, mat);
    sp.visible = false;
    sp.layers.enable(BLOOM_LAYER);
    state.world.add(sp);
    pool.push(sp);
  }
  return pool;
}

// ── factory ──
export function makeWillOWisp(homeX, homeY, homeZ, wanderRadius) {
  const group = new THREE.Group();
  group.position.set(homeX, homeY + 0.3, homeZ);

  // Glowing orb mesh
  const mat = new THREE.MeshStandardMaterial({
    color: WISP_COLOR,
    emissive: WISP_COLOR.clone().multiplyScalar(1.5),
    emissiveIntensity: 1.2,
    flatShading: true,
    roughness: 0.3,
    transparent: true,
    opacity: 0.92,
  });
  const orb = new THREE.Mesh(WISP_GEO, mat);
  orb.layers.enable(BLOOM_LAYER);
  group.add(orb);

  // Point light
  const light = new THREE.PointLight(WISP_COLOR, LIGHT_INTENSITY, LIGHT_RANGE, 1.8);
  light.position.set(0, 0, 0);
  group.add(light);

  const sparkles = makeSparklePool();

  const seed = Math.random() * 1000;
  const speed = 0.25 + Math.random() * 0.2;
  const startY = homeY + 0.3 + Math.random() * 0.4;
  const dartAngle = Math.random() * Math.PI * 2;

  return {
    group,
    orb,
    light,
    sparkles,
    homeX,
    homeY,
    homeZ,
    wanderRadius,
    seed,
    speed,
    targetX: homeX,
    targetY: startY,
    targetZ: homeZ,
    trailIdx: 0,
    trailTimer: 0,
    prevX: homeX,
    prevY: homeY + 0.3,
    prevZ: homeZ,
    // Dart state
    darting: false,
    dartTimer: 2 + Math.random() * 4, // countdown to next dart
    dartTime: 0,    // elapsed time in current dart
    dartDur: 0,     // duration of current dart
    dartNx: 0,
    dartNy: 0,
    dartNz: 0,
  };
}

// ── per-frame step ──
export function stepWillOWisp(w, dt, t, heightFn) {
  const { group, homeX, homeY, homeZ, wanderRadius, seed, speed, sparkles } = w;
  const pos = group.position;

  // ── dart logic ──
  const dartSpeed = speed * 5;
  if (w.darting) {
    w.dartTime += dt;
    if (w.dartTime >= w.dartDur) {
      w.darting = false;
      w.dartTimer = 2 + Math.random() * 5;
    }
  } else {
    w.dartTimer -= dt;
    if (w.dartTimer <= 0) {
      // Start a dart in a random direction
      const angle = Math.random() * Math.PI * 2;
      const pitch = (Math.random() - 0.3) * 0.6; // slight upward bias
      w.dartNx = Math.cos(angle) * Math.cos(pitch);
      w.dartNy = Math.sin(pitch);
      w.dartNz = Math.sin(angle) * Math.cos(pitch);
      w.dartDur = 0.8 + Math.random() * 0.6;
      w.dartTime = 0;
      w.darting = true;
    }
  }

  // ── movement ──
  if (w.darting) {
    const step = dartSpeed * dt;
    pos.x += w.dartNx * step;
    pos.y += w.dartNy * step;
    pos.z += w.dartNz * step;
  } else {
    // Normal wander toward target
    const dx = w.targetX - pos.x;
    const dy = w.targetY - pos.y;
    const dz = w.targetZ - pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist < 0.08) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * wanderRadius;
      w.targetX = homeX + Math.cos(angle) * r;
      w.targetZ = homeZ + Math.sin(angle) * r;
      w.targetY = homeY + 0.15 + Math.random() * wanderRadius * 2;
    }

    const step = speed * dt;
    const inv = step / (dist || 1);
    pos.x += dx * inv;
    pos.y += dy * inv;
    pos.z += dz * inv;
  }

  // Gentle bob
  pos.y += Math.sin(t * 2.0 + seed) * 0.003;

  // Stay above terrain
  const groundY = heightFn(pos.x, pos.z);
  if (pos.y < groundY + 0.15) pos.y = groundY + 0.15;

  // Glow pulse — brighter during dart
  const basePulse = 1.0 + Math.sin(t * 3.0 + seed * 1.5) * 0.15;
  w.light.intensity = LIGHT_INTENSITY * basePulse * (w.darting ? 1.6 : 1.0);

  // ── sparkle trail (only while moving) ──
  const mvDx = pos.x - w.prevX;
  const mvDz = pos.z - w.prevZ;
  const moved = Math.sqrt(mvDx * mvDx + mvDz * mvDz);
  w.trailTimer += dt;

  if (moved > 0.004 && w.trailTimer > 0.055) {
    w.trailTimer = 0;
    w.prevX = pos.x;
    w.prevY = pos.y;
    w.prevZ = pos.z;

    const sp = sparkles[w.trailIdx % TRAIL_MAX];
    // World-space position (sparkles are children of state.world)
    sp.position.set(
      pos.x + (Math.random() - 0.5) * 0.04,
      pos.y + (Math.random() - 0.5) * 0.04,
      pos.z + (Math.random() - 0.5) * 0.04,
    );
    sp.visible = true;
    sp.material.opacity = 0.7;
    sp.scale.setScalar(1.0);
    sp.userData.born = t;
    w.trailIdx++;
  }

  // Fade & shrink old sparkles
  for (const sp of sparkles) {
    if (!sp.visible) continue;
    const age = t - (sp.userData.born ?? 0);
    if (age > TRAIL_LIFE) {
      sp.visible = false;
      continue;
    }
    const frac = age / TRAIL_LIFE;
    sp.material.opacity = 0.7 * (1.0 - frac);
    sp.scale.setScalar(1.0 - frac * 0.6);
  }
}
