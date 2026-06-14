import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

assert(
  uiSource.includes('photoHudEl.setAttribute("aria-hidden", "true");\n    _photoReview ='),
  'Showing the photo review should hide the photo HUD/center reticle before storing review state.'
);

assert(
  uiSource.includes('photoSeedEl.setAttribute("aria-hidden", "true");\n    photoHudEl.setAttribute("aria-hidden", "true");\n    _photoReview ='),
  'Showing the photo review should hide the photo seed and hint row so review actions do not overlap it.'
);

assert(
  uiSource.includes('photoHudEl.setAttribute("aria-hidden", "false");'),
  'Closing the photo review while staying in photo mode should restore the photo HUD/reticle.'
);

assert(
  uiSource.includes('photoSeedEl.setAttribute("aria-hidden", "false");\n        photoHudEl.setAttribute("aria-hidden", "false");'),
  'Closing the photo review while staying in photo mode should restore the photo seed and hint row.'
);

assert(
  cssSource.includes('body.photo-mode .photo-hud[aria-hidden="true"] { opacity: 0; }'),
  'The photo HUD aria-hidden state should visually hide the reticle even while body.photo-mode is active.'
);

assert(
  cssSource.includes('body.photo-mode .photo-seed[aria-hidden="true"] { opacity: 0; pointer-events: none; }'),
  'The photo seed aria-hidden state should visually hide the seed and hint row even while body.photo-mode is active.'
);
