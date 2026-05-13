import * as THREE from "three";
import { jitterGeo, applyWindSway, TRUNK } from "./util.js";
import { BLOOM_LAYER } from "./postfx.js";

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

export const FLORA_BUILDERS = {
  tree(biome) {
    const g = new THREE.Group();
    const trunkGeo = pooled("tree.trunk.geo", () =>
      new THREE.CylinderGeometry(0.13, 0.18, 1.1, 6)
    );
    const trunkMat = pooled("tree.trunk.mat", () =>
      new THREE.MeshStandardMaterial({ color: TRUNK, flatShading: true, roughness: 1 })
    );
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.55;
    trunk.castShadow = true;
    g.add(trunk);
    const leafGeo = pooled("tree.leaves.geo", () =>
      jitterGeo(new THREE.IcosahedronGeometry(0.75, 0), 0.12)
    );
    const leafMat = pooled("tree.leaves.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.ground[0]).offsetHSL(0, 0.05, 0.08),
          flatShading: true,
          roughness: 0.85,
        }),
        1.0
      )
    );
    const leaves = new THREE.Mesh(leafGeo, leafMat);
    leaves.position.y = 1.45;
    leaves.scale.set(1, 1.15, 1);
    leaves.castShadow = true;
    g.add(leaves);
    return g;
  },

  pine(biome) {
    const g = new THREE.Group();
    const trunkGeo = pooled("pine.trunk.geo", () =>
      new THREE.CylinderGeometry(0.08, 0.12, 0.4, 6)
    );
    const trunkMat = pooled("pine.trunk.mat", () =>
      new THREE.MeshStandardMaterial({ color: TRUNK, flatShading: true })
    );
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.2;
    trunk.castShadow = true;
    g.add(trunk);
    const coneMat = pooled("pine.cone.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.accent).lerp(new THREE.Color("#0d2c1f"), 0.35),
          flatShading: true,
        }),
        0.6
      )
    );
    const tiers = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < tiers; i++) {
      const coneGeo = pooled("pine.cone.geo." + i, () =>
        new THREE.ConeGeometry(0.65 - i * 0.13, 0.65, 6)
      );
      const cone = new THREE.Mesh(coneGeo, coneMat);
      cone.position.y = 0.45 + i * 0.42;
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
    if (Math.random() > 0.4) {
      const armGeo = pooled("cactus.arm1.geo", () => new THREE.CapsuleGeometry(0.1, 0.4, 4, 8));
      const arm = new THREE.Mesh(armGeo, m);
      arm.position.set(0.22, 0.7, 0);
      arm.rotation.z = -Math.PI / 2.5;
      arm.castShadow = true;
      g.add(arm);
    }
    if (Math.random() > 0.5) {
      const armGeo = pooled("cactus.arm2.geo", () => new THREE.CapsuleGeometry(0.1, 0.35, 4, 8));
      const arm = new THREE.Mesh(armGeo, m);
      arm.position.set(-0.22, 0.55, 0);
      arm.rotation.z = Math.PI / 2.5;
      arm.castShadow = true;
      g.add(arm);
    }
    return g;
  },

  mushroom(biome) {
    const g = new THREE.Group();
    const stemGeo = pooled("mushroom.stem.geo", () =>
      new THREE.CylinderGeometry(0.07, 0.1, 0.35, 6)
    );
    const stemMat = pooled("mushroom.stem.mat", () =>
      new THREE.MeshStandardMaterial({ color: "#f1e8d8", flatShading: true })
    );
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.y = 0.18;
    stem.castShadow = true;
    g.add(stem);
    const capGeo = pooled("mushroom.cap.geo", () =>
      new THREE.SphereGeometry(0.22, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2)
    );
    const capMat = pooled("mushroom.cap.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.accent),
          flatShading: true,
          roughness: 0.6,
        }),
        0.4
      )
    );
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = 0.36;
    cap.scale.set(1.4, 0.9, 1.4);
    cap.castShadow = true;
    g.add(cap);
    // Underside disc — closes the hemisphere so looking up under the cap
    // from first-person stroll doesn't see through into empty space.
    const undersideGeo = pooled("mushroom.underside.geo", () =>
      new THREE.CircleGeometry(0.22, 8)
    );
    const underside = new THREE.Mesh(undersideGeo, stemMat);
    underside.rotation.x = Math.PI / 2; // face down (normal -Y)
    underside.position.y = 0.36;
    underside.scale.set(1.4, 1.4, 1);
    g.add(underside);
    // Local Y of the cap top so world.js can register an accurate perch
    // spot for fliers. Sphere radius 0.22 with Y-scale 0.9 puts the apex at
    // cap.position.y + 0.22*0.9.
    g.userData.capTopY = 0.36 + 0.22 * 0.9;
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
      const shard = new THREE.Mesh(
        new THREE.IcosahedronGeometry(r, 0),
        mat
      );
      const a = (i / shards) * Math.PI * 2 + Math.random() * 0.5;
      const off = 0.05 + Math.random() * 0.1;
      shard.position.set(
        Math.cos(a) * off,
        r * (0.9 + Math.random() * 1.4),
        Math.sin(a) * off
      );
      // stretch upward — shard-like silhouette
      shard.scale.set(0.55, 1.5 + Math.random() * 0.8, 0.55);
      shard.rotation.y = Math.random() * Math.PI * 2;
      shard.rotation.z = (Math.random() - 0.5) * 0.35;
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
    const stemMat = pooled("bigmushroom.stem.mat", () =>
      new THREE.MeshStandardMaterial({ color: "#f1e8d8", flatShading: true, roughness: 0.95 })
    );
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.18, stemH, 7),
      stemMat
    );
    stem.position.y = stemH / 2;
    stem.rotation.z = (Math.random() - 0.5) * 0.1;
    stem.castShadow = true;
    g.add(stem);
    const capGeo = pooled("bigmushroom.cap.geo", () =>
      new THREE.SphereGeometry(0.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)
    );
    const capMat = pooled("bigmushroom.cap.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.accent),
          flatShading: true,
          roughness: 0.55,
        }),
        0.35
      )
    );
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = stemH;
    cap.scale.set(1, 0.55, 1);
    cap.castShadow = true;
    g.add(cap);
    // Local Y of the cap top — varies with this instance's random stemH,
    // so world.js needs to read it off userData rather than guess from a
    // static per-kind table.
    g.userData.capTopY = stemH + 0.8 * 0.55;
    // Underside disc — closes the hemisphere so walking under the cap in
    // first-person doesn't see through into empty space above. Uses the
    // stem material (cream) which reads as a fresh mushroom gill plate.
    const undersideGeo = pooled("bigmushroom.underside.geo", () =>
      new THREE.CircleGeometry(0.8, 12)
    );
    const underside = new THREE.Mesh(undersideGeo, stemMat);
    underside.rotation.x = Math.PI / 2;
    underside.position.y = stemH;
    g.add(underside);
    const spotMat = pooled("bigmushroom.spot.mat", () =>
      new THREE.MeshStandardMaterial({ color: "#fbf3df", flatShading: true, roughness: 0.9 })
    );
    const spots = 3 + Math.floor(Math.random() * 3);
    const capR = 0.8;
    const capSY = 0.55;
    const capA2 = capR * capR;
    const capB2 = (capR * capSY) * (capR * capSY);
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < spots; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.25 + Math.random() * 0.4;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const yLocal = Math.sqrt(Math.max(0, capA2 - r * r)) * capSY;
      const n = new THREE.Vector3(x / capA2, yLocal / capB2, z / capA2).normalize();
      const spot = new THREE.Mesh(
        new THREE.SphereGeometry(0.08 + Math.random() * 0.05, 6, 5),
        spotMat
      );
      const sink = 0.02;
      spot.position.set(x - n.x * sink, stemH + yLocal - n.y * sink, z - n.z * sink);
      spot.quaternion.setFromUnitVectors(up, n);
      spot.scale.y = 0.35;
      g.add(spot);
    }
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
        flatShading: true,
        roughness: 0.55,
      })
    );
    const berryGeo = pooled("berrybush.berry.geo", () => new THREE.SphereGeometry(0.05, 6, 5));
    const berries = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < berries; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.15 + Math.random() * 0.15;
      const berry = new THREE.Mesh(berryGeo, berryMat);
      berry.position.set(
        Math.cos(a) * r,
        0.4 + Math.random() * 0.1,
        Math.sin(a) * r
      );
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

  balloontree(biome) {
    const g = new THREE.Group();
    const trunkH = 1.1 + Math.random() * 0.5;
    const trunkMat = pooled("balloontree.trunk.mat", () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.cliff).offsetHSL(0, 0, 0.15),
        flatShading: true,
        roughness: 1,
      })
    );
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.1, trunkH, 6),
      trunkMat
    );
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    g.add(trunk);
    const puffMat = pooled("balloontree.puff.mat", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(biome.ground[2]).lerp(new THREE.Color("#ffffff"), 0.6),
          flatShading: true,
          roughness: 0.95,
        }),
        0.3
      )
    );
    const puffs = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < puffs; i++) {
      const r = 0.32 + Math.random() * 0.18;
      const puff = new THREE.Mesh(
        jitterGeo(new THREE.IcosahedronGeometry(r, 0), r * 0.18),
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
      jitterGeo(new THREE.IcosahedronGeometry(0.45, 0), 0.08),
      puffMat
    );
    crown.position.y = trunkH + 0.5;
    crown.castShadow = true;
    g.add(crown);
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

