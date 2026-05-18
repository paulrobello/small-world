import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";

const state = readFileSync("src/state.js", "utf8");
const music = readFileSync("src/music.js", "utf8");
const ui = readFileSync("src/ui.js", "utf8");
const html = readFileSync("index.html", "utf8");

assert.match(state, /musicVolume:\s*0\.5/);
assert.match(state, /musicEnabled:\s*false/);
assert.match(music, /const MAX_VOLUME = 0\.15/);
assert.match(music, /return MAX_VOLUME \* Math\.max\(0, Math\.min\(1, volume\)\)/);
assert.match(music, /function clampAudioVolume\(volume\)/);
assert.match(music, /el\.volume = clampAudioVolume\(start \+ diff \* p\)/);
assert.match(music, /export function setMusicVolume\(volume\)/);
assert.match(ui, /"musicVolume"/);
assert.match(ui, /setMusicVolume\(v \/ 100\)/);
assert.match(html, /id="setting-music-volume"/);
assert.match(html, /id="setting-music-volume-value">50%/);
