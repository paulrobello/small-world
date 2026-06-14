import * as THREE from "three";
import { buildCatalogSubject } from "./catalog.js";

const centerNdc = new THREE.Vector2(0, 0);

export function getCatalogSubjectFromObject(object) {
  let cursor = object;
  while (cursor) {
    const catalog = cursor.userData?.catalog;
    if (catalog?.key) return catalog;
    if (catalog?.category && catalog?.variant && catalog?.biomeId) {
      return buildCatalogSubject(catalog);
    }
    cursor = cursor.parent;
  }
  return null;
}

export function findCatalogSubjectInHits(hits) {
  const sortedHits = [...hits].sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
  for (const hit of sortedHits) {
    const subject = getCatalogSubjectFromObject(hit.object);
    if (subject) return { subject, object: hit.object, hit };
  }
  return null;
}

export function findPhotoCatalogSubject({ camera, root, raycaster = new THREE.Raycaster() }) {
  if (!camera || !root) return null;
  raycaster.setFromCamera(centerNdc, camera);
  return findCatalogSubjectInHits(raycaster.intersectObject(root, true));
}
