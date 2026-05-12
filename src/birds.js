import * as THREE from "three";
import { state } from "./state.js";
import { jitterGeo } from "./util.js";

// ─────────────────────────────────────────────────────────────────────────────
// Birds — small bodies + flapping wings, flocking with boid behaviour
// ─────────────────────────────────────────────────────────────────────────────
export function makeBird(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });

  // body — elongated along Z; lookAt() makes -Z the forward direction
  const bodyGeo = jitterGeo(new THREE.IcosahedronGeometry(0.1, 0), 0.015);
  bodyGeo.scale(0.85, 0.78, 2.0);
  const body = new THREE.Mesh(bodyGeo, mat);
  body.castShadow = true;
  group.add(body);

  // shared wing geometry — flat ellipsoid centred at origin
  const wingGeo = new THREE.IcosahedronGeometry(0.12, 0);
  wingGeo.scale(2.2, 0.06, 1.2);

  const wings = [];
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.025, 0);
    group.add(pivot);

    const w = new THREE.Mesh(wingGeo, mat);
    w.position.x = side * 0.16;
    w.castShadow = true;
    pivot.add(w);
    wings.push(pivot);
  }

  return {
    group,
    body,
    wings,
    velocity: new THREE.Vector3(),
    flapPhase: Math.random() * Math.PI * 2,
    flapSpeed: 22 + Math.random() * 10,
  };
}

export function pickBirdColor(biome) {
  const r = Math.random();
  if (r < 0.5) return new THREE.Color(0x1a1a22);
  if (r < 0.8) return new THREE.Color(biome.accent);
  return new THREE.Color(biome.sun).offsetHSL(0, 0, -0.25);
}

export function makeFlock(biome) {
  const size = 5 + Math.floor(Math.random() * 5); // 5–9
  const color = pickBirdColor(biome);
  const birds = [];

  const cx = (Math.random() - 0.5) * state.ISLAND_SIZE * 0.5;
  const cz = (Math.random() - 0.5) * state.ISLAND_SIZE * 0.5;
  const altitude = 7 + Math.random() * 5;

  const dir = Math.random() * Math.PI * 2;
  const initVel = new THREE.Vector3(Math.cos(dir), 0, Math.sin(dir))
    .multiplyScalar(2.5);

  for (let i = 0; i < size; i++) {
    const b = makeBird(color);
    b.group.position.set(
      cx + (Math.random() - 0.5) * 3,
      altitude + (Math.random() - 0.5) * 1.5,
      cz + (Math.random() - 0.5) * 3
    );
    b.velocity.copy(initVel).add(
      new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5
      ).multiplyScalar(0.4)
    );
    birds.push(b);
  }

  return {
    birds,
    waypoint: new THREE.Vector3(cx, altitude, cz),
    waypointTimer: 0,
    altitude,
  };
}

const _flockTarget = new THREE.Vector3();
export function stepFlock(flock, dt, t) {
  flock.waypointTimer -= dt;
  if (flock.waypointTimer <= 0) {
    flock.waypoint.set(
      (Math.random() - 0.5) * state.ISLAND_SIZE * 0.7,
      flock.altitude + (Math.random() - 0.5) * 2.5,
      (Math.random() - 0.5) * state.ISLAND_SIZE * 0.7
    );
    flock.waypointTimer = 4 + Math.random() * 4;
  }

  const birds = flock.birds;
  const N = birds.length;

  // boid weights — tuned for tight but loose-looking flocks
  const PERCEPTION = 4.5;
  const SEP_RADIUS = 1.4;
  const MAX_SPEED  = 4.5;
  const MIN_SPEED  = 2.0;
  const W_ALIGN = 1.4;
  const W_COH   = 0.9;
  const W_SEP   = 2.6;
  const W_WAY   = 0.5;

  for (let i = 0; i < N; i++) {
    const b = birds[i];
    const pos = b.group.position;
    let ax = 0, ay = 0, az = 0;
    let cx = 0, cy = 0, cz = 0;
    let sx = 0, sy = 0, sz = 0;
    let nN = 0, nS = 0;

    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const o = birds[j];
      const dx = o.group.position.x - pos.x;
      const dy = o.group.position.y - pos.y;
      const dz = o.group.position.z - pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;

      if (d2 < PERCEPTION * PERCEPTION) {
        ax += o.velocity.x; ay += o.velocity.y; az += o.velocity.z;
        cx += o.group.position.x;
        cy += o.group.position.y;
        cz += o.group.position.z;
        nN++;
      }
      if (d2 < SEP_RADIUS * SEP_RADIUS && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        sx -= dx / d; sy -= dy / d; sz -= dz / d;
        nS++;
      }
    }

    let fx = 0, fy = 0, fz = 0;
    if (nN > 0) {
      fx += (ax / nN) * W_ALIGN;
      fy += (ay / nN) * W_ALIGN;
      fz += (az / nN) * W_ALIGN;
      fx += (cx / nN - pos.x) * W_COH;
      fy += (cy / nN - pos.y) * W_COH;
      fz += (cz / nN - pos.z) * W_COH;
    }
    if (nS > 0) {
      fx += sx * W_SEP; fy += sy * W_SEP; fz += sz * W_SEP;
    }
    fx += (flock.waypoint.x - pos.x) * 0.06 * W_WAY;
    fy += (flock.waypoint.y - pos.y) * 0.15 * W_WAY;
    fz += (flock.waypoint.z - pos.z) * 0.06 * W_WAY;

    // soft boundary — gently pull back toward the island when too far
    const r2 = pos.x * pos.x + pos.z * pos.z;
    if (r2 > state.ISLAND_RADIUS * state.ISLAND_RADIUS * 1.4) {
      fx -= pos.x * 0.4;
      fz -= pos.z * 0.4;
    }

    b.velocity.x += fx * dt;
    b.velocity.y += fy * dt;
    b.velocity.z += fz * dt;

    const sp = b.velocity.length();
    if (sp > MAX_SPEED) b.velocity.multiplyScalar(MAX_SPEED / sp);
    else if (sp < MIN_SPEED && sp > 1e-4)
      b.velocity.multiplyScalar(MIN_SPEED / sp);

    pos.x += b.velocity.x * dt;
    pos.y += b.velocity.y * dt;
    pos.z += b.velocity.z * dt;

    // Ground avoidance — keep birds well clear of the terrain. heightFn drops
    // to large negatives in the void beyond the islands, so we also clamp to
    // an absolute minimum altitude so flocks can't dive off the edge into the
    // abyss and visually disappear.
    const groundY = state.heightFn(pos.x, pos.z);
    const floor = Math.max(groundY + 2.5, 3.5);
    if (pos.y < floor) {
      pos.y = floor;
      if (b.velocity.y < 0) b.velocity.y *= -0.25;
      // nudge upward so they don't graze the ground next frame either
      b.velocity.y += 1.2 * dt;
    }

    _flockTarget.copy(pos).add(b.velocity);
    b.group.lookAt(_flockTarget);

    // flap — left/right wings mirrored
    const flapRate = b.flapSpeed + sp * 1.5;
    const flap = Math.sin(t * flapRate + b.flapPhase);
    b.wings[0].rotation.z = -flap * 0.85 + 0.15;
    b.wings[1].rotation.z =  flap * 0.85 - 0.15;
  }
}
