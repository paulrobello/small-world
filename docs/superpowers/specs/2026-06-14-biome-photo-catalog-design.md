# Biome Photo Catalog Design

Date: 2026-06-14

## Goal

Make photo mode more engaging by adding a persistent fauna/flora catalog that rewards exploring each biome and photographing catalog subjects.

The catalog is biome-specific. A subject photographed in one biome does not unlock that subject in another biome.

## Approved Direction

Use photo mode as a field-guide capture loop:

1. The user enters photo mode and frames a subject in the reticle.
2. Capturing a photo raycasts through the center reticle.
3. The nearest catalogable subject hit by the reticle becomes the photo subject.
4. The subject unlocks or updates a biome-specific catalog entry.
5. If that entry already has a photo, the user compares the current photo with the new photo and chooses whether to keep or replace it.

This should be geometric subject identification, not image recognition. The app already owns the Three.js scene graph and can tag catalogable objects directly.

## Catalog Scope

Each biome shows only entries that can actually appear in that biome.

Entry identity is based on:

- Category: `fauna` or `flora`
- Variant: subject type, such as `snail`, `fish`, `mushroom`, or `crystal`
- Biome ID: current biome, such as `grove`, `coral`, or `frozen`

Example keys:

- `fauna:snail:grove`
- `fauna:fish:coral`
- `flora:snowpine:frozen`
- `flora:crystal:obsidian`

The first implementation should use a curated checklist generated from existing biome config and known fauna rules. Do not show impossible placeholders for a biome.

## Subject Identification

Photo capture should identify only the intended reticle subject.

Implementation rule:

- Raycast from the camera through the screen center.
- Walk up each hit object's parent chain until an ancestor with `userData.catalog` is found.
- Ignore non-catalogable hits such as terrain, water, sky, particles, portals, and decorative internals.
- Use the closest catalogable subject.
- If no subject is found, keep the photo review available but show that it cannot be saved to the catalog.

Catalog metadata should be attached to the root object for each catalogable subject:

```js
group.userData.catalog = {
  category: "fauna",
  variant: "snail",
  biomeId: biome.id,
  label: "Snail",
};
```

Flora roots should receive matching metadata during placement in `src/world.js`. Creature roots should receive matching metadata in the fauna builders or immediately after creation.

Instanced ground-cover subjects need special handling. The first implementation may include non-instanced flora and fauna only if proxy picking for instanced subjects would make the first pass too large. If instanced subjects are included, use either `instanceId`-aware picking or lightweight invisible proxy pick volumes with catalog metadata.

## Persistence

Use split storage:

- `localStorage` stores the catalog index and lightweight entry metadata.
- `IndexedDB` stores thumbnail image blobs.

Catalog metadata should include:

- Entry key
- Category
- Variant
- Label
- Biome ID
- First discovery timestamp
- Last updated timestamp
- Seed for the saved photo
- Thumbnail blob ID
- Capture count

Photos should be downscaled before storage. The catalog does not need full-resolution screenshots.

If IndexedDB is unavailable or quota fails, the app should fail gracefully: keep normal photo save behavior working and show that catalog persistence is unavailable.

## Photo Review Flow

Photo mode currently captures a PNG and shows a 3D review card with save/discard actions. The catalog flow should extend that review rather than bypass it.

New entry:

- Show the captured photo.
- Show a "new catalog entry" state with the subject label and biome.
- Actions: `save to catalog`, `discard`, and existing local PNG save behavior.

Existing entry:

- Load the current catalog thumbnail.
- Show current photo and new photo side by side.
- Actions: `keep current`, `replace`, and existing local PNG save behavior.
- `keep current` closes the catalog comparison without changing stored metadata.
- `replace` writes the new thumbnail blob and updates timestamps, seed, and capture count.

No catalog write should occur until the user confirms.

## Catalog UI

Add a catalog panel near the existing settings/locator affordances.

Panel behavior:

- Group entries by biome.
- Surface the current biome first.
- Show fauna and flora sections within each biome.
- Locked entries show a soft placeholder and label.
- Unlocked entries show the saved thumbnail, label, seed, and capture date.
- Clicking an unlocked entry opens the saved photo detail.
- Photo detail can offer a "visit seed" action that loads the saved seed.

The UI should stay consistent with Small World's cute, quiet HUD style. It should feel like a field guide, not an achievement dashboard.

## Implementation Boundaries

Expected modules:

- `src/catalog.js`
  - Catalog entry definitions.
  - Biome-specific checklist generation.
  - `localStorage` metadata load/save.
  - IndexedDB thumbnail get/put/delete helpers.
  - Save, keep, and replace operations.

- `src/photoSubject.js`
  - Center-reticle raycast subject detection.
  - Hit-object to catalog-subject resolution.
  - Helper for checking whether a subject is catalogable.

- `src/ui.js`
  - Photo review integration.
  - Catalog compare/replace actions.
  - Catalog panel rendering and event wiring.

- `src/world.js`
  - Attach flora catalog metadata during placement.
  - Attach or normalize fauna catalog metadata after spawning if builders do not own it.

- `src/fauna/*`
  - Attach fauna catalog metadata where variant identity is already known.

- `index.html` and `style.css`
  - Catalog button, panel, locked/unlocked cards, and compare UI.

Keep the first implementation surgical. Do not redesign photo mode, inspect mode, bookmarks, or locator behavior.

## Testing and Verification

Automated checks:

1. Catalog key generation includes category, variant, and biome ID.
2. Biome checklist generation only includes entries possible for that biome.
3. Catalog storage supports first save, existing-entry keep, and existing-entry replace.
4. Photo subject resolution ignores uncatalogable objects and returns the nearest catalogable ancestor.
5. Fauna and flora creation paths attach catalog metadata for included entry types.

Manual/browser checks:

1. Photograph a new subject and save it to the catalog.
2. Open the catalog and confirm the current biome entry is unlocked with the thumbnail.
3. Photograph the same subject again and verify the current-vs-new comparison appears.
4. Choose keep current and verify the thumbnail does not change.
5. Choose replace and verify the thumbnail updates.
6. Photograph a non-catalogable view and verify no catalog write occurs.
7. Verify normal local PNG saving still works.

Final verification:

- Run `make checkall`.
- Use browser verification for the photo review and catalog panel.

## Out of Scope

- Server sync or cross-browser/account sync.
- Real image recognition or AI subject classification.
- Full-resolution photo library storage.
- Sharing catalog progress in URLs.
- Global species completion across biomes.
- Reworking inspect mode into the catalog.
