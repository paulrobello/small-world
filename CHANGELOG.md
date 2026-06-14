# Changelog

> Versioning is semantic (major.minor.patch) and tracks `package.json`. Versions
> 1.3.4 and 1.3.5 were never cut as separate releases — work in that range was
> folded into the adjacent 1.3.3 and 1.3.6 entries — which is why the history
> below jumps from 1.3.3 to 1.3.6.

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
