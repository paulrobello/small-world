# Biome Photo Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a biome-specific fauna/flora photo catalog that uses photo-mode reticle subject detection and persists catalog thumbnails locally.

**Architecture:** Add focused catalog and photo-subject modules, then wire them into world-generated subject metadata and the existing photo review UI. Catalog metadata stays in `localStorage`; image thumbnails are stored in IndexedDB with graceful fallback when storage is unavailable.

**Tech Stack:** Vanilla JavaScript ES modules, Three.js raycasting, IndexedDB, localStorage, Vite, Node tests, ESLint, `make checkall`.

---

### Task 1: Catalog Data And Storage

**Files:**
- Create: `src/catalog.js`
- Create: `tests/catalog.test.mjs`

- [x] **Step 1: Write failing tests**

Test catalog key generation, biome-specific checklist filtering, first-save metadata, keep-current no-op, replace update, and in-memory blob fallback.

- [x] **Step 2: Run test to verify it fails**

Run: `node tests/catalog.test.mjs`

Expected: fails because `src/catalog.js` does not exist.

- [x] **Step 3: Implement catalog module**

Create pure helpers for entry keys and biome checklists, plus async storage helpers for metadata and thumbnail blobs.

- [x] **Step 4: Run test to verify it passes**

Run: `node tests/catalog.test.mjs`

Expected: passes.

### Task 2: Photo Subject Resolution

**Files:**
- Create: `src/photoSubject.js`
- Create: `tests/photo-subject.test.mjs`

- [x] **Step 1: Write failing tests**

Test that subject resolution walks ancestors, ignores non-catalogable hits, returns the nearest catalogable hit, and reports no subject for empty hits.

- [x] **Step 2: Run test to verify it fails**

Run: `node tests/photo-subject.test.mjs`

Expected: fails because `src/photoSubject.js` does not exist.

- [x] **Step 3: Implement photo subject module**

Create helpers for center-reticle raycasting and hit-list resolution.

- [x] **Step 4: Run test to verify it passes**

Run: `node tests/photo-subject.test.mjs`

Expected: passes.

### Task 3: Scene Catalog Metadata

**Files:**
- Modify: `src/fauna/creature.js`
- Modify: `src/fauna/caterpillar.js`
- Modify: `src/fauna/butterfly.js`
- Modify: `src/fauna/bee.js`
- Modify: `src/birds.js`
- Modify: `src/world.js`
- Create: `tests/catalog-metadata-static.test.mjs`

- [x] **Step 1: Write failing static tests**

Test that fauna builders and world flora placement attach `userData.catalog` with category, variant, biome ID, and label.

- [x] **Step 2: Run test to verify it fails**

Run: `node tests/catalog-metadata-static.test.mjs`

Expected: fails because catalog metadata is not attached yet.

- [x] **Step 3: Attach metadata**

Attach fauna metadata where variant identity is known and flora metadata during placement for non-instanced flora roots.

- [x] **Step 4: Run test to verify it passes**

Run: `node tests/catalog-metadata-static.test.mjs`

Expected: passes.

### Task 4: Catalog UI And Photo Review

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `src/ui.js`
- Create: `tests/photo-catalog-ui-static.test.mjs`

- [x] **Step 1: Write failing static tests**

Test that the settings panel has a catalog entry point, `ui.js` imports catalog and subject helpers, photo review resolves a subject before save, existing entries render compare actions, and CSS includes catalog panel classes.

- [x] **Step 2: Run test to verify it fails**

Run: `node tests/photo-catalog-ui-static.test.mjs`

Expected: fails because the catalog UI is not wired yet.

- [x] **Step 3: Implement UI wiring**

Extend photo review with catalog save/replace actions, render the catalog panel grouped by biome, and keep normal PNG saving intact.

- [x] **Step 4: Run test to verify it passes**

Run: `node tests/photo-catalog-ui-static.test.mjs`

Expected: passes.

### Task 5: Verification

**Files:**
- Modify if needed: `package.json`, `CHANGELOG.md`, `ideas.md`

- [x] **Step 1: Run focused tests**

Run: `node tests/catalog.test.mjs && node tests/photo-subject.test.mjs && node tests/catalog-metadata-static.test.mjs && node tests/photo-catalog-ui-static.test.mjs`

Expected: all pass.

- [x] **Step 2: Run full verification**

Run: `make checkall`

Expected: all tests, lint, and production build pass.

- [x] **Step 3: Browser verification**

Start the dev server with `make dev-start`, open `http://localhost:2001`, capture a catalogable photo, save it, retake it, choose keep, retake it again, choose replace, and confirm normal PNG save still works.

- [x] **Step 4: Update release metadata**

If shipping the feature in this work, bump `package.json` minor version and add a matching `CHANGELOG.md` entry per `CLAUDE.md`.
