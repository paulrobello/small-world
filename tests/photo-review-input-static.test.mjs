import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

assert(
  uiSource.includes('_photoFP.reviewOpen = true'),
  'Opening the photo review should mark photo first-person input as suspended.'
);
assert(
  uiSource.includes('document.exitPointerLock?.()'),
  'Opening the photo review should release pointer lock so save/discard buttons are clickable.'
);
assert(
  uiSource.includes('if (fp.reviewOpen) return;'),
  'Photo review should suspend first-person movement while the save/discard prompt is visible.'
);
assert(
  uiSource.includes('if (_photoFP.reviewOpen) return;'),
  'Pointer-lock changes caused by photo review should not exit photo mode.'
);
assert(
  uiSource.includes('if (k === "s" && down) { capturePhoto(); e.preventDefault(); return; }'),
  'S key should trigger photo capture in first-person photo mode instead of being consumed as backward movement.'
);
assert(
  !uiSource.includes('document.body.classList.contains("photo-mode") && !_photoFP'),
  'Global S-key capture should not be gated off while first-person photo mode is active.'
);
