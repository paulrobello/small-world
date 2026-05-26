import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { BIOMES } from "../src/biomes.js";

const music = readFileSync("src/music.js", "utf8");
const ui = readFileSync("src/ui.js", "utf8");
const html = readFileSync("index.html", "utf8");
const gitignore = readFileSync(".gitignore", "utf8");

function nameToTrack(name) {
  return `${name
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("")}.mp3`;
}

const expectedBiomeTracks = BIOMES.map((biome) => nameToTrack(biome.name));

for (const track of expectedBiomeTracks) {
  assert(!/\s/.test(track), `Expected ${track} to be space-free.`);
  assert(
    music.includes(`"${track}"`),
    `Expected biome music track ${track} to be registered in src/music.js.`,
  );
}

assert.match(music, /const MUSIC_BASE_URL = "https:\/\/static\.pardev\.net\/small-world\/music"/);
assert.match(music, /const src = `\$\{MUSIC_BASE_URL\}\/\$\{track\}`/);
assert.match(music, /export const AVAILABLE_MUSIC_TRACKS = \[/);
assert.match(music, /export const BIOME_TRACKS = \{/);
assert.match(music, /export function defaultTrackForBiome\(biome\)/);
assert.match(music, /export function selectedTrackForBiome\(biome\)/);
assert.match(music, /export function setMusicTrackOverride\(biomeId, track\)/);
assert.match(music, /state\.userSettings\.musicTrackOverrides/);
assert.match(ui, /"musicTrackOverrides"/);
assert.match(ui, /getElementById\("setting-music-track"\)/);
assert.match(ui, /refreshMusicTrackSelect/);
assert.match(ui, /setMusicTrackOverride\(state\.currentBiome\?\.id, musicTrackEl\.value\)/);
assert.match(html, /id="setting-music-track"/);
assert.match(gitignore, /public\/music\//);
