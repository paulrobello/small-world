import * as THREE from "three";
import { state } from "../state.js";
import { WATER_AVOID_Y, pushOutOfObstacles, applyWaterFloorAndSteer } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// Butterflies — small bright fliers that flutter between flowers
// ─────────────────────────────────────────────────────────────────────────────
export function makeButterfly(palette, biome) {
  const group = new THREE.Group();

  const c1 = palette[Math.floor(Math.random() * palette.length)];
  let c2 = palette[Math.floor(Math.random() * palette.length)];
  if (palette.length > 1 && c2 === c1)
    c2 = palette[(palette.indexOf(c1) + 1) % palette.length];

  // tiny dark body
  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.04, 0),
    new THREE.MeshStandardMaterial({
      color: 0x1a1a22,
      flatShading: true,
      roughness: 0.5,
    })
  );
  body.scale.set(0.7, 0.7, 1.8);
  body.castShadow = true;
  group.add(body);

  // wing materials — two-tone (front + back wing pairs)
  const wingMat1 = new THREE.MeshStandardMaterial({
    color: new THREE.Color(c1),
    flatShading: true,
    roughness: 0.45,
    side: THREE.DoubleSide,
  });
  const wingMat2 = new THREE.MeshStandardMaterial({
    color: new THREE.Color(c2),
    flatShading: true,
    roughness: 0.45,
    side: THREE.DoubleSide,
  });

  const frontGeo = new THREE.IcosahedronGeometry(0.13, 1);
  frontGeo.scale(1.0, 0.05, 1.25);
  const backGeo = new THREE.IcosahedronGeometry(0.09, 1);
  backGeo.scale(1.0, 0.05, 1.0);

  const wings = [];
  // front (forewing) pair — larger, on the +Z (motion-forward) side
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.01, 0.04);
    group.add(pivot);
    const w = new THREE.Mesh(frontGeo, wingMat1);
    w.position.set(side * 0.15, 0, 0.04);
    w.castShadow = true;
    pivot.add(w);
    wings.push({ pivot, side, isBack: false });
  }
  // back (hindwing) pair — smaller, on the -Z (trailing) side
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.005, -0.04);
    group.add(pivot);
    const w = new THREE.Mesh(backGeo, wingMat2);
    w.position.set(side * 0.10, 0, -0.05);
    w.castShadow = true;
    pivot.add(w);
    wings.push({ pivot, side, isBack: true });
  }

  // 25% smaller overall (then another 25% smaller per user request)
  group.scale.setScalar(0.5625);

  return {
    group,
    wings,
    target: new THREE.Vector3(),
    hasTarget: false,
    state: "cruising", // "cruising" → flying to flower, "hovering" → near it
    holdUntil: 0,
    velocity: new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 0.5,
      (Math.random() - 0.5) * 2
    ),
    flapPhase: Math.random() * Math.PI * 2,
    flapSpeed: 28 + Math.random() * 18,
    wobblePhase: Math.random() * Math.PI * 2,
    wobbleSpeed: 4.5 + Math.random() * 3,
  };
}

// Mutates b.target in place — pre-allocated to avoid per-retarget Vector3 churn.
function pickFlower(b, flowerSpots) {
  if (!flowerSpots.length) {
    b.hasTarget = false;
    return;
  }
  const f = flowerSpots[Math.floor(Math.random() * flowerSpots.length)];
  b.target.set(f.x, f.y + 0.22, f.z);
  b.hasTarget = true;
}

const _bflyTarget = new THREE.Vector3();
export function stepButterfly(b, dt, t, flowerSpots, heightFn) {
  const pos = b.group.position;

  // state machine — pick flower → fly → hover → pick another
  if (b.state === "hovering" && t > b.holdUntil) {
    b.state = "cruising";
    pickFlower(b, flowerSpots);
  }
  if (b.state === "cruising" && !b.hasTarget) {
    pickFlower(b, flowerSpots);
  }
  if (b.state === "cruising" && b.hasTarget) {
    const dx = pos.x - b.target.x;
    const dy = pos.y - b.target.y;
    const dz = pos.z - b.target.z;
    if (dx * dx + dy * dy + dz * dz < 0.05) {
      b.state = "hovering";
      b.holdUntil = t + 1.2 + Math.random() * 2.5;
    }
  }

  // steer toward target
  if (b.hasTarget) {
    const dx = b.target.x - pos.x;
    const dy = b.target.y - pos.y;
    const dz = b.target.z - pos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 0.001) {
      const accel = b.state === "hovering" ? 1.0 : 4.0;
      b.velocity.x += (dx / d) * accel * dt;
      b.velocity.y += (dy / d) * accel * dt;
      b.velocity.z += (dz / d) * accel * dt;
    }
  }

  // erratic wobble — what makes butterflies look like butterflies
  const wt = b.wobblePhase + t * b.wobbleSpeed;
  b.velocity.x += Math.sin(wt * 1.7) * 1.4 * dt;
  b.velocity.y += Math.cos(wt * 2.3) * 1.8 * dt;
  b.velocity.z += Math.cos(wt * 1.3) * 1.4 * dt;

  // damping
  const damp = Math.pow(0.78, dt * 60);
  b.velocity.x *= damp;
  b.velocity.y *= damp;
  b.velocity.z *= damp;

  // cap speed (slower when hovering)
  const sp = b.velocity.length();
  const maxSp = b.state === "hovering" ? 1.4 : 3.0;
  if (sp > maxSp) b.velocity.multiplyScalar(maxSp / sp);

  pos.x += b.velocity.x * dt;
  pos.y += b.velocity.y * dt;
  pos.z += b.velocity.z * dt;

  // Water + terrain floor — over water, stay clear of the waves; over
  // land, stay just above the grass blades. Also steer back toward the
  // nearest island center when we've drifted out over open water so we
  // don't just hover above the surface forever.
  const ground = heightFn(pos.x, pos.z);
  applyWaterFloorAndSteer(pos, b.velocity, ground, {
    minLandY: 0.12,
    minWaterY: 0.45,
    steerStrength: 3.2,
    bounceVy: 0.2,
  }, dt);

  // Route around trunks below the canopy.
  pushOutOfObstacles(pos, b.velocity, 0.12);

  // orient toward velocity — Object3D.lookAt() points local +Z at the target,
  // so the larger forewing pair (placed at +Z) leads the direction of motion.
  if (b.velocity.lengthSq() > 0.08) {
    _bflyTarget.copy(pos).add(b.velocity);
    b.group.lookAt(_bflyTarget);
  }

  // fast wing flap; back pair lags slightly behind the front
  for (const w of b.wings) {
    const phaseOff = w.isBack ? 0.35 : 0;
    const f = Math.sin(t * b.flapSpeed + b.flapPhase + phaseOff);
    w.pivot.rotation.z = w.side * (0.35 + f * 0.95);
  }
}
