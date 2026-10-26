# Changelog

> Versioning is semantic (major.minor.patch) and tracks `package.json`. Versions
> 1.3.4 and 1.3.5 were never cut as separate releases — work in that range was
> folded into the adjacent 1.3.3 and 1.3.6 entries — which is why the history
> below jumps from 1.3.3 to 1.3.6.

## 1.6.2 - 2026-10-26

### Changed

- Dependencies bumped to latest stable: three 0.185.1 → 0.186.1, vite 8.1.3 →
  8.3.5, eslint 10.6.0 → 10.13.0, globals 17.7.0 → 17.13.0, esbuild
  0.28.1 → 0.28.2. No API used by this repo changed in the three.js r186
  migration (verified against the migration guide and by grep).
- CI (deploy.yml) now runs `make checkall-ci` — tests + lint + build — before
  deploying, instead of a bare `npm run build`. Added the `checkall-ci`
  Makefile target as the CI-parity gate.
- GitHub Actions bumped: checkout v6 → v7.0.1, setup-node v6 → v7.1.0
  (SHA-pinned, refs verified via ls-remote). upload-pages-artifact and
  deploy-pages were already on their latest majors (v5).

### Verified

- `make checkall-ci` green (exit 0) on the new versions; production build
  served locally and rendered in Chromium with zero console errors
  (Twilight Meadow seed 0x336d: 26 ground / 3 fly / 164 flora / 5 birds).

## 1.6.1 - 2026-09-18

### Added

- Google Analytics 4 (measurement ID `G-VY4VK9N81G`). The gtag loader is in
  `index.html`; its config lives in `public/gtag-init.js` so the CSP needs no
  `'unsafe-inline'`.

### Changed

- CSP now allows Google Analytics and the Cloudflare Web Analytics beacon in
  `script-src`, `connect-src`, and `img-src`.

### Verified

- `make checkall` green; local `vite preview` loads gtag, sends a collect hit,
  renders the world, and logs no CSP errors.

## 1.6.0 - 2026-07-04

The deferred structural backlog from the 1.5.9 audit (AUDIT.md Phase 4), executed in
dependency order: test-suite conversion first so the refactors land against behavioral
coverage, then the three god-module splits, then documentation.

### Added

- "pbr surface detail" checkbox in the settings FX panel (applies on regen); the
  `pbrDetails` setting is now persisted to localStorage and disabled under LOWFX
  (ARC-L02).
- JSDoc on ~265 exported symbols across 67 `src/` files — contract one-liners,
  param units/ranges, return shapes, and signature-invisible invariants such as
  the seeded-RNG-window rules and the pool reset-every-regen contract (DOC-006).
- New behavioral tests replacing source-grep assertions: real creatures driven
  through `stepCreature`/`stepCaterpillar` (edge recovery, course correction,
  wake transitions), real flora built via `FLORA_BUILDERS` with isolated pools,
  real PBR canvas painting with pixel-variance checks, and headless
  `generateWorld` runs for build-context and loading-order invariants (QA-009).

### Changed

- `src/ui.js` (2,764 lines) split into `src/ui/` sub-modules — context, settings
  panel, first-person modes, photo mode, input glue, locator/follow/tour, help
  panel, catalog panel — behind an unchanged 83-line public entry (ARC-001).
- `src/fauna/creature.js` (2,020 → 1,365 lines): burrower mound, perch/landing
  FSM, and sleep systems extracted to `creature-mound.js` / `creature-perch.js` /
  `creature-sleep.js`; `stepCreature` is now a thin dispatcher over
  `stepThink`/`moveCreature`/`positionCreatureY`/`animateCreature` (ARC-002,
  QA-010).
- `src/environment.js` is a 31-line barrel over `src/environment/` — particles,
  swarms, decals, groundcover, water (ARC-002).
- `generateWorld` decomposed into `src/world/` phase modules — atmosphere,
  flora placement, portal placement, ground cover, fauna population — with every
  `Math.random()` draw and `yieldIfNeeded()` await at its exact prior position;
  `world.js` drops to 413 lines (QA-008).
- Python test suite ported to node `.mjs`; `make test` no longer requires
  Python 3 (QA-023).
- Inspect mode reuses the production wildflower/grass-blade geometry builders
  instead of hand-rolled copies that had drifted slightly (ARC-013).

### Verified

- `make checkall` green after every stage: full test suite, ESLint, production
  build.
- Determinism gates (`determinism-seed`, `portal-world-rng-parity`,
  `world-build-context`) run after each extraction stage of every split — the
  same seed still reproduces the identical world.
- QA-019 grass pre-allocation measured live (`?perf=1`, verdant, seed 0x0001):
  265,875 allocated slots ≈ 16 MB instance matrix (not the ~130 MB the audit
  estimated), 120 fps at 8.3 ms/frame, and the ceiling exactly equals the
  density slider's 300% maximum — left unchanged by design.
- pbr toggle verified in a live browser: persists, respects the LOWFX disable,
  and regenerates the world on change.

## 1.5.9 - 2026-07-03

Second audit-driven remediation pass (four-domain audit in `AUDIT.md`): two runtime correctness bugs, two per-frame performance bugs, security hardening, dedup/consistency cleanups, and a documentation sync. No new user-facing features.

### Added
- `src/shaders/noise.js` — shared GLSL hash/value-noise chunks consumed by `sky.js`, `grass.js`, and `flora/volcanic.js` (precision-distinct variants preserved, not merged).
- `src/world-constants.js` grew shared world↔portal helpers: `rollBiomeAndLayout` (the RNG prefix the portal preview replays), `terrainAmpFor`, `WATER_SURFACE_Y`, wet-depth/flatten/footprint helpers — the preview can no longer silently drift from the destination world.
- Biome flags `hasWillowisps`, `giantFlora`, `guaranteeBurrower`, `treeFloraRadiusFrac` replace hardcoded `biome.id` behavior branches; `EDGE_AURA_DEFAULTS` deduplicates the per-biome edge-aura config.
- Content-Security-Policy meta tag in `index.html` (verified against the Vite build; `style-src 'unsafe-inline'` and `connect-src data:` are load-bearing and documented inline).
- `makeFirstPersonMode` factory in `ui.js` — stroll/fly/photo modes share one mouse-look/key-map/pointer-lock implementation, so the pointer-lock retry fix now covers all three.
- Behavioral regression tests: `caterpillar-trail-trim.test.mjs`, `portal-preview-pool-isolation-runtime.test.mjs`, `portal-world-rng-parity-runtime.test.mjs`, catalog quota-failure rollback case.
- `AUDIT.md` — full four-domain audit report with remediation plan and deferred-work backlog.

### Changed
- Portal previews build against isolated resource pools (`withIsolatedFloraPool`/`withIsolatedCreaturePool`) instead of the shared per-regen pools; the retained-set disposal machinery is gone.
- `disposeGroup` accepts `{ skip }`; creature/crawler placement-rejection paths pass pooled-resource skip sets so a rejected spawn can't dispose geometry other creatures share.
- Ground-mark canvas repaints throttled to ~10 Hz with a cached unit gradient (was: full 512×512 repaint + GPU re-upload every frame).
- Sand/cinder particles clamp against a baked 64×64 height grid and pre-filtered fissure obstacles (was: ~10k three-octave noise evals per frame).
- Twilight's grass-pattern edge aura builds 3,200 line segments instead of 3,200,000 (~128 MB → ~125 KB of attribute data). Visually equivalent at normal viewing; downstream RNG draws shift for twilight seeds, so those worlds differ slightly from 1.5.8.
- Wind/grass settings reapply now rides the existing `world-ready` CustomEvent; the `state._reapply*` back-channel calls from `world.js` and the redundant poll trigger are gone.
- Grass baselines `GRASS_DENSITY_BASE`/`GRASS_HEIGHT_BASE` are canonical exports of `state.js`; persisted settings are type-coerced and range-clamped on load.
- Fur `uLayers` is per-template instead of a shared monotonically-ratcheting uniform; shader `onBeforeCompile` patches warn when their anchor string no longer matches; music playback errors log and clear state so a biome can retry, and superseded crossfades cancel.
- Caterpillar eye/pupil resources pooled per regen (`resetCaterpillarPool`); butterfly/bee/bird velocity integrate/damp/cap/orient boilerplate shared via `fauna/shared.js` helpers; `pushOutOfObstacles` grid/fallback duplication collapsed; nine PBR LOWFX fallback guards collapsed into `pbrMaterialOr`.
- CLAUDE.md architecture inventory synced to the post-1.5.8 module layout (flora split, `world-hud`/`world-constants`/`ui/storage`, catalog subsystem, testing docs, TOC); README gains badges, troubleshooting, prerequisites; CONTRIBUTING gains a Testing section.

### Fixed
- Portal previews contaminated the shared flora/creature pools with the target biome's materials, and preview teardown disposed pooled resources still referenced by the live world (visible wrong-biome flora when a portal was present).
- Caterpillar trail ring buffers never trimmed — unbounded memory growth and linearly rising per-frame cost over a session (~3,850 points after one minute vs. the intended ~200).
- Photo-mode fog decayed to near-zero on cloudlike biomes (cumulative per-frame multiply while paused); fog now derives from a snapshotted baseline.
- Focused `<select>` elements (music dropdown) no longer trigger regen/pause on `r`/Space; catalog save failures show a recoverable error state instead of sticking on "saving"; overlapping catalog panel renders can't interleave; catalog blob/metadata writes can't strand orphans on partial failure.
- `parseSeed` masks to the documented 16-bit seed space; interpolated caterpillar trail positions include `y`; sundry dead code, stale comments, shadowed variables, and disposal gaps (terrain depth material, reflection dome clone, per-texel Vector3 churn).

### Verified
- `make checkall` — 71 JS tests + 53 Python tests, ESLint clean, production build.
- Visual smoke test (headless Chromium): twilight biome loads with zero console errors; zoomed-out island compared side-by-side against the production 1.5.8 build on the same seed.
- `tests/determinism-seed.test.mjs` plus the new portal parity and pool-isolation tests pass; five-seed RNG-prefix parity confirmed.

## 1.5.8 - 2026-06-16

Audit-driven remediation: critical bug fixes, internal structural refactors, hardening, and a determinism regression test. No user-facing feature changes.

### Added
- `tests/determinism-seed.test.mjs` — regression test proving the same seed reproduces a byte-identical world (mechanism + fresh-process structural snapshots). The guardrail that made the structural refactors safe.
- `CONTRIBUTING.md` and README `## License` / `## Contributing` sections.

### Changed
- Split `src/flora.js` (3,225 LOC) into per-kind modules under `src/flora/` (`_shared`, `trees`, `garden`, `rocks`, `structures`, `aquatic`, `volcanic`); `flora.js` is now a thin registry.
- Split `stepCreature` (~860 LOC) into per-mode dispatchers (`stepSleeper` / `stepNightSleep` / `stepBurrower` / `stepFlier`) and deduplicated the sleepiness/slope-pose helpers.
- Extracted `generateWorld`'s HUD/URL finalization phase into `src/world-hud.js` and the UI persistence layer into `src/ui/storage.js`.
- Deduplicated world/portal construction constants into `src/world-constants.js` (single source of truth).
- SHA-pinned all GitHub Actions in the deploy workflow to commit SHAs; gated the `window.__sw` devtools handle behind dev mode.

### Fixed
- Added WebGL context-loss/restore handling so a GPU reset no longer leaves a dead black canvas.
- Fixed a cancelled-and-superseded regen leaving `isGeneratingWorld` stuck true.
- Reapply wind settings synchronously on regen (no more brief wind flicker after each regen).
- Dispose portal-preview builder originals after cloning (per-placement GPU leak), and added a `dispose()` path to the post-FX API.
- Import the shared `wrapAngle` in `caterpillar.js` instead of re-declaring it per frame; guarded divide-by-zero in the fur shader and a zero-base-color Infinity in the grass color computation.
- Fixed a latent portal-preview divergence (`beachsucculent` vs `beach_succulent` flora-footprint key).
- Corrected `package.json` license to MIT and fixed several CLAUDE.md accuracy drifts (async determinism mechanism, `newRandomSeed` count/signature, perch-selection logic).

### Verified
- Verified with `make checkall` (JS + 53 Python tests, lint, production build), the new determinism regression test, and a live browser smoke (cloud-island world renders, no console errors).

## 1.5.7 - 2026-06-14

### Changed
- Bumped dev tooling to latest: `esbuild` 0.28.0 → 0.28.1, `eslint` 10.4.0 → 10.5.0, `vite` 8.0.13 → 8.0.16. Runtime deps (`three`, `simplex-noise`) were already at latest.

### Verified
- Verified with `make checkall` (JS + 53 Python tests, lint, production build) and `npm outdated`/`npm audit` clean.

## 1.5.6 - 2026-06-14

### Changed
- Documented the Field Guide catalog workflow, persistence, duplicate-photo review, and catalog navigation in the README.

### Verified
- Verified with `make checkall`, README diff review, and `graphify update .`.

## 1.5.5 - 2026-06-14

### Fixed
- Removed butterflies from Ashen Wastes spawning and catalog requirements.

### Verified
- Verified with focused catalog/Ashen checks, `make checkall`, an in-app Browser Ashen catalog/locator smoke, and `graphify update .`.

## 1.5.4 - 2026-06-14

### Changed
- Replaced the first-person stroll HUD button's visible `POV`/`stroll` text with a compact icon.
- Made Field Guide biome titles and locked photo slots load that biome with the current seed, preserving the selected biome in the URL.

### Fixed
- Guaranteed Lavender Marsh worlds reserve at least one burrower so the Field Guide and locator can always include that biome-specific entry.

### Verified
- Verified with the focused POV/catalog/world-generation static tests, `make checkall`, an in-app Browser HUD/catalog/locator smoke on `0xA366`, and `graphify update .`.

## 1.5.3 - 2026-06-14

### Fixed
- Fixed non-catalog photo review layout so cloud/sky captures hide the photo-mode seed/hint row and show the no-subject state as a contained status above save/discard.
- Fixed the current-biome Field Guide so locked entries are filtered to subjects the locator can actually target in the generated world, while saved entries remain visible.
- Replaced the Field Guide HUD button's `FG` text with a compact icon.

### Verified
- Verified with focused photo-review HUD/catalog tests, `make checkall`, an in-app Browser catalog/locator smoke on `0xA366`, an agentchrome cloud/no-subject capture on `0xA366`, and `graphify update .`.

## 1.5.2 - 2026-06-14

### Fixed
- Fixed photo-review catalog actions losing contrast over the bright photo border, and added a readable subject-name label to the frame.

### Verified
- Verified with focused catalog UI tests, `make checkall`, an in-app Browser photo-review smoke on `0x2676`, and `graphify update .`.

## 1.5.1 - 2026-06-14

### Added
- Added a persistent on-screen Field Guide button and a `G` hotkey for opening the biome photo catalog without visiting Settings.

### Verified
- Verified with focused catalog UI and POV static tests, `make checkall`, an agentchrome browser smoke for the HUD button and `G` hotkey, and `graphify update .`.

## 1.5.0 - 2026-06-14

### Added
- Added a biome-specific field guide catalog that unlocks fauna and flora entries from photo-mode reticle captures and persists thumbnail photos locally.
- Added catalog compare/replace review controls for re-photographing an existing entry, plus a field guide panel grouped by biome.

### Changed
- Photo review now resolves the reticle subject from scene catalog metadata while preserving regular PNG save/discard behavior.

### Verified
- Verified with focused catalog, subject, photo-review, and UI tests, `make checkall`, an agentchrome browser capture/save/keep/replace run on `0x2676`, and `graphify update .`.

## 1.4.0 - 2026-06-12

### Added
- Added a mid-tier mobile FX profile (`MIDFX`) that keeps bloom but defaults the depth-driven effects (outline, AO, depth fog) off, shrinks the water-reflection target, and caps the pixel ratio at 1.5 on touch devices with DPR ≥ 1.5. Overridable with `?midfx=1` / `?midfx=0`.
- Added PBR detail-texture prewarming so the per-biome canvas paints happen between world-gen frame slices instead of hitching flora placement on slower devices.
- Added vendor chunk splitting in the Vite build so Three.js and simplex-noise ship in stable-hash chunks that survive app-code deploys.
- Added a `make test` target (tests without lint/build) and made the test loop fail the build on any failing file.

### Changed
- Replaced the bloom pipeline with a mip-chain bloom (filtered downsample + Karis average + tent upsample) that does its blur at 1/2–1/32 resolution — far cheaper than the previous full-resolution stacked-pair Gaussian, with no pixelation. The bloom-radius slider now drives the per-step scatter weight.
- Moved the default orbit camera ~36% closer to the island center so worlds frame tighter on load.
- Eliminated per-frame allocations across the fauna hot paths (obstacle-grid queries, terrain-normal/slope sampling, walker slope cache, stray-recovery distance checks) by reusing module-scope scratch objects.
- Consolidated the redundant `state.portal` scalar into the `state.portals` array everywhere.
- Folded the duplicated angle-wrapping loops in `creature.js` into the shared `wrapAngle` helper.

### Fixed
- Fixed the bloom-radius slider above 100% (both branches of the radius mapping were identical, so the wide-halo range never engaged) and restored its 0–300% range.
- Fixed burrower mound sink running at 2× speed from a duplicated `stepMoundSink` call.
- Fixed a per-regen material leak from hidden burrower mounds that `disposeGroup` could not reach.
- Fixed corrupted `?perf=1` telemetry where the will-o'-wisp step shared a phase label with the butterfly/bee/flock step.
- Fixed a bloom render-target resize crash ("Attached DepthTexture is initialized to the incorrect size") by resizing the shared-depth bloom target alongside the depth pre-pass target.

### Verified
- Verified with `make checkall` (all JS + Python tests, lint, production build), headed-browser bloom A/B and resize checks on glow biomes, multi-biome regen smoke tests, and `graphify update .`.

## 1.3.9 - 2026-05-28

### Added
- Added static regression coverage for doubled island sizing without increasing flora or creature spawn counts.
- Added static regression coverage for island-aware orbit framing, renderer pixel-ratio caps, contact-shadow LOD, and Verdant static shadow LOD.
- Added static regression coverage for Mossy Ruins using the mist edge ring.

### Changed
- Doubled the base island size while keeping flora and creature counts tied to the old density target so islands have more breathing room.
- Changed the default orbit camera to frame the generated island from its actual layout radius.
- Lowered the renderer pixel-ratio cap for mobile viewports.
- Added Verdant Grove shadow LOD so far static flora no longer all submit to the shadow map.
- Limited creature and caterpillar contact-shadow discs to the active camera or orbit focus area.
- Changed Mossy Ruins from the black grass-edge ring to a translucent mist ring.
- Doubled default grass density for grass-enabled biomes, including a saved-setting migration so existing browsers move from the old 12.5 baseline to the new 25 baseline.
- Extended the perf probe output with the active static shadow LOD radius.

### Fixed
- Reduced the mobile fly joystick look sensitivity by 50%.
- Fixed stale obstacle-grid reuse during async world generation so fauna steering falls back to the current obstacle array.

### Verified
- Verified with focused JS tests for grass density, island sizing, mobile fly touch, fauna obstacle avoidance, Mossy Ruins mist ring, orbit/render/shadow LOD, and perf-probe reporting.
- Verified with rendered Chrome smoke tests for Verdant Grove and Mossy Ruins, including a Verdant probe showing doubled grass count from `276950` to `553900` with FX disabled.
- Verified with `make checkall` and `graphify update .`.

## 1.3.8 - 2026-05-28

### Changed
- Reworked mobile fly controls into circular touch controls pinned above the bottom HUD.
- Replaced the mobile fly direction arrows with a left-side look joystick.
- Changed the right-side mobile fly buttons to drive forward and backward movement.

### Verified
- Verified with `node tests/mobile-fly-touch-static.test.mjs`, `make checkall`, a mobile viewport smoke test, and `graphify update .`.

## 1.3.7 - 2026-05-28

### Added
- Added compact mobile touch controls for fly camera mode, with edge-pinned movement and altitude buttons plus touch-drag look on the open view.
- Added static regression coverage for the mobile fly camera touch controls.

### Changed
- Changed the fresh-load auto-rotate camera setting to default off in both runtime state and the static settings markup.

### Verified
- Verified with `node tests/mobile-fly-touch-static.test.mjs`, the focused auto-rotate unittest, `make checkall`, and `git diff --check`.

## 1.3.6 - 2026-05-28

### Changed
- Changed the footer fly control into an explicit orbit/fly toggle with clearer active-state text.
- Improved the mobile footer grid so camera toggles and regenerate actions keep balanced touch targets on narrow screens.

### Verified
- Verified with `node tests/pov-toggle-static.test.mjs`, `make checkall`, and a 390px-wide Playwright mobile render/click check.

## 1.3.3 - 2026-05-26

### Added
- Added first-visit help that opens the full help modal once per browser.
- Added a main-view fly camera mode, available from settings or the `V` key, with WASD movement, mouse look, and `E`/`Q` vertical movement.
- Added regression coverage for HUD readability, help modal layout, music toggle state, and immediate music shutdown.
- Added static regression coverage for the fly camera mode UI wiring and tilt-shift gating.

### Changed
- Improved HUD readability with stronger mono text, translucent backdrops, higher contrast secondary labels, and title-cased biome names.
- Changed the help panel into a centered modal with fixed `Help & Controls`, `Modes`, and `Controls` header content while only the body rows scroll.
- Changed help and camera settings copy to document fly camera controls.
- Removed the persistent `drag · zoom · observe` hint above the lower controls.
- Made the top-left title block fade out after five seconds.
- Updated the music toggle icon and accessible labels to distinguish music-on from muted state.

### Fixed
- Fixed music toggle-off behavior so the shared background audio element is silenced and paused immediately.
- Fixed same-origin tab behavior so music-off settings propagate to other open Small World tabs.
- Fixed tilt-shift gating so it also stays disabled while the main-view fly camera is active.

### Verified
- UI/music changes were committed in `959e521` after `make checkall`, focused UI/music regression tests, rendered browser checks for the help modal, music toggle, and title fade, `git diff --check`, and `graphify update .`.
- Fly camera changes were verified with focused fly-mode and tilt-shift static tests, `make checkall`, `graphify update .`, and a Playwright smoke test for `V`, `W`, and `Esc`.
- Release version bump and documentation updates were verified with `make checkall`.

## 1.3.2 - 2026-05-25

### Added
- Added biome portals that can render a preview of the destination biome and allow first-person traversal by reloading into the target seed.
- Added portal settings for enabling portals, double portal placement, and preview rendering details for grass, flora, creatures, and local FX.
- Added original biome music scores and a biome music track selector that can override the default track per biome.

### Changed
- Biome music now streams from `https://static.pardev.net/small-world/music/` so MP3 files stay out of the GitHub Pages build and git history.
- Portal rings now use the destination biome palette and sit deeper in the ground.
- Double portal placement now spreads portals across the island instead of clustering them.
- Portal previews now use higher-fidelity render targets, player-matched projection, and destination biome terrain/flora/grass/creature generation.
- Portals now default to off.

### Fixed
- Fixed portal-side arrival orientation and pointer-lock handling after traversal.
- Fixed portal placement and terrain flattening so portals avoid obstacles and reduce nearby flora/grass clipping.
- Fixed portal previews that could render the wrong side, upside-down back views, or placeholder-like destination scenes.
