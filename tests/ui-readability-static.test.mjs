import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');

function ruleFor(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cssSource.match(new RegExp(`(^|\\n)${escaped}\\s*\\{(?<body>[^}]*)\\}`, 'm'));
  assert(match?.groups?.body, `Missing CSS rule for ${selector}.`);
  return match.groups.body;
}

assert(
  cssSource.includes('--hud-backdrop: rgba(8, 6, 14, 0.58);')
    && cssSource.includes('--hud-border: rgba(245, 240, 230, 0.18);')
    && cssSource.includes('--hud-text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95), 0 0 18px rgba(0, 0, 0, 0.72);'),
  'HUD readability should use shared backdrop, border, and text-shadow tokens.'
);

for (const selector of ['.title-block', '.biome-card', '.stats']) {
  const rule = ruleFor(selector);
  assert(
    rule.includes('background: var(--hud-backdrop);')
      && rule.includes('border: 1px solid var(--hud-border);')
      && rule.includes('backdrop-filter: blur(6px);')
      && rule.includes('text-shadow: var(--hud-text-shadow);'),
    `${selector} should sit on a translucent readability backdrop.`
  );
}

assert(
  ruleFor('.title-block').includes('animation: titleBlockFadeOut 0.8s ease 5s forwards;')
    && cssSource.includes('@keyframes titleBlockFadeOut')
    && cssSource.includes('visibility: hidden;')
    && cssSource.includes('pointer-events: none;'),
  'The top-left title block should fade out after five seconds and stop intercepting pointer input.'
);

assert(
  ruleFor('.biome-name').includes('font-family: "DM Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;')
    && ruleFor('.value').includes('font-family: "DM Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;'),
  'High-frequency HUD values should use the more readable mono face instead of the display face.'
);

assert(
  ruleFor('.biome-name').includes('text-transform: capitalize;'),
  'The visible biome name should render in title case.'
);

assert(
  cssSource.includes('--ink-dim: rgba(245, 240, 230, 0.78);')
    && cssSource.includes('--ink-faint: rgba(245, 240, 230, 0.58);'),
  'Dim and faint text should remain readable over bright or high-motion biomes.'
);

assert(
  ruleFor('.label').includes('font-weight: 500;')
    && ruleFor('.island-name').includes('font-weight: 500;')
    && ruleFor('.biome-sub').includes('font-weight: 500;')
    && ruleFor('.biome-sub').includes('color: var(--ink);'),
  'Thin secondary HUD text should use the heavier loaded font weight and full ink contrast.'
);

assert(
  ruleFor('.island-name').includes('font-family: "DM Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;')
    && ruleFor('.island-name').includes('font-style: normal;')
    && ruleFor('.biome-sub').includes('font-family: "DM Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;')
    && ruleFor('.biome-sub').includes('font-style: normal;'),
  'Secondary biome-card copy should avoid thin italic serif rendering.'
);

assert(
  !indexSource.includes('<div class="hint">drag · zoom · observe</div>'),
  'The persistent bottom controls hint should be removed above the buttons.'
);

assert(
  ruleFor('.help-panel').includes('top: 50%;')
    && ruleFor('.help-panel').includes('left: 50%;')
    && ruleFor('.help-panel').includes('width: min(880px, calc(100vw - 48px));')
    && ruleFor('.help-panel').includes('max-height: min(720px, calc(100vh - 64px));')
    && ruleFor('.help-panel').includes('display: flex;')
    && ruleFor('.help-panel').includes('flex-direction: column;')
    && ruleFor('.help-panel').includes('overflow: hidden;')
    && ruleFor('.help-panel.open').includes('transform: translate(-50%, -50%) scale(1);'),
  'Help should open as a centered full modal instead of a small corner drawer.'
);

assert(
  ruleFor('.help-desktop').includes('display: grid;')
    && ruleFor('.help-desktop').includes('grid-template-columns: repeat(2, minmax(0, 1fr));')
    && ruleFor('.help-desktop-labels').includes('grid-template-columns: repeat(2, minmax(0, 1fr));')
    && ruleFor('.help-list').includes('font-size: 14px;')
    && ruleFor('.help-list').includes('row-gap: 12px;'),
  'Help modal content should use a larger, more readable two-column layout.'
);

assert(
  indexSource.includes('<div class="help-desktop-labels" aria-hidden="true">')
    && indexSource.includes('<div class="help-scroll">')
    && ruleFor('.help-scroll').includes('overflow-y: auto;')
    && ruleFor('.help-scroll').includes('min-height: 0;'),
  'Help modal section labels should live in the fixed header and only the body content should scroll.'
);

assert(
  cssSource.includes('@media (max-width: 720px) {\n  .help-desktop { display: none; }\n  .help-mobile { display: block; }'),
  'Narrow viewports should use the mobile help content even when hover is available.'
);

assert(
  uiSource.includes('const HELP_SEEN_KEY = "smallworld:help-seen:v1";')
    && uiSource.includes('function shouldShowFirstVisitHelp()')
    && uiSource.includes('localStorage.getItem(HELP_SEEN_KEY)')
    && uiSource.includes('localStorage.setItem(HELP_SEEN_KEY, "1")')
    && uiSource.includes('if (!INSPECT && shouldShowFirstVisitHelp()) {')
    && uiSource.includes('setHelpOpen(true);'),
  'Help should automatically open once on a user’s first visit and persist that it was seen.'
);

assert(
  ruleFor('.help-panel .settings-head').includes('position: sticky;')
    && ruleFor('.help-panel .settings-head').includes('top: 0;')
    && ruleFor('.help-panel .settings-head').includes('z-index: 2;'),
  'Help modal header should stay sticky while the modal content scrolls.'
);

assert(
  uiSource.includes('const musicGlyph = musicBtn.querySelector(".music-glyph");')
    && uiSource.includes('musicGlyph.textContent = state.userSettings.musicEnabled ? "♫" : "🔇";')
    && uiSource.includes('musicBtn.setAttribute("aria-label", state.userSettings.musicEnabled ? "music on" : "music off");')
    && uiSource.includes('musicBtn.title = state.userSettings.musicEnabled ? "music on" : "music off";'),
  'Music toggle off state should use a no-sound glyph instead of another note.'
);

assert(
  uiSource.includes('window.addEventListener("storage", (event) => {')
    && uiSource.includes('event.key !== SETTINGS_KEY')
    && uiSource.includes('setMusicEnabled(state.userSettings.musicEnabled);')
    && uiSource.includes('updateMusicButton();'),
  'Music setting changes should propagate to other same-origin tabs so background tabs stop playing too.'
);
