import * as THREE from "three";
import { state } from "./state.js";
import { jitterGeo } from "./util.js";
import { pickGroundPoint, nearestCenter } from "./terrain.js";
import { makeDirtPuff, makeDustKick } from "./environment.js";
import { applyShellFur } from "./fur.js";

// Terrain Y below which ground creatures are considered underwater. The water
// plane sits a touch below 0 and oscillates ~±0.08; clamping walkers to
// ground above 0 keeps them clear of waves and out of the shallow draft.
const WATER_AVOID_Y = 0.0;

// Personality presets — picked once per creature at spawn, tweak how it walks,
// thinks, hops, herds, and sleeps. Subtle multipliers; the cute baseline is
// still recognisable.
const PERSONALITIES = {
  shy:    { speedMul: 0.75, bobSpeedMul: 0.9, bobAmpMul: 0.85, pauseChance: 0.4,  hopProb: 0.12, herdStrength: 0.2,  nightThresh: 0.55 },
  bold:   { speedMul: 1.25, bobSpeedMul: 1.0, bobAmpMul: 1.1,  pauseChance: 0.05, hopProb: 0.45, herdStrength: 0.45, nightThresh: 0.85 },
  sleepy: { speedMul: 0.75, bobSpeedMul: 0.7, bobAmpMul: 0.9,  pauseChance: 0.45, hopProb: 0.1,  herdStrength: 0.3,  nightThresh: 0.40 },
  bouncy: { speedMul: 1.05, bobSpeedMul: 1.4, bobAmpMul: 1.5,  pauseChance: 0.1,  hopProb: 0.55, herdStrength: 0.35, nightThresh: 0.75 },
};
const PERSONALITY_NAMES = Object.keys(PERSONALITIES);

// Shared "zZz" texture for the night-sleep sprite. Built lazily on first
// drowsy creature, then reused for every sprite material across the session.
let _zTexture = null;
function getZTexture() {
  if (_zTexture) return _zTexture;
  const c = document.createElement("canvas");
  c.width = 96;
  c.height = 64;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 96, 64);
  ctx.fillStyle = "#fafaf2";
  ctx.font = "italic bold 36px 'Quicksand', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // soft shadow for legibility against bright biomes
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillText("zZz", 48, 36);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _zTexture = tex;
  return tex;
}
function makeZSprite() {
  const mat = new THREE.SpriteMaterial({
    map: getZTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.7, 0.45, 1);
  s.position.set(0.15, 0.85, 0);
  return s;
}

// Color similarity test for the herding check. Cheap RGB distance — fine for
// the small biome palettes used here.
function colorsClose(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db < 0.04;
}

// opts:
//   role         — "parent" | "kid"   (for family groups)
//   parent       — reference to the parent creature (for kids)
//   sizeMul      — overall size multiplier (default 1)
//   sleeper      — spawn in sleeping state (walkers only)
//   burrower     — spawn as burrower variant (walkers only)
export function makeCreature(biome, opts = {}) {
  const isFish = biome.creatureKind === "fish";
  // sleepers and burrowers must be walkers — sleeping fliers in mid-air look broken
  const forceWalk = !!(opts.sleeper || opts.burrower);
  const flies = isFish ? true : forceWalk ? false : Math.random() < 0.3;

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

  let furShells = null;
  // Fuzzy biomes give walkers (and only walkers — fliers/fish read aquatic
  // or airborne) a shell-fur layer. Burrowers + sleepers count as walkers.
  if (biome.fuzzy && !flies) {
    furShells = applyShellFur(body, biome, {
      baseColor: bodyCol.clone().offsetHSL(0, -0.05, -0.05),
    });
  }

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
  const eyeParts = [];
  for (const sign of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(sign * 0.16, 0.17, 0.4);
    group.add(eye);
    eyeParts.push(eye);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.set(sign * 0.16, 0.17, 0.48);
    group.add(pupil);
    eyeParts.push(pupil);
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

  const sizeMul = opts.sizeMul ?? 1;
  const baseScale = 0.65 + Math.random() * 0.6;
  // burrowers are notably smaller; kids inherit sizeMul on top
  const burrowScale = opts.burrower ? 0.55 : 1;
  const scale = baseScale * sizeMul * burrowScale;
  group.scale.setScalar(scale);

  const hoverHeight = 1.4 + Math.random() * 1.8;

  const isSleeper = !!opts.sleeper && !flies;
  const isBurrower = !!opts.burrower && !flies;

  // Sleepers spawn already curled (eyes scaled to 0, body squashed).
  // stepCreature animates the wake-up in reverse.
  let wakeProgress = isSleeper ? 0 : 1;
  if (isSleeper) {
    for (const e of eyeParts) e.scale.setScalar(0);
    body.scale.set(bodyBaseX * 1.18, bodyBaseY * 0.55, bodyBaseZ * 1.05);
  }

  // Personality stamp — pulled from the deterministic RNG during world-gen,
  // applies subtle multipliers to speed/think/bob and biases the sleep,
  // herd, and hop responses below.
  const personalityName =
    PERSONALITY_NAMES[Math.floor(Math.random() * PERSONALITY_NAMES.length)];
  const personality = PERSONALITIES[personalityName];

  const baseSpeed = flies ? 1.1 + Math.random() * 0.9 : 0.6 + Math.random() * 0.7;
  const baseBobSpeed = flies ? 4 + Math.random() * 2 : 6 + Math.random() * 3;

  return {
    group,
    body,
    feet,
    legs,
    wings,
    eyeParts,
    flies,
    isFish,
    scale,
    role: opts.role || null,         // "parent" | "kid" | null
    parent: opts.parent || null,     // reference to parent creature (kids only)
    heading: Math.random() * Math.PI * 2,
    speed: baseSpeed * personality.speedMul,
    bob: Math.random() * Math.PI * 2,
    bobSpeed: baseBobSpeed * personality.bobSpeedMul,
    flapSpeed: 16 + Math.random() * 10,
    flapPhase: Math.random() * Math.PI * 2,
    hoverHeight,
    // landing state — only used when flies===true
    landState: "flying", // "flying" | "descending" | "landed" | "ascending"
    landTimer: 6 + Math.random() * 14, // seconds until first landing attempt
    currentHover: hoverHeight, // animated; lerps between hoverHeight and rest
    bodyBaseY,
    bodyBaseX,
    bodyBaseZ,
    bodyColor: bodyCol.clone(),
    furShells,
    nextThink: Math.random() * 2.5,
    pauseUntil: 0,
    age: Math.random() * 100,
    // sleeper state — when isSleeper, the creature won't think/move until woken.
    isSleeper,
    wakeProgress,             // 0 = fully asleep, 1 = fully awake
    // burrower state — alternating cycles of above-ground/burrowed life
    isBurrower,
    burrowState: isBurrower ? "surface" : null, // "surface" | "descending" | "burrowed" | "emerging"
    burrowTimer: isBurrower ? 2 + Math.random() * 4 : 0,
    burrowDepth: 0,           // 0 = on ground, 1 = fully submerged
    dirtColor: new THREE.Color(biome.cliff),
    // Personality + behavior knobs read by stepCreature
    personality: personalityName,
    pauseChance: personality.pauseChance,
    bobAmpMul: personality.bobAmpMul,
    hopProb: personality.hopProb,
    herdStrength: personality.herdStrength,
    nightThresh: personality.nightThresh,
    // Look-at-camera — set by the UI hover handler to N seconds; stepCreature
    // decrements and overrides the heading-based rotation while > 0.
    lookTimer: 0,
    // Curiosity hop — a vertical pos.y bump added on top of the regular
    // ground+bob math. hopVy is the integrated vertical velocity, hopOffset
    // the current height above resting, hopCooldown the gate.
    hopVy: 0,
    hopOffset: 0,
    hopCooldown: 1.5 + Math.random() * 3,
    // Night-sleep — 0..1 sleepiness target driven by state.nightFactor and
    // personality.nightThresh. zSprite lazily attached when first drowsy.
    sleepiness: 0,
    zSprite: null,
    // Footstep dust — per-foot last sin sample for rising-edge detection,
    // and a global per-creature cooldown so multiple feet don't all kick
    // at once. Allocated for fliers/fish too (cheap) since the walker
    // animation block is never entered for them.
    lastFootSin: [0, 0, 0, 0],
    lastDustAt: 0,
  };
}

// Trigger a brief look-at-camera response. Called from the UI hover/tap
// handler — the stepCreature override decays via c.lookTimer.
export function lookAtCreature(c) {
  if (c.isSleeper) return;
  // 1.5s of camera-facing — long enough to read, short enough to not feel sticky
  c.lookTimer = 1.5;
}

// Find distance to nearest butterfly or bee for the curiosity-hop trigger.
// Returns Infinity if no buzzers are loaded. Cheap — we early-exit on the
// first close-enough hit so most checks bail in a handful of cells.
function nearestBuzzer(pos) {
  let best = Infinity;
  const list1 = state.butterflies;
  for (let i = 0; i < list1.length; i++) {
    const bp = list1[i].group.position;
    const dx = bp.x - pos.x;
    const dz = bp.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
    if (best < 1.0) return Math.sqrt(best);
  }
  const list2 = state.bees;
  for (let i = 0; i < list2.length; i++) {
    const bp = list2[i].group.position;
    const dx = bp.x - pos.x;
    const dz = bp.z - pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) best = d2;
    if (best < 1.0) return Math.sqrt(best);
  }
  return Math.sqrt(best);
}

// Nudge `c.heading` toward the nearest same-color creature so kin pair up
// into loose pairs/trios. Capped by `c.herdStrength` and a max distance so
// it never overpowers the existing random wander.
function herdInfluence(c, dt) {
  const me = c.group.position;
  let best = null;
  let bestD = Infinity;
  const list = state.creatures;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o === c) continue;
    if (o.isSleeper || o.isBurrower) continue;
    if (!o.bodyColor || !colorsClose(o.bodyColor, c.bodyColor)) continue;
    const op = o.group.position;
    const dx = op.x - me.x;
    const dz = op.z - me.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 64) continue;        // ignore peers more than 8 units away
    if (d2 < bestD) {
      bestD = d2;
      best = o;
    }
  }
  if (!best) return;
  const op = best.group.position;
  const d = Math.sqrt(bestD);
  // Too close → drift apart slightly. Sweet spot 1.4–4 units → pull toward.
  const sign = d < 1.2 ? -1 : 1;
  const targetH = Math.atan2(op.z - me.z, op.x - me.x);
  let diff = targetH - c.heading;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  c.heading += sign * diff * c.herdStrength * 0.4;
}

// Wake a sleeping creature. Called from the UI hover handler.
export function wakeCreature(c) {
  if (!c.isSleeper) return;
  // mark "waking" — wakeProgress will animate from 0→1 in stepCreature
  c.isSleeper = false;          // logically awake (no longer blocks movement)
  c._waking = true;             // animate the unfurl
  // small heading kick so they wander off in a fresh direction
  c.heading = Math.random() * Math.PI * 2;
  c.nextThink = 0.3 + Math.random() * 0.6;
}

export function stepCreature(c, dt, t, heightFn) {
  c.age += dt;
  c.nextThink -= dt;
  if (c.lookTimer > 0) c.lookTimer -= dt;
  if (c.hopCooldown > 0) c.hopCooldown -= dt;

  // Sleepiness target — driven by the global night factor and the personality
  // threshold. Sleepy creatures yawn earlier; bold ones tough it out until
  // it's properly dark. Smoothstep gives a soft on/off so the body curl
  // animates rather than snapping.
  if (!c.isSleeper && !c.flies) {
    const nf = state.nightFactor ?? 0;
    const a = c.nightThresh - 0.08;
    const b = c.nightThresh + 0.08;
    let target = (nf - a) / Math.max(0.001, b - a);
    if (target < 0) target = 0;
    else if (target > 1) target = 1;
    else target = target * target * (3 - 2 * target);
    // ease toward target at ~0.6/s so dawn/dusk transitions are smooth
    c.sleepiness += (target - c.sleepiness) * Math.min(1, dt * 0.6);
  } else if (c.flies && !c.isFish) {
    // fliers don't fully sleep, but they get drowsy + descend toward rest
    const nf = state.nightFactor ?? 0;
    const a = c.nightThresh - 0.08;
    const b = c.nightThresh + 0.08;
    let target = (nf - a) / Math.max(0.001, b - a);
    if (target < 0) target = 0;
    else if (target > 1) target = 1;
    c.sleepiness += (target - c.sleepiness) * Math.min(1, dt * 0.6);
  }

  // Lazily attach the zZz sprite the first time we drift into drowsy.
  if (c.sleepiness > 0.05 && !c.zSprite && !c.flies) {
    c.zSprite = makeZSprite();
    c.group.add(c.zSprite);
  }
  if (c.zSprite) {
    const targetOpacity = c.sleepiness > 0.6 ? Math.min(0.95, (c.sleepiness - 0.6) * 2.4) : 0;
    c.zSprite.material.opacity +=
      (targetOpacity - c.zSprite.material.opacity) * Math.min(1, dt * 3);
    // gentle vertical wobble so the sprite drifts up
    c.zSprite.position.y = 0.85 + Math.sin(t * 1.4 + c.flapPhase) * 0.08;
  }

  // Integrate the hop physics every frame so a hop in flight smoothly settles
  // even if the cooldown is later overwritten.
  if (c.hopVy !== 0 || c.hopOffset !== 0) {
    c.hopOffset += c.hopVy * dt;
    c.hopVy -= 14 * dt;
    if (c.hopOffset <= 0) {
      c.hopOffset = 0;
      c.hopVy = 0;
    }
  }

  // ── sleeping (curled, eyes closed, no motion) ─────────────────────────
  if (c.isSleeper) {
    // slow "breathing" — body bob on y axis, very small amplitude
    const breath = Math.sin(t * 1.1 + c.flapPhase) * 0.03;
    c.body.scale.y = c.bodyBaseY * 0.55 + breath;
    c.body.scale.x = c.bodyBaseX * (1.18 - breath * 0.3);
    // keep planted at ground height
    const ground = heightFn(c.group.position.x, c.group.position.z);
    c.group.position.y = ground + 0.28 * c.scale;
    return;
  }

  // ── waking-up animation (unfurl eyes + body) ──────────────────────────
  if (c._waking) {
    c.wakeProgress = Math.min(1, c.wakeProgress + dt * 1.8);
    const w = c.wakeProgress;
    for (const e of c.eyeParts) e.scale.setScalar(w);
    // body lerps from curled → resting baseline (the squash anim below
    // takes over once we're fully awake)
    c.body.scale.x = c.bodyBaseX * (1.18 + (1 - 1.18) * w);
    c.body.scale.y = c.bodyBaseY * (0.55 + (1 - 0.55) * w);
    if (w >= 1) c._waking = false;
  }

  // ── night sleep (walkers only) ────────────────────────────────────────
  // High sleepiness curls a walker down on the spot. Smooth transitions in
  // and out — eyes scale, body squashes, head-bob falls to a slow breath.
  if (!c.flies && c.sleepiness > 0.05 && !c._waking) {
    const s = c.sleepiness;
    // eyes squint shut as sleepiness rises (clamped to keep them readable
    // until really drowsy)
    const eyeOpen = Math.max(0, 1 - s * 1.2);
    for (const e of c.eyeParts) e.scale.setScalar(eyeOpen);
    // body curls
    c.body.scale.y = c.bodyBaseY * (1 + (0.55 - 1) * s);
    c.body.scale.x = c.bodyBaseX * (1 + (1.18 - 1) * s);
    if (s > 0.9) {
      // fully curled — slow breath, no motion, planted on the ground
      const breath = Math.sin(t * 1.1 + c.flapPhase) * 0.03;
      c.body.scale.y = c.bodyBaseY * 0.55 + breath;
      c.body.scale.x = c.bodyBaseX * (1.18 - breath * 0.3);
      const ground = heightFn(c.group.position.x, c.group.position.z);
      c.group.position.y = ground + 0.28 * c.scale + c.hopOffset;
      return;
    }
  }

  // ── burrower state machine ────────────────────────────────────────────
  if (c.isBurrower) {
    c.burrowTimer -= dt;
    if (c.burrowState === "surface" && c.burrowTimer <= 0) {
      c.burrowState = "descending";
      c.burrowTimer = 0.6;
    } else if (c.burrowState === "descending") {
      c.burrowDepth = Math.min(1, c.burrowDepth + dt * 1.6);
      if (c.burrowDepth >= 1) {
        c.burrowState = "burrowed";
        c.group.visible = false;
        c.burrowTimer = 3 + Math.random() * 4;
      }
    } else if (c.burrowState === "burrowed" && c.burrowTimer <= 0) {
      // teleport to a fresh nearby ground point and emerge there
      const pos = c.group.position;
      const ang = Math.random() * Math.PI * 2;
      const dist = 2.5 + Math.random() * 4;
      let nx = pos.x + Math.cos(ang) * dist;
      let nz = pos.z + Math.sin(ang) * dist;
      if (heightFn(nx, nz) < 0) {
        // fall back to a nudge toward origin if we'd surface in the void
        nx = pos.x * 0.5;
        nz = pos.z * 0.5;
      }
      pos.x = nx;
      pos.z = nz;
      c.group.visible = true;
      c.burrowState = "emerging";
      // emit a small dirt puff at the surface point
      const puff = makeDirtPuff(nx, heightFn(nx, nz), nz, c.dirtColor);
      state.world.add(puff);
      state.dirtPuffs.push(puff);
    } else if (c.burrowState === "emerging") {
      c.burrowDepth = Math.max(0, c.burrowDepth - dt * 1.8);
      if (c.burrowDepth <= 0) {
        c.burrowState = "surface";
        c.burrowTimer = 5 + Math.random() * 6;
      }
    }
    // while burrowed, skip all motion/animation
    if (c.burrowState === "burrowed") return;
  }

  // ── flier landing state machine ────────────────────────────────────────
  // Fish never land — they always float.
  if (c.flies && !c.isFish) {
    c.landTimer -= dt;
    const restH = 0.35 * c.scale;

    // Drowsy fliers want down — force a descent if they're still flying,
    // and refuse to lift off until they've slept it off.
    if (c.sleepiness > 0.6 && c.landState === "flying") {
      c.landState = "descending";
      c.landTimer = 8 + Math.random() * 6;
    }
    if (c.sleepiness > 0.6 && c.landState === "ascending") {
      c.landState = "descending";
    }

    if (c.landState === "flying" && c.landTimer <= 0) {
      c.landState = "descending";
    } else if (c.landState === "landed" && c.landTimer <= 0 && c.sleepiness < 0.5) {
      c.landState = "ascending";
    }

    // pull the hover ceiling down with sleepiness so a flier slowly sinks
    // toward the ground at night even before reaching the landed state.
    const hoverCeil = c.hoverHeight * (1 - 0.7 * c.sleepiness);
    const targetH =
      c.landState === "flying" || c.landState === "ascending"
        ? hoverCeil
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
    if ((!c.flies || grounded) && Math.random() < c.pauseChance) {
      c.pauseUntil = t + 0.6 + Math.random() * 1.4;
    } else {
      c.heading += (Math.random() - 0.5) * (c.flies && !grounded ? 1.2 : 1.6);
      // Herding — pull toward the nearest same-color creature (capped). Only
      // applied during the think event so it's cheap (O(creatures) per
      // creature ~once a second) and doesn't fight the natural wander.
      if (!c.flies || grounded) {
        herdInfluence(c, dt);
      }
    }
    // Trigger a curiosity hop if a butterfly or bee is buzzing nearby. Walkers
    // and landed fliers only — airborne fliers don't need to hop.
    if (
      (!c.flies || grounded) &&
      c.hopCooldown <= 0 &&
      c.hopOffset === 0 &&
      c.sleepiness < 0.4
    ) {
      const near = nearestBuzzer(c.group.position);
      if (near < 2.4 && Math.random() < c.hopProb) {
        c.hopVy = 2.0 + Math.random() * 0.6;
        c.hopCooldown = 3 + Math.random() * 3;
      }
    }
    c.nextThink = (c.flies ? 0.7 : 1.2) + Math.random() * (c.flies ? 1.8 : 3.0);
  }

  // family kids — if we've drifted too far from the parent, bias heading
  // toward them. Only nudges the heading; the normal think loop still adds jitter.
  if (c.role === "kid" && c.parent && c.parent.group.parent) {
    const pp = c.parent.group.position;
    const me = c.group.position;
    const dx = pp.x - me.x;
    const dz = pp.z - me.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 2.2) {
      const target = Math.atan2(dz, dx);
      // shortest-arc lerp toward parent heading
      let diff = target - c.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      c.heading += diff * Math.min(1, dt * 1.2);
    }
  }

  let moving = t > c.pauseUntil;
  // landed fliers stay put — they perched
  if (grounded) moving = false;
  const pos = c.group.position;

  if (moving) {
    const step = c.speed * dt * (1 - c.sleepiness * 0.85);
    const nx = pos.x + Math.cos(c.heading) * step;
    const nz = pos.z + Math.sin(c.heading) * step;
    // Edge avoidance:
    //  - walkers stay on the island plateau (turn back near the radius edge,
    //    so they don't wander down the slope onto the flat base plane)
    //  - fliers may range out over the slope but turn back inside the base
    //    plane so they never disappear off-world
    //  - in water biomes, walkers also turn back if their next step would
    //    submerge them below the waterline
    let wouldStray;
    let target;
    if (c.flies && c.landState === "flying") {
      const planeBound = state.ISLAND_SIZE * 0.46;
      wouldStray = Math.sqrt(nx * nx + nz * nz) > planeBound;
      target = nearestCenter(pos.x, pos.z);
    } else {
      const near = nearestCenter(nx, nz);
      const dx = nx - near.cx;
      const dz = nz - near.cz;
      wouldStray = Math.sqrt(dx * dx + dz * dz) > near.radius * 0.94;
      if (!wouldStray && state.waterMesh && heightFn(nx, nz) < WATER_AVOID_Y) {
        wouldStray = true;
      }
      target = near;
    }

    if (wouldStray) {
      c.heading =
        Math.atan2(target.cz - pos.z, target.cx - pos.x) +
        (Math.random() - 0.5) * 0.5;
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
    pos.y = ground + c.currentHover + Math.sin(c.bob) * bobAmp * c.bobAmpMul + c.hopOffset;
  } else {
    const bobAmp = (moving ? 0.08 : 0.02) * c.bobAmpMul;
    pos.y = ground + 0.35 * c.scale + Math.sin(c.bob) * bobAmp + c.hopOffset;
    // burrowers sink/rise — burrowDepth=0 sits at surface, 1 fully under
    if (c.isBurrower && c.burrowDepth > 0) {
      pos.y -= c.burrowDepth * (0.8 + 0.4 * c.scale);
    }
  }

  // face heading (smoothed)
  const targetRot = -c.heading + Math.PI / 2;
  let cur = c.group.rotation.y;
  let diff = targetRot - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  c.group.rotation.y = cur + diff * Math.min(1, dt * 6);

  // Look-at-camera override — when the user hovers/taps a creature, pull its
  // facing toward the camera for ~1.5s. Stronger lerp than the regular
  // heading-follow so the response reads as deliberate.
  if (c.lookTimer > 0 && state.camera) {
    const camDx = state.camera.position.x - c.group.position.x;
    const camDz = state.camera.position.z - c.group.position.z;
    const camHeading = Math.atan2(camDz, camDx);
    const lookRot = -camHeading + Math.PI / 2;
    let lcur = c.group.rotation.y;
    let ldiff = lookRot - lcur;
    while (ldiff > Math.PI) ldiff -= Math.PI * 2;
    while (ldiff < -Math.PI) ldiff += Math.PI * 2;
    c.group.rotation.y = lcur + ldiff * Math.min(1, dt * 9);
  }

  // squash & stretch body (the wake-up unfurl owns body scale until it finishes;
  // night-sleep also owns body scale while drowsy)
  if (!c._waking && !(!c.flies && c.sleepiness > 0.05)) {
    const squash = 1 + Math.sin(c.bob) * 0.05 * (moving ? 1 : 0.4);
    c.body.scale.y = c.bodyBaseY * squash;
    c.body.scale.x = c.bodyBaseX / Math.sqrt(squash);
  }

  if (c.flies) {
    if (c.isFish) {
      // Visible fin flap — fast enough to read at a glance. Old values (rate
      // 2.2 / amp 0.25-0.18) felt nearly static; bumped to ~1.4 Hz with a
      // bigger amplitude so the small fins are clearly working.
      const phase = t * 5.5 + c.flapPhase;
      const wave = Math.sin(phase);
      for (let i = 0; i < c.wings.length; i++) {
        const sign = i === 0 ? -1 : 1;
        c.wings[i].rotation.z = sign * (0.18 + wave * 0.55);
        c.wings[i].rotation.y = Math.cos(phase * 0.85) * 0.32;
      }
      c.body.rotation.z = wave * 0.06;
    } else if (grounded) {
      // Wings mostly tucked, but with a small idle twitch so the bird never
      // looks completely lifeless. Period ~2s, amplitude small.
      const k = Math.min(1, dt * 5);
      const twitch = Math.sin(t * 3.0 + c.flapPhase) * 0.06;
      for (let i = 0; i < c.wings.length; i++) {
        const sign = i === 0 ? -1 : 1;
        const restRot = sign * (0.55 + twitch);
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
      const flapStrength = 0.55 + 0.45 * altRatio; // weaker flap near the ground
      const phase = t * c.flapSpeed + c.flapPhase;
      const flap = Math.sin(phase);
      for (let i = 0; i < c.wings.length; i++) {
        const sign = i === 0 ? -1 : 1;
        c.wings[i].rotation.z = sign * (0.15 + flap * 1.2 * flapStrength);
        c.wings[i].rotation.x = Math.cos(phase) * 0.18 * flapStrength;
      }
      c.body.rotation.z = -flap * 0.06 * flapStrength;
    }
  } else if (moving) {
    // diagonal trot pattern: FL+BR phase, FR+BL counter-phase
    const phases = [0, Math.PI, Math.PI, 0];
    for (let i = 0; i < c.feet.length; i++) {
      const sVal = Math.sin(c.bob + phases[i]);
      const footY = -0.32 + sVal * 0.09;
      c.feet[i].position.y = footY;
      c.legs[i].scale.y = -0.1 - footY;
      // Rising-edge footstep detection — fires once when sVal crosses 0.85
      // upward. Emit a small dust kick on dry ground. Cooldown gates
      // multiple kicks per stride.
      const prev = c.lastFootSin[i] ?? 0;
      if (sVal > 0.85 && prev <= 0.85 && t - c.lastDustAt > 0.18) {
        const fx = c.group.position.x;
        const fz = c.group.position.z;
        const fy = heightFn(fx, fz);
        if (fy > 0.1) {
          const kick = makeDustKick(fx, fy, fz, c.dirtColor);
          state.world.add(kick);
          state.dustKicks.push(kick);
          c.lastDustAt = t;
        }
      }
      c.lastFootSin[i] = sVal;
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

  const scale = isSnail ? 0.85 + Math.random() * 0.25 : 0.7 + Math.random() * 0.4;
  for (const s of segments) s.scale.setScalar(scale);

  // snail shell — a fat, slightly squashed icosphere parented to the
  // last body segment, in a contrasting color so it reads as a shell.
  if (isSnail) {
    const shellCol = baseCol.clone().offsetHSL(0.08, -0.05, -0.18);
    const shellGeo = jitterGeo(new THREE.IcosahedronGeometry(segRadius * 1.55, 1), 0.04);
    shellGeo.scale(1.0, 0.95, 0.85);
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

  // all segments — including the head — sit at the same base offset so
  // adjacent spheres at segSpacing = 2*radius actually touch.
  const baseOffset = c.segRadius * 0.7 * c.scale;
  const headY = heightFn(nx, nz) + baseOffset;
  head.position.set(nx, headY, nz);
  head.rotation.y = -c.heading + Math.PI / 2;
  head.rotation.x = Math.sin(c.age * 4) * 0.06;

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
  const minY = ground + 0.18;
  if (pos.y < minY) {
    pos.y = minY;
    if (b.velocity.y < 0) b.velocity.y = 0.3;
  }

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

// ─────────────────────────────────────────────────────────────────────────────
