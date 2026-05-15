import * as THREE from "three";
import { state } from "./state.js";
import { jitterGeo, applyWindSway, TRUNK } from "./util.js";
import { BLOOM_LAYER } from "./postfx.js";

// Cactus needles. Each spine is a real little cone mesh sitting on the
// capsule's surface, oriented along the outward normal — the shell-fur
// approach we use for fuzzy creatures renders frosted square columns at
// sparse densities, which reads as ice crystals rather than thin spikes.
// One InstancedMesh per cactus part keeps the draw count down (a single
// 3-arm cactus is at most 3 draws regardless of needle count).
const NEEDLE_TIP_COLOR = new THREE.Color("#f5ead0");
const NEEDLE_LENGTH = 0.085;
const NEEDLE_DENSITY = 95; // needles per local-unit² of capsule surface area
function addCapsuleNeedles(parent, radius, length) {
  // One needle geo + material are pooled per regen — disposeGroup runs on
  // state.world before resetFloraPool(), so the disposed cone gets re-built
  // by the pool factory on the next world. (A module-scoped singleton would
  // hand back a stale, already-disposed geometry handle.)
  const needleGeo = pooled("cactus.needle.geo", () => {
    const g = new THREE.ConeGeometry(0.0112, NEEDLE_LENGTH, 4);
    g.translate(0, NEEDLE_LENGTH / 2, 0);
    return g;
  });
  const needleMat = pooled("cactus.needle.mat", () =>
    new THREE.MeshStandardMaterial({
      color: NEEDLE_TIP_COLOR,
      flatShading: true,
      roughness: 0.55,
    })
  );
  // CapsuleGeometry(radius, length, ...) defines `length` as the cylinder run
  // between the two hemispherical caps, with the local Y-axis as the spine.
  // We sample uniformly by surface area across cylinder + caps.
  const cylArea = 2 * Math.PI * radius * length;
  const capArea = 4 * Math.PI * radius * radius;
  const totalArea = cylArea + capArea;
  const count = Math.max(8, Math.round(totalArea * NEEDLE_DENSITY));
  const inst = new THREE.InstancedMesh(needleGeo, needleMat, count);
  inst.castShadow = false; // shadow per-needle would shimmer and is invisible at this scale
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scl = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const norm = new THREE.Vector3();
  const halfL = length / 2;
  for (let i = 0; i < count; i++) {
    if (Math.random() * totalArea < cylArea) {
      const a = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.5) * length;
      norm.set(Math.cos(a), 0, Math.sin(a));
      pos.set(norm.x * radius, y, norm.z * radius);
    } else {
      // sample a unit hemisphere normal (theta ∈ [0, π/2]) using
      // u = cos(theta) uniformly distributed → uniform area on the sphere
      const upper = Math.random() < 0.5;
      const u = Math.random();
      const phi = Math.random() * Math.PI * 2;
      const sinT = Math.sqrt(Math.max(0, 1 - u * u));
      norm.set(
        sinT * Math.cos(phi),
        upper ? u : -u,
        sinT * Math.sin(phi),
      );
      pos.set(norm.x * radius, (upper ? halfL : -halfL) + norm.y * radius, norm.z * radius);
    }
    q.setFromUnitVectors(up, norm);
    // Slight per-needle length jitter — uniform spikes would read mechanical.
    const sy = 0.65 + Math.random() * 0.7;
    scl.set(1, sy, 1);
    m.compose(pos, q, scl);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  // Parent into the capsule mesh so needles inherit its world transform —
  // body needles ride the body's y=0.6 offset, arm needles ride the arm's
  // rotation.z without any extra bookkeeping.
  parent.add(inst);
  return inst;
}

// Per-world resource pool. Each generateWorld() call resets it via
// resetFloraPool(), so two trees in the same biome share one trunk
// CylinderGeometry / MeshStandardMaterial, but rebuilding (which disposes
// the previous world) starts fresh resources. Only colors that are
// fully derived from the biome (no per-instance Math.random) are pooled —
// `rock`, `pillar`, and `archstone` keep their per-instance jitter.
let _pool = new Map();
export function resetFloraPool() {
  _pool = new Map();
}
function pooled(key, factory) {
  let v = _pool.get(key);
  if (v === undefined) {
    v = factory();
    _pool.set(key, v);
  }
  return v;
}

function applyLeafPlateWind(material, strength = 0.16) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uTime = state.windUniforms.uTime;
    shader.uniforms.uFoliageWind = state.windUniforms.uFoliageWind;
    shader.uniforms.uLeafPlateWind = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nuniform float uFoliageWind;\nuniform float uLeafPlateWind;"
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 leafOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #else
            vec3 leafOrigin = vec3(modelMatrix[3].x, modelMatrix[3].y, modelMatrix[3].z);
          #endif
          float phase = leafOrigin.x * 2.1 + leafOrigin.z * 1.6 + leafOrigin.y * 0.7;
          float tipFlex = smoothstep(-0.04, -0.42, position.y);
          float gust = sin(uTime * 1.15 + phase) * 0.65 + sin(uTime * 2.05 + phase * 1.37) * 0.35;
          float flutter = sin(uTime * 3.2 + phase * 1.9 + position.x * 8.0) * 0.45;
          float wind = uLeafPlateWind * uFoliageWind * tipFlex;
          transformed.x += (gust * 0.090 + flutter * 0.026) * wind;
          transformed.y += flutter * 0.018 * wind;
          transformed.z += (gust * 0.125 + flutter * 0.038) * wind;
        }`
      );
  };
  material.needsUpdate = true;
  return material;
}

function applyLeafPlateGradient(
  material,
  { tipLift = 0.10, baseShade = 0.10, veinShade = 0.08, sideShade = 0.10 } = {}
) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uLeafTipLift = { value: tipLift };
    shader.uniforms.uLeafBaseShade = { value: baseShade };
    shader.uniforms.uLeafVeinShade = { value: veinShade };
    shader.uniforms.uLeafSideShade = { value: sideShade };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        varying float vLeafPlateGradient;
        varying float vLeafPlateVein;
        varying float vLeafPlateSide;`
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vLeafPlateGradient = smoothstep(-0.42, 0.0, position.y);
        vLeafPlateVein = 1.0 - smoothstep(0.0, 0.035, abs(position.x));
        vLeafPlateSide = smoothstep(-0.16, 0.16, position.x);`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uLeafTipLift;
        uniform float uLeafBaseShade;
        uniform float uLeafVeinShade;
        uniform float uLeafSideShade;
        varying float vLeafPlateGradient;
        varying float vLeafPlateVein;
        varying float vLeafPlateSide;`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.rgb *= 1.0 - uLeafBaseShade * (1.0 - vLeafPlateGradient);
        diffuseColor.rgb += diffuseColor.rgb * uLeafTipLift * vLeafPlateGradient;
        diffuseColor.rgb *= 1.0 - uLeafSideShade * (1.0 - vLeafPlateSide);
        diffuseColor.rgb += diffuseColor.rgb * uLeafSideShade * 0.45 * vLeafPlateSide;
        diffuseColor.rgb *= 1.0 - uLeafVeinShade * vLeafPlateVein;`
      );
  };
  material.needsUpdate = true;
  return material;
}

function applySporeDrift(material, strength = 0.035) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader) => {
    if (prev) prev(shader);
    shader.uniforms.uTime = state.windUniforms.uTime;
    shader.uniforms.uSporeDrift = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nuniform float uSporeDrift;"
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          float phase = wp.x * 0.72 + wp.z * 0.57;
          transformed.x += sin(uTime * 1.1 + phase) * uSporeDrift;
          transformed.y += sin(uTime * 1.6 + phase * 1.3) * uSporeDrift * 0.85;
          transformed.z += cos(uTime * 1.0 + phase * 0.8) * uSporeDrift;
        }`
      );
  };
  material.needsUpdate = true;
  return material;
}

function makeInstancedLeafBatch(geometry, material, matrices) {
  if (!matrices.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  for (let i = 0; i < matrices.length; i++) {
    mesh.setMatrixAt(i, matrices[i]);
  }
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function addGroveMushroomFamily(group, biome, { radius = 0.44, count = 3, capY = 0.35 } = {}) {
  if (!biome.groveDetails?.mushroomFamilies) return;
  const stemGeo = pooled("grove.babyMushroom.stem.geo", () =>
    new THREE.CylinderGeometry(0.025, 0.04, 0.18, 5).translate(0, 0.09, 0)
  );
  const capGeo = pooled("grove.babyMushroom.cap.geo", () =>
    new THREE.SphereGeometry(0.085, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2)
      .scale(1.25, 0.72, 1.25)
      .translate(0, 0.18, 0)
  );
  const stemMat = pooled("grove.babyMushroom.stem.mat.smooth", () =>
    new THREE.MeshStandardMaterial({ color: "#f4e6c9", roughness: 0.95 })
  );
  const capMat = pooled("grove.babyMushroom.cap.mat.smooth", () =>
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(biome.accent).lerp(new THREE.Color("#b85f2a"), 0.18),
      roughness: 0.68,
    })
  );
  const babies = count + Math.floor(Math.random() * 3);
  for (let i = 0; i < babies; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = radius * (0.35 + Math.random() * 0.65);
    const scale = 0.72 + Math.random() * 0.62;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.set(x, 0, z);
    stem.scale.setScalar(scale);
    stem.castShadow = true;
    group.add(stem);
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(x, 0, z);
    cap.scale.setScalar(scale);
    cap.rotation.y = Math.random() * Math.PI * 2;
    cap.castShadow = true;
    group.add(cap);
  }

  if (!biome.groveDetails?.sporeGlow) return;
  const sporeGeo = pooled("grove.spore.geo", () => new THREE.SphereGeometry(0.0195, 6, 5));
  const sporeMat = pooled("grove.spore.mat", () => {
    const color = new THREE.Color("#ffc36b");
    return applySporeDrift(new THREE.MeshStandardMaterial({
      color,
      emissive: color.clone().multiplyScalar(1.35),
      emissiveIntensity: 1.05,
      flatShading: true,
      roughness: 0.45,
    }));
  });
  const spores = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < spores; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = radius * (0.18 + Math.random() * 0.62);
    const spore = new THREE.Mesh(sporeGeo, sporeMat);
    spore.position.set(Math.cos(a) * r, capY * (0.55 + Math.random() * 0.75), Math.sin(a) * r);
    spore.layers.enable(BLOOM_LAYER);
    group.add(spore);
  }
}

export const FLORA_BUILDERS = {
  tree(biome) {
    const g = new THREE.Group();
    const trunkGeo = pooled("tree.trunk.geo", () =>
      new THREE.CylinderGeometry(0.13, 0.18, 1.1, 6).translate(0, 0.55, 0)
    );
    const trunkMat = pooled("tree.trunk.mat", () =>
      new THREE.MeshStandardMaterial({ color: TRUNK, flatShading: true, roughness: 1 })
    );
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.castShadow = true;
    g.add(trunk);
    // Canopy geometry is pre-positioned so transformed.y measures height above
    // the ground rather than the canopy's center. With windAmp = y²·strength,
    // the bottom of the canopy stays put and only the top tilts — the whole
    // crown reads as bending in the wind rather than just smearing upward.
    const leafGeo = pooled("tree.leaves.geo", () => {
      const geo = jitterGeo(new THREE.IcosahedronGeometry(0.75, 0), 0.12);
      geo.scale(1, 1.15, 1);
      geo.translate(0, 1.45, 0);
      return geo;
    });
    const leafMat = pooled("tree.leaves.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.ground[0]).offsetHSL(0, 0.05, 0.08),
          flatShading: true,
          roughness: 0.85,
        }),
        0.18
      )
    );
    const leaves = new THREE.Mesh(leafGeo, leafMat);
    leaves.castShadow = true;
    g.add(leaves);
    return g;
  },

  leafballtree(biome) {
    const g = new THREE.Group();
    const trunkMat = pooled("leafballtree.trunk.mat", () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(TRUNK).lerp(new THREE.Color("#c38b45"), 0.52),
        flatShading: true,
        roughness: 0.95,
      })
    );
    const trunkGeo = pooled("leafballtree.trunk.geo", () => {
      const geo = new THREE.CylinderGeometry(0.12, 0.24, 1.45, 8, 6).translate(0, 0.725, 0);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const t = y / 1.45;
        const bend = Math.sin(t * Math.PI) * 0.07;
        const taperTwist = Math.sin(t * Math.PI * 2.2) * 0.026;
        pos.setX(i, pos.getX(i) + bend);
        pos.setZ(i, pos.getZ(i) + taperTwist);
      }
      geo.computeVertexNormals();
      return geo;
    });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    const leafballtreeTrunkHeightMul = 1 + Math.random() * 0.25;
    const canopyYOffset = 1.45 * (leafballtreeTrunkHeightMul - 1);
    trunk.scale.y = leafballtreeTrunkHeightMul;
    trunk.castShadow = true;
    g.add(trunk);

    const leafMats = [
      pooled("leafballtree.leaf.mat.shadow", () =>
        applyLeafPlateWind(
          applyLeafPlateGradient(
            new THREE.MeshStandardMaterial({
              color: new THREE.Color(biome.ground[0]).lerp(new THREE.Color("#1d4f29"), 0.30),
              side: THREE.DoubleSide,
              flatShading: true,
              roughness: 0.82,
            }),
            { tipLift: 0.08, baseShade: 0.12, veinShade: 0.06, sideShade: 0.11 }
          ),
          0.10
        )
      ),
      pooled("leafballtree.leaf.mat.mid", () =>
        applyLeafPlateWind(
          applyLeafPlateGradient(
            new THREE.MeshStandardMaterial({
              color: new THREE.Color(biome.ground[1]).lerp(new THREE.Color("#69b85b"), 0.34),
              side: THREE.DoubleSide,
              flatShading: true,
              roughness: 0.78,
            }),
            { tipLift: 0.10, baseShade: 0.10, veinShade: 0.07, sideShade: 0.12 }
          ),
          0.13
        )
      ),
      pooled("leafballtree.leaf.mat.light", () =>
        applyLeafPlateWind(
          applyLeafPlateGradient(
            new THREE.MeshStandardMaterial({
              color: new THREE.Color(biome.ground[1]).lerp(new THREE.Color("#64ad58"), 0.18),
              side: THREE.DoubleSide,
              flatShading: true,
              roughness: 0.82,
            }),
            { tipLift: 0.045, baseShade: 0.08, veinShade: 0.055, sideShade: 0.10 }
          ),
          0.12
        )
      ),
    ];
    const leafGeo = pooled("leafballtree.leaf.geo", () => {
      // Curved, anchored leaf. Local y=0 is the upper attachment point and
      // local -Y is the tip. Local +Z bows outward, so upper-row tips sit in
      // front of lower-row bases like overlapping shingles instead of coplanar
      // cards fighting for depth.
      const lengthSegs = 7;
      const widthSegs = 4;
      const positions = [];
      const uvs = [];
      const indices = [];
      for (let iy = 0; iy <= lengthSegs; iy++) {
        const v = iy / lengthSegs;
        const halfWidth = Math.max(0.006, 0.165 * Math.sin(Math.PI * v) ** 0.72 * (1 - v * 0.16));
        for (let ix = 0; ix <= widthSegs; ix++) {
          const u = ix / widthSegs;
          const side = u * 2 - 1;
          const centerLift = (1 - Math.abs(side)) * 0.010 * (1 - v * 0.35);
          const tipCurl = 0.060 * v ** 1.45;
          const edgeCurl = -Math.abs(side) * 0.010 * Math.sin(Math.PI * v);
          positions.push(side * halfWidth, -v * 0.42, tipCurl + centerLift + edgeCurl);
          uvs.push(u, v);
        }
      }
      for (let iy = 0; iy < lengthSegs; iy++) {
        for (let ix = 0; ix < widthSegs; ix++) {
          const a = iy * (widthSegs + 1) + ix;
          const b = a + 1;
          const c = a + widthSegs + 1;
          const d = c + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      return geo;
    });
    const leafOutlineGeo = pooled("leafballtree.leaf.outline.geo", () => {
      const geo = leafGeo.clone();
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        pos.setX(i, pos.getX(i) * 1.075);
        pos.setY(i, y < 0 ? y * 1.04 : y);
        pos.setZ(i, pos.getZ(i) - 0.006);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      return geo;
    });
    const leafOutlineMat = pooled("leafballtree.leaf.outline.mat", () =>
      applyLeafPlateWind(
        new THREE.MeshBasicMaterial({
          name: "leafballtree.leaf.outline.mat",
          color: "#102416",
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
        0.12
      )
    );

    const canopyCenter = new THREE.Vector3(0, 1.46 + canopyYOffset, 0);
    const canopyRadius = new THREE.Vector3(0.88, 0.68, 0.88);
    const up = new THREE.Vector3(0, 1, 0);
    const basis = new THREE.Matrix4();
    const leafBuckets = leafMats.map(() => []);
    const matrix = new THREE.Matrix4();
    const scaleVec = new THREE.Vector3();
    const orientLeaf = (leaf, normal, shingleLift = 0.10) => {
      const tangentDown = up.clone().sub(normal.clone().multiplyScalar(up.dot(normal)));
      if (tangentDown.lengthSq() < 0.0001) tangentDown.set(0, 0, 1);
      tangentDown.normalize().multiplyScalar(-1);
      // Point each teardrop down the dome, then tip its face slightly outward.
      // That shingle lift gives rows visible overlap without leaf planes
      // slicing through each other like a flat shell.
      const faceNormal = normal.clone().addScaledVector(tangentDown, shingleLift).normalize();
      // ShapeGeometry leaf tip is local -Y; map local -Y to tangentDown so
      // upper leaves point down over lower leaves, not underneath them.
      const yAxis = tangentDown.clone().multiplyScalar(-1);
      const xAxis = yAxis.clone().cross(faceNormal).normalize();
      basis.makeBasis(xAxis, yAxis, faceNormal);
      leaf.quaternion.setFromRotationMatrix(basis);
    };

    const rowCounts = [8, 14, 17, 20, 24, 24, 21, 17, 13, 9, 6];
    const addLeafRing = ({ count, phi, shell = 1, scale = 0.8, matIndex = 1, phase = 0, lift = 0.12, yOffset = 0 }) => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + phase + (Math.random() - 0.5) * 0.04;
        const normal = new THREE.Vector3(
          Math.sin(phi) * Math.cos(a),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(a)
        ).normalize();
        const leaf = new THREE.Object3D();
        leaf.position.set(
          canopyCenter.x + normal.x * canopyRadius.x * shell,
          canopyCenter.y + normal.y * canopyRadius.y * shell + yOffset,
          canopyCenter.z + normal.z * canopyRadius.z * shell
        );
        orientLeaf(leaf, normal, lift);
        leaf.rotateX(0.02 + lift * 0.18);
        leaf.rotateZ((Math.random() - 0.5) * 0.08);
        const s = scale * (0.92 + Math.random() * 0.16);
        scaleVec.set(s * 0.94, s * 1.18, s);
        matrix.compose(leaf.position, leaf.quaternion, scaleVec);
        leafBuckets[matIndex].push(matrix.clone());
      }
    };

    addLeafRing({ count: 7, phi: 0.07, shell: 0.54, scale: 0.72, matIndex: 1, phase: 0.18, lift: 0.32, yOffset: 0.40 });
    for (let row = 0; row < rowCounts.length; row++) {
      const t = row / (rowCounts.length - 1);
      const phi = 0.18 + t * 2.50;
      const rowScale = 0.76 + Math.sin((1 - t) * Math.PI * 0.5) * 0.16;
      const matIndex = row === 0 ? 2 : row > 5 ? 0 : 1;
      addLeafRing({
        count: rowCounts[row],
        phi,
        shell: 1.09 - t * 0.15 + (Math.random() - 0.5) * 0.01,
        scale: rowScale,
        matIndex,
        phase: (row % 2) * (Math.PI / rowCounts[row]),
        lift: 0.22 - t * 0.10,
      });
    }

    for (let i = 0; i < leafBuckets.length; i++) {
      const outline = makeInstancedLeafBatch(leafOutlineGeo, leafOutlineMat, leafBuckets[i]);
      if (outline) {
        outline.castShadow = false;
        outline.renderOrder = -1;
        g.add(outline);
      }
    }
    for (let i = 0; i < leafBuckets.length; i++) {
      const leaves = makeInstancedLeafBatch(leafGeo, leafMats[i], leafBuckets[i]);
      if (leaves) g.add(leaves);
    }

    const branchGeo = pooled("leafballtree.branch.geo", () => new THREE.CylinderGeometry(0.045, 0.075, 1, 6));
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.24;
      const start = new THREE.Vector3(0.03 * Math.cos(a), 1.10 + canopyYOffset + i * 0.025, 0.03 * Math.sin(a));
      const end = new THREE.Vector3(Math.cos(a) * 0.46, 1.34 + canopyYOffset + (i % 2) * 0.10, Math.sin(a) * 0.46);
      const delta = end.clone().sub(start);
      const branch = new THREE.Mesh(branchGeo, trunkMat);
      branch.position.copy(start).add(end).multiplyScalar(0.5);
      branch.quaternion.setFromUnitVectors(yAxis, delta.clone().normalize());
      branch.scale.set(1, delta.length(), 1);
      branch.castShadow = true;
      g.add(branch);
    }
    g.userData.obstacleTopY = 2.25 + canopyYOffset;
    return g;
  },

  pine(biome) {
    const g = new THREE.Group();
    // Pine is built so every piece's local y matches its height above ground:
    // trunk geo translated up by half its height, each cone tier translated to
    // its final stack position, and every mesh placed at y=0. Both trunkMat
    // and coneMat share the same wind strength so the entire silhouette sways
    // as one shape, with applyWindSway's y² term giving the downward falloff
    // (trunk barely moves, top cone moves most).
    const PINE_WIND = 0.18;
    const trunkGeo = pooled("pine.trunk.geo", () =>
      new THREE.CylinderGeometry(0.08, 0.12, 0.4, 6).translate(0, 0.2, 0)
    );
    const trunkMat = pooled("pine.trunk.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({ color: TRUNK, flatShading: true }),
        PINE_WIND
      )
    );
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.castShadow = true;
    g.add(trunk);
    const coneMat = pooled("pine.cone.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.accent).lerp(new THREE.Color("#0d2c1f"), 0.35),
          flatShading: true,
        }),
        PINE_WIND
      )
    );
    const tiers = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < tiers; i++) {
      const coneGeo = pooled("pine.cone.geo." + i, () =>
        new THREE.ConeGeometry(0.65 - i * 0.13, 0.65, 6).translate(0, 0.45 + i * 0.42, 0)
      );
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.castShadow = true;
      g.add(cone);
    }
    return g;
  },

  cactus() {
    const g = new THREE.Group();
    const m = pooled("cactus.mat", () =>
      new THREE.MeshStandardMaterial({ color: "#3d5a2e", flatShading: true, roughness: 0.8 })
    );
    const bodyGeo = pooled("cactus.body.geo", () => new THREE.CapsuleGeometry(0.18, 0.7, 4, 8));
    const body = new THREE.Mesh(bodyGeo, m);
    body.position.y = 0.6;
    body.castShadow = true;
    g.add(body);
    addCapsuleNeedles(body, 0.18, 0.7);
    if (Math.random() > 0.4) {
      const armGeo = pooled("cactus.arm1.geo", () => new THREE.CapsuleGeometry(0.1, 0.4, 4, 8));
      const arm = new THREE.Mesh(armGeo, m);
      arm.position.set(0.22, 0.7, 0);
      arm.rotation.z = -Math.PI / 2.5;
      arm.castShadow = true;
      g.add(arm);
      addCapsuleNeedles(arm, 0.1, 0.4);
    }
    if (Math.random() > 0.5) {
      const armGeo = pooled("cactus.arm2.geo", () => new THREE.CapsuleGeometry(0.1, 0.35, 4, 8));
      const arm = new THREE.Mesh(armGeo, m);
      arm.position.set(-0.22, 0.55, 0);
      arm.rotation.z = Math.PI / 2.5;
      arm.castShadow = true;
      g.add(arm);
      addCapsuleNeedles(arm, 0.1, 0.35);
    }
    return g;
  },

  mushroom(biome) {
    const g = new THREE.Group();
    // Stem geo is shifted so its base sits at y=0 (mesh at the origin) — that
    // makes applyWindSway's y² bend anchor at the ground and grow toward the
    // cap. Cap and underside use the same shared wind strength so they
    // translate along with the stem's top instead of warping on their own:
    // their geometry spans only ~0.2 in y near the stem's top, so windY² is
    // nearly uniform across each piece and the cap reads as rigid.
    const MUSH_WIND = 0.9;
    const STEM_TOP = 0.35;
    const stemGeo = pooled("mushroom.stem.geo", () =>
      new THREE.CylinderGeometry(0.07, 0.1, 0.35, 6).translate(0, 0.175, 0)
    );
    const stemMat = pooled("mushroom.stem.mat.smooth", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({ color: "#f1e8d8" }),
        MUSH_WIND
      )
    );
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.castShadow = true;
    g.add(stem);
    const capGeo = pooled("mushroom.cap.geo", () =>
      new THREE.SphereGeometry(0.22, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2)
        .scale(1.4, 0.9, 1.4)
        .translate(0, STEM_TOP + 0.01, 0)
    );
    const capMat = pooled("mushroom.cap.mat.smooth", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.accent),
          roughness: 0.6,
        }),
        MUSH_WIND
      )
    );
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.castShadow = true;
    g.add(cap);
    // Underside disc — closes the hemisphere so looking up under the cap
    // from first-person stroll doesn't see through into empty space.
    // Rotation/scale are baked into the geometry so the wind shader sees a
    // uniform transformed.y = STEM_TOP across every vertex.
    const undersideGeo = pooled("mushroom.underside.geo", () => {
      const geo = new THREE.CircleGeometry(0.22, 8);
      geo.rotateX(Math.PI / 2);
      geo.scale(1.4, 1, 1.4);
      geo.translate(0, STEM_TOP + 0.01, 0);
      return geo;
    });
    const underside = new THREE.Mesh(undersideGeo, stemMat);
    g.add(underside);
    // Local Y of the cap top so world.js can register an accurate perch
    // spot for fliers. Sphere radius 0.22 with Y-scale 0.9 puts the apex at
    // cap.position.y + 0.22*0.9.
    g.userData.capTopY = 0.36 + 0.22 * 0.9;
    g.userData.perchWind = { strength: MUSH_WIND, localY: g.userData.capTopY };
    addGroveMushroomFamily(g, biome, { radius: 0.42, count: 2, capY: g.userData.capTopY });
    return g;
  },

  fern(biome) {
    const g = new THREE.Group();
    const mat = pooled("fern.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.ground[0]).offsetHSL(0, 0, 0.15),
          flatShading: true,
        }),
        1.4
      )
    );
    const bladeGeo = pooled("fern.blade.geo", () => new THREE.ConeGeometry(0.06, 0.5, 4));
    const blades = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < blades; i++) {
      const blade = new THREE.Mesh(bladeGeo, mat);
      const a = (i / blades) * Math.PI * 2;
      blade.position.set(Math.cos(a) * 0.05, 0.22, Math.sin(a) * 0.05);
      blade.rotation.z = Math.cos(a) * 0.6;
      blade.rotation.x = Math.sin(a) * 0.6;
      g.add(blade);
    }
    return g;
  },

  rock(biome) {
    const r = 0.18 + Math.random() * 0.35;
    const geo = jitterGeo(new THREE.IcosahedronGeometry(r, 0), r * 0.3);
    const baseCol = new THREE.Color(biome.cliff).offsetHSL(
      0,
      0,
      0.05 + Math.random() * 0.1
    );
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: baseCol,
        flatShading: true,
        roughness: 1,
      })
    );
    mesh.scale.y = 0.55 + Math.random() * 0.4;
    mesh.castShadow = true;
    return mesh;
  },

  limestonerock(biome) {
    const g = new THREE.Group();
    const r = 0.2 + Math.random() * 0.32;
    const geo = jitterGeo(new THREE.IcosahedronGeometry(r, 0), r * 0.25);
    const baseCol = new THREE.Color(biome.ground[0])
      .lerp(new THREE.Color("#fff4dc"), 0.45)
      .offsetHSL(0.02, -0.08, Math.random() * 0.08);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: baseCol,
        flatShading: true,
        roughness: 1,
      })
    );
    mesh.scale.set(1.15, 0.45 + Math.random() * 0.25, 0.9 + Math.random() * 0.35);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.castShadow = true;
    g.add(mesh);
    return g;
  },

  reed() {
    const g = new THREE.Group();
    const mat = pooled("reed.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({ color: "#6d4f8a", flatShading: true }),
        1.6
      )
    );
    const count = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const h = 0.6 + Math.random() * 0.5;
      const blade = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.025, h, 4),
        mat
      );
      blade.position.set(
        (Math.random() - 0.5) * 0.18,
        h / 2,
        (Math.random() - 0.5) * 0.18
      );
      blade.rotation.z = (Math.random() - 0.5) * 0.3;
      g.add(blade);
    }
    return g;
  },

  seaweed(biome) {
    const g = new THREE.Group();
    const base = new THREE.Color(biome.underside || "#3aa8b8");
    const matA = pooled("seaweed.mat.a", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: base.clone().offsetHSL(0.08, 0.1, -0.08),
          side: THREE.DoubleSide,
          flatShading: true,
          roughness: 0.75,
        }),
        2.2
      )
    );
    const matB = pooled("seaweed.mat.b", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.accent).offsetHSL(-0.08, -0.15, -0.02),
          side: THREE.DoubleSide,
          flatShading: true,
          roughness: 0.75,
        }),
        2.2
      )
    );
    const count = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const h = 0.45 + Math.random() * 0.45;
      const w = 0.055 + Math.random() * 0.035;
      const geo = new THREE.PlaneGeometry(w, h, 1, 3);
      const blade = new THREE.Mesh(geo, i % 2 ? matA : matB);
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      blade.position.set(Math.cos(a) * 0.08, h / 2, Math.sin(a) * 0.08);
      blade.rotation.y = a + Math.PI / 2;
      blade.rotation.z = (Math.random() - 0.5) * 0.45;
      g.add(blade);
    }
    return g;
  },

  grass(biome) {
    const g = new THREE.Group();
    const mat = pooled("grass.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.ground[2]).offsetHSL(0, 0, -0.1),
          flatShading: true,
        }),
        1.8
      )
    );
    const count = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const blade = new THREE.Mesh(
        new THREE.ConeGeometry(0.04, 0.3 + Math.random() * 0.2, 3),
        mat
      );
      blade.position.set(
        (Math.random() - 0.5) * 0.2,
        0.15,
        (Math.random() - 0.5) * 0.2
      );
      blade.rotation.z = (Math.random() - 0.5) * 0.6;
      g.add(blade);
    }
    return g;
  },

  beachsucculent(biome) {
    const g = new THREE.Group();
    const leafMat = pooled("beachsucculent.leaf.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.underside || biome.fog).lerp(new THREE.Color("#d7fff3"), 0.35),
          flatShading: true,
          roughness: 0.8,
        }),
        0.7
      )
    );
    const budMat = pooled("beachsucculent.bud.mat", () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.accent).lerp(new THREE.Color("#fff2b3"), 0.35),
        flatShading: true,
        roughness: 0.65,
      })
    );
    const leafGeo = pooled("beachsucculent.leaf.geo", () => {
      const geo = jitterGeo(new THREE.IcosahedronGeometry(0.11, 0), 0.025);
      geo.scale(0.65, 0.28, 1.35);
      return geo;
    });
    const leaves = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < leaves; i++) {
      const a = (i / leaves) * Math.PI * 2 + Math.random() * 0.25;
      const leaf = new THREE.Mesh(leafGeo, leafMat);
      leaf.position.set(Math.cos(a) * 0.11, 0.08, Math.sin(a) * 0.11);
      leaf.rotation.y = a;
      leaf.rotation.z = 0.55 + Math.random() * 0.25;
      leaf.castShadow = true;
      g.add(leaf);
    }
    const bud = new THREE.Mesh(jitterGeo(new THREE.IcosahedronGeometry(0.09, 0), 0.02), budMat);
    bud.position.y = 0.18;
    bud.scale.set(1.1, 0.75, 1.1);
    bud.castShadow = true;
    g.add(bud);
    return g;
  },

  deadtree(biome) {
    const g = new THREE.Group();
    const mat = pooled("deadtree.mat", () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.cliff).offsetHSL(0, -0.1, 0.05),
        flatShading: true,
        roughness: 1,
      })
    );
    const trunkGeo = pooled("deadtree.trunk.geo", () =>
      new THREE.CylinderGeometry(0.06, 0.13, 1.2, 5)
    );
    const branchGeo = pooled("deadtree.branch.geo", () => {
      const geo = new THREE.CylinderGeometry(0.025, 0.04, 0.45, 4);
      geo.translate(0, 0.225, 0);
      return geo;
    });
    const trunk = new THREE.Mesh(trunkGeo, mat);
    trunk.position.y = 0.6;
    trunk.rotation.z = (Math.random() - 0.5) * 0.15;
    trunk.castShadow = true;
    g.add(trunk);
    for (let i = 0; i < 4; i++) {
      const branch = new THREE.Mesh(branchGeo, mat);
      const yaw = Math.random() * Math.PI * 2;
      const tilt = 0.5 + Math.random() * 0.7;
      branch.position.set(0, 0.9 + i * 0.08, 0);
      branch.rotation.set(0, yaw, 0);
      branch.rotateX(tilt);
      branch.castShadow = true;
      g.add(branch);
    }
    return g;
  },

  skull() {
    const g = new THREE.Group();
    const mat = pooled("skull.mat", () =>
      new THREE.MeshStandardMaterial({ color: "#f1ead8", flatShading: true, roughness: 0.8 })
    );
    const skullGeo = pooled("skull.geo", () => new THREE.SphereGeometry(0.18, 10, 8));
    const skull = new THREE.Mesh(skullGeo, mat);
    skull.scale.set(1, 0.85, 1.1);
    skull.position.y = 0.18;
    skull.castShadow = true;
    g.add(skull);
    const eyeMat = pooled("skull.eye.mat", () =>
      new THREE.MeshStandardMaterial({ color: "#1a1a1a" })
    );
    const eyeGeo = pooled("skull.eye.geo", () => new THREE.SphereGeometry(0.04, 6, 6));
    [-0.06, 0.06].forEach((x) => {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(x, 0.2, 0.15);
      g.add(eye);
    });
    return g;
  },

  pillar(biome) {
    const g = new THREE.Group();
    const stoneCol = new THREE.Color(biome.cliff).offsetHSL(
      0,
      -0.1,
      0.12 + Math.random() * 0.08
    );
    const lichenCol = new THREE.Color(biome.ground[0]).offsetHSL(0, 0.05, 0.1);
    const stoneMat = new THREE.MeshStandardMaterial({
      color: stoneCol,
      flatShading: true,
      roughness: 1,
    });
    const lichenMat = new THREE.MeshStandardMaterial({
      color: lichenCol,
      flatShading: true,
      roughness: 1,
    });
    const segments = 2 + Math.floor(Math.random() * 3); // 2–4 stacked drums
    let y = 0;
    for (let i = 0; i < segments; i++) {
      const h = 0.45 + Math.random() * 0.25;
      const r = 0.22 - i * 0.015;
      // lichen-tinted on the first segment ~half the time
      const useLichen = i === 0 && Math.random() < 0.5;
      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r * 1.05, h, 7),
        useLichen ? lichenMat : stoneMat
      );
      drum.position.y = y + h / 2;
      drum.rotation.y = Math.random() * Math.PI * 2;
      drum.rotation.z = (Math.random() - 0.5) * 0.08;
      drum.castShadow = true;
      g.add(drum);
      y += h - 0.02;
    }
    // broken cap — jittered chunk
    if (Math.random() < 0.7) {
      const cap = new THREE.Mesh(
        jitterGeo(new THREE.IcosahedronGeometry(0.22, 0), 0.08),
        stoneMat
      );
      cap.position.y = y + 0.1;
      cap.scale.set(1.1, 0.5, 1.1);
      cap.rotation.y = Math.random() * Math.PI * 2;
      cap.castShadow = true;
      g.add(cap);
    }
    return g;
  },

  archstone(biome) {
    const g = new THREE.Group();
    const stoneCol = new THREE.Color(biome.cliff).offsetHSL(
      0,
      -0.1,
      0.12 + Math.random() * 0.06
    );
    const mat = new THREE.MeshStandardMaterial({
      color: stoneCol,
      flatShading: true,
      roughness: 1,
    });
    // two short pillars
    const pillarH = 0.7 + Math.random() * 0.2;
    const gap = 0.55;
    for (const sign of [-1, 1]) {
      const p = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.16, pillarH, 7),
        mat
      );
      p.position.set(sign * gap, pillarH / 2, 0);
      p.castShadow = true;
      g.add(p);
    }
    // curved arch — partial torus
    const arc = new THREE.Mesh(
      new THREE.TorusGeometry(gap, 0.11, 5, 10, Math.PI),
      mat
    );
    arc.position.y = pillarH;
    arc.rotation.z = 0;
    arc.castShadow = true;
    g.add(arc);
    // crumbled keystone or missing chunk — break the arch occasionally
    if (Math.random() < 0.5) {
      const fragment = new THREE.Mesh(
        jitterGeo(new THREE.IcosahedronGeometry(0.18, 0), 0.06),
        mat
      );
      fragment.position.set(
        (Math.random() - 0.5) * 0.4,
        0.05,
        (Math.random() - 0.5) * 0.3
      );
      fragment.scale.y = 0.5;
      fragment.castShadow = true;
      g.add(fragment);
    }
    return g;
  },

  crystal(biome) {
    const g = new THREE.Group();
    const mat = pooled("crystal.mat", () => {
      const tint = new THREE.Color(biome.accent);
      return new THREE.MeshStandardMaterial({
        color: tint,
        emissive: tint.clone().multiplyScalar(0.4),
        flatShading: true,
        roughness: 0.35,
        metalness: 0.1,
      });
    });
    const shards = 3 + Math.floor(Math.random() * 3); // 3–5
    for (let i = 0; i < shards; i++) {
      const r = 0.1 + Math.random() * 0.12;
      const geo = new THREE.IcosahedronGeometry(r, 0);
      geo.translate(0, r, 0); // pivot at the base so tilted shards stay rooted together
      const shard = new THREE.Mesh(geo, mat);
      const a = (i / shards) * Math.PI * 2 + Math.random() * 0.5;
      const isCenter = i === 0;
      const tilt = isCenter ? 0.04 : 0.34 + Math.random() * 0.32;
      const rootOff = isCenter ? 0 : 0.025 + Math.random() * 0.035;
      const heightScale = isCenter ? 1.95 + Math.random() * 0.45 : 1.35 + Math.random() * 0.65;
      // Tilt side shards outward from nearby shared roots so the bases touch
      // and the whole cluster reads as one faceted crystal instead of posts.
      shard.position.set(Math.cos(a) * rootOff, 0.02, Math.sin(a) * rootOff);
      shard.scale.set(0.55, heightScale, 0.55);
      shard.rotation.order = "YXZ";
      shard.rotation.y = a;
      shard.rotation.x = -tilt;
      shard.rotation.z = (Math.random() - 0.5) * 0.10;
      shard.castShadow = true;
      shard.layers.enable(BLOOM_LAYER);
      g.add(shard);
    }
    return g;
  },

  bigmushroom(biome) {
    const g = new THREE.Group();
    // tall stem — creatures could pass beneath the cap
    const stemH = 1.4 + Math.random() * 0.5;
    // Big mushroom uses the same trick as the small one — geometry is shifted
    // so each piece's local y matches its world height above the group's
    // anchor, and every mesh sits at y=0. Because stemH is per-instance, the
    // stem/cap/underside geometries can't be pooled. Wind on all three at the
    // same strength keeps the stem-bend coherent: the y² bend grows from the
    // ground up so the slim stem flexes more than the cap (whose vertices
    // share nearly identical y ~ stemH and so move as a rigid block).
    const BIG_WIND = 0.45;
    const stemMat = pooled("bigmushroom.stem.mat.smooth", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({ color: "#f1e8d8", roughness: 0.95 }),
        BIG_WIND
      )
    );
    const stemGeo = new THREE.CylinderGeometry(0.13, 0.18, stemH, 7).translate(0, stemH / 2, 0);
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.rotation.z = (Math.random() - 0.5) * 0.1;
    stem.castShadow = true;
    g.add(stem);
    const capGeo = new THREE.SphereGeometry(0.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)
      .scale(1, 0.55, 1)
      .translate(0, stemH, 0);
    const capMat = pooled("bigmushroom.cap.mat.smooth", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.accent),
          roughness: 0.55,
        }),
        BIG_WIND
      )
    );
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.castShadow = true;
    g.add(cap);
    // Local Y of the cap top — varies with this instance's random stemH,
    // so world.js needs to read it off userData rather than guess from a
    // static per-kind table.
    g.userData.capTopY = stemH + 0.8 * 0.55;
    g.userData.perchWind = { strength: BIG_WIND, localY: g.userData.capTopY };
    // Underside disc — closes the hemisphere so walking under the cap in
    // first-person doesn't see through into empty space above. Uses the
    // stem material (cream) which reads as a fresh mushroom gill plate.
    // Rotation baked into geometry so wind shader sees a uniform y = stemH.
    const undersideGeo = new THREE.CircleGeometry(0.8, 12);
    undersideGeo.rotateX(Math.PI / 2);
    undersideGeo.translate(0, stemH, 0);
    const underside = new THREE.Mesh(undersideGeo, stemMat);
    g.add(underside);
    // Spots share the cap's wind strength so they sway with it. Each spot's
    // orientation + world position is baked into its geometry — the mesh sits
    // at the group origin so applyWindSway's transformed.y reads the spot's
    // actual world-y above ground. Without this the spots float free of the
    // cap whenever wind nudges the cap material.
    const spotMat = pooled("bigmushroom.spot.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({ color: "#fbf3df", flatShading: true, roughness: 0.9 }),
        BIG_WIND
      )
    );
    const spots = 3 + Math.floor(Math.random() * 3);
    const capR = 0.8;
    const capSY = 0.55;
    const capA2 = capR * capR;
    const capB2 = (capR * capSY) * (capR * capSY);
    const up = new THREE.Vector3(0, 1, 0);
    const tmpQuat = new THREE.Quaternion();
    const tmpMat = new THREE.Matrix4();
    for (let i = 0; i < spots; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.25 + Math.random() * 0.4;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const yLocal = Math.sqrt(Math.max(0, capA2 - r * r)) * capSY;
      const n = new THREE.Vector3(x / capA2, yLocal / capB2, z / capA2).normalize();
      const sink = 0.02;
      const spotGeo = new THREE.SphereGeometry(0.08 + Math.random() * 0.05, 6, 5);
      spotGeo.scale(1, 0.35, 1);
      tmpQuat.setFromUnitVectors(up, n);
      tmpMat.makeRotationFromQuaternion(tmpQuat);
      spotGeo.applyMatrix4(tmpMat);
      spotGeo.translate(x - n.x * sink, stemH + yLocal - n.y * sink, z - n.z * sink);
      const spot = new THREE.Mesh(spotGeo, spotMat);
      g.add(spot);
    }
    addGroveMushroomFamily(g, biome, { radius: 1.15, count: 4, capY: stemH });
    return g;
  },

  fairyring(biome) {
    const g = new THREE.Group();
    const stumpMat = new THREE.MeshStandardMaterial({ color: TRUNK, flatShading: true, roughness: 1 });
    const stump = new THREE.Mesh(
      jitterGeo(new THREE.CylinderGeometry(0.18, 0.24, 0.38, 8).translate(0, 0.19, 0), 0.025),
      stumpMat
    );
    stump.scale.set(1.2, 0.82, 0.9);
    stump.castShadow = true;
    g.add(stump);
    const hollow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.07, 0.018, 8).translate(0, 0.325, 0),
      new THREE.MeshStandardMaterial({ color: "#22150e", flatShading: true, roughness: 1 })
    );
    hollow.scale.set(1.25, 1, 0.8);
    g.add(hollow);

    const stemGeo = new THREE.CylinderGeometry(0.026, 0.04, 0.18, 5).translate(0, 0.09, 0);
    const capGeo = new THREE.SphereGeometry(0.09, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2)
      .scale(1.28, 0.72, 1.28)
      .translate(0, 0.18, 0);
    const stemMat = new THREE.MeshStandardMaterial({ color: "#f4e6c9", roughness: 0.95 });
    const capMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(biome.accent).lerp(new THREE.Color("#b85f2a"), 0.18),
      roughness: 0.68,
    });
    const mushrooms = 10 + Math.floor(Math.random() * 4);
    for (let i = 0; i < mushrooms; i++) {
      const a = (i / mushrooms) * Math.PI * 2 + (Math.random() - 0.5) * 0.18;
      const r = 0.9 + (Math.random() - 0.5) * 0.16;
      const scale = 0.75 + Math.random() * 0.55;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.set(x, 0, z);
      stem.scale.setScalar(scale);
      stem.castShadow = true;
      g.add(stem);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(x, 0, z);
      cap.rotation.y = a + Math.PI / 2;
      cap.scale.setScalar(scale);
      cap.castShadow = true;
      g.add(cap);
    }

    // Will-o-wisps replace the old static spores.
    // Store how many to spawn (1-3); the world placement code
    // creates the actual WillOWisp objects and parents them to
    // the scene so they can move independently.
    if (biome.groveDetails?.sporeGlow) {
      g.userData.willowispCount = 1 + Math.floor(Math.random() * 3);
    }

    g.userData.capTopY = 0.32;
    return g;
  },

  berrybush(biome) {
    const g = new THREE.Group();
    const bodyGeo = pooled("berrybush.body.geo", () =>
      jitterGeo(new THREE.IcosahedronGeometry(0.32, 0), 0.08)
    );
    const bodyMat = pooled("berrybush.body.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.ground[0]).offsetHSL(0, 0.08, 0.05),
          flatShading: true,
          roughness: 0.85,
        }),
        0.7
      )
    );
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.28;
    body.scale.set(1, 0.85, 1);
    body.castShadow = true;
    g.add(body);
    const berryMat = pooled("berrybush.berry.mat", () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.accent),
        roughness: 0.62,
      })
    );
    const berryGeo = pooled("berrybush.berry.geo", () => new THREE.SphereGeometry(0.05, 12, 8));
    const berries = 4 + Math.floor(Math.random() * 4);
    // Bush is an ellipsoid at (0, 0.28, 0): xz-radius 0.32, y-scale 0.85.
    // Sink berry centers just inside the upper hemisphere so the berries read
    // as attached fruit rather than beads hovering over the faceted canopy.
    const R = 0.285;
    for (let i = 0; i < berries; i++) {
      const a = Math.random() * Math.PI * 2;
      const elev = 0.2 + Math.random() * 1.1; // [~11°, ~75°] above equator
      const c = Math.cos(elev);
      const s = Math.sin(elev);
      const berry = new THREE.Mesh(berryGeo, berryMat);
      berry.position.set(Math.cos(a) * c * R, 0.28 + s * R * 0.85, Math.sin(a) * c * R);
      g.add(berry);
    }
    return g;
  },

  lantern(biome) {
    const g = new THREE.Group();
    const tetherH = 1.3 + Math.random() * 0.4;
    const tetherMat = pooled("lantern.tether.mat", () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.cliff).offsetHSL(0, 0, 0.1),
        flatShading: true,
        roughness: 1,
      })
    );
    const tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, tetherH, 4),
      tetherMat
    );
    tether.position.y = tetherH / 2;
    g.add(tether);
    const orbGeo = pooled("lantern.orb.geo", () => new THREE.IcosahedronGeometry(0.12, 1));
    const orbMat = pooled("lantern.orb.mat", () => {
      const glowCol = new THREE.Color(biome.accent);
      return new THREE.MeshStandardMaterial({
        color: glowCol,
        emissive: glowCol.clone().multiplyScalar(0.9),
        flatShading: true,
        roughness: 0.4,
      });
    });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    orb.position.y = tetherH + 0.05;
    orb.layers.enable(BLOOM_LAYER);
    g.add(orb);
    const haloGeo = pooled("lantern.halo.geo", () => new THREE.IcosahedronGeometry(0.2, 1));
    const haloMat = pooled("lantern.halo.mat", () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(biome.accent),
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.copy(orb.position);
    halo.layers.enable(BLOOM_LAYER);
    g.add(halo);
    return g;
  },

  coral(biome) {
    const g = new THREE.Group();
    const baseCol = new THREE.Color(biome.accent);
    const altCol = baseCol.clone().offsetHSL(0.04, -0.05, 0.1);
    const trunkMat = pooled("coral.trunk.mat", () =>
      new THREE.MeshStandardMaterial({
        color: baseCol.clone().offsetHSL(0, 0, -0.1),
        flatShading: true,
        roughness: 0.55,
      })
    );
    const baseGeo = pooled("coral.base.geo", () => new THREE.SphereGeometry(0.18, 8, 6));
    const base = new THREE.Mesh(baseGeo, trunkMat);
    base.position.y = 0.12;
    base.scale.set(1.1, 0.55, 1.1);
    base.castShadow = true;
    g.add(base);
    const branchMatBase = pooled("coral.branch.mat.base", () =>
      new THREE.MeshStandardMaterial({ color: baseCol, flatShading: true, roughness: 0.5 })
    );
    const branchMatAlt = pooled("coral.branch.mat.alt", () =>
      new THREE.MeshStandardMaterial({ color: altCol, flatShading: true, roughness: 0.5 })
    );
    const branches = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < branches; i++) {
      const a = (i / branches) * Math.PI * 2 + Math.random() * 0.4;
      const len = 0.7 + Math.random() * 0.4;
      const branchMat = i % 2 === 0 ? branchMatBase : branchMatAlt;

      const branch = new THREE.Group();
      // anchor the branch group at the base, pointing along the group's local +Y
      branch.position.set(Math.cos(a) * 0.05, 0.15, Math.sin(a) * 0.05);
      // tilt outward — rotation is applied to the group, all children follow
      branch.rotation.z = Math.cos(a) * 0.55;
      branch.rotation.x = -Math.sin(a) * 0.55;
      g.add(branch);

      const stalk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.07, len, 5),
        branchMat
      );
      stalk.position.y = len / 2;
      stalk.castShadow = true;
      branch.add(stalk);

      // little blob at the tip — coral polyp, parented to the branch so it
      // tracks the rotated stalk's end.
      const tip = new THREE.Mesh(
        jitterGeo(new THREE.IcosahedronGeometry(0.11, 0), 0.04),
        branchMat
      );
      tip.position.y = len + 0.02;
      tip.scale.set(1.2, 0.7, 1.2);
      tip.castShadow = true;
      branch.add(tip);

      // 2 tiny side blobs along the branch
      for (let k = 0; k < 2; k++) {
        const u = 0.4 + k * 0.3;
        const knob = new THREE.Mesh(
          new THREE.SphereGeometry(0.05 + Math.random() * 0.025, 6, 5),
          branchMat
        );
        knob.position.set(
          (Math.random() - 0.5) * 0.06,
          len * u,
          (Math.random() - 0.5) * 0.06
        );
        branch.add(knob);
      }
    }
    return g;
  },

  braincoral(biome) {
    const g = new THREE.Group();
    const baseCol = new THREE.Color(biome.accent).lerp(new THREE.Color("#fff0a8"), 0.28);
    const mat = pooled("braincoral.mat", () =>
      new THREE.MeshStandardMaterial({ color: baseCol, flatShading: true, roughness: 0.58 })
    );
    const grooveMat = pooled("braincoral.groove.mat", () =>
      new THREE.MeshStandardMaterial({
        color: baseCol.clone().offsetHSL(0, -0.08, -0.16),
        flatShading: true,
        roughness: 0.7,
      })
    );
    const lobes = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < lobes; i++) {
      const a = (i / lobes) * Math.PI * 2;
      const r = 0.11 + Math.random() * 0.05;
      const lobe = new THREE.Mesh(jitterGeo(new THREE.IcosahedronGeometry(r, 0), 0.025), mat);
      const ring = i === 0 ? 0 : 0.12 + Math.random() * 0.08;
      lobe.position.set(Math.cos(a) * ring, 0.12 + Math.random() * 0.05, Math.sin(a) * ring);
      lobe.scale.set(1.4, 0.65, 1.15);
      lobe.castShadow = true;
      g.add(lobe);
    }
    for (let i = 0; i < 4; i++) {
      const ridge = new THREE.Mesh(new THREE.TorusGeometry(0.13 + i * 0.035, 0.008, 5, 24), grooveMat);
      ridge.rotation.x = Math.PI / 2;
      ridge.position.y = 0.22 + i * 0.005;
      ridge.scale.z = 0.55;
      g.add(ridge);
    }
    return g;
  },

  cupcoral(biome) {
    const g = new THREE.Group();
    const baseCol = new THREE.Color(biome.accent).offsetHSL(-0.05, -0.08, 0.08);
    const mat = pooled("cupcoral.mat", () =>
      new THREE.MeshStandardMaterial({
        color: baseCol,
        side: THREE.DoubleSide,
        flatShading: true,
        roughness: 0.55,
      })
    );
    const cups = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < cups; i++) {
      const h = 0.24 + Math.random() * 0.24;
      const top = 0.11 + Math.random() * 0.05;
      const bottom = top * 0.45;
      const a = (i / cups) * Math.PI * 2 + Math.random() * 0.35;
      const cup = new THREE.Group();
      cup.position.set(Math.cos(a) * 0.13, h / 2, Math.sin(a) * 0.13);
      cup.rotation.z = Math.cos(a) * 0.18;
      cup.rotation.x = -Math.sin(a) * 0.18;
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, h, 8, 1, true), mat);
      wall.castShadow = true;
      cup.add(wall);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(top * 0.92, 0.014, 5, 18), mat);
      lip.rotation.x = Math.PI / 2;
      lip.position.y = h / 2;
      cup.add(lip);
      g.add(cup);
    }
    return g;
  },

  balloontree(biome) {
    const g = new THREE.Group();
    const trunkH = 1.1 + Math.random() * 0.5;
    const trunkMat = biome.cloudlike
      ? pooled("balloontree.trunk.cloud.mat", () =>
        new THREE.MeshStandardMaterial({
          color: new THREE.Color("#e1e8f8"),
          flatShading: false,
          roughness: 0.88,
        })
      )
      : pooled("balloontree.trunk.mat", () =>
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.cliff).offsetHSL(0, 0, 0.15),
          flatShading: true,
          roughness: 1,
        })
      );
    const trunkTopR = biome.cloudlike ? 0.032 : 0.07;
    const trunkBaseR = biome.cloudlike ? 0.052 : 0.1;
    const trunkSegments = biome.cloudlike ? 8 : 6;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(trunkTopR, trunkBaseR, trunkH, trunkSegments),
      trunkMat
    );
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    g.add(trunk);
    if (biome.cloudlike) {
      const ribbonMat = pooled("balloontree.trunk.ribbon.cloud.mat", () =>
        new THREE.MeshBasicMaterial({
          color: new THREE.Color("#f7fbff"),
          transparent: true,
          opacity: 0.58,
          depthWrite: false,
        })
      );
      for (const side of [-1, 1]) {
        const ribbon = new THREE.Mesh(
          new THREE.PlaneGeometry(0.012, trunkH * 0.94, 1, 3),
          ribbonMat
        );
        ribbon.position.set(side * trunkTopR * 0.72, trunkH * 0.52, 0.002);
        ribbon.rotation.y = side * 0.18;
        g.add(ribbon);
      }
    }
    const puffMat = pooled("balloontree.puff.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.ground[2]).lerp(new THREE.Color("#ffffff"), 0.6),
          flatShading: false,
          roughness: 0.95,
        }),
        0.3
      )
    );
    const puffs = biome.cloudlike ? 7 + Math.floor(Math.random() * 4) : 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < puffs; i++) {
      const r = biome.cloudlike ? 0.22 + Math.random() * 0.34 : 0.32 + Math.random() * 0.18;
      const puff = new THREE.Mesh(
        jitterGeo(new THREE.IcosahedronGeometry(r, 1), r * 0.12),
        puffMat
      );
      const a = (i / puffs) * Math.PI * 2;
      const ring = 0.2 + Math.random() * 0.15;
      puff.position.set(
        Math.cos(a) * ring,
        trunkH + 0.1 + Math.random() * 0.25,
        Math.sin(a) * ring
      );
      puff.castShadow = true;
      g.add(puff);
    }
    // crowning puff
    const crown = new THREE.Mesh(
      jitterGeo(new THREE.IcosahedronGeometry(0.45, 1), 0.055),
      puffMat
    );
    crown.position.y = trunkH + 0.5;
    crown.castShadow = true;
    g.add(crown);
    const satellitePuffs = biome.cloudlike ? 5 + Math.floor(Math.random() * 4) : 0;
    for (let i = 0; i < satellitePuffs; i++) {
      const r = 0.12 + Math.random() * 0.12;
      const puff = new THREE.Mesh(
        jitterGeo(new THREE.IcosahedronGeometry(r, 1), r * 0.10),
        puffMat
      );
      const a = Math.random() * Math.PI * 2;
      const ring = 0.34 + Math.random() * 0.22;
      puff.position.set(
        Math.cos(a) * ring,
        trunkH + 0.32 + Math.random() * 0.46,
        Math.sin(a) * ring
      );
      puff.castShadow = true;
      g.add(puff);
    }
    return g;
  },

  lavafissure(biome) {
    const g = new THREE.Group();
    const ember = new THREE.Color(biome.accent);
    const hot = new THREE.Color("#ffd166");
    const rim = new THREE.Color("#000000");
    const ribbonMat = pooled("lavafissure.ribbon.mat", () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uRim: { value: rim },
          uLava: { value: ember.clone().lerp(hot, 0.25) },
          uCore: { value: hot },
        },
        vertexShader: `
          attribute float aAcross;
          attribute float aAlong;
          attribute float aHeat;
          varying float vAcross;
          varying float vAlong;
          varying float vHeat;
          void main() {
            vAcross = abs(aAcross);
            vAlong = aAlong;
            vHeat = aHeat;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          precision highp float;
          uniform vec3 uRim;
          uniform vec3 uLava;
          uniform vec3 uCore;
          varying float vAcross;
          varying float vAlong;
          varying float vHeat;
          float hash(float n) { return fract(sin(n) * 43758.5453123); }
          void main() {
            float edge = smoothstep(0.62, 0.92, vAcross);
            float redBand = smoothstep(0.01125, 0.38, vAcross);
            float coreMask = 1.0 - smoothstep(0.00625, 0.01875, vAcross);
            float flicker = 0.82 + 0.18 * hash(floor(vAlong * 34.0) + vHeat * 19.0);
            vec3 redGlow = uLava * vec3(0.95, 0.28, 0.16);
            vec3 lava = mix(uCore, redGlow * flicker, redBand);
            vec3 col = mix(lava, uRim, edge);
            float alpha = smoothstep(1.0, 0.92, vAcross);
            gl_FragColor = vec4(col, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );

    const pointCount = 18 + Math.floor(Math.random() * 8);
    const totalLen = 3.4 + Math.random() * 1.2;
    const step = totalLen / (pointCount - 1);
    const centers = [];
    let wanderZ = (Math.random() - 0.5) * 0.08;
    for (let i = 0; i < pointCount; i++) {
      if (i > 0) wanderZ += (Math.random() - 0.5) * 0.42;
      centers.push({
        x: -totalLen * 0.5 + step * i,
        z: Math.max(-0.85, Math.min(0.85, wanderZ)),
        halfW: 0.144 + Math.random() * 0.063,
        heat: Math.random(),
      });
    }

    const across = [-1, -0.72, -0.38, -0.14, 0, 0.14, 0.38, 0.72, 1];
    const positions = [];
    const acrossAttr = [];
    const alongAttr = [];
    const heatAttr = [];
    for (let i = 0; i < pointCount; i++) {
      const prev = centers[Math.max(0, i - 1)];
      const next = centers[Math.min(pointCount - 1, i + 1)];
      const tx = next.x - prev.x;
      const tz = next.z - prev.z;
      const tl = Math.max(0.001, Math.sqrt(tx * tx + tz * tz));
      const nx = -tz / tl;
      const nz = tx / tl;
      const taper = Math.sin((i / (pointCount - 1)) * Math.PI);
      const halfW = centers[i].halfW * taper;
      for (const a of across) {
        positions.push(
          centers[i].x + nx * a * halfW,
          0.07,
          centers[i].z + nz * a * halfW
        );
        acrossAttr.push(a);
        alongAttr.push(i / (pointCount - 1));
        heatAttr.push(centers[i].heat);
      }
    }

    const cols = across.length;
    const indices = [];
    for (let i = 0; i < pointCount - 1; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = i * cols + j;
        const b = a + 1;
        const c = (i + 1) * cols + j;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    g.userData.fissureObstaclePoints = centers.map(({ x, z, halfW }) => ({
      x,
      z,
      r: Math.max(0.22, halfW * 1.5),
    }));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute("aAcross", new THREE.BufferAttribute(new Float32Array(acrossAttr), 1));
    geo.setAttribute("aAlong", new THREE.BufferAttribute(new Float32Array(alongAttr), 1));
    geo.setAttribute("aHeat", new THREE.BufferAttribute(new Float32Array(heatAttr), 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const ribbon = new THREE.Mesh(geo, ribbonMat);
    ribbon.userData.surfaceLift = 0.07;
    ribbon.userData.surfaceConformVertices = true;
    ribbon.layers.enable(BLOOM_LAYER);
    g.add(ribbon);
    return g;
  },

  obsidianshard(biome) {
    const g = new THREE.Group();
    const ember = new THREE.Color(biome.accent);
    const glassMat = pooled("obsidianshard.glass.mat", () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color("#0d0a14"),
        emissive: ember.clone().multiplyScalar(0.18),
        flatShading: true,
        roughness: 0.25,
        metalness: 0.35,
      })
    );
    const shards = 3 + Math.floor(Math.random() * 3); // 3–5
    for (let i = 0; i < shards; i++) {
      const r = 0.1 + Math.random() * 0.13;
      const shard = new THREE.Mesh(
        new THREE.IcosahedronGeometry(r, 0),
        glassMat
      );
      const a = (i / shards) * Math.PI * 2 + Math.random() * 0.4;
      const off = 0.04 + Math.random() * 0.1;
      shard.position.set(
        Math.cos(a) * off,
        r * (0.85 + Math.random() * 1.5),
        Math.sin(a) * off
      );
      shard.scale.set(0.5, 1.6 + Math.random() * 0.8, 0.5);
      shard.rotation.y = Math.random() * Math.PI * 2;
      shard.rotation.z = (Math.random() - 0.5) * 0.4;
      shard.castShadow = true;
      shard.layers.enable(BLOOM_LAYER);
      g.add(shard);
    }
    // warm halo near the base — small additive sphere reading as crack-light
    const haloGeo = pooled("obsidianshard.halo.geo", () => new THREE.IcosahedronGeometry(0.18, 1));
    const haloMat = pooled("obsidianshard.halo.mat", () =>
      new THREE.MeshBasicMaterial({
        color: ember,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    const halo = new THREE.Mesh(haloGeo, haloMat);
    halo.position.y = 0.05;
    halo.scale.set(1.2, 0.4, 1.2);
    halo.layers.enable(BLOOM_LAYER);
    g.add(halo);
    return g;
  },
};

