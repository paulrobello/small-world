import * as THREE from "three";
import { state } from "./state.js";
import { jitterGeo } from "./util.js";
import { pickGroundPoint } from "./terrain.js";

export function makeCreature(biome) {
  const isFish = biome.creatureKind === "fish";
  const flies = isFish ? true : Math.random() < 0.3;

  const group = new THREE.Group();
  const palette = biome.creatureColors;
  const bodyCol = new THREE.Color(
    palette[Math.floor(Math.random() * palette.length)]
  );

  // body — rounder for fliers, more elongated for walkers
  const bodyGeo = jitterGeo(new THREE.IcosahedronGeometry(0.42, 0), 0.06);
  const body = new THREE.Mesh(
    bodyGeo,
    new THREE.MeshStandardMaterial({
      color: bodyCol,
      flatShading: true,
      roughness: 0.55,
      metalness: 0.02,
    })
  );
  const bodyBaseY = flies ? 0.92 : 0.82;
  const bodyBaseX = flies ? 1.05 : 1;
  const bodyBaseZ = flies ? 1.05 : 1.25;
  body.scale.set(bodyBaseX, bodyBaseY, bodyBaseZ);
  body.castShadow = true;
  group.add(body);

  // belly highlight
  const belly = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 10, 8),
    new THREE.MeshStandardMaterial({
      color: bodyCol.clone().offsetHSL(0, -0.2, 0.18),
      flatShading: true,
    })
  );
  belly.position.set(0, -0.12, 0.05);
  belly.scale.set(0.85, 0.55, 1);
  group.add(belly);

  // eyes
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xfafaf2,
    roughness: 0.15,
  });
  const pupilMat = biome.glowEyes
    ? new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.accent),
        emissive: new THREE.Color(biome.accent),
        emissiveIntensity: 1.4,
        roughness: 0.3,
      })
    : new THREE.MeshStandardMaterial({
        color: 0x0a0a0a,
        roughness: 0.05,
      });
  const eyeGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const pupilGeo = new THREE.SphereGeometry(0.05, 8, 8);
  for (const sign of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(sign * 0.16, 0.17, 0.4);
    group.add(eye);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(sign * 0.16, 0.17, 0.48);
    group.add(pupil);
  }

  // antennae for some
  if (Math.random() > 0.55) {
    const antMat = new THREE.MeshStandardMaterial({
      color: bodyCol.clone().offsetHSL(0, 0, -0.2),
    });
    for (const sign of [-1, 1]) {
      const stalk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.22, 4),
        antMat
      );
      stalk.position.set(sign * 0.1, 0.42, 0.1);
      stalk.rotation.z = sign * -0.25;
      group.add(stalk);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 6, 6),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.accent),
          emissive: new THREE.Color(biome.accent).multiplyScalar(0.35),
        })
      );
      tip.position.set(sign * 0.13, 0.52, 0.13);
      group.add(tip);
    }
  }

  const feet = [];
  const legs = [];
  const wings = [];

  if (flies) {
    if (isFish) {
      // fin-like ears — small flattened pivots on the upper sides
      const finMat = new THREE.MeshStandardMaterial({
        color: bodyCol.clone().offsetHSL(0, -0.05, 0.14),
        flatShading: true,
        roughness: 0.5,
        side: THREE.DoubleSide,
      });
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.18, 0.22, 0.05);
        group.add(pivot);
        const finGeo = jitterGeo(
          new THREE.IcosahedronGeometry(0.13, 0),
          0.03
        );
        finGeo.scale(1.4, 0.12, 1.0);
        const fin = new THREE.Mesh(finGeo, finMat);
        fin.position.set(side * 0.13, 0.04, 0);
        fin.castShadow = true;
        pivot.add(fin);
        wings.push(pivot);
      }
      // little tail fin on the back
      const tailGeo = jitterGeo(new THREE.IcosahedronGeometry(0.13, 0), 0.03);
      tailGeo.scale(0.3, 0.85, 1.1);
      const tail = new THREE.Mesh(tailGeo, finMat);
      tail.position.set(0, 0.05, -0.45);
      tail.castShadow = true;
      group.add(tail);
    } else {
      // wings — flattened ellipsoid icospheres on hinge groups
      const wingMat = new THREE.MeshStandardMaterial({
        color: bodyCol.clone().offsetHSL(0, -0.15, 0.12),
        flatShading: true,
        roughness: 0.45,
        side: THREE.DoubleSide,
      });
      for (const side of [-1, 1]) {
        const pivot = new THREE.Group();
        pivot.position.set(side * 0.12, 0.18, -0.02);
        group.add(pivot);

        const wingGeo = jitterGeo(
          new THREE.IcosahedronGeometry(0.18, 0),
          0.04
        );
        wingGeo.scale(2.4, 0.18, 1.1);
        const wing = new THREE.Mesh(wingGeo, wingMat);
        wing.position.set(side * 0.38, 0, 0);
        wing.castShadow = true;
        pivot.add(wing);
        wings.push(pivot);
      }

      // two dangling feet for charm (no legs, just little nubs hanging)
      const dangleMat = new THREE.MeshStandardMaterial({
        color: bodyCol.clone().offsetHSL(0, 0, -0.25),
        flatShading: true,
      });
      for (const sign of [-1, 1]) {
        const dangle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.04, 0.16, 5),
          dangleMat
        );
        dangle.position.set(sign * 0.11, -0.36, 0.02);
        dangle.castShadow = true;
        group.add(dangle);
      }
    }
  } else {
    // walkers: visible legs + feet
    const legMat = new THREE.MeshStandardMaterial({
      color: bodyCol.clone().offsetHSL(0, 0, -0.18),
      flatShading: true,
      roughness: 0.75,
    });
    const footMat = new THREE.MeshStandardMaterial({
      color: bodyCol.clone().offsetHSL(0, 0, -0.3),
      flatShading: true,
    });
    // cylinder of length 1 with its origin at the top so scale.y = length
    const legGeoTemplate = new THREE.CylinderGeometry(0.045, 0.06, 1, 6);
    legGeoTemplate.translate(0, -0.5, 0);

    const footPositions = [
      [-0.18, 0.18],
      [0.18, 0.18],
      [-0.18, -0.18],
      [0.18, -0.18],
    ];
    for (const [fx, fz] of footPositions) {
      const leg = new THREE.Mesh(legGeoTemplate.clone(), legMat);
      leg.position.set(fx, -0.1, fz);
      leg.scale.y = 0.22; // resting length, updated each frame
      leg.castShadow = true;
      group.add(leg);
      legs.push(leg);

      const foot = new THREE.Mesh(
        new THREE.SphereGeometry(0.085, 6, 6),
        footMat
      );
      foot.position.set(fx, -0.32, fz);
      foot.scale.set(1.15, 0.55, 1.3);
      foot.castShadow = true;
      group.add(foot);
      feet.push(foot);
    }
    legGeoTemplate.dispose();
  }

  const scale = 0.65 + Math.random() * 0.6;
  group.scale.setScalar(scale);

  const hoverHeight = 1.4 + Math.random() * 1.8;

  return {
    group,
    body,
    feet,
    legs,
    wings,
    flies,
    isFish,
    scale,
    heading: Math.random() * Math.PI * 2,
    speed: flies ? 1.1 + Math.random() * 0.9 : 0.6 + Math.random() * 0.7,
    bob: Math.random() * Math.PI * 2,
    bobSpeed: flies ? 4 + Math.random() * 2 : 6 + Math.random() * 3,
    flapSpeed: 16 + Math.random() * 10,
    flapPhase: Math.random() * Math.PI * 2,
    hoverHeight,
    // landing state — only used when flies===true
    landState: "flying", // "flying" | "descending" | "landed" | "ascending"
    landTimer: 6 + Math.random() * 14, // seconds until first landing attempt
    currentHover: hoverHeight, // animated; lerps between hoverHeight and rest
    bodyBaseY,
    bodyBaseX,
    nextThink: Math.random() * 2.5,
    pauseUntil: 0,
    age: Math.random() * 100,
  };
}

export function stepCreature(c, dt, t, heightFn) {
  c.age += dt;
  c.nextThink -= dt;

  // ── flier landing state machine ────────────────────────────────────────
  // Fish never land — they always float.
  if (c.flies && !c.isFish) {
    c.landTimer -= dt;
    const restH = 0.35 * c.scale;

    if (c.landState === "flying" && c.landTimer <= 0) {
      c.landState = "descending";
    } else if (c.landState === "landed" && c.landTimer <= 0) {
      c.landState = "ascending";
    }

    const targetH =
      c.landState === "flying" || c.landState === "ascending"
        ? c.hoverHeight
        : restH;
    // smooth lerp for the descent/ascent
    c.currentHover += (targetH - c.currentHover) * Math.min(1, dt * 1.4);

    if (
      c.landState === "descending" &&
      c.currentHover - restH < 0.08
    ) {
      c.landState = "landed";
      c.landTimer = 4 + Math.random() * 10;
    } else if (
      c.landState === "ascending" &&
      c.hoverHeight - c.currentHover < 0.15
    ) {
      c.landState = "flying";
      c.landTimer = 8 + Math.random() * 16;
    }
  }

  const grounded = c.flies && c.landState === "landed";

  // think — fliers never pause while airborne; walkers + landed fliers can
  if (c.nextThink <= 0) {
    if ((!c.flies || grounded) && Math.random() < 0.25) {
      c.pauseUntil = t + 0.6 + Math.random() * 1.4;
    } else {
      c.heading += (Math.random() - 0.5) * (c.flies && !grounded ? 1.2 : 1.6);
    }
    c.nextThink = (c.flies ? 0.7 : 1.2) + Math.random() * (c.flies ? 1.8 : 3.0);
  }

  let moving = t > c.pauseUntil;
  // landed fliers stay put — they perched
  if (grounded) moving = false;
  const pos = c.group.position;

  if (moving) {
    const step = c.speed * dt;
    const nx = pos.x + Math.cos(c.heading) * step;
    const nz = pos.z + Math.sin(c.heading) * step;
    // Edge avoidance: flying creatures can range a bit beyond ground; walkers
    // turn back the moment their next step is over a void or steep cliff.
    const overVoid = heightFn(nx, nz) < -0.35;
    const wouldStray =
      c.flies && c.landState === "flying"
        ? Math.sqrt(nx * nx + nz * nz) > state.ISLAND_RADIUS * 1.18
        : overVoid;

    if (wouldStray) {
      c.heading = Math.atan2(-nz, -nx) + (Math.random() - 0.5) * 0.5;
    } else {
      pos.x = nx;
      pos.z = nz;
    }
    c.bob += dt * c.bobSpeed;
  } else {
    c.bob += dt * 2;
  }

  const ground = heightFn(pos.x, pos.z);
  if (c.flies) {
    // bob amplitude scales with current hover — perched creatures only quiver
    const bobAmp = grounded
      ? 0.02
      : 0.28 * Math.min(1, c.currentHover / Math.max(0.1, c.hoverHeight));
    pos.y = ground + c.currentHover + Math.sin(c.bob) * bobAmp;
  } else {
    const bobAmp = moving ? 0.08 : 0.02;
    pos.y = ground + 0.35 * c.scale + Math.sin(c.bob) * bobAmp;
  }

  // face heading (smoothed)
  const targetRot = -c.heading + Math.PI / 2;
  let cur = c.group.rotation.y;
  let diff = targetRot - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  c.group.rotation.y = cur + diff * Math.min(1, dt * 6);

  // squash & stretch body
  const squash = 1 + Math.sin(c.bob) * 0.05 * (moving ? 1 : 0.4);
  c.body.scale.y = c.bodyBaseY * squash;
  c.body.scale.x = c.bodyBaseX / Math.sqrt(squash);

  if (c.flies) {
    if (c.isFish) {
      // gentle fin sway — slow, low amplitude
      const phase = t * 2.2 + c.flapPhase;
      const wave = Math.sin(phase);
      for (let i = 0; i < c.wings.length; i++) {
        const sign = i === 0 ? -1 : 1;
        c.wings[i].rotation.z = sign * (0.15 + wave * 0.25);
        c.wings[i].rotation.y = Math.cos(phase * 0.7) * 0.18;
      }
      c.body.rotation.z = wave * 0.05;
    } else if (grounded) {
      // wings folded — slowly settle into rest pose, no oscillation
      const k = Math.min(1, dt * 5);
      for (let i = 0; i < c.wings.length; i++) {
        const sign = i === 0 ? -1 : 1;
        const restRot = sign * 0.55; // wings tucked slightly up
        c.wings[i].rotation.z += (restRot - c.wings[i].rotation.z) * k;
        c.wings[i].rotation.x += (0 - c.wings[i].rotation.x) * k;
      }
      c.body.rotation.z += (0 - c.body.rotation.z) * k;
    } else {
      // amplitude fades as the creature transitions between hover and ground
      const altRatio = Math.min(
        1,
        (c.currentHover - 0.35 * c.scale) / Math.max(0.1, c.hoverHeight - 0.35 * c.scale)
      );
      const flapStrength = 0.4 + 0.6 * altRatio; // weaker flap near the ground
      const phase = t * c.flapSpeed + c.flapPhase;
      const flap = Math.sin(phase);
      for (let i = 0; i < c.wings.length; i++) {
        const sign = i === 0 ? -1 : 1;
        c.wings[i].rotation.z = sign * (0.25 + flap * 0.75 * flapStrength);
        c.wings[i].rotation.x = Math.cos(phase) * 0.12 * flapStrength;
      }
      c.body.rotation.z = -flap * 0.04 * flapStrength;
    }
  } else if (moving) {
    // diagonal trot pattern: FL+BR phase, FR+BL counter-phase
    const phases = [0, Math.PI, Math.PI, 0];
    for (let i = 0; i < c.feet.length; i++) {
      const footY = -0.32 + Math.sin(c.bob + phases[i]) * 0.09;
      c.feet[i].position.y = footY;
      // leg top is at -0.1 in body space; scale.y = distance to foot
      c.legs[i].scale.y = -0.1 - footY;
    }
  }
}

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
    const dz = cur.z - prev.z;
    const d = Math.sqrt(dx * dx + dz * dz);
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

export function makeCaterpillar(biome) {
  const group = new THREE.Group();
  const palette = biome.creatureColors;
  const baseCol = new THREE.Color(
    palette[Math.floor(Math.random() * palette.length)]
  );
  const altCol = baseCol.clone().offsetHSL(0, 0.05, 0.12);

  const segments = [];
  const segCount = 3 + Math.floor(Math.random() * 4); // 3-6 body segments
  // uniform radius for head + every body segment — keeps them touching
  const segRadius = 0.28;

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
  for (const sign of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(sign * 0.13, 0.12, 0.24);
    head.add(eye);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(sign * 0.13, 0.12, 0.31);
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
    tip.position.set(sign * 0.13, 0.38, 0.08);
    head.add(tip);
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

  const scale = 0.7 + Math.random() * 0.4;
  for (const s of segments) s.scale.setScalar(scale);

  // initial placement — anywhere on solid ground
  const sp = pickGroundPoint(0.55);
  const startX = sp.x;
  const startZ = sp.z;
  const startHeading = Math.random() * Math.PI * 2;
  // tighter than 2r — icospheres at exactly 2r touch only at corners, so
  // their flat faces leave a visible gap. Overlap a bit so segments visibly
  // read as touching even over sloped terrain.
  const segSpacing = 1.4 * segRadius * scale;

  // pre-seed the trail behind the head so segments aren't stacked at frame 0
  const trail = [];
  const seedStep = 0.04;
  for (let i = 0; i < 250; i++) {
    trail.push({
      x: startX - Math.cos(startHeading) * i * seedStep,
      z: startZ - Math.sin(startHeading) * i * seedStep,
    });
  }

  head.position.set(startX, 0, startZ);

  return {
    type: "caterpillar",
    group,
    segments,
    segRadius,
    trail,
    segSpacing,
    scale,
    heading: startHeading,
    speed: 0.5 + Math.random() * 0.3,
    nextThink: Math.random() * 2.5,
    age: Math.random() * 100,
  };
}

export function stepCaterpillar(c, dt, t, heightFn) {
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

  // edge avoidance — if the next step is over a void or steep cliff, turn back
  if (heightFn(nx, nz) < -0.25) {
    c.heading = Math.atan2(-nz, -nx) + (Math.random() - 0.5) * 0.4;
    nx = head.position.x + Math.cos(c.heading) * step;
    nz = head.position.z + Math.sin(c.heading) * step;
  }

  // all segments — including the head — sit at the same base offset so
  // adjacent spheres at segSpacing = 2*radius actually touch.
  const baseOffset = c.segRadius * 0.7 * c.scale;
  const headY = heightFn(nx, nz) + baseOffset;
  head.position.set(nx, headY, nz);
  head.rotation.y = -c.heading + Math.PI / 2;
  head.rotation.x = Math.sin(c.age * 4) * 0.06;

  // record path
  c.trail.unshift({ x: nx, z: nz });
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
    target: null,
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

function pickFlower(flowerSpots) {
  if (!flowerSpots.length) return null;
  const f = flowerSpots[Math.floor(Math.random() * flowerSpots.length)];
  return new THREE.Vector3(f.x, f.y + 0.22, f.z);
}

const _bflyTarget = new THREE.Vector3();
export function stepButterfly(b, dt, t, flowerSpots, heightFn) {
  const pos = b.group.position;

  // state machine — pick flower → fly → hover → pick another
  if (b.state === "hovering" && t > b.holdUntil) {
    b.state = "cruising";
    b.target = pickFlower(flowerSpots);
  }
  if (b.state === "cruising" && !b.target) {
    b.target = pickFlower(flowerSpots);
  }
  if (b.state === "cruising" && b.target) {
    const dx = pos.x - b.target.x;
    const dy = pos.y - b.target.y;
    const dz = pos.z - b.target.z;
    if (dx * dx + dy * dy + dz * dz < 0.05) {
      b.state = "hovering";
      b.holdUntil = t + 1.2 + Math.random() * 2.5;
    }
  }

  // steer toward target
  if (b.target) {
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

  // don't dip below terrain
  const ground = heightFn(pos.x, pos.z);
  const minY = ground + 0.12;
  if (pos.y < minY) {
    pos.y = minY;
    if (b.velocity.y < 0) b.velocity.y = 0.2;
  }

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

// ─────────────────────────────────────────────────────────────────────────────
