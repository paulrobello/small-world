import * as THREE from "three";
import { jitterGeo, applyWindSway, TRUNK, buildLeafGeo } from "../util.js";
import {
  makeLeafballTreeLeafPBRMaterial,
  makeLeafballTreeTrunkPBRMaterial,
} from "../pbr.js";
import { pooled, applyLeafPlateWind, applyLeafPlateGradient, makeInstancedLeafBatch, shouldUseLeafballCanopyShadowProxy, makeLeafballCanopyShadowProxy, getLeafballTreePalette } from "./_shared.js";

export function tree(biome) {
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
}
export function leafballtree(biome) {
    const g = new THREE.Group();
    const palette = getLeafballTreePalette(biome);
    const trunkMat = pooled("leafballtree.trunk.mat", () =>
      makeLeafballTreeTrunkPBRMaterial({
        color: palette.trunk,
        flatShading: false,
        roughness: 0.95,
        vertexColors: true,
      })
    );
    const trunkGeo = pooled("leafballtree.trunk.geo", () => {
      const geo = new THREE.CylinderGeometry(0.12, 0.24, 1.45, 12, 12).translate(0, 0.725, 0);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      const ringCount = 7;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        const t = y / 1.45;
        const bend = Math.sin(t * Math.PI) * 0.07;
        const taperTwist = Math.sin(t * Math.PI * 2.2) * 0.026;
        pos.setX(i, pos.getX(i) + bend);
        pos.setZ(i, pos.getZ(i) + taperTwist);
        // Bark-ring shading: horizontal bands with soft edges.
        const ring = 0.5 + 0.5 * Math.sin(t * ringCount * Math.PI * 2);
        const band = 0.82 + ring * 0.18;
        // Slight per-vertex noise to break up uniformity.
        const noise = 0.96 + Math.sin(pos.getX(i) * 13.7 + pos.getZ(i) * 9.3) * 0.04;
        colors[i * 3] = band * noise;
        colors[i * 3 + 1] = band * noise;
        colors[i * 3 + 2] = band * noise;
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
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
            makeLeafballTreeLeafPBRMaterial({
              color: palette.leaves[0],
              side: THREE.DoubleSide,
              flatShading: false,
              roughness: 0.82,
            }),
            { tipLift: 0.08, baseShade: 0.12, veinShade: 0.18, sideShade: 0.11, ribShade: 0.26 }
          ),
          0.10
        )
      ),
      pooled("leafballtree.leaf.mat.mid", () =>
        applyLeafPlateWind(
          applyLeafPlateGradient(
            makeLeafballTreeLeafPBRMaterial({
              color: palette.leaves[1],
              side: THREE.DoubleSide,
              flatShading: false,
              roughness: 0.78,
            }),
            { tipLift: 0.10, baseShade: 0.10, veinShade: 0.20, sideShade: 0.12, ribShade: 0.28 }
          ),
          0.13
        )
      ),
      pooled("leafballtree.leaf.mat.light", () =>
        applyLeafPlateWind(
          applyLeafPlateGradient(
            makeLeafballTreeLeafPBRMaterial({
              color: palette.leaves[2],
              side: THREE.DoubleSide,
              flatShading: false,
              roughness: 0.82,
            }),
            { tipLift: 0.045, baseShade: 0.08, veinShade: 0.16, sideShade: 0.10, ribShade: 0.24 }
          ),
          0.12
        )
      ),
    ];
    // Curved, anchored leaf. Local y=0 is the upper attachment point and
    // local -Y is the tip. Local +Z bows outward, so upper-row tips sit in
    // front of lower-row bases like overlapping shingles.
    const leafGeo = pooled("leafballtree.leaf.geo", () =>
      buildLeafGeo({
        lengthSegs: 14,
        widthSegs: 8,
        length: 0.42,
        maxWidth: 0.165,
        minWidth: 0.006,
        profileExp: 0.72,
        taperEnd: 0.16,
        centerLift: 0.012,
        centerLiftFade: 0.35,
        tipCurlStrength: 0.060,
        tipCurlExp: 1.45,
        edgeCurlStrength: 0.010,
        centerRibLift: 0.030,
        secondaryRibLift: 0.018,
        secondaryRibFrequency: 8.5,
      })
    );
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
          color: palette.outline,
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
    const useCanopyShadowProxy = shouldUseLeafballCanopyShadowProxy(biome);
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

    const rowCounts = [9, 14, 18, 22, 26, 26, 24, 20, 17, 13, 10];
    const addLeafRing = ({ count, phi, shell = 1, scale = 0.8, matIndex = 1, phase = 0, lift = 0.12, yOffset = 0, pitchOffset = 0 }) => {
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
        leaf.rotateX(0.02 + lift * 0.18 + pitchOffset);
        leaf.rotateZ((Math.random() - 0.5) * 0.08);
        const s = scale * (0.92 + Math.random() * 0.16);
        scaleVec.set(s * 0.94, s * 1.18, s);
        matrix.compose(leaf.position, leaf.quaternion, scaleVec);
        leafBuckets[matIndex].push(matrix.clone());
      }
    };

    const topHighlightRows = 3;
    const topMotionTuckRows = 4;
    const topMotionTuckAngle = -(0.045 + THREE.MathUtils.degToRad(2));
    const firstTopRowBackoffAngle = THREE.MathUtils.degToRad(2);
    addLeafRing({ count: 6, phi: 0.07, shell: 0.54, scale: 0.72, matIndex: 2, phase: 0.18, lift: 0.32, yOffset: 0.40, pitchOffset: topMotionTuckAngle });
    const earlyRowPhaseOffsets = [0.16, 0.48, -0.08, 0.31];
    let staggerPhase = earlyRowPhaseOffsets[earlyRowPhaseOffsets.length - 1] + Math.PI / rowCounts[earlyRowPhaseOffsets.length - 1];
    for (let row = 0; row < rowCounts.length; row++) {
      const t = row / (rowCounts.length - 1);
      const phi = 0.18 + t * 2.50;
      const rowScale = 0.76 + Math.sin((1 - t) * Math.PI * 0.5) * 0.16;
      const matIndex = row < topHighlightRows ? 2 : row > 6 ? 0 : 1;
      const rowPhase = row < earlyRowPhaseOffsets.length ? earlyRowPhaseOffsets[row] : staggerPhase;
      addLeafRing({
        count: rowCounts[row],
        phi,
        shell: 1.09 - t * 0.15 + (Math.random() - 0.5) * 0.01,
        scale: rowScale,
        matIndex,
        phase: rowPhase,
        lift: row === rowCounts.length - 2 ? 0.48 - t * 0.08 : row === rowCounts.length - 1 ? 0.35 - t * 0.08 : 0.22 - t * 0.10,
        pitchOffset: row === 0 ? topMotionTuckAngle + firstTopRowBackoffAngle : row < topMotionTuckRows ? topMotionTuckAngle : 0,
      });
      if (row >= earlyRowPhaseOffsets.length) staggerPhase += Math.PI / rowCounts[row];
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
      const leaves = makeInstancedLeafBatch(leafGeo, leafMats[i], leafBuckets[i], !useCanopyShadowProxy);
      if (leaves) g.add(leaves);
    }
    if (useCanopyShadowProxy) {
      g.add(makeLeafballCanopyShadowProxy(canopyCenter, canopyRadius));
    }

    const branchGeo = pooled("leafballtree.branch.geo", () => new THREE.CylinderGeometry(0.045, 0.075, 1, 6));
    const yAxis = new THREE.Vector3(0, 1, 0);
    const branchReach = 0.62;
    const minLeafMotionGap = 0.20;
    const branchTipRadius = Math.min(branchReach, canopyRadius.x - minLeafMotionGap);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.24;
      const start = new THREE.Vector3(0.03 * Math.cos(a), 1.10 + canopyYOffset + i * 0.025, 0.03 * Math.sin(a));
      const end = new THREE.Vector3(Math.cos(a) * branchTipRadius, 1.34 + canopyYOffset + (i % 2) * 0.10, Math.sin(a) * branchTipRadius);
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
}
export function pine(biome) {
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
}
export function snowpine(biome) {
    const g = new THREE.Group();
    // Snow-covered pine — stacked low-poly bough skirts with scalloped snow
    // rims, closer to the chunky frozen-forest reference than simple cones.
    const PINE_WIND = 0.18;
    const boughSegments = 28;
    const coneGreen = new THREE.Color(biome.accent).lerp(new THREE.Color("#0d3342"), 0.38);

    const trunkGeo = pooled("snowpine.trunk.geo", () =>
      new THREE.CylinderGeometry(0.075, 0.13, 0.62, 6).translate(0, 0.31, 0)
    );
    const trunkMat = pooled("snowpine.trunk.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(TRUNK).lerp(new THREE.Color("#8ba4b8"), 0.12),
          flatShading: true,
        }),
        PINE_WIND
      )
    );
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.castShadow = true;
    g.add(trunk);

    function applySnowMaskShader(material) {
      material.userData.snowpineSnowShader = true;
      material.onBeforeCompile = (shader) => {
        shader.uniforms.uSnowColor = { value: new THREE.Color("#e4edf7") };
        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            "#include <common>\nattribute float aSnow;\nvarying float vSnow;"
          )
          .replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvSnow = aSnow;"
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nuniform vec3 uSnowColor;\nvarying float vSnow;"
          )
          .replace(
            "#include <color_fragment>",
            `#include <color_fragment>
            float snowMask = smoothstep(0.46, 0.52, vSnow);
            diffuseColor.rgb = mix(diffuseColor.rgb, uSnowColor, snowMask);`
          );
      };
      return material;
    }

    const boughMat = pooled("snowpine.bough.mat", () =>
      applyWindSway(
        applySnowMaskShader(
          new THREE.MeshStandardMaterial({
            color: coneGreen,
            flatShading: false,
            roughness: 0.82,
            vertexColors: true,
          })
        ),
        PINE_WIND
      )
    );

    function makeBoughGeometry(radius, height, tierY) {
      const topY = tierY + height * 0.52;
      const skirtY = tierY - height * 0.32;
      const vertices = [];
      const snowMask = [];
      const colors = [];
      const innerRing = [];
      const outerRing = [];
      const undersideRing = [];
      function pushVertex(x, y, z, snow) {
        const index = vertices.length / 3;
        vertices.push(x, y, z);
        snowMask.push(snow);
        const color = snow > 0.5 ? new THREE.Color("#e4edf7") : coneGreen;
        colors.push(color.r, color.g, color.b);
        return index;
      }
      const apex = pushVertex(0, topY, 0, 0);
      const undersideCenter = pushVertex(0, skirtY + height * 0.02, 0, 0);
      for (let j = 0; j < boughSegments; j++) {
        const a = (j / boughSegments) * Math.PI * 2;
        const point = j % 2 === 0;
        const innerR = radius * (point ? 0.86 : 0.78);
        const outerR = radius * (point ? 1.08 : 0.96);
        const innerY = skirtY + height * 0.035;
        const outerY = skirtY - (point ? height * 0.04 : height * 0.14);
        const ox = Math.cos(a) * outerR;
        const oz = Math.sin(a) * outerR;
        innerRing.push(pushVertex(Math.cos(a) * innerR, innerY, Math.sin(a) * innerR, 0));
        outerRing.push(pushVertex(ox, outerY, oz, 1));
        undersideRing.push(pushVertex(ox, outerY, oz, 0));
      }
      const indices = [];
      for (let j = 0; j < boughSegments; j++) {
        const next = (j + 1) % boughSegments;
        const innerA = innerRing[j];
        const innerB = innerRing[next];
        const outerA = outerRing[j];
        const outerB = outerRing[next];
        indices.push(
          apex, innerB, innerA,
          innerA, innerB, outerB,
          innerA, outerB, outerA
        );
      }
      for (let j = 0; j < boughSegments; j++) {
        const next = (j + 1) % boughSegments;
        const underA = undersideRing[j];
        const underB = undersideRing[next];
        indices.push(undersideCenter, underA, underB);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      geo.setAttribute("aSnow", new THREE.Float32BufferAttribute(snowMask, 1));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geo.setIndex(indices);
      geo.userData.snowpineUpperFaceCount = boughSegments * 3;
      geo.computeVertexNormals();
      return geo;
    }

    const tiers = 4;
    for (let i = 0; i < tiers; i++) {
      const tierRadius = 0.82 - i * 0.095;
      const tierHeight = 0.62 - i * 0.03;
      const tierY = 0.48 + i * 0.36;

      const boughGeo = pooled("snowpine.bough.geo." + i, () =>
        makeBoughGeometry(tierRadius, tierHeight, tierY)
      );
      const bough = new THREE.Mesh(boughGeo, boughMat);
      bough.castShadow = true;
      bough.userData.snowpinePart = "bough";
      bough.userData.tierRadius = tierRadius;
      bough.userData.tierY = tierY;
      bough.userData.zigZagPoints = boughSegments;
      g.add(bough);
    }

    g.userData.obstacleTopY = 1.95;
    return g;
}
