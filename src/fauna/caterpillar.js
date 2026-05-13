import * as THREE from "three";
import { state } from "../state.js";
import { jitterGeo } from "../util.js";
import { pickGroundPoint, nearestCenter } from "../terrain.js";
import { applyShellFur } from "../fur.js";
import { BLOOM_LAYER } from "../postfx.js";
import { WATER_AVOID_Y, avoidObstacles } from "./shared.js";

// ─────────────────────────────────────────────────────────────────────────────
// Caterpillar — head + 3-6 body spheres, body segments follow head's trail
// ─────────────────────────────────────────────────────────────────────────────
function findTrailPointAt(trail, distance) {
  if (trail.length === 0) return null;
  if (trail.length === 1) return trail[0];
  let acc = 0;
  let prev = trail[0];
  for (let i = 1; i < trail.length; i++) {
    const cur = trail[i];
    const dx = cur.x - prev.x;
    const dy = (cur.y ?? 0) - (prev.y ?? 0);
    const dz = cur.z - prev.z;
    // 3D arc-length so segments stay tight on sloped terrain
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (acc + d >= distance) {
      const u = d > 1e-4 ? (distance - acc) / d : 0;
      return {
        x: prev.x + dx * u,
        z: prev.z + dz * u,
      };
    }
    acc += d;
    prev = cur;
  }
  return prev;
}

// opts.kind: undefined | "snail". Snails are slow, have fewer segments,
// and a fat shell parented to the last body segment.
export function makeCaterpillar(biome, opts = {}) {
  const isSnail = opts.kind === "snail";
  const group = new THREE.Group();
  const palette = biome.creatureColors;
  const baseCol = new THREE.Color(
    palette[Math.floor(Math.random() * palette.length)]
  );
  const altCol = baseCol.clone().offsetHSL(0, 0.05, 0.12);

  const segments = [];
  const segCount = isSnail ? 2 : 3 + Math.floor(Math.random() * 4); // snails: short body
  // uniform radius for head + every body segment — keeps them touching
  const segRadius = isSnail ? 0.24 : 0.28;

  // ── head ───────────────────────────────────────────────────────────────
  const headGeo = jitterGeo(
    new THREE.IcosahedronGeometry(segRadius, 0),
    0.05
  );
  const headMat = new THREE.MeshStandardMaterial({
    color: baseCol,
    flatShading: true,
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
  for (const sign of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(sign * 0.13, 0.12, eyeZ);
    head.add(eye);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(sign * 0.13, 0.12, pupilZ);
    head.add(pupil);
  }

  // antennae always for caterpillars — feels right
  const antMat = new THREE.MeshStandardMaterial({
    color: baseCol.clone().offsetHSL(0, 0, -0.25),
  });
  for (const sign of [-1, 1]) {
    const stalk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.22, 4),
      antMat
    );
    stalk.position.set(sign * 0.09, 0.28, 0.05);
    stalk.rotation.z = sign * -0.3;
    head.add(stalk);
    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 6, 6),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.accent),
        emissive: new THREE.Color(biome.accent).multiplyScalar(0.4),
      })
    );
    tip.layers.enable(BLOOM_LAYER);
    tip.position.set(0, 0.11, 0);
    stalk.add(tip);
  }

  // ── body segments — all the same radius as the head ──────────────────
  for (let i = 0; i < segCount; i++) {
    const segGeo = jitterGeo(
      new THREE.IcosahedronGeometry(segRadius, 0),
      segRadius * 0.14
    );
    const mat = new THREE.MeshStandardMaterial({
      color: i % 2 === 0 ? altCol : baseCol,
      flatShading: true,
      roughness: 0.6,
    });
    const seg = new THREE.Mesh(segGeo, mat);
    seg.castShadow = true;
    group.add(seg);
    segments.push(seg);
  }

  const scale = isSnail ? 0.85 + Math.random() * 0.25 : 0.7 + Math.random() * 0.4;
  for (const s of segments) s.scale.setScalar(scale);

  // snail shell — a fat, slightly squashed icosphere parented to the
  // last body segment, in a contrasting color so it reads as a shell.
  if (isSnail) {
    const shellCol = baseCol.clone().offsetHSL(0.08, -0.05, -0.18);
    const shellGeo = jitterGeo(new THREE.IcosahedronGeometry(segRadius * 1.7, 1), 0.04);
    shellGeo.scale(1.0, 0.95, 0.9);
    const shell = new THREE.Mesh(
      shellGeo,
      new THREE.MeshStandardMaterial({
        color: shellCol,
        flatShading: true,
        roughness: 0.45,
        metalness: 0.05,
      })
    );
    // sit on top of the back segment, slightly forward
    shell.position.set(0, segRadius * 0.55, segRadius * 0.1);
    shell.castShadow = true;
    // a couple of darker "ridges" — small thin rings around the equator
    const ridgeMat = new THREE.MeshStandardMaterial({
      color: shellCol.clone().offsetHSL(0, 0, -0.18),
      flatShading: true,
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

  // initial placement — anywhere on solid ground (avoid water in water biomes)
  let sp = pickGroundPoint(0.55);
  if (state.waterMesh && state.heightFn) {
    for (let tries = 0; tries < 15; tries++) {
      if (state.heightFn(sp.x, sp.z) >= WATER_AVOID_Y) break;
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
  const trail = [];
  const seedStep = 0.04;
  for (let i = 0; i < 250; i++) {
    trail.push({
      x: startX - Math.cos(startHeading) * i * seedStep,
      y: 0,
      z: startZ - Math.sin(startHeading) * i * seedStep,
    });
  }

  head.position.set(startX, 0, startZ);

  // Fur — applied per segment so head and body each get their own shell stack.
  // Per-caterpillar roll against biome.furProbability (0 if missing); can be
  // forced via opts.furry. Snails are excluded (a furry snail shell reads as
  // a hairy rock, not as a snail).
  let furShells = null;
  const furProb = biome.furProbability ?? 0;
  if (!isSnail && (opts.furry ?? (furProb > 0 && Math.random() < furProb))) {
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

  return {
    type: isSnail ? "snail" : "caterpillar",
    group,
    segments,
    segRadius,
    trail,
    segSpacing,
    scale,
    heading: startHeading,
    speed: isSnail ? 0.12 + Math.random() * 0.08 : 0.5 + Math.random() * 0.3,
    nextThink: Math.random() * 2.5,
    age: Math.random() * 100,
    furShells,
  };
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
    c.heading += (Math.random() - 0.5) * 0.9;
    c.nextThink = 1.4 + Math.random() * 2.5;
  }

  const head = c.segments[0];
  const step = c.speed * dt;
  let nx = head.position.x + Math.cos(c.heading) * step;
  let nz = head.position.z + Math.sin(c.heading) * step;

  // edge avoidance — stay on the island plateau, turn back before reaching
  // the sloped rim. Also turn back from water in water biomes.
  const near = nearestCenter(nx, nz);
  const ndx = nx - near.cx;
  const ndz = nz - near.cz;
  const wetAhead = state.waterMesh && heightFn(nx, nz) < WATER_AVOID_Y;
  if (Math.sqrt(ndx * ndx + ndz * ndz) > near.radius * 0.94 || wetAhead) {
    c.heading =
      Math.atan2(near.cz - head.position.z, near.cx - head.position.x) +
      (Math.random() - 0.5) * 0.4;
    nx = head.position.x + Math.cos(c.heading) * step;
    nz = head.position.z + Math.sin(c.heading) * step;
  }

  // Obstacle slide — small radius since caterpillars are skinny. Pass `c`
  // as selfOwner so the head doesn't try to avoid its own body segments
  // (every segment of this caterpillar is registered in dynamicObstacles
  // with the same owner ref).
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
    c
  );
  if (slide) {
    nx = slide.nx;
    nz = slide.nz;
    c.heading = slide.heading;
  }

  // all segments — including the head — sit at the same base offset so
  // adjacent spheres at segSpacing = 2*radius actually touch.
  const baseOffset = c.segRadius * 0.7 * c.scale;
  const headY = heightFn(nx, nz) + baseOffset;
  head.position.set(nx, headY, nz);
  head.rotation.y = -c.heading + Math.PI / 2;

  // Terrain tilt — same slope-sampling shape walkers use in stepCreature.
  // Sample heightFn along heading (forward/back) and perpendicular to it
  // (right/left), derive slope gradients, and ease pitch (rotation.x) and
  // roll (rotation.z) toward angles that lay the head flat against the
  // hillside. The idle nodding bob is folded into the pitch target so it
  // adds on top of the slope rather than overwriting it.
  const ds = 0.25 * c.scale;
  const ch = Math.cos(c.heading);
  const sh = Math.sin(c.heading);
  const yF = heightFn(nx + ch * ds, nz + sh * ds);
  const yB = heightFn(nx - ch * ds, nz - sh * ds);
  const yR = heightFn(nx + sh * ds, nz - ch * ds);
  const yL = heightFn(nx - sh * ds, nz + ch * ds);
  const slopeFwd = (yF - yB) / (2 * ds);
  const slopeRight = (yR - yL) / (2 * ds);
  const cl = (v) => Math.max(-2, Math.min(2, v));
  const nod = Math.sin(c.age * 4) * 0.06;
  const pitchTarget = -Math.atan(cl(slopeFwd)) + nod;
  const rollTarget = Math.atan(cl(slopeRight));
  const k = Math.min(1, dt * 5);
  head.rotation.x += (pitchTarget - head.rotation.x) * k;
  head.rotation.z += (rollTarget - head.rotation.z) * k;

  // record path (3D so 3D-arclength following stays accurate on slopes)
  c.trail.unshift({ x: nx, y: headY, z: nz });
  if (c.trail.length > 300) c.trail.length = 300;

  // body segments sample the trail at fixed arc-length offsets
  for (let i = 1; i < c.segments.length; i++) {
    const pt = findTrailPointAt(c.trail, i * c.segSpacing);
    if (!pt) continue;
    const groundY = heightFn(pt.x, pt.z);
    // subtle wave along the body — small enough that they stay touching
    const bob = Math.sin(c.age * 3.5 - i * 0.7) * 0.03 * c.scale;
    c.segments[i].position.set(pt.x, groundY + baseOffset + bob, pt.z);
    c.segments[i].rotation.z = Math.sin(c.age * 2 - i * 0.5) * 0.06;
  }
}
