import * as THREE from "three";
import { jitterGeo } from "../util.js";
import { pooled } from "./_shared.js";

export function coral(biome) {
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
}
export function braincoral(biome) {
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
}
export function cupcoral(biome) {
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
}
