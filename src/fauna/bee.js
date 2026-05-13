import * as THREE from "three";
import { state } from "../state.js";
import { nearestCenter } from "../terrain.js";
import { WATER_AVOID_Y, pushOutOfObstacles } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// Bee swarms — small fast fliers that orbit a shared flower target.
// A "swarm" is a shared object { target, retargetAt }; each bee references
// it so they all migrate together when the swarm picks a new flower.
// ─────────────────────────────────────────────────────────────────────────────
export function makeSwarm() {
  return {
    target: new THREE.Vector3(),          // pre-allocated; values overwritten on retarget
    hasTarget: false,
    retargetIn: 0,                        // seconds remaining until we pick a new flower
    members: [],
  };
}

export function makeBee(swarm, biome) {
  const group = new THREE.Group();
  // tiny dark body (slightly smaller than a butterfly)
  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.035, 0),
    new THREE.MeshStandardMaterial({
      color: 0x141414,
      flatShading: true,
      roughness: 0.5,
    })
  );
  body.scale.set(0.85, 0.85, 1.6);
  body.castShadow = true;
  group.add(body);

  // a single yellow stripe band — small flat ring around the body
  const stripe = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.034, 0),
    new THREE.MeshStandardMaterial({
      color: 0xffd13b,
      flatShading: true,
      roughness: 0.45,
    })
  );
  stripe.scale.set(0.92, 0.92, 0.45);
  stripe.position.z = -0.005;
  group.add(stripe);

  // two tiny clear-ish wings — single pair, no fore/hind split
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.55,
    flatShading: true,
    roughness: 0.2,
    side: THREE.DoubleSide,
  });
  const wingGeo = new THREE.IcosahedronGeometry(0.07, 1);
  wingGeo.scale(1.0, 0.04, 0.55);
  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.02, 0.01);
    group.add(pivot);
    const w = new THREE.Mesh(wingGeo, wingMat);
    w.position.set(side * 0.06, 0, 0);
    pivot.add(w);
    wings.push({ pivot, side });
  }

  group.scale.setScalar(0.6);

  const bee = {
    group,
    body,
    wings,
    swarm,
    // per-bee personality so they don't all overlap on the same point
    orbitPhase: Math.random() * Math.PI * 2,
    orbitSpeed: 1.6 + Math.random() * 1.3,
    orbitRadius: 0.35 + Math.random() * 0.4,
    flapPhase: Math.random() * Math.PI * 2,
    flapSpeed: 55 + Math.random() * 18,
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * 1.5,
      (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 1.5
    ),
  };
  swarm.members.push(bee);
  return bee;
}

// Mutates swarm.target in place. Returns true when a flower was picked.
function pickBeeFlower(swarm, flowerSpots) {
  if (!flowerSpots.length) return false;
  const f = flowerSpots[Math.floor(Math.random() * flowerSpots.length)];
  swarm.target.set(f.x, f.y + 0.35, f.z);
  swarm.hasTarget = true;
  return true;
}

const _beeTarget = new THREE.Vector3();
const _beeOffset = new THREE.Vector3();

export function stepBee(b, dt, t, flowerSpots, heightFn) {
  // shared swarm target — countdown shared across the swarm, so it's only
  // decremented by the first bee each frame.
  if (b === b.swarm.members[0]) b.swarm.retargetIn -= dt;
  if (!b.swarm.hasTarget || b.swarm.retargetIn <= 0) {
    if (pickBeeFlower(b.swarm, flowerSpots)) {
      b.swarm.retargetIn = 4 + Math.random() * 5;
    }
  }

  const pos = b.group.position;
  const target = b.swarm.hasTarget ? b.swarm.target : null;

  // personal orbit offset — small circle in XZ around the shared target
  const op = b.orbitPhase + t * b.orbitSpeed;
  _beeOffset.set(
    Math.cos(op) * b.orbitRadius,
    Math.sin(op * 0.7) * 0.18,
    Math.sin(op) * b.orbitRadius
  );

  if (target) {
    _beeTarget.copy(target).add(_beeOffset);
    const dx = _beeTarget.x - pos.x;
    const dy = _beeTarget.y - pos.y;
    const dz = _beeTarget.z - pos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 0.001) {
      // tight pursuit — much harder than butterflies
      const accel = 8.0;
      b.velocity.x += (dx / d) * accel * dt;
      b.velocity.y += (dy / d) * accel * dt;
      b.velocity.z += (dz / d) * accel * dt;
    }
  }

  // small jitter so straight lines feel buzzy
  b.velocity.x += (Math.random() - 0.5) * 1.0 * dt;
  b.velocity.y += (Math.random() - 0.5) * 0.7 * dt;
  b.velocity.z += (Math.random() - 0.5) * 1.0 * dt;

  // damping (bees are tighter / less drifty than butterflies)
  const damp = Math.pow(0.7, dt * 60);
  b.velocity.x *= damp;
  b.velocity.y *= damp;
  b.velocity.z *= damp;

  // cap speed — faster top end than butterflies
  const sp = b.velocity.length();
  const maxSp = 4.5;
  if (sp > maxSp) b.velocity.multiplyScalar(maxSp / sp);

  pos.x += b.velocity.x * dt;
  pos.y += b.velocity.y * dt;
  pos.z += b.velocity.z * dt;

  const ground = heightFn(pos.x, pos.z);
  const overWater = state.waterMesh && ground < WATER_AVOID_Y;
  const minY = overWater ? 0.5 : ground + 0.18;
  if (pos.y < minY) {
    pos.y = minY;
    if (b.velocity.y < 0) b.velocity.y = 0.3;
  }
  if (overWater) {
    const near = nearestCenter(pos.x, pos.z);
    const dx = near.cx - pos.x;
    const dz = near.cz - pos.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    b.velocity.x += (dx / d) * 4.0 * dt;
    b.velocity.z += (dz / d) * 4.0 * dt;
  }

  pushOutOfObstacles(pos, b.velocity, 0.1);

  // orient — same trick as butterflies: lookAt(pos + velocity)
  if (b.velocity.lengthSq() > 0.05) {
    _beeTarget.copy(pos).add(b.velocity);
    b.group.lookAt(_beeTarget);
  }

  // very fast wing buzz
  for (const w of b.wings) {
    const f = Math.sin(t * b.flapSpeed + b.flapPhase);
    w.pivot.rotation.z = w.side * (0.5 + f * 0.85);
  }
}
