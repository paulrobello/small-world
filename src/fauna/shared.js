import { state } from "../state.js";

// Terrain Y below which ground creatures are considered underwater. The water
// plane sits a touch below 0 and oscillates ~±0.08; clamping walkers to
// ground above 0 keeps them clear of waves and out of the shallow draft.
export const WATER_AVOID_Y = 0.0;

// Color similarity test for the herding check. Cheap RGB distance — fine for
// the small biome palettes used here.
export function colorsClose(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db < 0.04;
}

// Combined obstacle avoidance for grounded movers (walkers + caterpillars).
//
// Static phase (state.obstacles — trunks, mushrooms): tangent-slide. If the
// candidate step penetrates an obstacle, projects motion onto the perimeter
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
    for (let i = 0; i < obs.length; i++) {
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
      if (ox * ox + oz * oz >= minD * minD) continue;
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
      const sx = px + tx * step;
      const sz = pz + tz * step;
      let wedged = false;
      for (let j = 0; j < obs.length; j++) {
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
      const tangentHeading = Math.atan2(tz, tx);
      result = wedged
        ? { nx: px, nz: pz, heading: Math.atan2(nrz, nrx) + (Math.random() - 0.5) * 0.5 }
        : staticResponse === "turn"
          ? { nx: px, nz: pz, heading: tangentHeading }
          : { nx: sx, nz: sz, heading: tangentHeading };
      break;
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
