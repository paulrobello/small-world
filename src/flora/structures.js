import * as THREE from "three";
import { jitterGeo, applyWindSway, TRUNK } from "../util.js";
import { BLOOM_LAYER } from "../postfx.js";
import {
  makeDeadTreePBRMaterial,
  makeFlyerNestPBRMaterial,
  makeMushroomCapPBRMaterial,
  makeMushroomUndersideMaterial,
} from "../pbr.js";
import { pooled, getFlyerNestPalette, makeMushroomStemGeometry, makeMushroomUndersideGeometry, enableMushroomCapShadowUnderside, addGroveMushroomFamily } from "./_shared.js";

export function flyer_nest(biome) {
    const g = new THREE.Group();
    const FLYER_NEST_PERCH_RADIUS = 0.612;
    const nestPalette = getFlyerNestPalette(biome);
    const nestColor = nestPalette.base;
    const bowlMat = makeFlyerNestPBRMaterial({
      color: nestColor,
      flatShading: true,
      roughness: 0.96,
      side: THREE.DoubleSide,
    });
    const mat = makeFlyerNestPBRMaterial({
      color: nestColor,
      flatShading: true,
      roughness: 0.96,
    });
    const lightTwigColor = nestPalette.light;
    const twigLightMat = makeFlyerNestPBRMaterial({
      color: lightTwigColor,
      flatShading: true,
      roughness: 0.94,
    });
    const outerRingGeo = pooled("flyer_nest.outerRing.geo", () => {
      const geo = new THREE.TorusGeometry(0.558, 0.252, 8, 24);
      geo.rotateX(Math.PI / 2);
      geo.scale(1, 0.62, 1);
      geo.computeVertexNormals();
      return geo;
    });
    const innerBowlGeo = pooled("flyer_nest.innerBowl.geo", () => {
      const geo = new THREE.CircleGeometry(0.558, 28);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        const r = Math.min(1, Math.sqrt(x * x + z * z) / 0.558);
        pos.setY(i, 0.117 + r * r * 0.108);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      return geo;
    });
    const bowl = new THREE.Mesh(innerBowlGeo, bowlMat);
    bowl.castShadow = true;
    bowl.receiveShadow = true;
    g.add(bowl);
    const ring = new THREE.Mesh(outerRingGeo, mat);
    ring.position.y = 0.225;
    ring.castShadow = true;
    ring.receiveShadow = true;
    g.add(ring);

    const twigGeo = pooled("flyer_nest.twig.geo", () => {
      const geo = new THREE.CylinderGeometry(0.0432, 0.0612, 1, 5);
      geo.computeVertexNormals();
      return geo;
    });
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + (Math.random() - 0.5) * 0.20;
      const len = 0.342 + Math.random() * 0.306;
      const radius = 0.378 + Math.random() * 0.162;
      const tangent = new THREE.Vector3(-Math.sin(a), 0.10 + Math.random() * 0.10, Math.cos(a)).normalize();
      const twig = new THREE.Mesh(twigGeo, i % 4 === 1 || i % 7 === 3 ? twigLightMat : mat);
      twig.position.set(Math.cos(a) * radius, 0.207 + Math.random() * 0.072, Math.sin(a) * radius);
      twig.quaternion.setFromUnitVectors(up, tangent);
      twig.rotateY((Math.random() - 0.5) * 0.65);
      twig.scale.setScalar(0.9 + Math.random() * 0.25);
      twig.scale.y = len;
      twig.castShadow = true;
      g.add(twig);
    }

    g.userData.capTopY = 0.387;
    g.userData.obstacleTopY = 0.432;
    g.userData.perchRadius = FLYER_NEST_PERCH_RADIUS;
    return g;
}
export function deadtree(biome) {
    const g = new THREE.Group();
    const mat = pooled("deadtree.mat.smooth", () =>
      makeDeadTreePBRMaterial({
        color: new THREE.Color(biome.cliff).offsetHSL(0, -0.1, 0.05),
        flatShading: false,
        roughness: 0.98,
      })
    );
    const trunkGeo = pooled("deadtree.trunk.geo", () => {
      const geo = new THREE.CylinderGeometry(0.06, 0.13, 1.2, 5);
      geo.computeVertexNormals();
      return geo;
    });
    const branchGeo = pooled("deadtree.branch.geo", () => {
      const geo = new THREE.CylinderGeometry(0.025, 0.04, 0.45, 4);
      geo.translate(0, 0.225, 0);
      geo.computeVertexNormals();
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
}
export function crystal(biome) {
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
}
export function bigmushroom(biome) {
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
    const BIG_WIND = 0.34;
    const stemMat = pooled("bigmushroom.stem.mat.smooth", () =>
      applyWindSway(
        new THREE.MeshStandardMaterial({ color: "#f1e8d8", roughness: 0.95 }),
        BIG_WIND
      )
    );
    const undersideMat = pooled("bigmushroom.underside.mat.lit", () =>
      applyWindSway(makeMushroomUndersideMaterial(), BIG_WIND)
    );
    const stemGeo = makeMushroomStemGeometry(stemH, {
      baseRadius: 0.17,
      topRadius: 0.12,
      bulbRadius: 0.090,
      curve: stemH * 0.024,
      radialSegments: 9,
      heightSegments: 12,
    });
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.rotation.z = (Math.random() - 0.5) * 0.025;
    stem.castShadow = true;
    g.add(stem);
    const capGeo = new THREE.SphereGeometry(0.8, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)
      .scale(1, 0.55, 1)
      .translate(0, stemH, 0);
    const capColor = new THREE.Color(biome.accent).offsetHSL(
      (Math.random() - 0.5) * 0.06,
      (Math.random() - 0.5) * 0.15,
      (Math.random() - 0.5) * 0.10
    );
    const capMat = applyWindSway(
      makeMushroomCapPBRMaterial({ color: capColor, roughness: 0.55 }),
      BIG_WIND
    );
    enableMushroomCapShadowUnderside(capMat);
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
    // Rotation baked into geometry so wind shader sees a uniform y near stemH.
    const undersideGeo = makeMushroomUndersideGeometry(0.8, 0.8, stemH, 12);
    const underside = new THREE.Mesh(undersideGeo, undersideMat);
    g.add(underside);
    // Spots share the cap's wind strength so they sway with it. Each spot's
    // orientation + world position is baked into its geometry — the mesh sits
    // at the group origin so applyWindSway's transformed.y reads the spot's
    // actual world-y above ground. Without this the spots float free of the
    // cap whenever wind nudges the cap material.
    const spotBaseColor = new THREE.Color("#fbf3df");
    const spots = 3 + Math.floor(Math.random() * 3);
    const capR = 0.8;
    const capSY = 0.55;
    const capA2 = capR * capR;
    const capB2 = (capR * capSY) * (capR * capSY);
    const up = new THREE.Vector3(0, 1, 0);
    const tmpQuat = new THREE.Quaternion();
    const tmpMat = new THREE.Matrix4();
    const placedSpots = []; // {x, z, r} to enforce minimum separation
    for (let i = 0; i < spots; i++) {
      // Try to find a non-overlapping position
      let x, z, r, attempts = 0;
      do {
        const a = Math.random() * Math.PI * 2;
        r = 0.25 + Math.random() * 0.4;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        attempts++;
      } while (attempts < 12 && placedSpots.some(s => {
        const dx = x - s.x, dz = z - s.z;
        return dx * dx + dz * dz < (s.r + 0.18) * (s.r + 0.18);
      }));
      const spotRadius = 0.08 + Math.random() * 0.05;
      placedSpots.push({ x, z, r: spotRadius });
      const yLocal = Math.sqrt(Math.max(0, capA2 - r * r)) * capSY;
      const n = new THREE.Vector3(x / capA2, yLocal / capB2, z / capA2).normalize();
      const sink = 0.02;
      const spotGeo = new THREE.SphereGeometry(spotRadius, 20, 12);
      spotGeo.scale(1, 0.35, 1);
      tmpQuat.setFromUnitVectors(up, n);
      tmpMat.makeRotationFromQuaternion(tmpQuat);
      spotGeo.applyMatrix4(tmpMat);
      spotGeo.translate(x - n.x * sink, stemH + yLocal - n.y * sink, z - n.z * sink);
      const spotColor = spotBaseColor.clone().offsetHSL(
        (Math.random() - 0.5) * 0.08,
        (Math.random() - 0.5) * 0.12,
        (Math.random() - 0.5) * 0.08
      );
      const spotMat = applyWindSway(
        new THREE.MeshStandardMaterial({ color: spotColor, roughness: 0.9 }),
        BIG_WIND
      );
      const spot = new THREE.Mesh(spotGeo, spotMat);
      g.add(spot);
    }
    addGroveMushroomFamily(g, biome, { radius: 1.15, count: 4, capY: stemH });
    return g;
}
export function fairyring(biome) {
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
    const undersideGeo = makeMushroomUndersideGeometry(0.09 * 1.28, 0.09 * 1.28, 0.18, 10);
    undersideGeo.name = "fairyring.underside.geo";
    const undersideMat = makeMushroomUndersideMaterial();
    const capBaseColor = new THREE.Color(biome.accent).lerp(new THREE.Color("#b85f2a"), 0.18);
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
      const capColor = capBaseColor.clone().offsetHSL(
        (Math.random() - 0.5) * 0.06,
        (Math.random() - 0.5) * 0.15,
        (Math.random() - 0.5) * 0.10
      );
      const cap = new THREE.Mesh(capGeo, enableMushroomCapShadowUnderside(makeMushroomCapPBRMaterial({
        color: capColor,
        roughness: 0.68,
      })));
      cap.position.set(x, 0, z);
      cap.rotation.y = a + Math.PI / 2;
      cap.scale.setScalar(scale);
      cap.castShadow = true;
      g.add(cap);
      const underside = new THREE.Mesh(undersideGeo, undersideMat);
      underside.position.set(x, 0, z);
      underside.rotation.y = cap.rotation.y;
      underside.scale.setScalar(scale);
      g.add(underside);
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
}
export function lantern(biome) {
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
}
