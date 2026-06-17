import * as THREE from "three";
import { jitterGeo, applyWindSway } from "../util.js";
import { BLOOM_LAYER } from "../postfx.js";
import { pooled, applyBalloonPuffWisps } from "./_shared.js";

export function balloontree(biome) {
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
      applyBalloonPuffWisps(
        applyWindSway(
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(biome.ground[2]).lerp(new THREE.Color("#ffffff"), 0.6),
            flatShading: false,
            roughness: 0.95,
          }),
          0.3
        ),
        biome.cloudlike ? 1.08 : 0.48
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
    const detailPuffs = biome.cloudlike ? 8 + Math.floor(Math.random() * 5) : 0;
    if (detailPuffs) {
      const detailPuffMat = pooled("balloontree.puff.detail.mat", () =>
        applyBalloonPuffWisps(
          applyWindSway(
            new THREE.MeshStandardMaterial({
              color: new THREE.Color("#ffffff"),
              flatShading: false,
              roughness: 0.9,
              transparent: true,
              opacity: 0.82,
            }),
            0.34
          ),
          1.18
        )
      );
      const tetherMat = pooled("balloontree.tether.cloud.mat", () =>
        new THREE.MeshStandardMaterial({
          color: new THREE.Color("#f5f9ff"),
          flatShading: false,
          roughness: 0.86,
        })
      );
      const yAxis = new THREE.Vector3(0, 1, 0);
      const tetherRoot = new THREE.Vector3(0, trunkH * 0.92, 0);
      for (let i = 0; i < detailPuffs; i++) {
        const r = 0.055 + Math.random() * 0.055;
        const puff = new THREE.Mesh(
          jitterGeo(new THREE.IcosahedronGeometry(r, 1), r * 0.08),
          detailPuffMat
        );
        const a = (i / detailPuffs) * Math.PI * 2 + Math.random() * 0.32;
        const ring = 0.18 + Math.random() * 0.38;
        puff.position.set(
          Math.cos(a) * ring,
          trunkH + 0.34 + Math.random() * 0.56,
          Math.sin(a) * ring
        );
        puff.castShadow = true;
        g.add(puff);

        const tetherEnd = puff.position.clone();
        const tetherDelta = tetherEnd.clone().sub(tetherRoot);
        const tetherLength = tetherDelta.length();
        const tether = new THREE.Mesh(
          new THREE.CylinderGeometry(0.006, 0.004, tetherLength, 5),
          tetherMat
        );
        tether.position.copy(tetherRoot).add(tetherEnd).multiplyScalar(0.5);
        tether.quaternion.setFromUnitVectors(yAxis, tetherDelta.normalize());
        g.add(tether);
      }
    }
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
    g.userData.capTopY = trunkH + 0.95;
    g.userData.obstacleTopY = trunkH + (biome.cloudlike ? 1.08 : 0.95);
    return g;
}
export function lavafissure(biome) {
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
            float redBand = smoothstep(0.0084375, 0.285, vAcross);
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
}
export function obsidianglass() {
    const g = new THREE.Group();
    const glassGeo = pooled("obsidianglass.fin.geo", () => {
      const geo = new THREE.ConeGeometry(0.22, 1, 5, 1);
      geo.scale(0.74, 1, 0.14);
      geo.translate(0, 0.5, 0);
      return geo;
    });
    const glassMat = pooled("obsidianglass.glass.mat", () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color("#020204"),
        emissive: new THREE.Color("#000000"),
        flatShading: true,
        roughness: 0.035,
        metalness: 0.88,
        clearcoat: 1.0,
        clearcoatRoughness: 0.02,
        specularIntensity: 1.0,
        specularColor: new THREE.Color("#b9c7d8"),
        reflectivity: 1.0,
      })
    );
    const fins = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < fins; i++) {
      const a = (i / fins) * Math.PI * 2 + Math.random() * 0.34;
      const height = 0.42 + Math.random() * 0.78;
      const off = 0.03 + Math.random() * 0.22;
      const fin = new THREE.Mesh(glassGeo, glassMat);
      fin.position.set(Math.cos(a) * off, 0.015, Math.sin(a) * off);
      fin.scale.set(0.55 + Math.random() * 0.34, height, 0.72 + Math.random() * 0.28);
      fin.rotation.order = "YXZ";
      fin.rotation.y = a + Math.PI * 0.5;
      fin.rotation.x = -Math.sin(a) * (0.18 + Math.random() * 0.24);
      fin.rotation.z = Math.cos(a) * (0.18 + Math.random() * 0.28);
      fin.castShadow = true;
      g.add(fin);
    }
    const base = new THREE.Mesh(
      pooled("obsidianglass.base.geo", () => jitterGeo(new THREE.IcosahedronGeometry(0.22, 0), 0.05)),
      glassMat
    );
    base.scale.set(1.35, 0.28, 1.05);
    base.position.y = 0.04;
    base.rotation.y = Math.random() * Math.PI * 2;
    base.castShadow = true;
    g.add(base);
    g.userData.inspect = { category: "flora", variant: "obsidianglass" };
    return g;
}
export function obsidianshard(biome) {
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
}
