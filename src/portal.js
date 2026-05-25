import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import { ISLAND_RADIUS_BASE, ISLAND_SIZE_BASE, disposeGroup } from "./state.js";
import { makeHeightFn } from "./terrain.js";
import { makeSkyDome, makeMountainBackdrop, makeCloudLayer } from "./sky.js";
import { LOWFX } from "./lowfx.js";
import { mulberry32 } from "./seed.js";

const PORTAL_RT_SIZE = LOWFX ? 192 : 384;
const PORTAL_RENDER_INTERVAL_MS = LOWFX ? 180 : 90;
const PORTAL_ACTIVE_DISTANCE = LOWFX ? 52 : 90;
const PORTAL_RING_RADIUS = 1.48;
const PORTAL_VIEW_RADIUS = PORTAL_RING_RADIUS - 0.04;
const PORTAL_TRAVEL_PLANE_EPSILON = 0.38;
const PORTAL_TRAVEL_RADIUS = PORTAL_VIEW_RADIUS * 0.8;
const PORTAL_ARRIVAL_OFFSET = PORTAL_RING_RADIUS + 0.9;

function normalizePortalPreviewSettings(settings = {}) {
  return {
    portalPreviewGrass: settings.portalPreviewGrass === true,
    portalPreviewFlora: settings.portalPreviewFlora !== false,
    portalPreviewCreatures: settings.portalPreviewCreatures === true,
    portalPreviewFx: settings.portalPreviewFx !== false,
  };
}

function portalNormal(portal) {
  const yaw = portal?.group?.rotation?.y ?? 0;
  return { x: Math.sin(yaw), z: Math.cos(yaw) };
}

export function isCameraPassingThroughPortal(portal, camera, worldScale = 1) {
  if (!portal || !camera) return false;
  const invWorldScale = 1 / Math.max(0.001, worldScale);
  const center = portal.group.position;
  const normal = portalNormal(portal);
  const tangent = { x: Math.cos(portal.group.rotation.y), z: -Math.sin(portal.group.rotation.y) };
  const dx = camera.position.x * invWorldScale - center.x;
  const dy = camera.position.y * invWorldScale - center.y;
  const dz = camera.position.z * invWorldScale - center.z;
  const planeDist = Math.abs(dx * normal.x + dz * normal.z);
  const sideDist = dx * tangent.x + dz * tangent.z;
  const discDistSq = sideDist * sideDist + dy * dy;
  return planeDist < PORTAL_TRAVEL_PLANE_EPSILON && discDistSq < PORTAL_TRAVEL_RADIUS * PORTAL_TRAVEL_RADIUS;
}

export function getPortalArrivalPose(portal) {
  const normal = portalNormal(portal);
  const center = portal.group.position;
  return {
    x: center.x + normal.x * PORTAL_ARRIVAL_OFFSET,
    z: center.z + normal.z * PORTAL_ARRIVAL_OFFSET,
    yaw: Math.atan2(normal.x, normal.z) + Math.PI,
  };
}

function makePortalRenderTarget(name) {
  const rt = new THREE.WebGLRenderTarget(PORTAL_RT_SIZE, PORTAL_RT_SIZE, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  rt.texture.name = name;
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  return rt;
}

function makePortalMaterial(frontTexture, backTexture, settings) {
  return new THREE.ShaderMaterial({
    uniforms: {
      tPortalFront: { value: frontTexture },
      tPortalBack: { value: backTexture },
      uEdgeColor: { value: new THREE.Color("#f6e7ff") },
      uTime: { value: 0 },
      uDistortStrength: { value: LOWFX ? 0.009 : 0.015 },
      uFxStrength: { value: settings.portalPreviewFx ? 1 : 0 },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tPortalFront;
      uniform sampler2D tPortalBack;
      uniform vec3 uEdgeColor;
      uniform float uTime;
      uniform float uDistortStrength;
      uniform float uFxStrength;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float d = length(p);
        if (d > 1.0) discard;
        float angle = atan(p.y, p.x);
        float radialWave = sin(d * 22.0 - uTime * 2.8);
        float swirlWave = sin(angle * 7.0 + d * 8.0 + uTime * 1.7);
        float rippleMask = smoothstep(0.06, 0.42, d) * (1.0 - smoothstep(0.94, 1.0, d));
        vec2 radialDir = p / max(d, 0.001);
        vec2 tangentDir = vec2(-radialDir.y, radialDir.x);
        vec2 warpedUv = vUv
          + radialDir * radialWave * uDistortStrength * rippleMask * uFxStrength
          + tangentDir * swirlWave * uDistortStrength * 0.42 * rippleMask * uFxStrength;
        warpedUv = clamp(warpedUv, vec2(0.001), vec2(0.999));
        vec3 frontCol = texture2D(tPortalFront, warpedUv).rgb;
        vec3 backCol = texture2D(tPortalBack, warpedUv).rgb;
        vec3 col = gl_FrontFacing ? frontCol : backCol;
        col += (radialWave * 0.5 + 0.5) * 0.035 * rippleMask * uFxStrength;
        float rim = smoothstep(0.86, 1.0, d);
        float alpha = 1.0 - smoothstep(0.985, 1.0, d);
        col = mix(col, uEdgeColor, rim * 0.18 * uFxStrength);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

function makePreviewTerrain(biome, heightFn, size) {
  const geo = new THREE.PlaneGeometry(size, size, 64, 64);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color(biome.ground[0]);
  const mid = new THREE.Color(biome.ground[1]);
  const high = new THREE.Color(biome.ground[2]);
  const cliff = new THREE.Color(biome.cliff);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightFn(x, z);
    pos.setY(i, y);
    const t = THREE.MathUtils.clamp((y + 1.0) / 4.2, 0, 1);
    tmp.copy(low).lerp(t < 0.52 ? mid : high, t < 0.52 ? t / 0.52 : (t - 0.52) / 0.48);
    tmp.lerp(cliff, Math.max(0, Math.min(0.32, Math.abs(y) * 0.045)));
    colors[i * 3 + 0] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  return mesh;
}

function makePreviewFlora(biome, rng, heightFn, layout) {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.cliff).lerp(new THREE.Color("#3b2418"), 0.35),
    roughness: 0.85,
  });
  const crownMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.accent).lerp(new THREE.Color(biome.ground[2]), 0.35),
    roughness: 0.8,
  });
  const rockMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.cliff).lerp(new THREE.Color(biome.fog), 0.18),
    roughness: 0.92,
  });
  for (let i = 0; i < 28; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * layout.boundRadius * 0.72;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad;
    const y = heightFn(x, z);
    if (y < -0.22) continue;
    let obj;
    if (rng() < 0.68) {
      obj = new THREE.Group();
      const h = 0.55 + rng() * 0.8;
      const trunk = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, h, 4, 6), trunkMat);
      trunk.position.y = h * 0.45;
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34 + rng() * 0.22, 1), crownMat);
      crown.position.y = h + 0.36;
      crown.scale.set(1.1, 0.82, 1.05);
      obj.add(trunk, crown);
    } else {
      obj = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18 + rng() * 0.22, 1), rockMat);
      obj.scale.y = 0.55 + rng() * 0.35;
      obj.position.y = 0.12;
    }
    obj.position.set(x, y - 0.03, z);
    obj.rotation.y = rng() * Math.PI * 2;
    obj.scale.setScalar(0.8 + rng() * 0.6);
    group.add(obj);
  }
  return group;
}

function makePreviewGrass(biome, rng, heightFn, layout) {
  const count = LOWFX ? 80 : 180;
  const geo = new THREE.ConeGeometry(0.028, 0.42, 4, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(biome.ground[1]).lerp(new THREE.Color(biome.accent), 0.24),
    roughness: 0.88,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = "PortalPreviewGrass";
  const dummy = new THREE.Object3D();
  let placed = 0;
  for (let i = 0; i < count; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * layout.boundRadius * 0.76;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad;
    const y = heightFn(x, z);
    if (y < -0.18) continue;
    const s = 0.6 + rng() * 0.9;
    dummy.position.set(x, y + 0.18 * s, z);
    dummy.rotation.set(0, rng() * Math.PI * 2, 0);
    dummy.scale.set(0.7 + rng() * 0.45, s, 0.7 + rng() * 0.45);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed++, dummy.matrix);
  }
  mesh.count = placed;
  return mesh;
}

function makePreviewCreatures(biome, rng, heightFn, layout) {
  const group = new THREE.Group();
  group.name = "PortalPreviewCreatures";
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfffbf0 });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x1c1720 });
  const palette = biome.creatureColors ?? [biome.accent];
  for (let i = 0; i < (LOWFX ? 3 : 6); i++) {
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * layout.boundRadius * 0.58;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad;
    const y = heightFn(x, z);
    if (y < -0.2) continue;
    const bodyMat = new THREE.MeshStandardMaterial({
      color: palette[Math.floor(rng() * palette.length)],
      roughness: 0.78,
    });
    const creature = new THREE.Group();
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 + rng() * 0.12, 2), bodyMat);
    body.scale.set(1.1, 0.78, 0.92);
    body.position.y = 0.28;
    creature.add(body);
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), eyeMat);
      eye.position.set(sx * 0.12, 0.38, -0.23);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), pupilMat);
      pupil.position.set(sx * 0.12, 0.38, -0.275);
      creature.add(eye, pupil);
    }
    creature.position.set(x, y + 0.02, z);
    creature.rotation.y = rng() * Math.PI * 2;
    creature.scale.setScalar(0.82 + rng() * 0.35);
    group.add(creature);
  }
  return group;
}

function buildPortalPreviewScene(targetBiome, seed, previewSettings = {}) {
  const settings = normalizePortalPreviewSettings(previewSettings);
  const previewScene = new THREE.Scene();
  previewScene.name = "PortalPreview";
  previewScene.background = new THREE.Color(targetBiome.sky);
  previewScene.fog = new THREE.FogExp2(new THREE.Color(targetBiome.fog), targetBiome.fogDensity * 0.65);

  const rng = mulberry32((seed ^ 0x9e37) >>> 0);
  const layout = {
    centers: [{
      cx: 0,
      cz: 0,
      radius: ISLAND_RADIUS_BASE * 0.82,
      visualRadius: ISLAND_RADIUS_BASE,
      shape: { kind: "round" },
    }],
    planeSize: ISLAND_SIZE_BASE * 0.9,
    boundRadius: ISLAND_RADIUS_BASE,
    kind: "portal-preview",
  };
  const heightFn = makeHeightFn(createNoise2D(rng), layout, targetBiome.cloudlike ? 1.65 : 2.55);

  previewScene.add(makeSkyDome(targetBiome));
  const mountains = makeMountainBackdrop(targetBiome);
  mountains.position.y -= 2.2;
  previewScene.add(mountains);
  const clouds = makeCloudLayer(targetBiome);
  if (clouds) previewScene.add(clouds);
  previewScene.add(new THREE.HemisphereLight(new THREE.Color(targetBiome.sky), new THREE.Color(targetBiome.ground[0]), 1.5));
  const sun = new THREE.DirectionalLight(new THREE.Color(targetBiome.sun), 1.4);
  sun.position.set(10, 16, 8);
  previewScene.add(sun);
  previewScene.add(makePreviewTerrain(targetBiome, heightFn, layout.planeSize));
  if (settings.portalPreviewFlora) previewScene.add(makePreviewFlora(targetBiome, rng, heightFn, layout));
  if (settings.portalPreviewGrass) previewScene.add(makePreviewGrass(targetBiome, rng, heightFn, layout));
  if (settings.portalPreviewCreatures) previewScene.add(makePreviewCreatures(targetBiome, rng, heightFn, layout));

  const previewFrontCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 140);
  previewFrontCamera.position.set(8.5, 5.2, 11.5);
  previewFrontCamera.lookAt(0, 0.9, 0);

  const previewBackCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 140);
  previewBackCamera.position.set(-8.5, 5.2, -11.5);
  previewBackCamera.lookAt(0, 0.9, 0);

  return { scene: previewScene, frontCamera: previewFrontCamera, backCamera: previewBackCamera };
}

export function createBiomePortal({
  sourceBiome,
  targetBiome,
  x,
  y,
  z,
  heading = 0,
  seed = 0,
  previewSettings = {},
}) {
  const settings = normalizePortalPreviewSettings(previewSettings);
  const frontRt = makePortalRenderTarget("PortalPreviewFrontTexture");
  const backRt = makePortalRenderTarget("PortalPreviewBackTexture");

  const preview = buildPortalPreviewScene(targetBiome, seed, settings);

  const group = new THREE.Group();
  group.name = "PortalRing";
  group.position.set(x, y + PORTAL_RING_RADIUS - 0.18, z);
  group.rotation.y = heading;
  group.userData.portal = { sourceBiome: sourceBiome.id, targetBiome: targetBiome.id };

  const ringMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(sourceBiome.cliff).lerp(new THREE.Color(targetBiome.accent), 0.22),
    emissive: new THREE.Color(targetBiome.accent).multiplyScalar(0.16),
    roughness: 0.62,
    metalness: 0.08,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(PORTAL_RING_RADIUS, 0.13, 12, 72), ringMat);
  ring.name = "PortalRing";
  ring.castShadow = true;
  ring.receiveShadow = true;
  group.add(ring);

  const view = new THREE.Mesh(
    new THREE.CircleGeometry(PORTAL_VIEW_RADIUS, 72),
    makePortalMaterial(frontRt.texture, backRt.texture, settings)
  );
  view.name = "PortalView";
  view.position.z = 0.018;
  group.add(view);

  return {
    group,
    ring,
    view,
    frontRt,
    backRt,
    previewScene: preview.scene,
    previewFrontCamera: preview.frontCamera,
    previewBackCamera: preview.backCamera,
    sourceBiome,
    targetBiome,
    seed,
    previewSettings: settings,
    lastRenderAt: -Infinity,
    blocker: { kind: "portal", x, z, r: PORTAL_RING_RADIUS * 1.35, grassRadius: PORTAL_RING_RADIUS * 1.45 },
    obstacle: { kind: "portal", x, z, r: PORTAL_RING_RADIUS * 1.12, top: y + PORTAL_RING_RADIUS * 2.0 },
  };
}

export function updatePortalPreview(portal, renderer, camera, nowSeconds = 0) {
  if (!portal || !renderer || !camera) return;
  portal.view.material.uniforms.uTime.value = nowSeconds;
  if (camera.position.distanceTo(portal.group.position) > PORTAL_ACTIVE_DISTANCE) return;
  const nowMs = nowSeconds * 1000;
  if (nowMs - portal.lastRenderAt < PORTAL_RENDER_INTERVAL_MS) return;
  portal.lastRenderAt = nowMs;

  const prevTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(portal.frontRt);
  renderer.clear();
  renderer.render(portal.previewScene, portal.previewFrontCamera);
  renderer.setRenderTarget(portal.backRt);
  renderer.clear();
  renderer.render(portal.previewScene, portal.previewBackCamera);
  renderer.setRenderTarget(prevTarget);
}

export function updatePortalPreviewSettings(portal, previewSettings = {}) {
  if (!portal) return;
  const settings = normalizePortalPreviewSettings(previewSettings);
  portal.previewSettings = settings;
  if (portal.view?.material?.uniforms?.uFxStrength) {
    portal.view.material.uniforms.uFxStrength.value = settings.portalPreviewFx ? 1 : 0;
  }
  disposeGroup(portal.previewScene);
  const preview = buildPortalPreviewScene(portal.targetBiome, portal.seed, settings);
  portal.previewScene = preview.scene;
  portal.previewFrontCamera = preview.frontCamera;
  portal.previewBackCamera = preview.backCamera;
  portal.lastRenderAt = -Infinity;
}

export function disposePortal(portal) {
  if (!portal) return;
  disposeGroup(portal.group);
  disposeGroup(portal.previewScene);
  portal.frontRt?.dispose();
  portal.backRt?.dispose();
}
