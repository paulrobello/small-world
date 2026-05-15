# Crimson Dunes Creature Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update crimson dunes creature body colors so they better match the biome's sandstone, terracotta, and crimson palette.

**Architecture:** This is a surgical data-only palette change in the existing `BIOMES` table. Creature construction already reads `biome.creatureColors`, so no runtime logic or module boundaries change.

**Tech Stack:** Plain ES modules, Three.js via CDN, no build step, local static server via `make start`.

---

## File Structure

- Modify: `src/biomes.js`
  - Responsibility: source-of-truth biome config table, including `desert.creatureColors`.
- No new source files.
- No automated test files; the repo has no test framework. Verification is diff inspection plus browser/inspect-mode visual check.

---

### Task 1: Update Desert Creature Palette

**Files:**
- Modify: `src/biomes.js`

- [ ] **Step 1: Inspect the current desert biome block**

Run:

```bash
sed -n '31,52p' src/biomes.js
```

Expected: output includes this exact current palette line:

```js
    creatureColors: ["#fefae0", "#dda15e", "#bc6c25", "#3d405b"],
```

- [ ] **Step 2: Replace only the desert creatureColors line**

In `src/biomes.js`, replace:

```js
    creatureColors: ["#fefae0", "#dda15e", "#bc6c25", "#3d405b"],
```

with:

```js
    creatureColors: ["#f3c68f", "#d97757", "#a94a3f", "#7a3438"],
```

Do not change any other `desert` biome fields.

- [ ] **Step 3: Inspect the diff**

Run:

```bash
git diff -- src/biomes.js
```

Expected: the diff changes exactly one line in `src/biomes.js`, replacing the old four-color desert creature palette with the approved four-color sandstone crimson palette.

- [ ] **Step 4: Start or confirm the local static server**

Run:

```bash
make status || true
make start
```

Expected: server is running on port 1999, or `make start` reports it was already running.

- [ ] **Step 5: Visual verification in inspect mode**

Open this URL in a browser:

```text
http://localhost:1999/?inspect=1&category=creature&biome=desert&variant=walker&seed=0x3f2a&paused=1
```

Expected: the inspected desert creature uses one of the warm sandstone/crimson body colors. Press `r` a few times or adjust the `seed` value to see the palette vary across:

```js
["#f3c68f", "#d97757", "#a94a3f", "#7a3438"]
```

The creature should still look cute, rounded, and readable against crimson dunes.

- [ ] **Step 6: Final status check**

Run:

```bash
git status --short
```

Expected: only `src/biomes.js` is modified for implementation. The design/plan docs may already be committed or tracked separately.

- [ ] **Step 7: Commit the implementation**

Run:

```bash
git add src/biomes.js
git commit -m "fix: tune crimson dunes creature colors"
```

Expected: commit succeeds with a one-line source change.
