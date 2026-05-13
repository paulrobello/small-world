import * as THREE from "three";
import { state } from "./state.js";
import { LOWFX } from "./lowfx.js";
import { CLOUD_COUNT, AURORA_BIOMES, AURORA_TINTS } from "./biomes.js";

// ─────────────────────────────────────────────────────────────────────────────
// Sky dome — vertical gradient shader sphere. Replaces scene.background so the
// horizon line isn't a flat color seam. Uniforms (uZenith / uHorizon) are
// mutated each frame by updateDayNight so the dome inherits the same dawn /
// day / dusk / night palette transitions as the rest of the world.
// ─────────────────────────────────────────────────────────────────────────────
export function makeSkyDome(biome) {
  // Big enough to sit behind the parallax mountains (radius 200) and well
  // outside the camera maxDistance (72).
  const geo = new THREE.SphereGeometry(380, 32, 20);
  const zenith = new THREE.Color(biome.sky).offsetHSL(0, 0.04, -0.06);
  const horizon = new THREE.Color(biome.fog).offsetHSL(0, 0.02, 0.04);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uZenith: { value: zenith },
      uHorizon: { value: horizon },
      // shapes the gradient — higher = horizon stays low, lower = horizon
      // color bleeds up the sky. 1.6 reads as a soft painterly transition.
      uExp: { value: 1.6 },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform float uExp;
      varying vec3 vDir;
      void main() {
        float t = clamp(vDir.y + 0.05, 0.0, 1.0);
        t = pow(t, uExp);
        gl_FragColor = vec4(mix(uHorizon, uZenith, t), 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(geo, mat);
  // draw first, behind everything; never frustum-cull a 760-diameter sphere
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  return dome;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mountain backdrop — two concentric wobbled cylinders behind the island, so
// the horizon reads as a layered silhouette rather than a flat fog band.
// Both rings inherit the biome palette and are nudged toward fog at night
// (via updateDayNight) so they recede into the sky after dusk.
// ─────────────────────────────────────────────────────────────────────────────
function makeWobbledRing(radius, height, peakAmp, peakDetail, segs) {
  const geo = new THREE.CylinderGeometry(radius, radius, height, segs, 4, true);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const a = Math.atan2(z, x);
      // Three octaves of angular sin so peaks have rolling sub-bumps instead
      // of a regular sine pattern. peakDetail picks the dominant frequencies.
      const wobble =
        Math.sin(a * peakDetail.f1) * peakAmp +
        Math.sin(a * peakDetail.f2 + peakDetail.p2) * peakAmp * 0.6 +
        Math.sin(a * peakDetail.f3 - peakDetail.p3) * peakAmp * 1.2;
      const lift = (y / (height * 0.5)) * wobble;
      pos.setY(i, y + lift);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

export function makeMountainBackdrop(biome) {
  const group = new THREE.Group();
  const skyC = new THREE.Color(biome.sky);
  const fogC = new THREE.Color(biome.fog);

  // Far ring — sits between the sky dome and the island. Lighter, taller,
  // hazier — reads as distant peaks fading into the sky.
  const farGeo = makeWobbledRing(
    220, 36, 7,
    { f1: 5, f2: 11, p2: 1.7, f3: 3, p3: 0.4 },
    96
  );
  const farTint = fogC.clone().lerp(skyC, 0.75);
  const farMat = new THREE.MeshBasicMaterial({
    color: farTint,
    side: THREE.BackSide,
    fog: false, // we want them to read past the world's fog band
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
  });
  const far = new THREE.Mesh(farGeo, farMat);
  far.position.y = 6;
  far.renderOrder = -50;
  far.frustumCulled = false;
  group.add(far);

  // Near ring — closer to the island, darker, more defined silhouettes.
  // This is the silhouette band that sells "the world sits in a valley".
  const nearGeo = makeWobbledRing(
    115, 24, 4,
    { f1: 7, f2: 13, p2: 1.2, f3: 4, p3: 1.9 },
    96
  );
  const nearTint = fogC.clone().lerp(skyC, 0.4);
  const nearMat = new THREE.MeshBasicMaterial({
    color: nearTint,
    side: THREE.BackSide,
    fog: true, // fog hides the base, leaving only the peaks
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const near = new THREE.Mesh(nearGeo, nearMat);
  near.position.y = 2;
  near.renderOrder = -40;
  near.frustumCulled = false;
  group.add(near);

  // expose mats so day/night can re-tint each layer at dusk/night
  group.userData.farMat = farMat;
  group.userData.nearMat = nearMat;
  group.userData.farBase = farTint.clone();
  group.userData.nearBase = nearTint.clone();
  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloud layer — soft circular sprites floating beyond the mountain silhouettes.
// Per-biome density (cloudCount) and tint live on the biome config; biomes with
// cloudCount 0 / undefined get no clouds (desert, ashen). Sprites are placed in
// loose clusters across the upper hemisphere so the sky reads as puffy clumps
// instead of evenly-spaced dots. Clouds drift slowly via stepClouds.
// ─────────────────────────────────────────────────────────────────────────────
let _cloudTex = null;
function getCloudTexture() {
  if (_cloudTex) return _cloudTex;
  // Generate a soft puff texture procedurally so we don't ship a PNG.
  const size = 128;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  // Layered radial gradients to fake clumpy cloud silhouette
  const blobs = [
    { x: 0.5, y: 0.55, r: 0.42, a: 0.95 },
    { x: 0.32, y: 0.6, r: 0.28, a: 0.85 },
    { x: 0.68, y: 0.62, r: 0.30, a: 0.85 },
    { x: 0.4, y: 0.45, r: 0.22, a: 0.7 },
    { x: 0.62, y: 0.46, r: 0.20, a: 0.7 },
  ];
  for (const b of blobs) {
    const g = ctx.createRadialGradient(
      b.x * size, b.y * size, 0,
      b.x * size, b.y * size, b.r * size
    );
    g.addColorStop(0, `rgba(255,255,255,${b.a})`);
    g.addColorStop(0.6, `rgba(255,255,255,${b.a * 0.4})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  _cloudTex = new THREE.CanvasTexture(c);
  _cloudTex.colorSpace = THREE.SRGBColorSpace;
  return _cloudTex;
}

export function makeCloudLayer(biome) {
  const base = CLOUD_COUNT[biome.id] ?? 12;
  const count = LOWFX ? Math.max(2, Math.floor(base * 0.5)) : base;
  if (count <= 0) return null;

  const group = new THREE.Group();
  const tint = new THREE.Color(biome.cloudTint ?? biome.sky)
    .lerp(new THREE.Color(0xffffff), 0.35);
  const tex = getCloudTexture();
  const mat = new THREE.SpriteMaterial({
    map: tex,
    color: tint,
    transparent: true,
    // Default opacity stays low so distant clouds don't dominate the sky —
    // they're meant to accent the dome gradient, not replace it. Per-biome
    // override via cloudOpacity for skies that want a visibly cloudy look.
    opacity: biome.cloudOpacity ?? 0.32,
    depthWrite: false,
    fog: false,
  });

  // Distribute cluster centers across the upper hemisphere — sphere radius
  // 180-240, polar angle theta from 25° (overhead) to 82° (near horizon).
  // The hemisphere cap keeps clouds visible from every orbit angle; clustering
  // several sprites around each center makes them read as cottony puffs rather
  // than a regular dotted field.
  const sprites = [];
  const thetaMin = 0.44; // ~25° from zenith
  const thetaMax = 1.43; // ~82° from zenith
  const clusterCount = Math.max(1, Math.ceil(count / 4));
  let remaining = count;
  for (let ci = 0; ci < clusterCount; ci++) {
    const remainingClusters = clusterCount - ci;
    const evenShare = Math.ceil(remaining / remainingClusters);
    const maxThisCluster = remaining - (remainingClusters - 1);
    const clusterSize = remainingClusters === 1
      ? remaining
      : Math.max(
        1,
        Math.min(maxThisCluster, evenShare + Math.floor(Math.random() * 3) - 1)
      );
    remaining -= clusterSize;

    const phiStep = Math.PI * 2 / clusterCount;
    const clusterPhi = ci * phiStep + (Math.random() - 0.5) * phiStep * 0.55;
    const clusterTheta = thetaMin + Math.random() * (thetaMax - thetaMin);
    const clusterSphereR = 180 + Math.random() * 60;
    const clusterSpread = 0.024 + Math.random() * 0.026;
    const driftSpeed = 0.012 + Math.random() * 0.018;

    for (let i = 0; i < clusterSize; i++) {
      const around = (i / clusterSize) * Math.PI * 2 + Math.random() * 0.9;
      const offset = Math.sqrt(Math.random()) * clusterSpread;
      const phi = clusterPhi + Math.cos(around) * offset / Math.max(0.45, Math.sin(clusterTheta));
      const theta = Math.max(
        thetaMin,
        Math.min(
          thetaMax,
          clusterTheta + Math.sin(around) * offset * 0.8 + (Math.random() - 0.5) * 0.025
        )
      );
      const sphereR = clusterSphereR + (Math.random() - 0.5) * 10;
      const xzR = sphereR * Math.sin(theta);
      const y = sphereR * Math.cos(theta);
      const s = new THREE.Sprite(mat.clone());
      s.position.set(Math.cos(phi) * xzR, y, Math.sin(phi) * xzR);
      // Broad puffs overlap inside each cluster so separate sprites merge into
      // one cottony mass instead of reading as individual dots. In-cluster
      // variation keeps the silhouette soft and hand-placed.
      const scale = 14 + Math.random() * 10;
      s.scale.set(
        scale * (2.0 + Math.random() * 0.65),
        scale * (0.72 + Math.random() * 0.26),
        1
      );
      s.material.opacity *= 0.72 + Math.random() * 0.3;
      s.material.rotation = (Math.random() - 0.5) * 0.45;
      s.userData.driftSpeed = driftSpeed;
      s.userData.angle = phi;
      s.userData.radius = xzR;
      s.userData.height = y;
      s.renderOrder = -30;
      group.add(s);
      sprites.push(s);
    }
  }
  group.userData.sprites = sprites;
  group.userData.baseTint = tint.clone();
  return group;
}

export function stepClouds(group, dt) {
  if (!group) return;
  for (const s of group.userData.sprites) {
    s.userData.angle += s.userData.driftSpeed * dt;
    s.position.x = Math.cos(s.userData.angle) * s.userData.radius;
    s.position.z = Math.sin(s.userData.angle) * s.userData.radius;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Starfield — points cloud on the upper sky hemisphere. Hidden during the day
// and fades in at night via updateDayNight. Single mesh, shared across all
// biomes; the per-biome aurora layer (below) adds biome-specific night color.
// ─────────────────────────────────────────────────────────────────────────────
export function makeStarfield() {
  const count = LOWFX ? 220 : 600;
  const positions = new Float32Array(count * 3);
  const brights = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Random direction biased to upper hemisphere so we don't waste stars
    // underground (the dome's lower half is below the horizon anyway).
    const u = Math.random();
    const v = 0.15 + Math.random() * 0.85; // 0=bottom, 1=top — bias up
    const theta = u * Math.PI * 2;
    const phi = Math.acos(2 * v - 1);
    const r = 350;
    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
    positions[i * 3 + 1] = Math.cos(phi) * r;
    positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    brights[i] = 0.4 + Math.random() * 0.6;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aBright", new THREE.BufferAttribute(brights, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uAlpha: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: `
      attribute float aBright;
      varying float vBright;
      void main() {
        vBright = aBright;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 1.0 + aBright * 1.6;
      }
    `,
    fragmentShader: `
      uniform float uAlpha;
      uniform float uTime;
      varying float vBright;
      void main() {
        // soft circular point
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float a = smoothstep(0.5, 0.0, d);
        // subtle twinkle — phase from brightness so neighbors don't sync
        float twinkle = 0.7 + 0.3 * sin(uTime * 2.3 + vBright * 18.0);
        gl_FragColor = vec4(vec3(1.0, 0.96, 0.9) * vBright * twinkle, a * uAlpha);
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = -90;
  points.frustumCulled = false;
  return points;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aurora — wide curtain mesh for biomes that look good with cold/night skies.
// Biome opt-in via `aurora: true`; otherwise this returns null. Fades in
// alongside the starfield at night.
// ─────────────────────────────────────────────────────────────────────────────
export function makeAurora(biome) {
  if (!AURORA_BIOMES.has(biome.id)) return null;

  // A few overlapping curtains at different angles around the horizon.
  const group = new THREE.Group();
  const tints = AURORA_TINTS[biome.id] ?? ["#7df0c8", "#a98cff"];
  const tintA = new THREE.Color(tints[0]);
  const tintB = new THREE.Color(tints[1]);

  for (let i = 0; i < 3; i++) {
    const w = 220;
    const h = 70;
    const geo = new THREE.PlaneGeometry(w, h, 32, 1);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
      side: THREE.DoubleSide,
      uniforms: {
        uAlpha: { value: 0 },
        uTime: { value: 0 },
        uA: { value: tintA },
        uB: { value: tintB },
        uSeed: { value: i * 1.7 },
      },
      vertexShader: `
        uniform float uTime;
        uniform float uSeed;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          // gentle horizontal ripple to suggest curtain motion
          p.x += sin(p.x * 0.04 + uTime * 0.3 + uSeed) * 4.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uAlpha;
        uniform float uTime;
        uniform float uSeed;
        uniform vec3 uA;
        uniform vec3 uB;
        varying vec2 vUv;
        void main() {
          // vertical fade — bright at top, transparent at bottom
          float vfade = smoothstep(0.0, 0.4, vUv.y) * smoothstep(1.0, 0.6, vUv.y);
          // horizontal bands wobble over time so the curtain seems to ripple
          float band = 0.5 + 0.5 * sin(vUv.x * 22.0 + uTime * 0.7 + uSeed * 3.1);
          band = smoothstep(0.3, 0.9, band);
          vec3 col = mix(uA, uB, vUv.x + 0.2 * sin(uTime * 0.5 + uSeed));
          float a = vfade * band * 0.55 * uAlpha;
          gl_FragColor = vec4(col, a);
        }
      `,
    });
    const m = new THREE.Mesh(geo, mat);
    // Sit between mountain rings and the sky dome, at a height that's clearly
    // in-frame for the default orbit camera (y≈25 looking at the island).
    m.position.set(0, 40, -150);
    m.rotation.y = Math.random() * 0.3;
    // rotate around scene origin by rotating the parent group? simpler: keep
    // each curtain at its own angle by parenting to a per-mesh pivot.
    m.frustumCulled = false;
    m.renderOrder = -70;
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / 3) * Math.PI * 2;
    pivot.add(m);
    group.add(pivot);
  }
  group.userData.curtains = group.children.map(p => p.children[0]);
  return group;
}

// Stepping for sky-dome / mountain re-tinting (called by updateDayNight in
// world.js — kept here so all sky knobs live alongside their constructors).
// Cloud-biome swirling cloud halo. A wide flat torus around the island with
// a custom shader: two-octave value noise sampled at UV, scrolled in opposing
// directions to read as swirling, soft alpha falloff at the torus poles, and
// colors blended from biome.fog → biome.accent. Returns null on any biome
// that isn't flagged cloudlike.
export function makeCloudSwirl(biome) {
  if (!biome.cloudlike) return null;

  const radius = 30.0;      // major radius — wraps around the island
  const tube = 7.0;         // minor radius — thickness of the cloud band
  const geo = new THREE.TorusGeometry(radius, tube, 14, 96);

  const colA = new THREE.Color(biome.fog);
  const colB = new THREE.Color(biome.accent);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: state.windUniforms.uTime,   // shared time — no per-frame step needed
      uColA: { value: colA },
      uColB: { value: colB },
      uAlpha: { value: 0.55 },           // overall opacity
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform vec3  uColA;
      uniform vec3  uColB;
      uniform float uAlpha;
      varying vec2  vUv;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i),             hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      // Two octaves at different scales, scrolled in opposite directions
      // along U; together they read as slow-swirling cumulus.
      float swirl(vec2 uv, float t) {
        float a = vnoise(vec2(uv.x * 8.0 - t * 0.08, uv.y * 4.0));
        float b = vnoise(vec2(uv.x * 16.0 + t * 0.14, uv.y * 8.0 + t * 0.05));
        return 0.65 * a + 0.45 * b;
      }

      void main() {
        // Distort the lookup itself with a low-frequency noise to break
        // up directional banding — gives the "curling" feel.
        vec2 warp = vec2(
          vnoise(vUv * 2.7 + vec2(uTime * 0.04, 0.0)),
          vnoise(vUv * 2.1 + vec2(0.0, uTime * 0.03))
        );
        float n = swirl(vUv + (warp - 0.5) * 0.25, uTime);

        // Softer-edge fog (low end of noise) → bright tufts (high end).
        float density = smoothstep(0.30, 0.95, n);

        // Fade the band near the torus poles (v → 0 or 1) so it doesn't
        // read as a hard ring — soft top/bottom edges.
        float pole = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);

        vec3 col = mix(uColA, uColB, density * 0.55);
        float a = density * pole * uAlpha;
        gl_FragColor = vec4(col, a);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, mat);
  // Lay the torus flat (around Y axis) so the band wraps horizontally
  // around the island.
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = 6.0;     // sits just above the island silhouette
  mesh.frustumCulled = false;
  mesh.renderOrder = -65;    // behind the clouds layer, in front of mountains
  return mesh;
}

export function updateSkyColors(skyDome, mountains, dayNight, dayFactor, nightAmt) {
  if (skyDome) {
    const u = skyDome.material.uniforms;
    // Zenith follows the biome's sky color (day → dusk → night)
    blendDuskDayNight(u.uZenith.value, dayNight.sky, dayNight.duskSky, dayNight.nightSky, dayFactor);
    // ...darkened a touch toward the horizon shade so we never go pure black
    u.uZenith.value.offsetHSL(0, 0.02, -0.04);
    // Horizon follows the fog color
    blendDuskDayNight(u.uHorizon.value, dayNight.fog, dayNight.duskFog, dayNight.nightFog, dayFactor);
  }
  if (mountains) {
    const ud = mountains.userData;
    // Far ring nudges toward sky color during day, fog at night
    ud.farMat.color.copy(ud.farBase).lerp(dayNight.nightFog, nightAmt * 0.6);
    ud.nearMat.color.copy(ud.nearBase).lerp(dayNight.nightFog, nightAmt * 0.55);
  }
}

function blendDuskDayNight(out, day, dusk, night, f) {
  if (!dusk) return out.copy(day).lerp(night, 1 - f);
  if (f >= 0.5) return out.copy(dusk).lerp(day, (f - 0.5) * 2);
  return out.copy(night).lerp(dusk, f * 2);
}
