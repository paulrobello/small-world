import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

const vignetteBlock = cssSource.match(/\.vignette\s*\{[^}]*\}/)?.[0] ?? '';

assert(
  !vignetteBlock.includes('radial-gradient'),
  'The global vignette overlay should not add a center halo or dark camera-edge falloff.'
);

assert(
  !uiSource.includes('const dim = document.createElement("div");'),
  'Photo review dimming should not use a DOM overlay above the canvas because it darkens the postcard preview.'
);

assert(
  uiSource.includes('dimMesh.renderOrder = 998'),
  'Photo review dimming should render behind the postcard in the 3D review group.'
);

assert(
  uiSource.includes('dimMat.opacity = 0.45'),
  'Photo review dimming should darken the scene separately from the postcard preview.'
);
