import * as THREE from "three";
import { state } from "../state.js";
import { jitterGeo, applyWindSway, buildLeafGeo } from "../util.js";
import {
  makeMushroomCapPBRMaterial,
  makeMushroomUndersideMaterial,
} from "../pbr.js";
import { addCapsuleNeedles, pooled, applyLeafPlateWind, applyLeafPlateGradient, applyDandylionHeadWind, makeInstancedLeafBatch, shouldCastMicroFloraShadow, getDandylionFloraPalette, makeMushroomStemGeometry, makeMushroomUndersideGeometry, enableMushroomCapShadowUnderside, addGroveMushroomFamily } from "./_shared.js";

export function dandylion(biome) {
    const g = new THREE.Group();
    const castMicroShadow = shouldCastMicroFloraShadow(biome);
    const DANDYLION_STEM_H = 0.92;
    const DANDYLION_WIND = 1.15;
    function dandylionStemOffset(t) {
      return new THREE.Vector3(
        Math.sin(t * Math.PI * 0.88) * 0.026,
        t * DANDYLION_STEM_H,
        Math.sin(t * Math.PI * 1.7 + 0.6) * 0.008
      );
    }
    const stemGeo = pooled("dandylion.stem.geo", () => {
      const geo = new THREE.CylinderGeometry(0.011, 0.022, DANDYLION_STEM_H, 12, 8).translate(0, DANDYLION_STEM_H / 2, 0);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const t = pos.getY(i) / DANDYLION_STEM_H;
        const stemOffset = dandylionStemOffset(t);
        pos.setX(i, pos.getX(i) + stemOffset.x);
        pos.setZ(i, pos.getZ(i) + stemOffset.z);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      return geo;
    });
    const dandyPalette = getDandylionFloraPalette(biome);
    const stemMat = pooled("dandylion.stem.mat.smooth", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({ color: dandyPalette.stem, flatShading: false, roughness: 0.88 }),
        DANDYLION_WIND
      )
    );
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.castShadow = castMicroShadow;
    g.add(stem);

    const leafGeo = pooled("dandylion.baseleaf.geo", () =>
      buildLeafGeo({
        lengthSegs: 8,
        widthSegs: 5,
        length: 0.44,
        maxWidth: 0.115,
        minWidth: 0.010,
        profileExp: 0.54,
        taperEnd: 0.34,
        centerLift: 0.018,
        centerLiftFade: 0.42,
        tipCurlStrength: 0.045,
        tipCurlExp: 1.25,
        edgeCurlStrength: 0.018,
        centerRibLift: 0.018,
        secondaryRibLift: 0.010,
        secondaryRibFrequency: 6.0,
      })
    );
    const leafMat = pooled("dandylion.baseleaf.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: dandyPalette.leaf,
          side: THREE.DoubleSide,
          flatShading: false,
          roughness: 0.86,
        }),
        0.72
      )
    );
    const baseLeafCount = 5;
    const leafHeightStart = 0.20;
    const leafHeightGap = 0.18 / Math.max(1, baseLeafCount - 1);
    const basis = new THREE.Matrix4();
    for (let i = 0; i < baseLeafCount; i++) {
      const a = (i / baseLeafCount) * Math.PI * 2 + Math.random() * 0.35;
      const outward = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const tipDir = outward.clone().multiplyScalar(0.96).add(new THREE.Vector3(0, -0.28, 0)).normalize();
      const yAxis = tipDir.clone().multiplyScalar(-1);
      const zAxis = new THREE.Vector3(0, 1, 0).addScaledVector(outward, 0.18);
      zAxis.addScaledVector(yAxis, -zAxis.dot(yAxis)).normalize();
      const xAxis = yAxis.clone().cross(zAxis).normalize();
      zAxis.copy(xAxis).cross(yAxis).normalize();
      basis.makeBasis(xAxis, yAxis, zAxis);

      const leaf = new THREE.Mesh(leafGeo, leafMat);
      const attachT = leafHeightStart + i * leafHeightGap + Math.random() * 0.012;
      const attachPos = dandylionStemOffset(attachT);
      leaf.position.copy(attachPos);
      leaf.quaternion.setFromRotationMatrix(basis);
      const leafPitchVariation = (Math.random() - 0.5) * 0.34;
      const leafYawVariation = (Math.random() - 0.5) * 0.18;
      const leafRollVariation = (Math.random() - 0.5) * 0.28;
      leaf.rotateX(leafPitchVariation);
      leaf.rotateY(leafYawVariation);
      leaf.rotateZ(leafRollVariation);
      leaf.scale.setScalar(0.82 + Math.random() * 0.28);
      leaf.castShadow = castMicroShadow;
      g.add(leaf);
    }

    const coreGeo = pooled("dandylion.core.geo", () =>
      new THREE.SphereGeometry(0.070, 16, 12).scale(1, 0.82, 1).translate(0, DANDYLION_STEM_H, 0)
    );
    const glow = !!biome.glowFlowers;
    const coreMat = pooled("dandylion.core.mat.smooth", () =>
      applyDandylionHeadWind(
        new THREE.MeshStandardMaterial({
          color: "#ece0b8",
          emissive: glow ? new THREE.Color(biome.accent).multiplyScalar(0.32) : 0x000000,
          emissiveIntensity: glow ? 0.55 : 0,
          flatShading: false,
          roughness: 0.78,
        }),
        DANDYLION_WIND,
        DANDYLION_STEM_H
      )
    );
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.castShadow = castMicroShadow;
    g.add(core);

    const sporeCount = 288;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const fuzzInnerRadius = 0.050;
    const fuzzOuterRadius = 0.152;
    const linePositions = new Float32Array(sporeCount * 2 * 3);
    const lineSeeds = new Float32Array(sporeCount * 2);
    const sporePositions = new Float32Array(sporeCount * 3);
    const sporeSeeds = new Float32Array(sporeCount);
    const sporeSizes = new Float32Array(sporeCount);
    const detachedSporeCount = 6;
    const detachedSporePositions = new Float32Array(detachedSporeCount * 3);
    const detachedSporeSeeds = new Float32Array(detachedSporeCount);
    const detachedSporeSizes = new Float32Array(detachedSporeCount);
    const v = new THREE.Vector3();
    for (let i = 0; i < sporeCount; i++) {
      const y = 1 - (i / (sporeCount - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = i * goldenAngle;
      const wobble = 0.92 + Math.random() * 0.18;
      v.set(Math.cos(a) * r, y * 0.92, Math.sin(a) * r).normalize();
      const root = v.clone().multiplyScalar(fuzzInnerRadius);
      const tip = v.clone().multiplyScalar(fuzzOuterRadius * wobble);
      root.y += DANDYLION_STEM_H;
      tip.y += DANDYLION_STEM_H;

      linePositions.set([root.x, root.y, root.z, tip.x, tip.y, tip.z], i * 6);
      lineSeeds[i * 2] = i * 0.173;
      lineSeeds[i * 2 + 1] = i * 0.173 + 0.37;
      sporePositions.set([tip.x, tip.y, tip.z], i * 3);
      sporeSeeds[i] = i * 0.173 + 0.71;
      sporeSizes[i] = 4.2 + Math.random() * 4.2;
    }
    for (let i = 0; i < detachedSporeCount; i++) {
      const y = 0.2 + Math.random() * 0.6;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = i * goldenAngle + Math.random() * 0.28;
      v.set(Math.cos(a) * r, y * 0.86, Math.sin(a) * r).normalize();
      const start = v.multiplyScalar(fuzzOuterRadius * (0.72 + Math.random() * 0.20));
      start.y += DANDYLION_STEM_H;
      detachedSporePositions.set([start.x, start.y, start.z], i * 3);
      detachedSporeSeeds[i] = Math.random();
      detachedSporeSizes[i] = 4.0 + Math.random() * 3.1;
    }

    const lineGeo = pooled("dandylion.fuzz.line.geo", () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
      geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(lineSeeds, 1));
      return geo;
    });
    const sporeGeo = pooled("dandylion.spore.point.geo", () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(sporePositions, 3));
      geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(sporeSeeds, 1));
      geo.setAttribute("aSize", new THREE.Float32BufferAttribute(sporeSizes, 1));
      return geo;
    });
    const detachedSporeGeo = pooled("dandylion.detached.spore.point.geo", () => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(detachedSporePositions, 3));
      geo.setAttribute("aSeed", new THREE.Float32BufferAttribute(detachedSporeSeeds, 1));
      geo.setAttribute("aSize", new THREE.Float32BufferAttribute(detachedSporeSizes, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, DANDYLION_STEM_H + 0.35, 0), 12.5);
      return geo;
    });
    const fuzzVertexShader = `
      attribute float aSeed;
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uFoliageWind;
      uniform float uDandylionHeadY;
      varying float vSeed;
      vec2 dandylionHeadWindOffset() {
        float windY = uDandylionHeadY;
        float windAmp = windY * windY * uWindStrength * uFoliageWind;
        vec4 wp = modelMatrix * vec4(vec3(0.0, uDandylionHeadY, 0.0), 1.0);
        float w1 = sin(uTime * 1.4 + wp.x * 0.30 + wp.z * 0.40);
        float w2 = sin(uTime * 0.9 + wp.x * 0.15 - wp.z * 0.25);
        vec2 windWorld = vec2(w1 * windAmp * 0.06, w2 * windAmp * 0.05);
        return windWorld;
      }
      void main() {
        vSeed = aSeed;
        vec3 p = position;
        p.xz += dandylionHeadWindOffset();
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `;
    const lineMat = pooled("dandylion.fuzz.line.mat", () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: state.windUniforms.uTime,
          uWindStrength: { value: DANDYLION_WIND },
          uFoliageWind: state.windUniforms.uFoliageWind,
          uDandylionHeadY: { value: DANDYLION_STEM_H },
          uColor: { value: new THREE.Color("#f9f0d8") },
          uOpacity: { value: glow ? 0.46 : 0.34 },
        },
        vertexShader: fuzzVertexShader,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vSeed;
          void main() {
            float twinkle = 0.84 + 0.16 * sin(vSeed * 11.0);
            gl_FragColor = vec4(uColor * twinkle, uOpacity);
          }
        `,
        transparent: true,
        depthWrite: false,
      })
    );
    const sporeMat = pooled("dandylion.spore.point.mat", () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: state.windUniforms.uTime,
          uWindStrength: { value: DANDYLION_WIND },
          uFoliageWind: state.windUniforms.uFoliageWind,
          uDandylionHeadY: { value: DANDYLION_STEM_H },
          uColor: { value: new THREE.Color("#fff8e8") },
          uOpacity: { value: glow ? 0.58 : 0.44 },
        },
        vertexShader: fuzzVertexShader.replace(
          "void main() {",
          "attribute float aSize;\nvoid main() {"
        ).replace(
          "gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);",
          "vec4 mv = modelViewMatrix * vec4(p, 1.0);\n        gl_Position = projectionMatrix * mv;\n        gl_PointSize = aSize;"
        ),
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vSeed;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c);
            if (d > 0.5) discard;
            float soft = smoothstep(0.5, 0.08, d);
            float twinkle = 0.82 + 0.18 * sin(vSeed * 13.0);
            gl_FragColor = vec4(uColor * twinkle, soft * uOpacity);
          }
        `,
        transparent: true,
        depthWrite: false,
      })
    );
    const detachedSporeMat = pooled("dandylion.detached.spore.point.mat", () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: state.windUniforms.uTime,
          uWindStrength: { value: DANDYLION_WIND },
          uFoliageWind: state.windUniforms.uFoliageWind,
          uDandylionHeadY: { value: DANDYLION_STEM_H },
          uColor: { value: new THREE.Color("#fffaf0") },
          uOpacity: { value: glow ? 0.62 : 0.48 },
        },
        vertexShader: `
          attribute float aSeed;
          attribute float aSize;
          uniform float uTime;
          uniform float uWindStrength;
          uniform float uFoliageWind;
          uniform float uDandylionHeadY;
          varying float vSeed;
          varying float vDriftAlpha;
          void main() {
            vSeed = aSeed;
            float cycle = fract(uTime * 0.037 + aSeed);
            float rise = smoothstep(0.03, 0.18, cycle);
            float fade = rise * (1.0 - smoothstep(0.62, 0.96, cycle)) * uFoliageWind;
            vec4 headWp = modelMatrix * vec4(vec3(0.0, uDandylionHeadY, 0.0), 1.0);
            vec2 windDir = normalize(vec2(
              0.72 + sin(headWp.z * 0.23 + aSeed * 8.0) * 0.28,
              0.44 + cos(headWp.x * 0.19 + aSeed * 7.0) * 0.24
            ));
            vec3 p = position;
            float lift = smoothstep(0.0, 0.72, cycle);
            vec2 crossWind = vec2(-windDir.y, windDir.x);
            float lateralLane = (fract(aSeed * 17.0) - 0.5) * 0.055;
            float forwardGust = 0.92 + 0.16 * sin(aSeed * 37.0);
            float modelScale = max(length(modelMatrix[0].xyz), 0.001);
            float travel = 10.0 / modelScale;
            p.xz += windDir * cycle * cycle * forwardGust * uWindStrength * uFoliageWind * travel;
            p.xz += crossWind * lateralLane * lift * uFoliageWind;
            p.y += cycle * (0.18 + sin(aSeed * 19.0) * 0.045);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = aSize * (1.0 - cycle * 0.35);
            vDriftAlpha = fade;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vSeed;
          varying float vDriftAlpha;
          void main() {
            vec2 c = gl_PointCoord - 0.5;
            float d = length(c);
            if (d > 0.5) discard;
            float soft = smoothstep(0.5, 0.08, d);
            float twinkle = 0.86 + 0.14 * sin(vSeed * 41.0);
            gl_FragColor = vec4(uColor * twinkle, soft * uOpacity * vDriftAlpha);
          }
        `,
        transparent: true,
        depthWrite: false,
      })
    );
    const fuzzLines = new THREE.LineSegments(lineGeo, lineMat);
    const spores = new THREE.Points(sporeGeo, sporeMat);
    const detachedSpores = new THREE.Points(detachedSporeGeo, detachedSporeMat);
    fuzzLines.renderOrder = 1;
    spores.renderOrder = 2;
    detachedSpores.renderOrder = 3;
    g.add(fuzzLines);
    g.add(spores);
    g.add(detachedSpores);

    g.userData.flowerSpotY = DANDYLION_STEM_H;
    return g;
}
export function cactus() {
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
}
export function mushroom(biome) {
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
      makeMushroomStemGeometry(0.35, { baseRadius: 0.095, topRadius: 0.066, bulbRadius: 0.040, radialSegments: 7 })
    );
    const stemMat = pooled("mushroom.stem.mat.smooth", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({ color: "#f1e8d8" }),
        MUSH_WIND
      )
    );
    const undersideMat = pooled("mushroom.underside.mat.lit", () =>
      applyWindSway(makeMushroomUndersideMaterial(), MUSH_WIND)
    );
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.castShadow = true;
    g.add(stem);
    const capGeo = pooled("mushroom.cap.geo", () =>
      new THREE.SphereGeometry(0.22, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2)
        .scale(1.4, 0.9, 1.4)
        .translate(0, STEM_TOP + 0.01, 0)
    );
    const capColor = new THREE.Color(biome.accent).offsetHSL(
      (Math.random() - 0.5) * 0.06,
      (Math.random() - 0.5) * 0.15,
      (Math.random() - 0.5) * 0.10
    );
    const capMat = applyWindSway(
      makeMushroomCapPBRMaterial({ color: capColor, roughness: 0.6 }),
      MUSH_WIND
    );
    enableMushroomCapShadowUnderside(capMat);
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.castShadow = true;
    g.add(cap);
    // Underside disc — closes the hemisphere so looking up under the cap
    // from first-person stroll doesn't see through into empty space.
    // Rotation/scale are baked into the geometry so the wind shader sees a
    // uniform transformed.y = STEM_TOP across every vertex.
    const undersideGeo = pooled("mushroom.underside.geo", () =>
      makeMushroomUndersideGeometry(0.22 * 1.4, 0.22 * 1.4, STEM_TOP + 0.01, 12)
    );
    const underside = new THREE.Mesh(undersideGeo, undersideMat);
    g.add(underside);
    // Local Y of the cap top so world.js can register an accurate perch
    // spot for fliers. Sphere radius 0.22 with Y-scale 0.9 puts the apex at
    // cap.position.y + 0.22*0.9.
    g.userData.capTopY = 0.36 + 0.22 * 0.9;
    g.userData.perchWind = { strength: MUSH_WIND, localY: g.userData.capTopY };
    addGroveMushroomFamily(g, biome, { radius: 0.42, count: 2, capY: g.userData.capTopY });
    return g;
}
export function fern(biome) {
    const g = new THREE.Group();
    const castMicroShadow = shouldCastMicroFloraShadow(biome);
    const stemMat = pooled("fern.frond.stem.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.ground[0]).offsetHSL(0, 0.04, -0.06),
          flatShading: false,
          roughness: 0.92,
        }),
        1.0
      )
    );
    const leafMat = pooled("fern.frond.leaflet.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.ground[1] ?? biome.ground[0]).offsetHSL(0, 0.10, 0.02),
          side: THREE.DoubleSide,
          flatShading: false,
          roughness: 0.84,
        }),
        1.45
      )
    );
    const stemGeo = pooled("fern.frond.stem.geo", () => new THREE.CylinderGeometry(0.007, 0.014, 1, 5));
    const leafletGeo = pooled("fern.frond.leaflet.geo", () => {
      const geo = buildLeafGeo({
        lengthSegs: 8,
        widthSegs: 4,
        length: 0.18,
        maxWidth: 0.030,
        minWidth: 0.003,
        profileExp: 0.72,
        taperEnd: 0.28,
        centerLift: 0.006,
        centerLiftFade: 0.45,
        tipCurlStrength: 0.035,
        tipCurlExp: 1.35,
        edgeCurlStrength: 0.012,
        centerRibLift: 0.004,
        secondaryRibLift: 0.0025,
        secondaryRibFrequency: 5.8,
      });
      geo.rotateZ(Math.PI);
      return geo;
    });
    const yAxis = new THREE.Vector3(0, 1, 0);
    const fronds = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < fronds; i++) {
      const frond = new THREE.Group();
      const a = (i / fronds) * Math.PI * 2 + (Math.random() - 0.5) * 0.42;
      const lean = 0.40 + Math.random() * 0.34;
      const frondLength = 0.44 + Math.random() * 0.20;
      const dir = new THREE.Vector3(
        Math.cos(a) * Math.sin(lean),
        Math.cos(lean),
        Math.sin(a) * Math.sin(lean)
      ).normalize();
      frond.quaternion.setFromUnitVectors(yAxis, dir);
      frond.position.set(Math.cos(a) * 0.025, 0, Math.sin(a) * 0.025);

      const stem = new THREE.Mesh(stemGeo, stemMat);
      stem.position.y = frondLength * 0.5;
      stem.scale.y = frondLength;
      stem.castShadow = castMicroShadow;
      frond.add(stem);

      const leafletPairs = 5 + Math.floor(Math.random() * 2);
      for (let j = 0; j < leafletPairs; j++) {
        const t = (j + 1) / (leafletPairs + 1);
        const y = frondLength * (0.14 + t * 0.70);
        const leafletScale = 0.72 + t * 0.46 + Math.random() * 0.08;
        for (const side of [-1, 1]) {
          const leaflet = new THREE.Mesh(leafletGeo, leafMat);
          leaflet.position.set(side * (0.006 + t * 0.010), y, (Math.random() - 0.5) * 0.010);
          leaflet.rotation.z = side * (0.82 + t * 0.34 + Math.random() * 0.12);
          leaflet.rotation.y = side * (0.10 + Math.random() * 0.18);
          leaflet.rotation.x = -0.14 + t * 0.20 + (Math.random() - 0.5) * 0.08;
          leaflet.scale.setScalar(leafletScale);
          leaflet.castShadow = castMicroShadow;
          frond.add(leaflet);
        }
      }

      const tip = new THREE.Mesh(leafletGeo, leafMat);
      tip.position.y = frondLength * 0.90;
      tip.rotation.z = (Math.random() - 0.5) * 0.16;
      tip.rotation.x = 0.08 + Math.random() * 0.10;
      tip.scale.setScalar(0.80 + Math.random() * 0.16);
      tip.castShadow = castMicroShadow;
      frond.add(tip);

      g.add(frond);
    }
    return g;
}
export function reed() {
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
}
export function seaweed(biome) {
    const g = new THREE.Group();
    const SEAWEED_BASE_HEIGHT = 0.8;
    const SEAWEED_SEGMENTS = 6;
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
      const h = SEAWEED_BASE_HEIGHT * (0.78 + Math.random() * 0.22);
      const w = 0.055 + Math.random() * 0.035;
      const geo = new THREE.PlaneGeometry(w, h, 1, SEAWEED_SEGMENTS);
      const position = geo.attributes.position;
      const bow = (Math.random() - 0.5) * 2;
      for (let i = 0; i < position.count; i++) {
        const y = position.getY(i) + h / 2;
        const t = y / h;
        const x = position.getX(i);
        const z = position.getZ(i);
        position.setX(i, x + bow * 0.025 * Math.sin(t * Math.PI * 1.5));
        position.setZ(i, z + bow * 0.018 * Math.sin(t * Math.PI * 2.0 + 0.6));
      }
      position.needsUpdate = true;
      geo.translate(0, h / 2, 0);
      geo.computeVertexNormals();
      const blade = new THREE.Mesh(geo, i % 2 ? matA : matB);
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      blade.position.set(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08);
      blade.rotation.y = a + Math.PI / 2;
      blade.rotation.z = (Math.random() - 0.5) * 0.45;
      g.add(blade);
    }
    g.userData.surfaceReachRange = [0.5, 0.95];
    g.userData.baseHeight = SEAWEED_BASE_HEIGHT;
    return g;
}
export function grass(biome) {
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
}
export function beachsucculent(biome) {
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
}
export function berrybush(biome) {
    const g = new THREE.Group();
    const castMicroShadow = shouldCastMicroFloraShadow(biome);

    // --- Leaf plates (layered dome, like the leafball tree but smaller/bushy) ---
    const leafMats = [
      pooled("berrybush.leaf.mat.shadow", () =>
        applyLeafPlateWind(
          applyLeafPlateGradient(
            new THREE.MeshStandardMaterial({
              color: new THREE.Color(biome.ground[0]).lerp(new THREE.Color("#2a5e2e"), 0.25),
              side: THREE.DoubleSide,
              flatShading: true,
              roughness: 0.82,
            }),
            { tipLift: 0.22, baseShade: 0.25, veinShade: 0.18, sideShade: 0.24 }
          ),
          0.14
        )
      ),
      pooled("berrybush.leaf.mat.mid", () =>
        applyLeafPlateWind(
          applyLeafPlateGradient(
            new THREE.MeshStandardMaterial({
              color: new THREE.Color(biome.ground[1]).lerp(new THREE.Color("#5aad4a"), 0.28),
              side: THREE.DoubleSide,
              flatShading: true,
              roughness: 0.78,
            }),
            { tipLift: 0.28, baseShade: 0.22, veinShade: 0.16, sideShade: 0.26 }
          ),
          0.16
        )
      ),
      pooled("berrybush.leaf.mat.light", () =>
        applyLeafPlateWind(
          applyLeafPlateGradient(
            new THREE.MeshStandardMaterial({
              color: new THREE.Color(biome.ground[1]).lerp(new THREE.Color("#72c462"), 0.18),
              side: THREE.DoubleSide,
              flatShading: true,
              roughness: 0.82,
            }),
            { tipLift: 0.20, baseShade: 0.18, veinShade: 0.14, sideShade: 0.22 }
          ),
          0.15
        )
      ),
    ];

    // Wider, rounder leaf shape for bush foliage (not the teardrop leaf of the tree)
    const leafGeo = pooled("berrybush.leaf.geo", () =>
      buildLeafGeo({
        lengthSegs: 5,
        widthSegs: 3,
        length: 0.28,
        maxWidth: 0.165,
        minWidth: 0.005,
        profileExp: 0.55,
        taperEnd: null,
        centerLift: 0.028,
        centerLiftFade: 0.3,
        tipCurlStrength: 0.040,
        tipCurlExp: 1.3,
        edgeCurlStrength: 0.028,
      })
    );
    const leafOutlineGeo = pooled("berrybush.leaf.outline.geo", () => {
      const geo = leafGeo.clone();
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        pos.setX(i, pos.getX(i) * 1.08);
        pos.setZ(i, pos.getZ(i) - 0.004);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      return geo;
    });
    const leafOutlineMat = pooled("berrybush.leaf.outline.mat", () =>
      applyLeafPlateWind(
        new THREE.MeshBasicMaterial({
          name: "berrybush.leaf.outline.mat",
          color: "#0e1e12",
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        }),
        0.14
      )
    );

    // Bush dome placement: hemisphere centered at (0, 0.30, 0)
    const bushCenter = new THREE.Vector3(0, 0.30, 0);
    const bushRadius = new THREE.Vector3(0.34, 0.28, 0.34);
    const up = new THREE.Vector3(0, 1, 0);
    const basis = new THREE.Matrix4();
    const matrix = new THREE.Matrix4();
    const scaleVec = new THREE.Vector3();
    const leafBuckets = leafMats.map(() => []);

    const orientLeaf = (leaf, normal, shingleLift = 0.08) => {
      const tangentDown = up.clone().sub(normal.clone().multiplyScalar(up.dot(normal)));
      if (tangentDown.lengthSq() < 0.0001) tangentDown.set(0, 0, 1);
      tangentDown.normalize().multiplyScalar(-1);
      const faceNormal = normal.clone().addScaledVector(tangentDown, shingleLift).normalize();
      const yAxis = tangentDown.clone().multiplyScalar(-1);
      const xAxis = yAxis.clone().cross(faceNormal).normalize();
      basis.makeBasis(xAxis, yAxis, faceNormal);
      leaf.quaternion.setFromRotationMatrix(basis);
    };

    // Dome rows — upper hemisphere only, tighter than the tree
    const addLeafRing = ({ count, phi, shell = 1, scale = 0.7, matIndex = 1, phase = 0, lift = 0.10 }) => {
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + phase + (Math.random() - 0.5) * 0.06;
        const normal = new THREE.Vector3(
          Math.sin(phi) * Math.cos(a),
          Math.cos(phi),
          Math.sin(phi) * Math.sin(a)
        ).normalize();
        const leaf = new THREE.Object3D();
        leaf.position.set(
          bushCenter.x + normal.x * bushRadius.x * shell,
          bushCenter.y + normal.y * bushRadius.y * shell,
          bushCenter.z + normal.z * bushRadius.z * shell
        );
        orientLeaf(leaf, normal, lift);
        leaf.rotateX(0.02 + lift * 0.15);
        leaf.rotateZ((Math.random() - 0.5) * 0.10);
        const s = scale * (0.90 + Math.random() * 0.20);
        scaleVec.set(s * 0.96, s * 1.12, s);
        matrix.compose(leaf.position, leaf.quaternion, scaleVec);
        leafBuckets[matIndex].push(matrix.clone());
      }
    };

    // Cap cluster — tight rosette with tips converging at center.
    // Use orientLeaf with a tilted normal so the tangent is valid near the pole.
    const capCount = 4;
    const capY = bushCenter.y + bushRadius.y * 1.18;
    const capBaseR = 0.02;
    for (let i = 0; i < capCount; i++) {
      const a = (i / capCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.04;
      // Normal mostly up but tilted outward enough for a valid tangent
      const capNormal = new THREE.Vector3(
        Math.cos(a) * 0.35,
        1.0,
        Math.sin(a) * 0.35
      ).normalize();
      const leaf = new THREE.Object3D();
      leaf.position.set(
        bushCenter.x + Math.cos(a) * capBaseR,
        capY,
        bushCenter.z + Math.sin(a) * capBaseR
      );
      orientLeaf(leaf, capNormal, 0.44);
      const s = 0.45 * (0.92 + Math.random() * 0.16);
      scaleVec.set(s * 0.96, s * 1.12, s);
      matrix.compose(leaf.position, leaf.quaternion, scaleVec);
      leafBuckets[1].push(matrix.clone());
    }
    // Dome rings (upper hemisphere phi 0..PI/2)
    const rowCounts = [7, 9, 12, 12, 9, 13];
    for (let row = 0; row < rowCounts.length; row++) {
      const t = row / (rowCounts.length - 1);
      const phi = 0.20 + t * 1.35;
      const rowScale = 0.68 + Math.sin((1 - t) * Math.PI * 0.5) * 0.12;
      const matIndex = row === 0 ? 2 : row > 3 ? 0 : 1;
      const rowLift = row === 0 ? 0.28 : 0.18 - t * 0.08;
      addLeafRing({
        count: rowCounts[row],
        phi,
        shell: 1.05 - t * 0.08 + (Math.random() - 0.5) * 0.02,
        scale: rowScale,
        matIndex,
        phase: (row % 2) * (Math.PI / rowCounts[row]),
        lift: rowLift,
      });
    }

    // Instanced leaf batches
    for (let i = 0; i < leafBuckets.length; i++) {
      const outline = makeInstancedLeafBatch(leafOutlineGeo, leafOutlineMat, leafBuckets[i]);
      if (outline) {
        outline.castShadow = false;
        outline.renderOrder = -1;
        g.add(outline);
      }
    }
    for (let i = 0; i < leafBuckets.length; i++) {
      const leaves = makeInstancedLeafBatch(leafGeo, leafMats[i], leafBuckets[i], castMicroShadow);
      if (leaves) g.add(leaves);
    }

    // --- Shiny berries with per-bush color variation ---
    // Pick a berry color variant per bush
    const BERRY_PALETTES = [
      { color: "#e63946", hsl: [0.98, 0.72, 0.45] },   // bright red
      { color: "#d62839", hsl: [0.97, 0.65, 0.40] },   // deep crimson
      { color: "#f4845f", hsl: [0.06, 0.80, 0.58] },   // coral-orange
      { color: "#9b2335", hsl: [0.95, 0.60, 0.32] },   // dark wine
      { color: "#ff6b6b", hsl: [0.0, 0.78, 0.62] },    // cherry pink
      { color: "#c1440e", hsl: [0.06, 0.72, 0.35] },   // burnt orange
      { color: "#8b1a4a", hsl: [0.92, 0.65, 0.30] },   // plum
      { color: "#e85d75", hsl: [0.95, 0.72, 0.55] },    // rose
    ];
    const berryVariant = BERRY_PALETTES[Math.floor(Math.random() * BERRY_PALETTES.length)];
    const berryBaseColor = new THREE.Color(berryVariant.color);

    const berryMat = pooled("berrybush.berry.mat." + berryVariant.color, () =>
      new THREE.MeshStandardMaterial({
        color: berryBaseColor,
        roughness: 0.18,
        metalness: 0.05,
      })
    );
    const berryGeo = pooled("berrybush.berry.geo", () => new THREE.SphereGeometry(0.028, 8, 6));

    // Place berries on the dome surface so they poke out between leaves.
    // Reject placements that overlap an existing berry (min center-to-center gap).
    const berryCount = 12 + Math.floor(Math.random() * 12);
    const berryR = 0.37; // just outside the leaf shell so berries read on the surface
    const minBerryGap = 0.15; // minimum distance between berry centers
    const berryPositions = [];
    for (let i = 0; i < berryCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const elev = 0.1 + Math.random() * 1.47;
      const c = Math.cos(elev);
      const s = Math.sin(elev);
      const bx = Math.cos(a) * c * berryR;
      const by = 0.30 + s * berryR * 0.85;
      const bz = Math.sin(a) * c * berryR;
      // Skip if too close to an existing berry
      const tooClose = berryPositions.some(p =>
        (p.x - bx) ** 2 + (p.y - by) ** 2 + (p.z - bz) ** 2 < minBerryGap * minBerryGap
      );
      if (tooClose) continue;
      berryPositions.push({ x: bx, y: by, z: bz });
      const berry = new THREE.Mesh(berryGeo, berryMat);
      berry.position.set(bx, by, bz);
      const bs = 0.85 + Math.random() * 0.20;
      berry.scale.setScalar(bs);
      berry.castShadow = castMicroShadow;
      g.add(berry);
    }
    return g;
}
