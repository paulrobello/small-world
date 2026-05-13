import * as THREE from "three";
import { state, DENSITY_BASE } from "./state.js";
import { pickGroundPoint } from "./terrain.js";
import { GRASS_DENSITY } from "./biomes.js";
import { LOWFX, LOWFX_DENSITY } from "./lowfx.js";
import { applyWindSway } from "./util.js";

const _lowfxScale = (n) => (LOWFX ? Math.max(1, Math.round(n * LOWFX_DENSITY)) : n);
const _coverScale = (n, gain = 1) =>
  _lowfxScale(Math.round(n * (state.ISLAND_SIZE / DENSITY_BASE) * gain));

export function makeGrassField(biome, heightFn) {
  const count = _coverScale(GRASS_DENSITY[biome.id] ?? 300, 2.8);

  const blade = new THREE.PlaneGeometry(0.06, 0.34, 1, 3);
  const bp = blade.attributes.position;
  const tipCount = bp.count;
  const tipFactors = new Float32Array(tipCount);
  for (let i = 0; i < tipCount; i++) {
    const y = bp.getY(i) + 0.17;
    bp.setY(i, y);
    const taper = 1 - Math.min(1, y / 0.34) * 0.6;
    bp.setX(i, bp.getX(i) * taper);
    tipFactors[i] = Math.min(1, y / 0.34);
  }
  blade.setAttribute("aTipFactor", new THREE.BufferAttribute(tipFactors, 1));
  blade.computeVertexNormals();

  const baseCol = new THREE.Color(biome.ground[1]).offsetHSL(
    (Math.random() - 0.5) * 0.04, 0.1, -0.08
  );
  const tipCol = baseCol.clone().offsetHSL(0.0, -0.15, 0.18);

  const mat = new THREE.MeshStandardMaterial({
    color: baseCol,
    roughness: 0.95,
    side: THREE.DoubleSide,
    vertexColors: true,
  });

  const tipUniforms = { uTipColor: { value: tipCol } };
  const prevOnBeforeCompile = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    if (prevOnBeforeCompile) prevOnBeforeCompile(shader);
    shader.uniforms.uTipColor = tipUniforms.uTipColor;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute float aTipFactor;\nvarying float vTipFactor;"
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvTipFactor = aTipFactor;"
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 uTipColor;\nvarying float vTipFactor;"
      )
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uTipColor, vTipFactor * 0.85);"
      );
  };
  applyWindSway(mat, 1.8);

  const mesh = new THREE.InstancedMesh(blade, mat, count);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;

  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const e = new THREE.Euler();
  let placed = 0;
  let attempts = 0;
  while (placed < count && attempts < count * 5) {
    attempts++;
    const p = pickGroundPoint(0.88);
    const x = p.x;
    const z = p.z;
    const y = heightFn(x, z);
    if (y < -0.15) continue;
    v.set(x, y, z);
    s.setScalar(0.6 + Math.random() * 0.8);
    e.set(
      (Math.random() - 0.5) * 0.18,
      Math.random() * Math.PI * 2,
      (Math.random() - 0.5) * 0.18
    );
    q.setFromEuler(e);
    m.compose(v, q, s);
    mesh.setMatrixAt(placed, m);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;

  const colors = new Float32Array(mesh.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < mesh.count; i++) {
    tmp.copy(baseCol).offsetHSL(
      (Math.random() - 0.5) * 0.08,
      0,
      (Math.random() - 0.5) * 0.10
    );
    colors[i * 3 + 0] = tmp.r / baseCol.r || 1;
    colors[i * 3 + 1] = tmp.g / baseCol.g || 1;
    colors[i * 3 + 2] = tmp.b / baseCol.b || 1;
  }
  mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  mesh.instanceColor.needsUpdate = true;

  state.grass = { mesh, uniforms: tipUniforms };
  return mesh;
}

export function stepGrass(_camera) {
  // No-op in skeleton task — uniforms aren't camera-dependent yet.
  // Real implementation lands in Task 5.
}
