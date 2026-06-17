import * as THREE from "three";
import { jitterGeo } from "../util.js";
import {
  makePlainRockPBRMaterial,
  makeStonePBRMaterial,
} from "../pbr.js";
import { pooled, addPillarSurfaceMarks, makePlainRockGeometry } from "./_shared.js";

export function rock(biome) {
    const g = new THREE.Group();
    const r = 0.18 + Math.random() * 0.35;
    const baseCol = new THREE.Color(biome.cliff).offsetHSL(
      0,
      0,
      0.05 + Math.random() * 0.1
    );
    const mat = makePlainRockPBRMaterial({
      color: baseCol,
      flatShading: true,
      roughness: 1,
    });
    const mesh = new THREE.Mesh(makePlainRockGeometry(r), mat);
    mesh.castShadow = true;
    g.add(mesh);

    const shoulders = 2;
    const shoulderPhase = Math.random() * Math.PI * 2;
    for (let i = 0; i < shoulders; i++) {
      const a = shoulderPhase + i * Math.PI * 0.82;
      const chipRadius = r * (0.46 + Math.random() * 0.18);
      const chipColor = baseCol.clone().offsetHSL(0, -0.02, -0.03 + Math.random() * 0.08);
      const chip = new THREE.Mesh(
        makePlainRockGeometry(chipRadius, { shoulder: true }),
        makePlainRockPBRMaterial({
          color: chipColor,
          flatShading: true,
          roughness: 1,
        })
      );
      chip.position.set(Math.cos(a) * r * 0.74, -r * 0.14, Math.sin(a) * r * 0.62);
      chip.rotation.y = a + Math.PI * (0.25 + Math.random() * 0.5);
      chip.castShadow = true;
      g.add(chip);
    }

    return g;
}
export function limestonerock(biome) {
    const g = new THREE.Group();
    const r = 0.2 + Math.random() * 0.32;
    const geo = jitterGeo(new THREE.IcosahedronGeometry(r, 0), r * 0.25, { sphericalUvs: true });
    const baseCol = new THREE.Color(biome.ground[0])
      .lerp(new THREE.Color("#fff4dc"), 0.45)
      .offsetHSL(0.02, -0.08, Math.random() * 0.08);
    const mesh = new THREE.Mesh(
      geo,
      makeStonePBRMaterial({
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
}
export function skull() {
    const g = new THREE.Group();
    const mat = pooled("skull.mat", () =>
      new THREE.MeshStandardMaterial({ color: "#f1ead8", roughness: 0.8 })
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
}
export function pillar(biome) {
    const g = new THREE.Group();
    const stoneCol = new THREE.Color(biome.cliff).offsetHSL(
      0,
      -0.1,
      0.12 + Math.random() * 0.08
    );
    const lichenCol = new THREE.Color(biome.ground[0]).offsetHSL(0, 0.05, 0.1);
    const stoneMat = makeStonePBRMaterial({
      color: stoneCol,
      flatShading: true,
      roughness: 1,
    });
    const lichenMat = makeStonePBRMaterial({
      color: lichenCol,
      flatShading: true,
      roughness: 1,
    });
    const segments = 2 + Math.floor(Math.random() * 3); // 2–4 stacked drums
    const pillarHorizontalScale = biome.id === "desert" ? 1 + Math.random() : 1;
    let y = 0;
    for (let i = 0; i < segments; i++) {
      const h = 0.45 + Math.random() * 0.25;
      const r = (0.22 - i * 0.015) * pillarHorizontalScale;
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
      addPillarSurfaceMarks(drum, r, r * 1.05, h, useLichen ? lichenCol : stoneCol);
      g.add(drum);
      y += h - 0.02;
    }
    let capTopY = y;
    const capRadius = 0.22 * 1.1 * pillarHorizontalScale;
    // broken cap — jittered chunk
    if (Math.random() < 0.7) {
      const cap = new THREE.Mesh(
        jitterGeo(new THREE.IcosahedronGeometry(0.22, 0), 0.08, { sphericalUvs: true }),
        stoneMat
      );
      cap.position.y = y + 0.1;
      cap.scale.set(1.1 * pillarHorizontalScale, 0.5, 1.1 * pillarHorizontalScale);
      cap.rotation.y = Math.random() * Math.PI * 2;
      cap.castShadow = true;
      g.add(cap);
      capTopY = cap.position.y + 0.22 * cap.scale.y;
    }
    g.userData.capTopY = capTopY;
    g.userData.nestHostRadius = capRadius;
    return g;
}
export function archstone(biome) {
    const g = new THREE.Group();
    const stoneCol = new THREE.Color(biome.cliff).offsetHSL(
      0,
      -0.1,
      0.12 + Math.random() * 0.06
    );
    const mat = makeStonePBRMaterial({
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
        jitterGeo(new THREE.IcosahedronGeometry(0.18, 0), 0.06, { sphericalUvs: true }),
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
}
