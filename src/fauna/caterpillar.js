import * as THREE from "three";
import { state } from "../state.js";
import { jitterGeo } from "../util.js";
import { pickGroundPoint, nearestCenter } from "../terrain.js";
import { emitGroundMark } from "../environment.js";
import { applyShellFur } from "../fur.js";
import { buildCatalogSubject } from "../catalog.js";
import { WATER_AVOID_Y, avoidObstacles, sampleSlopes, addAntennae, wrapAngle } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// Caterpillar — head + 3-8 body spheres, body segments follow head's trail
// ─────────────────────────────────────────────────────────────────────────────
const TRAIL_RETENTION_PADDING = 1.0;
const TRAIL_MIN_POINT_DISTANCE = 1e-6;
const CRAWLER_TRAIL_TARGET_SPEED = 0.85;

// ── Ring buffer trail ──────────────────────────────────────────────────────
// Pre-allocated ring buffer to avoid per-frame array unshift/trim overhead.
// Points are stored in a fixed-size Float32Array; arc lengths are cumulative
// from head (index 0). Head is at index 0, tail at index len-1.
const RING_INITIAL_CAP = 512;

function makeRingTrail(initialPoints) {
  const cap = Math.max(RING_INITIAL_CAP, initialPoints.length * 2);
  const buf = new Float32Array(cap * 3); // x, y, z per point
  const arc = new Float32Array(cap);     // cumulative arc length from head
  for (let i = 0; i < initialPoints.length; i++) {
    const p = initialPoints[i];
    const off = i * 3;
    buf[off] = p.x; buf[off + 1] = p.y ?? 0; buf[off + 2] = p.z;
  }
  // Compute initial arc lengths (head is index 0, arc[0] = 0)
  arc[0] = 0;
  for (let i = 1; i < initialPoints.length; i++) {
    const prev = (i - 1) * 3;
    const cur = i * 3;
    const dx = buf[cur] - buf[prev];
    const dy = buf[cur + 1] - buf[prev + 1];
    const dz = buf[cur + 2] - buf[prev + 2];
    arc[i] = arc[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return {
    buf,
    arc,
    cap,
    len: initialPoints.length,  // number of valid entries (head at 0)
  };
}

// Get point at logical index i (0 = head, len-1 = tail).
function ringGet(tr, i) {
  const off = i * 3;
  return { x: tr.buf[off], y: tr.buf[off + 1], z: tr.buf[off + 2] };
}

// Push a new head point. Returns true if pushed, false if duplicate (updated in-place).
function ringPushHead(tr, x, y, z) {
  // Check duplicate
  if (tr.len > 0) {
    const dx = x - tr.buf[0];
    const dz = z - tr.buf[2];
    if (dx * dx + dz * dz < TRAIL_MIN_POINT_DISTANCE * TRAIL_MIN_POINT_DISTANCE) {
      tr.buf[1] = y; // update Y in-place
      return false;
    }
  }
  // Grow if needed
  if (tr.len >= tr.cap) {
    const newCap = tr.cap * 2;
    const newBuf = new Float32Array(newCap * 3);
    const newArc = new Float32Array(newCap);
    // Shift existing data right by one slot (new head at index 0)
    newBuf.set(tr.buf, 3);
    newArc.set(tr.arc, 1);
    tr.buf = newBuf;
    tr.arc = newArc;
    tr.cap = newCap;
  } else if (tr.len > 0) {
    tr.buf.copyWithin(3, 0, tr.len * 3);
    tr.arc.copyWithin(1, 0, tr.len);
  }
  // Write new head at index 0
  tr.buf[0] = x; tr.buf[1] = y; tr.buf[2] = z;
  tr.arc[0] = 0;
  // Rebuild arc[1] = distance from new head to old head (now at index 1)
  if (tr.len > 0) {
    const dx = x - tr.buf[3];
    const dy = y - tr.buf[4];
    const dz = z - tr.buf[5];
    const newSeg = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // Shift all subsequent arc values by the new segment length
    for (let i = 1; i <= tr.len; i++) {
      tr.arc[i] += newSeg;
    }
  }
  tr.len++;
  return true;
}

// Trim tail beyond maxDistance from head.
function ringTrimByDistance(tr, maxDistance) {
  if (tr.len < 2) return;
  // arc[i] is cumulative from head; keep everything within maxDistance + 1
  // extra point for interpolation.
  for (let i = tr.len - 2; i >= 0; i--) {
    if (tr.arc[i] > maxDistance) {
      tr.len = i + 2;
      return;
    }
  }
}

// Find the point at a given arc-length distance from the head.
// Uses binary search on the arc array.
function ringFindAt(tr, distance) {
  if (tr.len === 0) return null;
  if (distance <= 0) return { x: tr.buf[0], y: tr.buf[1], z: tr.buf[2] };
  if (tr.arc[tr.len - 1] <= distance) {
    return ringGet(tr, tr.len - 1);
  }
  // Binary search for the segment
  let lo = 0, hi = tr.len - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (tr.arc[mid] <= distance) lo = mid;
    else hi = mid;
  }
  const segLen = tr.arc[hi] - tr.arc[lo];
  const u = segLen > 1e-4 ? (distance - tr.arc[lo]) / segLen : 0;
  const pOff = lo * 3;
  const cOff = hi * 3;
  return {
    x: tr.buf[pOff] + (tr.buf[cOff] - tr.buf[pOff]) * u,
    z: tr.buf[pOff + 2] + (tr.buf[cOff + 2] - tr.buf[pOff + 2]) * u,
  };
}

// opts.kind: undefined | "snail". Snails are slow, have fewer segments,
// and a fat shell parented to the last body segment.
export { makeRingTrail };

export function makeCaterpillar(biome, opts = {}) {
  const isSnail = opts.kind === "snail";
  const group = new THREE.Group();
  group.userData.inspect = {
    category: "creature",
    variant: isSnail ? "snail" : "caterpillar",
  };
  group.userData.catalog = buildCatalogSubject({
    category: group.userData.inspect.category,
    variant: group.userData.inspect.variant,
    biomeId: biome.id,
  });
  const palette = biome.creatureColors;
  const baseCol = opts.color instanceof THREE.Color
    ? opts.color.clone()
    : new THREE.Color(palette[Math.floor(Math.random() * palette.length)]);
  const altCol = baseCol.clone().offsetHSL(0, 0.05, 0.12);

  const segments = [];
  const segCount = isSnail ? 2 : 3 + Math.floor(Math.random() * 6); // snails: short body
  // uniform radius for head + every body segment — keeps them touching
  const segRadius = isSnail ? 0.24 : 0.28;

  // Roll fur before geometry so detail level can depend on it.
  // Snails never get fur; caterpillars roll against biome.furProbability.
  const furProb = biome.furProbability ?? 0;
  const furRoll = furProb > 0 ? Math.random() : 1;
  const wantsFur = !isSnail && (opts.furry ?? (furProb > 0 && furRoll < furProb));
  // Furless creatures get +1 detail so the smoother surface reads clearly.
  const segDetail = wantsFur ? 1 : 2;

  // ── head ───────────────────────────────────────────────────────────────
  const headGeo = jitterGeo(
    new THREE.IcosahedronGeometry(segRadius, segDetail),
    0.05
  );
  const headMat = new THREE.MeshStandardMaterial({
    name: isSnail ? "snail.head.mat.smooth" : "caterpillar.head.mat.smooth",
    color: baseCol,
    roughness: 0.55,
    metalness: 0.02,
  });
  const head = new THREE.Mesh(headGeo, headMat);
  head.castShadow = true;
  // YXZ resolves pitch/roll in the body frame after yaw — so the head can
  // tilt to match slopes (see stepCaterpillar) without yaw + pitch tangling
  // into roll along the heading axis. Default XYZ order would tilt around
  // world-X regardless of which way the head was facing.
  head.rotation.order = "YXZ";
  group.add(head);
  segments.push(head);

  // eyes — same recipe as blob creatures
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xfafaf2,
    roughness: 0.15,
  });
  const pupilMat = new THREE.MeshStandardMaterial({
    color: 0x0a0a0a,
    roughness: 0.05,
  });
  const eyeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const pupilGeo = new THREE.SphereGeometry(0.04, 8, 8);
  // Eye depth follows segRadius so the eye sits inside the head sphere
  // and only the pupil protrudes — the old hardcoded z=0.24 was sized for
  // caterpillars (segRadius 0.28) and put snail eyes (segRadius 0.24) right
  // at the head's surface, floating out in front.
  const eyeZ = segRadius - 0.05;
  const pupilZ = segRadius + 0.04;
  const eyeParts = [];
  for (const sign of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(sign * 0.13, 0.12, eyeZ);
    head.add(eye);
    eyeParts.push(eye);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(sign * 0.13, 0.12, pupilZ);
    head.add(pupil);
    eyeParts.push(pupil);
  }

  // antennae always for caterpillars — feels right
  addAntennae(head, biome, baseCol, {
    stalkHeight: 0.22,
    offsetX: 0.09,
    baseY: 0.28,
    baseZ: 0.05,
    tiltAngle: 0.3,
    tipRadius: 0.04,
    colorDarken: 0.25,
    emissiveStrength: 0.4,
    tipGlow: !isSnail || biome.snailAntennaGlow !== false,
  });

  // ── body segments — all the same radius as the head ──────────────────
  for (let i = 0; i < segCount; i++) {
    const segGeo = jitterGeo(
      new THREE.IcosahedronGeometry(segRadius, segDetail),
      segRadius * 0.14
    );
    const mat = new THREE.MeshStandardMaterial({
      name: isSnail ? "snail.segment.mat.smooth" : "caterpillar.segment.mat.smooth",
      color: i % 2 === 0 ? altCol : baseCol,
      roughness: 0.6,
    });
    const seg = new THREE.Mesh(segGeo, mat);
    seg.castShadow = true;
    // Body segments are visually spherical, but snails carry a shell parented
    // to the rear segment. Yaw the segment along the sampled trail tangent so
    // the shell stays behind the head instead of sliding sideways through turns.
    seg.rotation.order = "YXZ";
    group.add(seg);
    segments.push(seg);
  }

  const scale = isSnail ? 0.85 + Math.random() * 0.25 : 0.7 + Math.random() * 0.4;
  for (const s of segments) s.scale.setScalar(scale);

  // snail shell — a fat, slightly squashed icosphere parented to the
  // last body segment, in a contrasting color so it reads as a shell.
  if (isSnail) {
    const shellCol = baseCol.clone().offsetHSL(0.08, -0.05, -0.18);
    const shellGeo = jitterGeo(new THREE.IcosahedronGeometry(segRadius * 1.7, segDetail), 0.04);
    shellGeo.scale(1.0, 0.95, 0.9);
    const shell = new THREE.Mesh(
      shellGeo,
      new THREE.MeshStandardMaterial({
        name: "snail.shell.mat.smooth",
        color: shellCol,
        roughness: 0.45,
        metalness: 0.05,
      })
    );
    // sit on top of the back segment, slightly forward
    shell.position.set(0, segRadius * 0.55, segRadius * 0.1);
    shell.castShadow = true;
    // a couple of darker "ridges" — small thin rings around the equator
    const ridgeMat = new THREE.MeshStandardMaterial({
      name: "snail.ridge.mat.smooth",
      color: shellCol.clone().offsetHSL(0, 0, -0.18),
    });
    for (let r = 0; r < 2; r++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(segRadius * 1.25 - r * 0.07, 0.015, 6, 16),
        ridgeMat
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.04 + r * 0.07;
      shell.add(ring);
    }
    segments[segments.length - 1].add(shell);
  }

  // initial placement — anywhere on solid ground (avoid water in water biomes).
  // Require a real dry margin, not just heightFn >= 0 — a spot at the very
  // boundary (heightFn ≈ 0) is surrounded by water on most sides and the
  // snail will fail to find a forward step before its wet-escape kicks in.
  let sp = pickGroundPoint(0.55);
  if (state.waterMesh && state.heightFn) {
    const DRY_MARGIN = 0.3;
    for (let tries = 0; tries < 20; tries++) {
      if (state.heightFn(sp.x, sp.z) >= WATER_AVOID_Y + DRY_MARGIN) break;
      sp = pickGroundPoint(0.55);
    }
  }
  const startX = sp.x;
  const startZ = sp.z;
  const startHeading = Math.random() * Math.PI * 2;
  // tighter than 2r — icospheres at exactly 2r touch only at corners, so
  // their flat faces leave a visible gap. Overlap noticeably so segments
  // stay touching even on steep terrain.
  const segSpacing = 1.15 * segRadius * scale;

  // pre-seed the trail behind the head so segments aren't stacked at frame 0
  const seedPoints = [];
  const seedStep = 0.04;
  for (let i = 0; i < 250; i++) {
    seedPoints.push({
      x: startX - Math.cos(startHeading) * i * seedStep,
      y: 0,
      z: startZ - Math.sin(startHeading) * i * seedStep,
    });
  }
  const trail = makeRingTrail(seedPoints);

  head.position.set(startX, 0, startZ);

  // Fur — applied per segment so head and body each get their own shell stack.
  // Per-caterpillar roll against biome.furProbability (0 if missing); can be
  // forced via opts.furry. Snails are excluded (a furry snail shell reads as
  // a hairy rock, not as a snail). wantsFur was already rolled above to set
  // the segment detail level.
  let furShells = null;
  if (wantsFur) {
    furShells = [];
    // Length scaled to segment radius (creatures use 0.072 on radius 0.42,
    // ~17% — match that ratio here).
    const furLen = segRadius * 0.17;
    for (const seg of segments) {
      const segCol = seg.material.color.clone();
      const shells = applyShellFur(seg, biome, {
        baseColor: segCol,
        tipColor: segCol.clone().offsetHSL(0, -0.05, 0.10),
        length: furLen,
      });
      if (shells) furShells.push(...shells);
    }
  }
  group.userData.inspect.fur = furShells ? "1" : "0";
  group.userData.inspect.color = baseCol.getHexString();

  return {
    type: isSnail ? "snail" : "caterpillar",
    group,
    segments,
    eyeParts,
    segRadius,
    trail,
    segSpacing,
    trailMaxDistance: segments.length * segSpacing + TRAIL_RETENTION_PADDING,
    scale,
    heading: startHeading,
    headingTarget: startHeading,
    lastGroundMarkX: startX,
    lastGroundMarkZ: startZ,
    lastGroundSampleX: startX,
    lastGroundSampleZ: startZ,
    groundMarkDistance: 0,
    // rad/s the heading can slew toward headingTarget. Snails turn a bit
    // more leisurely than caterpillars; both are fast enough that edge
    // avoidance (which sets target every frame while over the buffer)
    // doesn't let them stray past the island.
    turnRate: isSnail ? 2.0 : 3.0,
    speed: isSnail ? 0.12 + Math.random() * 0.08 : 0.5 + Math.random() * 0.3,
    nextThink: Math.random() * 2.5,
    age: Math.random() * 100,
    furShells,
  };
}

function emitCrawlerGroundMark(c, x, z, heading, heightFn) {
  const marks = state.groundMarks;
  const cfg = state.currentBiome?.groundMarks;
  if (!marks || !cfg) return;

  const dx = x - c.lastGroundSampleX;
  const dz = z - c.lastGroundSampleZ;
  const moved = Math.sqrt(dx * dx + dz * dz);
  c.groundMarkDistance += moved;
  c.lastGroundSampleX = x;
  c.lastGroundSampleZ = z;
  const isSnail = c.type === "snail";
  const interval = (isSnail ? 0.16 : 0.20) * c.scale;
  if (c.groundMarkDistance < interval) return;

  const y = heightFn(x, z);
  if (state.waterMesh && y < WATER_AVOID_Y) return;
  c.groundMarkDistance = 0;

  // Crawlers move slower than walkers. Scale mark life inversely with speed so
  // the visible trail covers a comparable world distance to footprint paths.
  const crawlerTrailLifeScale = Math.min(
    7.0,
    Math.max(1.0, CRAWLER_TRAIL_TARGET_SPEED / Math.max(0.01, c.speed))
  );

  emitGroundMark(marks, {
    x,
    z,
    fromX: c.lastGroundMarkX,
    fromZ: c.lastGroundMarkZ,
    heading,
    width: (isSnail ? 0.34 : 0.22) * c.scale,
    length: (isSnail ? 0.46 : 0.36) * c.scale,
    opacity: cfg.opacity * (isSnail ? 0.82 : 0.66),
    life: cfg.life * crawlerTrailLifeScale,
  });

  c.lastGroundMarkX = x;
  c.lastGroundMarkZ = z;
}

export function stepCaterpillar(c, dt, t, heightFn) {
  // Photo mode passes dt=0 to freeze the sim. Returning early matters here
  // because the trail is unshifted unconditionally below — without this, the
  // 300-entry trail would fill with duplicate copies of the (now-stationary)
  // head position frame after frame, and body segments sampling that trail
  // would all slide into the head as the older real trail points fall off.
  if (dt <= 0) return;
  c.age += dt;
  c.nextThink -= dt;
  if (c.nextThink <= 0) {
    // Random thinks aim a *target* heading; c.heading then slews toward it
    // at c.turnRate (rad/s) so the head doesn't whip-snap before the body
    // catches up. Movement, slope sampling, and visual yaw all read the
    // smoothed c.heading, so they stay consistent through the turn.
    c.headingTarget = c.heading + (Math.random() - 0.5) * 0.9;
    c.nextThink = 1.4 + Math.random() * 2.5;
  }

  // Slew heading toward headingTarget via shortest-angle diff.
  const dHead = wrapAngle(c.headingTarget - c.heading);
  const maxTurn = c.turnRate * dt;
  c.heading +=
    Math.abs(dHead) <= maxTurn ? dHead : Math.sign(dHead) * maxTurn;

  const head = c.segments[0];
  const step = c.speed * dt;
  let nx = head.position.x + Math.cos(c.heading) * step;
  let nz = head.position.z + Math.sin(c.heading) * step;

  // edge avoidance — stay on the island plateau, turn back before reaching
  // the sloped rim. Water handling is delegated entirely to the post-slide
  // probe below; retargeting heading here on every wetAhead frame caused
  // the slew to run at max indefinitely (visible as a shaking head while
  // the body collapses around it).
  const near = nearestCenter(nx, nz);
  const ndx = nx - near.cx;
  const ndz = nz - near.cz;
  if (Math.sqrt(ndx * ndx + ndz * ndz) > near.radius * 0.94) {
    c.headingTarget =
      Math.atan2(near.cz - head.position.z, near.cx - head.position.x) +
      (Math.random() - 0.5) * 0.4;
  }

  // Obstacle avoidance — small radius since caterpillars are skinny. Static
  // flora should make the head turn in place, not tangent-slide the whole
  // trail sideways; pass `c` as selfOwner so the head doesn't try to avoid its
  // own body segments (every segment of this caterpillar is registered in
  // dynamicObstacles with the same owner ref).
  const slide = avoidObstacles(
    head.position.x,
    head.position.z,
    nx,
    nz,
    c.heading,
    step,
    0.18 * c.scale,
    undefined,
    undefined,
    undefined,
    c,
    { staticResponse: "turn" }
  );
  if (slide) {
    nx = slide.nx;
    nz = slide.nz;
    // Retarget only; the normal heading slew below keeps obstacle course
    // corrections from whip-snapping the head before the body catches up.
    c.headingTarget = slide.heading;
  }

  // Post-slide water guard. Probe a fan of escape angles starting from
  // the current heading; use the first one whose forward step lands on
  // dry ground. Position advances at the safe angle (so the snail
  // physically moves along the shoreline), but only the slew *target*
  // is updated — c.heading itself catches up gradually, so we don't
  // whip the head around every frame. If no probe is dry, freeze
  // without disturbing heading so segments don't collapse onto a
  // shaking head.
  if (state.waterMesh && heightFn(nx, nz) < WATER_AVOID_Y) {
    const probes = [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.55, -1.55, 2.0, -2.0, 2.6];
    let foundAngle = null;
    let foundNx = 0, foundNz = 0;
    for (const off of probes) {
      const h = c.heading + off;
      const tx = head.position.x + Math.cos(h) * step;
      const tz = head.position.z + Math.sin(h) * step;
      if (heightFn(tx, tz) >= WATER_AVOID_Y) {
        foundAngle = h;
        foundNx = tx;
        foundNz = tz;
        break;
      }
    }
    if (foundAngle != null) {
      c.headingTarget = foundAngle;
      nx = foundNx;
      nz = foundNz;
    } else {
      // Truly stuck — freeze position AND park the slew target on the
      // current heading so the head doesn't keep spinning while the body
      // is pinned. Body trail won't advance, segments stay coherent.
      c.headingTarget = c.heading;
      nx = head.position.x;
      nz = head.position.z;
    }
  }

  // all segments — including the head — sit at the same base offset so
  // adjacent spheres at segSpacing = 2*radius actually touch.
  const baseOffset = c.segRadius * 0.7 * c.scale;
  const headY = heightFn(nx, nz) + baseOffset;
  head.position.set(nx, headY, nz);
  head.rotation.y = -c.heading + Math.PI / 2;
  emitCrawlerGroundMark(c, nx, nz, c.heading, heightFn);

  // Terrain tilt — same slope-sampling shape walkers use in stepCreature.
  // Sample heightFn along heading (forward/back) and perpendicular to it
  // (right/left), derive slope gradients, and ease pitch (rotation.x) and
  // roll (rotation.z) toward angles that lay the head flat against the
  // hillside. The idle nodding bob is folded into the pitch target so it
  // adds on top of the slope rather than overwriting it.
  const ds = 0.25 * c.scale;
  const slopes = sampleSlopes(nx, nz, c.heading, ds, heightFn);
  const nod = Math.sin(c.age * 4) * 0.06;
  const pitchTarget = slopes.pitchTarget + nod;
  const rollTarget = slopes.rollTarget;
  const k = Math.min(1, dt * 5);
  head.rotation.x += (pitchTarget - head.rotation.x) * k;
  head.rotation.z += (rollTarget - head.rotation.z) * k;

  // record path (3D so 3D-arclength following stays accurate on slopes).
  // Retain by arc length, not frame count: slow crawlers at high FPS produce
  // dense samples, and a fixed point cap can cover less distance than the tail
  // needs, collapsing multiple rear segments onto the oldest point.
  ringPushHead(c.trail, nx, headY, nz);
  ringTrimByDistance(c.trail, c.trailMaxDistance);

  // body segments sample the trail at fixed arc-length offsets
  for (let i = 1; i < c.segments.length; i++) {
    const seg = c.segments[i];
    const d = i * c.segSpacing;
    const pt = ringFindAt(c.trail, d);
    if (!pt) continue;
    const groundY = heightFn(pt.x, pt.z);
    // subtle wave along the body — small enough that they stay touching
    const bob = Math.sin(c.age * 3.5 - i * 0.7) * 0.03 * c.scale;
    seg.position.set(pt.x, groundY + baseOffset + bob, pt.z);

    const frontPt = ringFindAt(c.trail, Math.max(0, d - c.segSpacing * 0.5));
    const backPt = ringFindAt(c.trail, d + c.segSpacing * 0.5);
    if (frontPt && backPt) {
      const bodyHeading = Math.atan2(frontPt.z - backPt.z, frontPt.x - backPt.x);
      seg.rotation.y = -bodyHeading + Math.PI / 2;
    }
    seg.rotation.z = Math.sin(c.age * 2 - i * 0.5) * 0.06;
  }
}
