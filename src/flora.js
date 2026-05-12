import * as THREE from "three";
import { jitterGeo, applyWindSway, TRUNK } from "./util.js";

export const FLORA_BUILDERS = {
  tree(biome) {
    const g = new THREE.Group();
    const leafCol = new THREE.Color(biome.ground[0])
      .offsetHSL(0, 0.05, 0.08);
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.18, 1.1, 6),
      new THREE.MeshStandardMaterial({
        color: TRUNK,
        flatShading: true,
        roughness: 1,
      })
    );
    trunk.position.y = 0.55;
    trunk.castShadow = true;
    g.add(trunk);
    const leaves = new THREE.Mesh(
      jitterGeo(new THREE.IcosahedronGeometry(0.75, 0), 0.12),
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: leafCol,
          flatShading: true,
          roughness: 0.85,
        }),
        1.0
      )
    );
    leaves.position.y = 1.45;
    leaves.scale.set(1, 1.15, 1);
    leaves.castShadow = true;
    g.add(leaves);
    return g;
  },

  pine(biome) {
    const g = new THREE.Group();
    const col = new THREE.Color(biome.accent).lerp(
      new THREE.Color("#0d2c1f"),
      0.35
    );
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 0.4, 6),
      new THREE.MeshStandardMaterial({ color: TRUNK, flatShading: true })
    );
    trunk.position.y = 0.2;
    trunk.castShadow = true;
    g.add(trunk);
    // shared cone material — windy
    const coneMat = applyWindSway(
      new THREE.MeshStandardMaterial({ color: col, flatShading: true }),
      0.6
    );
    const tiers = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < tiers; i++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.65 - i * 0.13, 0.65, 6),
        coneMat
      );
      cone.position.y = 0.45 + i * 0.42;
      cone.castShadow = true;
      g.add(cone);
    }
    return g;
  },

  cactus() {
    const g = new THREE.Group();
    const m = new THREE.MeshStandardMaterial({
      color: "#3d5a2e",
      flatShading: true,
      roughness: 0.8,
    });
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.18, 0.7, 4, 8),
      m
    );
    body.position.y = 0.6;
    body.castShadow = true;
    g.add(body);
    if (Math.random() > 0.4) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.4, 4, 8), m);
      arm.position.set(0.22, 0.7, 0);
      arm.rotation.z = -Math.PI / 2.5;
      arm.castShadow = true;
      g.add(arm);
    }
    if (Math.random() > 0.5) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.35, 4, 8), m);
      arm.position.set(-0.22, 0.55, 0);
      arm.rotation.z = Math.PI / 2.5;
      arm.castShadow = true;
      g.add(arm);
    }
    return g;
  },

  mushroom(biome) {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.1, 0.35, 6),
      new THREE.MeshStandardMaterial({
        color: "#f1e8d8",
        flatShading: true,
      })
    );
    stem.position.y = 0.18;
    stem.castShadow = true;
    g.add(stem);
    const capCol = new THREE.Color(biome.accent);
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: capCol,
          flatShading: true,
          roughness: 0.6,
        }),
        0.4
      )
    );
    cap.position.y = 0.36;
    cap.scale.set(1.4, 0.9, 1.4);
    cap.castShadow = true;
    g.add(cap);
    return g;
  },

  fern(biome) {
    const g = new THREE.Group();
    const col = new THREE.Color(biome.ground[0]).offsetHSL(0, 0, 0.15);
    const mat = applyWindSway(
      new THREE.MeshStandardMaterial({
        color: col,
        flatShading: true,
      }),
      1.4
    );
    const blades = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < blades; i++) {
      const blade = new THREE.Mesh(
        new THREE.ConeGeometry(0.06, 0.5, 4),
        mat
      );
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
    const mat = applyWindSway(
      new THREE.MeshStandardMaterial({
        color: "#6d4f8a",
        flatShading: true,
      }),
      1.6
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
    const col = new THREE.Color(biome.ground[2]).offsetHSL(0, 0, -0.1);
    const mat = applyWindSway(
      new THREE.MeshStandardMaterial({
        color: col,
        flatShading: true,
      }),
      1.8
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
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(biome.cliff).offsetHSL(0, -0.1, 0.05),
      flatShading: true,
      roughness: 1,
    });
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.13, 1.2, 5),
      mat
    );
    trunk.position.y = 0.6;
    trunk.rotation.z = (Math.random() - 0.5) * 0.15;
    trunk.castShadow = true;
    g.add(trunk);
    for (let i = 0; i < 4; i++) {
      const branch = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.04, 0.45, 4),
        mat
      );
      branch.position.set(0, 0.9 + i * 0.08, 0);
      branch.rotation.z = (Math.random() - 0.5) * 1.6;
      branch.rotation.x = (Math.random() - 0.5) * 1.6;
      branch.castShadow = true;
      g.add(branch);
    }
    return g;
  },

  skull() {
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: "#f1ead8",
      flatShading: true,
      roughness: 0.8,
    });
    const skull = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 8),
      mat
    );
    skull.scale.set(1, 0.85, 1.1);
    skull.position.y = 0.18;
    skull.castShadow = true;
    g.add(skull);
    // eye sockets
    const eyeMat = new THREE.MeshStandardMaterial({
      color: "#1a1a1a",
    });
    [-0.06, 0.06].forEach((x) => {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 6, 6),
        eyeMat
      );
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
    const tint = new THREE.Color(biome.accent);
    const mat = new THREE.MeshStandardMaterial({
      color: tint,
      emissive: tint.clone().multiplyScalar(0.4),
      flatShading: true,
      roughness: 0.35,
      metalness: 0.1,
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
      g.add(shard);
    }
    return g;
  },

  bigmushroom(biome) {
    const g = new THREE.Group();
    // tall stem — creatures could pass beneath the cap
    const stemH = 1.4 + Math.random() * 0.5;
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.18, stemH, 7),
      new THREE.MeshStandardMaterial({
        color: "#f1e8d8",
        flatShading: true,
        roughness: 0.95,
      })
    );
    stem.position.y = stemH / 2;
    stem.rotation.z = (Math.random() - 0.5) * 0.1;
    stem.castShadow = true;
    g.add(stem);
    // wide hemisphere cap
    const capCol = new THREE.Color(biome.accent);
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: capCol,
          flatShading: true,
          roughness: 0.55,
        }),
        0.35
      )
    );
    cap.position.y = stemH;
    cap.scale.set(1, 0.55, 1);
    cap.castShadow = true;
    g.add(cap);
    // a few pale spots on the cap
    const spotMat = new THREE.MeshStandardMaterial({
      color: "#fbf3df",
      flatShading: true,
      roughness: 0.9,
    });
    const spots = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < spots; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.25 + Math.random() * 0.4;
      const spot = new THREE.Mesh(
        new THREE.SphereGeometry(0.08 + Math.random() * 0.05, 6, 5),
        spotMat
      );
      spot.position.set(
        Math.cos(a) * r,
        stemH + Math.sqrt(Math.max(0, 0.64 - r * r)) * 0.55 - 0.02,
        Math.sin(a) * r
      );
      spot.scale.y = 0.35;
      g.add(spot);
    }
    return g;
  },

  berrybush(biome) {
    const g = new THREE.Group();
    const leafCol = new THREE.Color(biome.ground[0]).offsetHSL(0, 0.08, 0.05);
    const body = new THREE.Mesh(
      jitterGeo(new THREE.IcosahedronGeometry(0.32, 0), 0.08),
      applyWindSway(
        new THREE.MeshStandardMaterial({
          color: leafCol,
          flatShading: true,
          roughness: 0.85,
        }),
        0.7
      )
    );
    body.position.y = 0.28;
    body.scale.set(1, 0.85, 1);
    body.castShadow = true;
    g.add(body);
    // berries — small accent-colored spheres parented on top
    const berryCol = new THREE.Color(biome.accent);
    const berryMat = new THREE.MeshStandardMaterial({
      color: berryCol,
      flatShading: true,
      roughness: 0.55,
    });
    const berries = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < berries; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.15 + Math.random() * 0.15;
      const berry = new THREE.Mesh(
        new THREE.SphereGeometry(0.05, 6, 5),
        berryMat
      );
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
    const glowCol = new THREE.Color(biome.accent);
    // thin tether line from ground up to the orb
    const tetherH = 1.3 + Math.random() * 0.4;
    const tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, tetherH, 4),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.cliff).offsetHSL(0, 0, 0.1),
        flatShading: true,
        roughness: 1,
      })
    );
    tether.position.y = tetherH / 2;
    g.add(tether);
    // soft glow orb at the top
    const orb = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.12, 1),
      new THREE.MeshStandardMaterial({
        color: glowCol,
        emissive: glowCol.clone().multiplyScalar(0.9),
        flatShading: true,
        roughness: 0.4,
      })
    );
    orb.position.y = tetherH + 0.05;
    g.add(orb);
    // faint outer halo (slightly larger, additive-blended sphere)
    const halo = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.2, 1),
      new THREE.MeshBasicMaterial({
        color: glowCol,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    halo.position.copy(orb.position);
    g.add(halo);
    return g;
  },

  coral(biome) {
    const g = new THREE.Group();
    const baseCol = new THREE.Color(biome.accent);
    const altCol = baseCol.clone().offsetHSL(0.04, -0.05, 0.1);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: baseCol.clone().offsetHSL(0, 0, -0.1),
      flatShading: true,
      roughness: 0.55,
    });
    // squat base bulb
    const base = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 8, 6),
      trunkMat
    );
    base.position.y = 0.12;
    base.scale.set(1.1, 0.55, 1.1);
    base.castShadow = true;
    g.add(base);
    // 3–5 fan branches arching upward. Each branch is its own Group
    // so the stalk + tip + knobs stay rigidly attached when the branch tilts.
    const branches = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < branches; i++) {
      const a = (i / branches) * Math.PI * 2 + Math.random() * 0.4;
      const len = 0.7 + Math.random() * 0.4;
      const branchMat = new THREE.MeshStandardMaterial({
        color: i % 2 === 0 ? baseCol : altCol,
        flatShading: true,
        roughness: 0.5,
      });

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
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.1, trunkH, 6),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(biome.cliff).offsetHSL(0, 0, 0.15),
        flatShading: true,
        roughness: 1,
      })
    );
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    g.add(trunk);
    // puffy white canopy — overlapping spheres
    const tint = new THREE.Color(biome.ground[2]).lerp(new THREE.Color("#ffffff"), 0.6);
    const puffMat = applyWindSway(
      new THREE.MeshStandardMaterial({
        color: tint,
        flatShading: true,
        roughness: 0.95,
      }),
      0.3
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
    const dark = new THREE.Color("#0d0a14");
    const ember = new THREE.Color(biome.accent);
    const glassMat = new THREE.MeshStandardMaterial({
      color: dark,
      emissive: ember.clone().multiplyScalar(0.18),
      flatShading: true,
      roughness: 0.25,
      metalness: 0.35,
    });
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
      g.add(shard);
    }
    // warm halo near the base — small additive sphere reading as crack-light
    const halo = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.18, 1),
      new THREE.MeshBasicMaterial({
        color: ember,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    halo.position.y = 0.05;
    halo.scale.set(1.2, 0.4, 1.2);
    g.add(halo);
    return g;
  },
};

