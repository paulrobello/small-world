import * as THREE from "three";
import { state } from "../state.js";
import { BLOOM_LAYER } from "../postfx.js";
import { nearestCenter } from "../terrain.js";

// Terrain Y below which ground creatures are considered underwater. The water
// plane sits a touch below 0 and oscillates ~±0.08; clamping walkers to
// ground above 0 keeps them clear of waves and out of the shallow draft.
export const WATER_AVOID_Y = 0.0;

// ── Terrain helpers ──────────────────────────────────────────────────────
// Shared terrain sampling utilities used by walkers, crawlers, and burrowers.

/**
 * Sample terrain normal at (x, z) via central finite differences.
 * Returns a unit Vector3.
 */
export function sampleTerrainNormal(x, z, heightFn, eps = 0.1) {
  const yl = heightFn(x - eps, z);
  const yr = heightFn(x + eps, z);
  const yf = heightFn(x, z - eps);
  const yb = heightFn(x, z + eps);
  return new THREE.Vector3(yl - yr, 2 * eps, yf - yb).normalize();
}

const SLOPE_LIMIT = 2;
const clampSlope = (v) => Math.max(-SLOPE_LIMIT, Math.min(SLOPE_LIMIT, v));

/**
 * Convert cached world-space terrain gradients into heading-local pitch/roll.
 */
export function slopeTargetsFromGradient(gradientX, gradientZ, heading) {
  const ch = Math.cos(heading);
  const sh = Math.sin(heading);
  const slopeFwd = ch * gradientX + sh * gradientZ;
  const slopeRight = sh * gradientX - ch * gradientZ;
  return {
    pitchTarget: -Math.atan(clampSlope(slopeFwd)),
    rollTarget: Math.atan(clampSlope(slopeRight)),
    slopeFwd,
    slopeRight,
  };
}

/**
 * Sample terrain slope along heading and perpendicular to it.
 * Returns { pitchTarget, rollTarget, slopeFwd, slopeRight } for use
 * with group.rotation.x (pitch) and group.rotation.z (roll).
 * World-space gradients are included for callers that cache slopes across
 * heading changes.
 */
export function sampleSlopes(x, z, heading, ds, heightFn) {
  const ch = Math.cos(heading);
  const sh = Math.sin(heading);
  const yF = heightFn(x + ch * ds, z + sh * ds);
  const yB = heightFn(x - ch * ds, z - sh * ds);
  const yR = heightFn(x + sh * ds, z - ch * ds);
  const yL = heightFn(x - sh * ds, z + ch * ds);
  const slopeFwd = (yF - yB) / (2 * ds);
  const slopeRight = (yR - yL) / (2 * ds);
  const gradientX = ch * slopeFwd + sh * slopeRight;
  const gradientZ = sh * slopeFwd - ch * slopeRight;
  return {
    ...slopeTargetsFromGradient(gradientX, gradientZ, heading),
    gradientX,
    gradientZ,
  };
}

/**
 * Create a pair of antennae (stalk + emissive tip) parented to `parent`.
 * Used by both blob creatures and caterpillars. Returns the stalk meshes
 * (for sleep/wake scale animation in blob creatures).
 */
export function addAntennae(parent, biome, bodyColor, opts = {}) {
  const {
    stalkRadius = 0.012,
    stalkHeight = 0.32,
    offsetX = 0.1,
    baseY = 0.36,
    baseZ = 0.1,
    tiltAngle = 0.25,
    forwardTiltAngle = 0,
    tipRadius = 0.04,
    colorDarken = 0.2,
    emissiveStrength = 0.35,
  } = opts;
  const antMat = new THREE.MeshStandardMaterial({
    color: bodyColor.clone().offsetHSL(0, 0, -colorDarken),
  });
  const stalks = [];
  for (const sign of [-1, 1]) {
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(stalkRadius, stalkRadius, stalkHeight, 4),
      antMat
    );
    stalk.position.set(sign * offsetX, baseY, baseZ);
    stalk.rotation.x = forwardTiltAngle;
    stalk.rotation.z = sign * -tiltAngle;
    parent.add(stalk);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(tipRadius, 6, 6),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.accent),
        emissive: new THREE.Color(biome.accent).multiplyScalar(emissiveStrength),
      })
    );
    tip.layers.enable(BLOOM_LAYER);
    tip.position.set(0, stalkHeight / 2, 0);
    stalk.add(tip);
    stalks.push(stalk);
  }
  return stalks;
}

// ── Spatial grid for static obstacle queries ──────────────────────────────
// Built once per world-gen via buildObstacleGrid(). avoidObstacles() queries
// the grid instead of scanning the full obstacle list, reducing the inner
// loop from O(all obstacles) to O(nearby obstacles).
const GRID_CELL = 2.0;
let _grid = null;       // Map<string, number[]>  — cell key → obstacle indices
let _gridObs = null;    // reference to the obstacles array the grid was built from

function cellKey(cx, cz) { return cx + ',' + cz; }

export function buildObstacleGrid(obstacles) {
  _gridObs = obstacles;
  _grid = new Map();
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const r = o.r || 0.5;
    const minCX = Math.floor((o.x - r) / GRID_CELL);
    const maxCX = Math.floor((o.x + r) / GRID_CELL);
    const minCZ = Math.floor((o.z - r) / GRID_CELL);
    const maxCZ = Math.floor((o.z + r) / GRID_CELL);
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cz = minCZ; cz <= maxCZ; cz++) {
        const k = cellKey(cx, cz);
        let bucket = _grid.get(k);
        if (!bucket) { bucket = []; _grid.set(k, bucket); }
        bucket.push(i);
      }
    }
  }
}

// Return obstacle indices whose bounding cell overlaps the query disc.
function nearbyObstacleIndices(x, z, radius) {
  if (!_grid || !_gridObs) return null; // fallback — no grid built
  const minCX = Math.floor((x - radius) / GRID_CELL);
  const maxCX = Math.floor((x + radius) / GRID_CELL);
  const minCZ = Math.floor((z - radius) / GRID_CELL);
  const maxCZ = Math.floor((z + radius) / GRID_CELL);
  const out = [];
  const seen = new Set();
  for (let cx = minCX; cx <= maxCX; cx++) {
    for (let cz = minCZ; cz <= maxCZ; cz++) {
      const bucket = _grid.get(cellKey(cx, cz));
      if (!bucket) continue;
      for (let j = 0; j < bucket.length; j++) {
        const idx = bucket[j];
        if (seen.has(idx)) continue;
        seen.add(idx);
        out.push(idx);
      }
    }
  }
  return out;
}

// Color similarity test for the herding check. Cheap RGB distance — fine for
// the small biome palettes used here.
export function colorsClose(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db < 0.04;
}

const STATIC_AVOID_LOOKAHEAD = 1.25;
const STATIC_AVOID_MAX_TURN = 0.22;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smoothstep01 = (v) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
const wrapAngle = (a) =>
  ((a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

// Combined obstacle avoidance for grounded movers (walkers + caterpillars).
//
// Static phase (state.obstacles — trunks, mushrooms): a smooth approach
// buffer starts bending heading before contact. If the candidate step still
// penetrates an obstacle, tangent-slide projects motion onto the perimeter
// tangent that best matches the current heading. If the slid candidate is
// itself wedged into another obstacle, the mover stays put with a heading
// pointing outward. Result of this phase becomes the "current candidate"
// position fed to the dynamic phase.
//
// Dynamic phase (state.dynamicObstacles — other movers): soft separation.
// Any overlap with another mover applies a small radial push to the
// candidate position, keeping heading intact. This reads as a gentle nudge
// — far less twitchy than a hard tangent snap, which is important for the
// project vibe (cute, easeful motion). selfOwner is matched against each
// dyn entry's `owner` so a caterpillar's segments don't collide with each
// other and a walker doesn't push itself.
//
// Returns null when both phases pass cleanly — caller commits the straight
// step. opts.staticResponse controls static flora hits: "slide" preserves the
// walker/flier tangent-slide behavior; "turn" only retargets heading and keeps
// the current position for crawlers whose body should follow a head-led path.
export function avoidObstacles(
  px, pz, nx, nz, heading, step, cr, y, skipX, skipZ, selfOwner, opts
) {
  const staticResponse = opts?.staticResponse ?? "slide";
  let result = null;
  const obs = state.obstacles;
  if (obs && obs.length > 0) {
    const skipping = skipX !== undefined && skipZ !== undefined;
    // Use spatial grid to narrow the candidate set.
    const candidates = nearbyObstacleIndices(nx, nz, cr + 2) || obs.map((_, i) => i);
    let proactive = null;
    for (let ci = 0; ci < candidates.length; ci++) {
      const i = candidates[ci];
      const o = obs[i];
      // Skip the specific obstacle we're trying to land on (the perch's
      // mushroom). Without this, a flier descending toward its own perch
      // would get pushed away by the cap's collision disc.
      if (skipping && Math.abs(o.x - skipX) < 0.4 && Math.abs(o.z - skipZ) < 0.4) continue;
      // Height filter — fliers above the canopy can pass over freely.
      if (y !== undefined && o.top !== undefined && y > o.top + 0.15) continue;
      const ox = nx - o.x;
      const oz = nz - o.z;
      const minD = o.r + cr;
      const rx = px - o.x;
      const rz = pz - o.z;
      const rlen = Math.sqrt(rx * rx + rz * rz) || 1;
      const nrx = rx / rlen;
      const nrz = rz / rlen;
      let tx = -nrz;
      let tz = nrx;
      if (tx * Math.cos(heading) + tz * Math.sin(heading) < 0) {
        tx = nrz;
        tz = -nrx;
      }
      const tangentHeading = Math.atan2(tz, tx);
      const d2 = ox * ox + oz * oz;
      if (d2 >= minD * minD) {
        const ahead = (o.x - px) * Math.cos(heading) + (o.z - pz) * Math.sin(heading);
        const influenceD = minD + STATIC_AVOID_LOOKAHEAD;
        if (ahead <= 0 || d2 >= influenceD * influenceD) continue;
        const d = Math.sqrt(d2);
        const strength = smoothstep01((influenceD - d) / (influenceD - minD));
        const turn = wrapAngle(tangentHeading - heading);
        const turnLimit = STATIC_AVOID_MAX_TURN * strength;
        const steer = Math.max(-turnLimit, Math.min(turnLimit, turn));
        if (Math.abs(steer) < 0.001) continue;
        const candidate = {
          nx,
          nz,
          heading: heading + steer,
          strength,
        };
        if (!proactive || candidate.strength > proactive.strength) proactive = candidate;
        continue;
      }
      const sx = px + tx * step;
      const sz = pz + tz * step;
      let wedged = false;
      // Use spatial grid for wedge check too.
      const wedgeCandidates = nearbyObstacleIndices(sx, sz, cr + 2) || obs.map((_, j) => j);
      for (let wj = 0; wj < wedgeCandidates.length; wj++) {
        const j = wedgeCandidates[wj];
        if (j === i) continue;
        const o2 = obs[j];
        if (skipping && Math.abs(o2.x - skipX) < 0.4 && Math.abs(o2.z - skipZ) < 0.4) continue;
        if (y !== undefined && o2.top !== undefined && y > o2.top + 0.15) continue;
        const dx2 = sx - o2.x;
        const dz2 = sz - o2.z;
        const md = o2.r + cr;
        if (dx2 * dx2 + dz2 * dz2 < md * md) {
          wedged = true;
          break;
        }
      }
      // If the current position is already inside this obstacle's clearance
      // ring, the normal crawler "turn" freeze would trap it forever. Walk it
      // outward until it reaches the ring again.
      const pxInsideClearance = rx * rx + rz * rz < minD * minD;
      result = wedged
        ? { nx: px, nz: pz, heading: Math.atan2(nrz, nrx) + (Math.random() - 0.5) * 0.5 }
        : staticResponse === "turn"
          ? pxInsideClearance
            ? { nx: px + nrx * step, nz: pz + nrz * step, heading: Math.atan2(nrz, nrx) }
            : { nx: px, nz: pz, heading: tangentHeading }
          : { nx: sx, nz: sz, heading: tangentHeading };
      break;
    }
    if (!result && proactive) {
      result = { nx: proactive.nx, nz: proactive.nz, heading: proactive.heading };
    }
  }

  // Dynamic soft separation against other movers. Applies on top of the
  // static result (or the straight candidate when no static collision).
  const dyn = state.dynamicObstacles;
  if (dyn && dyn.length > 0) {
    let cnx = result ? result.nx : nx;
    let cnz = result ? result.nz : nz;
    const curHeading = result ? result.heading : heading;
    let pushed = false;
    // PUSH < 1.0 means each frame only resolves part of the overlap, which
    // smears the correction across a few frames and keeps the motion soft
    // instead of snapping. Multiple overlaps accumulate naturally.
    const PUSH = 0.5;
    for (let i = 0; i < dyn.length; i++) {
      const o = dyn[i];
      if (selfOwner && o.owner === selfOwner) continue;
      if (y !== undefined && o.top !== undefined && y > o.top + 0.15) continue;
      const ox = cnx - o.x;
      const oz = cnz - o.z;
      const minD = o.r + cr;
      const d2 = ox * ox + oz * oz;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2) || 0.001;
      const overlap = minD - d;
      cnx += (ox / d) * overlap * PUSH;
      cnz += (oz / d) * overlap * PUSH;
      pushed = true;
    }
    if (pushed) return { nx: cnx, nz: cnz, heading: curHeading };
  }

  return result;
}

// Velocity-based obstacle push for fliers that steer via velocity rather
// than heading (butterflies, bees). Mutates pos + vel in place: nudges the
// position outside any trunk it has entered, and damps the velocity
// component pointing into the trunk so it glances off instead of stalling.
export function pushOutOfObstacles(pos, vel, bodyR) {
  const obs = state.obstacles;
  if (!obs || obs.length === 0) return;
  // Use spatial grid for O(nearby) lookups.
  const candidates = nearbyObstacleIndices(pos.x, pos.z, bodyR + 2);
  if (candidates) {
    for (let ci = 0; ci < candidates.length; ci++) {
      const o = obs[candidates[ci]];
      if (o.top !== undefined && pos.y > o.top + 0.15) continue;
      const dx = pos.x - o.x;
      const dz = pos.z - o.z;
      const minD = o.r + bodyR;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2) || 0.001;
      const nx = dx / d;
      const nz = dz / d;
      pos.x = o.x + nx * minD;
      pos.z = o.z + nz * minD;
      const vn = vel.x * nx + vel.z * nz;
      if (vn < 0) {
        vel.x -= vn * nx * 1.6;
        vel.z -= vn * nz * 1.6;
      }
    }
  } else {
    // Fallback — no grid built
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o.top !== undefined && pos.y > o.top + 0.15) continue;
      const dx = pos.x - o.x;
      const dz = pos.z - o.z;
      const minD = o.r + bodyR;
      const d2 = dx * dx + dz * dz;
      if (d2 >= minD * minD) continue;
      const d = Math.sqrt(d2) || 0.001;
      const nx = dx / d;
      const nz = dz / d;
      pos.x = o.x + nx * minD;
      pos.z = o.z + nz * minD;
      const vn = vel.x * nx + vel.z * nz;
      if (vn < 0) {
        vel.x -= vn * nx * 1.6;
        vel.z -= vn * nz * 1.6;
      }
    }
  }
}

// ── Water floor and steering for flying insects ────────────────────────────
// Butterflies and bees both need: (1) a minimum altitude above ground/water,
// and (2) a drift-correcting steer back toward the nearest island center
// when flying over open water. Centralized here to avoid duplicating the
// same logic in both step functions.

/**
 * Enforce a minimum Y floor for a flying insect and steer toward the
 * nearest island center if over open water. Mutates `pos` and `vel` in place.
 *
 * @param {Object} pos - position Vector3 (mutated)
 * @param {Object} vel - velocity Vector3 (mutated)
 * @param {number} ground - heightFn(pos.x, pos.z)
 * @param {number} minLandY - Y offset above terrain when over land
 * @param {number} minWaterY - Y offset above terrain when over water
 * @param {number} steerStrength - acceleration toward island center
 * @param {number} bounceVy - upward velocity when hitting the floor
 * @param {number} dt
 */
export function applyWaterFloorAndSteer(pos, vel, ground, opts, dt) {
  const {
    minLandY = 0.12,
    minWaterY = 0.45,
    steerStrength = 3.2,
    bounceVy = 0.2,
  } = opts;
  const overWater = state.waterMesh && ground < WATER_AVOID_Y;
  const minY = overWater ? minWaterY : ground + minLandY;
  if (pos.y < minY) {
    pos.y = minY;
    if (vel.y < 0) vel.y = bounceVy;
  }
  if (overWater) {
    const near = nearestCenter(pos.x, pos.z);
    const dx = near.cx - pos.x;
    const dz = near.cz - pos.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    vel.x += (dx / d) * steerStrength * dt;
    vel.z += (dz / d) * steerStrength * dt;
  }
}
